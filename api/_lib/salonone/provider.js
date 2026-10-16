// ============================================================
// SalonOne データ供給（ライブ / デモの切り替え + キャッシュ + 対応付け）
// ------------------------------------------------------------
// ダッシュボード側の店舗・スタッフ（Supabase）と SalonOne 側の店舗・スタッフは
// 設定画面で対応付ける（dash_config に保存）。
//   salonone.shopMap    : { [ダッシュボード店舗ID]: SalonOne店舗ID }
//   salonone.staffMap   : { [ダッシュボードスタッフID]: SalonOneスタッフID }
//   salonone.channelMap : { [来店経由名]: 経路キー }
//   salonone.planRules  : { sharePlanKeyword, payPerVisitKeyword }
// デモモードでは SalonOne 側の ID = ダッシュボード側の ID として扱う。
// ============================================================

import { supabase } from '../supabase.js';
import {
  salonOneConfig, fetchShops, fetchStaff, fetchReceptions, fetchContracts, fetchRetention, fetchVisitSources,
} from './client.js';
import {
  normalizeShop, normalizeStaff, normalizeReception, normalizeContract, normalizeRetention, pick,
} from './normalize.js';
import { demoMaster, simulateDemo, DEMO_SOURCES } from './demo.js';
import { monthRange, monthOf, monthsBetween, todayJst } from '../../../shared/dates.js';

export const CONFIG_KEYS = ['salonone.shopMap', 'salonone.staffMap', 'salonone.channelMap', 'salonone.planRules'];

// ------------------------------------------------------------
// インスタンス内キャッシュ（サーバーレスのウォーム中だけ有効）
// ------------------------------------------------------------
const cache = new Map();
function cached(key, ttlMs, loader, refresh) {
  const hit = cache.get(key);
  if (!refresh && hit && hit.expires > Date.now()) return hit.promise;
  const promise = loader().catch((e) => { cache.delete(key); throw e; });
  cache.set(key, { promise, expires: Date.now() + ttlMs });
  if (cache.size > 200) {
    for (const [k, v] of cache) if (v.expires <= Date.now()) cache.delete(k);
  }
  return promise;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const keywordPattern = (kw, fallback) => {
  const words = String(kw || fallback || '').split(/[,、\s]+/).filter(Boolean);
  return words.length ? new RegExp(words.map(escapeRe).join('|'), 'i') : null;
};

// ------------------------------------------------------------
// ダッシュボード側のマスタと設定
// ------------------------------------------------------------
export async function loadAppContext() {
  const ctx = { stores: [], staff: [], config: {}, dbError: null };
  try {
    const [st, sf, ss, cf] = await Promise.all([
      supabase.from('stores').select('id, name, status, merged_into').order('created_at'),
      supabase.from('staff').select('id, name, role, status').order('created_at'),
      supabase.from('staff_stores').select('staff_id, store_id'),
      supabase.from('dash_config').select('key, value').in('key', CONFIG_KEYS),
    ]);
    for (const r of [st, sf, ss, cf]) if (r.error) throw r.error;
    ctx.stores = (st.data || [])
      .filter((s) => s.status !== 'inactive' && !s.merged_into)
      .map((s) => ({ id: String(s.id), name: s.name }));
    const storeIdsByStaff = new Map();
    for (const r of ss.data || []) {
      const list = storeIdsByStaff.get(r.staff_id) || [];
      list.push(String(r.store_id));
      storeIdsByStaff.set(r.staff_id, list);
    }
    ctx.staff = (sf.data || []).map((s) => ({
      id: String(s.id), name: s.name, role: s.role || 'staff', status: s.status || 'active',
      storeIds: storeIdsByStaff.get(s.id) || [],
    }));
    for (const r of cf.data || []) ctx.config[r.key] = r.value || {};
  } catch (e) {
    // Supabase 未設定（ローカル開発など）でもデモ表示はできるようにする
    ctx.dbError = e && e.message ? e.message : String(e);
  }
  return ctx;
}

// ------------------------------------------------------------
// SalonOne マスタ（店舗・スタッフ・来店経由）
// ------------------------------------------------------------
export async function loadMaster(appCtx, { refresh } = {}) {
  const cfg = salonOneConfig();
  if (!cfg.configured) {
    const m = demoMaster(appCtx.stores, appCtx.staff.filter((s) => s.status !== 'inactive'));
    return { mode: 'demo', shops: m.shops, staff: m.staff, sources: DEMO_SOURCES.map((s) => s.name) };
  }
  return cached('master', 10 * 60 * 1000, async () => {
    const [shopsRaw, staffRaw, sourcesRaw] = await Promise.all([
      fetchShops(cfg),
      fetchStaff(cfg),
      fetchVisitSources(cfg).catch(() => []),
    ]);
    return {
      mode: 'live',
      shops: shopsRaw.map(normalizeShop).filter((s) => s.id),
      staff: staffRaw.map(normalizeStaff).filter((s) => s.id && s.active),
      sources: sourcesRaw.map((s) => String(pick(s, ['name', 'visit_source_name', 'label'], ''))).filter(Boolean),
    };
  }, refresh);
}

/**
 * ダッシュボード ⇔ SalonOne の ID 対応付け
 */
export function buildMapping(appCtx, master) {
  const demo = master.mode === 'demo';
  const shopMap = demo ? {} : (appCtx.config['salonone.shopMap'] || {});
  const staffMap = demo ? {} : (appCtx.config['salonone.staffMap'] || {});
  const storeIds = new Set(appCtx.stores.map((s) => s.id));
  const staffIds = new Set(appCtx.staff.map((s) => s.id));

  const storeToShop = new Map();
  const shopToStore = new Map();
  for (const store of appCtx.stores) {
    const shopId = demo ? store.id : (shopMap[store.id] ? String(shopMap[store.id]) : '');
    if (!shopId) continue;
    storeToShop.set(store.id, shopId);
    if (!shopToStore.has(shopId)) shopToStore.set(shopId, store.id);
  }
  if (demo && appCtx.stores.length === 0) {
    // サンプル店舗しか無い場合は、その ID をそのまま店舗 ID として使う
    for (const shop of master.shops) { storeToShop.set(shop.id, shop.id); shopToStore.set(shop.id, shop.id); }
  }

  const staffToS1 = new Map();
  const s1ToStaff = new Map();
  if (demo) {
    for (const s of master.staff) if (staffIds.has(s.id)) { staffToS1.set(s.id, s.id); s1ToStaff.set(s.id, s.id); }
  } else {
    for (const [staffId, s1Id] of Object.entries(staffMap)) {
      if (!s1Id || !staffIds.has(staffId)) continue;
      staffToS1.set(staffId, String(s1Id));
      if (!s1ToStaff.has(String(s1Id))) s1ToStaff.set(String(s1Id), staffId);
    }
  }
  return {
    storeToShop, shopToStore, staffToS1, s1ToStaff,
    unmappedStores: appCtx.stores.filter((s) => !storeToShop.has(s.id)).map((s) => s.id),
    knownStore: (id) => storeIds.has(id),
  };
}

// ------------------------------------------------------------
// 受付・契約データ
// ------------------------------------------------------------
function planPatterns(appCtx) {
  const rules = appCtx.config['salonone.planRules'] || {};
  return {
    sharePlanPattern: keywordPattern(rules.sharePlanKeyword, 'シェア'),
    payPerVisitPattern: keywordPattern(rules.payPerVisitKeyword, '都度'),
  };
}

async function liveReceptionsForMonth(cfg, shops, month, asOf, refresh) {
  const current = monthOf(asOf) === month;
  const ttl = current ? 3 * 60 * 1000 : 60 * 60 * 1000;
  return cached(`rec:${month}:${current ? asOf : 'past'}`, ttl, async () => {
    const { from, to } = monthRange(month);
    const lists = await Promise.all(shops.map((s) => fetchReceptions(cfg, { from, to: current && asOf < to ? asOf : to, shopId: s.id })));
    return lists.flat().map(normalizeReception).filter((r) => r.date && monthOf(r.date) === month);
  }, refresh);
}

async function liveContracts(cfg, shops, asOf, appCtx, refresh) {
  return cached(`con:${asOf}`, 10 * 60 * 1000, async () => {
    const opts = planPatterns(appCtx);
    const lists = await Promise.all(shops.map((s) => fetchContracts(cfg, { shopId: s.id, to: asOf })));
    return lists.flat().map((c) => normalizeContract(c, opts)).filter((c) => c.customerId && c.startDate);
  }, refresh);
}

/**
 * 指定月のデータ一式（全店舗分。権限による絞り込みは呼び出し側で行う）
 * @returns {{ mode, receptions, contracts, retentionOverrides, asOf }}
 */
export async function loadDataset(appCtx, master, { months, refresh } = {}) {
  const asOf = todayJst();
  const wanted = [...new Set(months)].filter((m) => monthsBetween(m, monthOf(asOf)) >= 0);
  if (master.mode === 'demo') {
    const sim = simulateDemo({ shops: master.shops, staff: master.staff, months: wanted, asOf });
    return { mode: 'demo', receptions: sim.receptions, contracts: sim.contracts, retentionOverrides: {}, asOf };
  }
  const cfg = salonOneConfig();
  const [recLists, contracts] = await Promise.all([
    Promise.all(wanted.map((m) => liveReceptionsForMonth(cfg, master.shops, m, asOf, refresh))),
    liveContracts(cfg, master.shops, asOf, appCtx, refresh),
  ]);
  // 継続指標を API が集計済みで返す場合だけ使う（月ごと）
  const retentionOverrides = {};
  if (cfg.endpoints.retention) {
    for (const m of wanted) {
      try {
        const rows = (await Promise.all(master.shops.map((s) => fetchRetention(cfg, { month: m, shopId: s.id })))).flat();
        retentionOverrides[m] = Object.fromEntries(rows.map(normalizeRetention).filter((r) => r.shopId).map((r) => [r.shopId, r]));
      } catch (e) {
        console.warn('[salonone] retention fetch failed:', e.message);
      }
    }
  }
  return { mode: 'live', receptions: recLists.flat(), contracts, retentionOverrides, asOf };
}

export function clearSalonOneCache() {
  cache.clear();
}
