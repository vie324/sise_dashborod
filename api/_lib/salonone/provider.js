// ============================================================
// SalonOne データ供給（ライブ / デモの切り替え + キャッシュ + 対応付け）
// ------------------------------------------------------------
// ダッシュボード側の店舗・スタッフ（Supabase）と SalonOne 側の店舗・スタッフは
// 設定画面で対応付ける（dash_config に保存）。
//   salonone.shopMap    : { [ダッシュボード店舗ID]: SalonOne店舗ID }
//   salonone.staffMap   : { [ダッシュボードスタッフID]: SalonOneスタッフID }
//   salonone.channelMap : { [来店経由名]: 経路キー }
//   salonone.planRules  : { sharePlanKeyword, payPerVisitKeyword }
//   salonone.retentionSnapshots : { 'YYYY-MM': { [SalonOne店舗ID]: 継続指標 } }
//       継続管理の値は「取得した時点」のものしか取れないため、当月分を取得するたびに保存し、
//       過去の月はここに残った値（その月の最後の取得時点）を使う。
// デモモードでは SalonOne 側の ID = ダッシュボード側の ID として扱う。
// ============================================================

import { supabase } from '../supabase.js';
import {
  salonOneConfig, fetchShops, fetchStaff, fetchVisitSources, fetchReceptions, fetchSalesSummary,
  fetchRetentionSummary, fetchRetentionCustomers,
} from './client.js';
import {
  normalizeShop, normalizeStaff, normalizeVisitSourceName, normalizeReception, normalizeRetention,
  normalizeSalesSummary, contractsFromReceptions,
} from './normalize.js';
import { demoMaster, simulateDemo, DEMO_SOURCES } from './demo.js';
import { monthRange, monthOf, monthsBetween, todayJst, addDays } from '../../../shared/dates.js';

export const RETENTION_KEY = 'salonone.retentionSnapshots';
export const CONFIG_KEYS = ['salonone.shopMap', 'salonone.staffMap', 'salonone.channelMap', 'salonone.planRules', RETENTION_KEY];

// ------------------------------------------------------------
// インスタンス内キャッシュ（サーバーレスのウォーム中だけ有効）
// ------------------------------------------------------------
// 同じキーの取得が重なったら 1回にまとめる。取り直しに失敗したときは前回の値を
// stale として返す（SalonOne の一時的な不調や利用上限で画面が真っ白にならないように）。
const cache = new Map();
const MAX_ENTRIES = 500;
const RETRY_AFTER_FAILURE_MS = 60 * 1000;

/** @returns {Promise<{ value:any, fetchedAt:number, stale:boolean, error?:string }>} */
function cached(key, ttlMs, loader, refresh) {
  const now = Date.now();
  const hit = cache.get(key);
  if (!refresh && hit && hit.expires > now) return hit.pending;
  const last = hit ? hit.last : null;
  const pending = loader().then(
    (value) => {
      const res = { value, fetchedAt: Date.now(), stale: false };
      cache.set(key, { pending: Promise.resolve(res), expires: Date.now() + ttlMs, last: res });
      return res;
    },
    (e) => {
      if (!last) { cache.delete(key); throw e; }
      const res = { ...last, stale: true, error: e && e.message ? e.message : String(e) };
      cache.set(key, { pending: Promise.resolve(res), expires: Date.now() + RETRY_AFTER_FAILURE_MS, last });
      return res;
    },
  );
  cache.set(key, { pending, expires: now + ttlMs, last });
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
  return pending;
}

// 当月はこまめに、締まった月ほど長く持つ（1分 60回の上限を使い切らないように）
const TTL_CURRENT = 5 * 60 * 1000;
const TTL_PREVIOUS = 30 * 60 * 1000;
const TTL_OLDER = 6 * 60 * 60 * 1000;
const TTL_MASTER = 30 * 60 * 1000;
const TTL_RETENTION = 30 * 60 * 1000;
const TTL_TENURE = 6 * 60 * 60 * 1000;

function ttlFor(month, asOf) {
  const diff = monthsBetween(month, monthOf(asOf));
  return diff <= 0 ? TTL_CURRENT : diff === 1 ? TTL_PREVIOUS : TTL_OLDER;
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
    return { mode: 'demo', shops: m.shops, staff: m.staff, sources: DEMO_SOURCES.map((s) => s.name), stale: [] };
  }
  const res = await cached('master', TTL_MASTER, async () => {
    const [shopsRaw, staffRaw, sourcesRaw] = await Promise.all([
      fetchShops(cfg),
      fetchStaff(cfg),
      fetchVisitSources(cfg).catch(() => []),
    ]);
    return {
      shops: shopsRaw.map(normalizeShop).filter((s) => s.id && s.active),
      staff: staffRaw.map(normalizeStaff).filter((s) => s.id && s.active),
      sources: [...new Set(sourcesRaw.filter((s) => !(s && s.deleted_at)).map(normalizeVisitSourceName).filter(Boolean))],
    };
  }, refresh);
  return { mode: 'live', ...res.value, stale: res.stale ? [{ fetchedAt: res.fetchedAt, error: res.error }] : [] };
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
// 受付履歴・継続管理
// ------------------------------------------------------------
function planPatterns(appCtx) {
  const rules = appCtx.config['salonone.planRules'] || {};
  return {
    sharePlanPattern: keywordPattern(rules.sharePlanKeyword, 'シェア'),
    payPerVisitPattern: keywordPattern(rules.payPerVisitKeyword, '都度'),
  };
}

/** 1店舗・1ヶ月分の売上サマリ（SalonOne の売上分析と同じ数字。日別・スタッフ別つき） */
function shopMonthSummary(cfg, shopId, month, asOf, refresh) {
  const { from, to } = monthRange(month);
  return cached(`sum:${shopId}:${month}`, ttlFor(month, asOf), async () => (
    normalizeSalesSummary(await fetchSalesSummary(cfg, { from, to, shopId }))
  ), refresh);
}

/** 1店舗・1ヶ月分の受付履歴（予約日時がその月の予約。キャンセルを含む） */
function shopMonthReceptions(cfg, shopId, month, asOf, refresh) {
  const { from, to } = monthRange(month);
  return cached(`rec:${shopId}:${month}`, ttlFor(month, asOf), async () => {
    const rows = await fetchReceptions(cfg, { from, to, shopId });
    return rows
      .map(normalizeReception)
      .map((r) => (r.shopId ? r : { ...r, shopId: String(shopId) }))
      .filter((r) => r.date && monthOf(r.date) === month);
  }, refresh);
}

/**
 * 1店舗の継続指標（サブスク。取得時点の値）
 * 人数は 30分ごと、平均継続期間（顧客一覧。ゆっくりしか変わらない）は 6時間ごとに取り直す。
 */
async function shopRetention(cfg, shopId, asOf, refresh) {
  const [summary, customers] = await Promise.all([
    cached(`ret:${shopId}`, TTL_RETENTION, () => fetchRetentionSummary(cfg, { from: monthRange(monthOf(asOf)).from, to: asOf, shopId }), refresh),
    // 平均継続期間: 直近 1年にサブスクの支払いがあったお客様の継続月数
    cached(`tenure:${shopId}`, TTL_TENURE, () => fetchRetentionCustomers(cfg, { from: addDays(asOf, -365), to: asOf, shopId }), refresh),
  ]);
  return {
    value: { ...normalizeRetention(summary.value, customers.value), asOf },
    fetchedAt: Math.min(summary.fetchedAt, customers.fetchedAt),
    freshAt: summary.fetchedAt,
    stale: summary.stale || customers.stale,
    error: summary.error || customers.error,
  };
}

/** 当月の継続指標を dash_config に残す（同じ月は店舗ごとに上書き。24ヶ月分） */
async function saveRetentionSnapshots(month, byShop) {
  const { data, error } = await supabase.from('dash_config').select('value').eq('key', RETENTION_KEY).maybeSingle();
  if (error) throw error;
  const all = (data && data.value && typeof data.value === 'object') ? data.value : {};
  all[month] = { ...(all[month] || {}), ...byShop };
  const value = Object.fromEntries(Object.keys(all).sort().slice(-24).map((k) => [k, all[k]]));
  const { error: e2 } = await supabase.from('dash_config').upsert({ key: RETENTION_KEY, value }, { onConflict: 'key' });
  if (e2) throw e2;
}

/**
 * 指定月のデータ一式
 * @param {Object} opts
 * @param {string[]} opts.months 集計する月（売上サマリ + 受付履歴）
 * @param {string[]} [opts.receptionMonths] 受付履歴だけ要る月（後の月の契約・前の月のキャンセルを見るため）
 * @param {boolean} [opts.receptions=true] 受付履歴を取るか（推移は売上サマリだけで足りるので false）
 * @param {string[]} [opts.shopIds] 取得する SalonOne 店舗（省略時は全店舗）。権限による絞り込みは呼び出し側で行う
 * @returns {Promise<{ mode, receptions, contracts, salesSummaries, retentionOverrides, retentionFromContracts, receptionsLoaded, asOf, stale, warnings }>}
 */
export async function loadDataset(appCtx, master, { months, receptionMonths = [], receptions: withReceptions = true, shopIds, refresh } = {}) {
  const asOf = todayJst();
  const current = monthOf(asOf);
  const notFuture = (m) => monthsBetween(m, current) >= 0;
  const wanted = [...new Set(months)].filter(notFuture);
  if (master.mode === 'demo') {
    const all = [...new Set([...wanted, ...receptionMonths])].filter(notFuture);
    const sim = simulateDemo({ shops: master.shops, staff: master.staff, months: all, asOf });
    return {
      mode: 'demo', receptions: sim.receptions, contracts: sim.contracts, salesSummaries: {}, retentionOverrides: {},
      retentionFromContracts: true, receptionsLoaded: true, asOf, stale: [], warnings: [],
    };
  }

  const cfg = salonOneConfig();
  const targets = [...new Set((shopIds || master.shops.map((s) => s.id)).map(String).filter(Boolean))];
  const startedAt = Date.now();
  // 更新ボタンで取り直すのは当月と前月だけ（締まった月は長めのキャッシュのまま）
  const recent = (m) => monthsBetween(m, current) <= 1;
  const recMonths = withReceptions ? [...new Set([...wanted, ...receptionMonths])].filter(notFuture) : [];
  const recJob = (m, shopId) => shopMonthReceptions(cfg, shopId, m, asOf, refresh && recent(m));
  const sumJobs = [];
  for (const m of wanted) {
    for (const shopId of targets) {
      sumJobs.push(shopMonthSummary(cfg, shopId, m, asOf, refresh && recent(m)).then((r) => ({ m, shopId, ...r }), (e) => ({ m, shopId, failed: e })));
    }
  }
  const recJobs = [];
  for (const m of recMonths) for (const shopId of targets) recJobs.push(recJob(m, shopId));
  const retJobs = wanted.includes(current)
    ? targets.map((shopId) => shopRetention(cfg, shopId, asOf, refresh).then((r) => ({ shopId, ...r }), (e) => ({ shopId, failed: e })))
    : [];
  const [sumResults, recResults, retResults] = await Promise.all([Promise.all(sumJobs), Promise.all(recJobs), Promise.all(retJobs)]);

  const warnings = [];
  const salesSummaries = Object.fromEntries(wanted.map((m) => [m, {}]));
  const failedSummaries = sumResults.filter((r) => r.failed);
  for (const r of sumResults) if (!r.failed) salesSummaries[r.m][r.shopId] = r.value;
  // 売上サマリが取れなかった店舗・月は受付履歴から集計する（推移で受付履歴を取っていない場合は取りに行く）
  if (failedSummaries.length) {
    const first = failedSummaries[0].failed;
    if (failedSummaries.every((r) => r.failed && r.failed.code === 'unauthorized')) throw first;
    warnings.push({ code: 'salesSummary', message: `SalonOne の売上分析を取得できなかったため、受付履歴から集計しています（SalonOne の画面と数字が少しずれます）: ${first.message.replace(/^SalonOne API エラー \([^)]*\): /, '')}` });
    if (!withReceptions) {
      recResults.push(...await Promise.all(failedSummaries.map((r) => recJob(r.m, r.shopId))));
    }
  }

  const receptions = recResults.flatMap((r) => r.value);
  const contracts = contractsFromReceptions(receptions, planPatterns(appCtx));
  const stale = [...sumResults, ...recResults].filter((r) => r.stale).map((r) => ({ fetchedAt: r.fetchedAt, error: r.error }));

  // 継続指標: 過去の月は保存した値、当月は取得した値
  const snapshots = appCtx.config[RETENTION_KEY] || {};
  const retentionOverrides = {};
  for (const m of wanted) retentionOverrides[m] = { ...(snapshots[m] || {}) };
  const fresh = {};
  for (const r of retResults) {
    if (r.failed) {
      warnings.push({ code: 'retention', message: `継続管理（会員数・退会率）を取得できませんでした: ${r.failed.message}` });
      continue;
    }
    retentionOverrides[current][r.shopId] = r.value;
    if (r.stale) stale.push({ fetchedAt: r.fetchedAt, error: r.error });
    else if (r.freshAt >= startedAt) fresh[r.shopId] = r.value;
  }
  if (Object.keys(fresh).length && !appCtx.dbError) {
    try {
      await saveRetentionSnapshots(current, fresh);
    } catch (e) {
      console.warn('[salonone] retention snapshot save failed:', e.message);
    }
  }
  return {
    mode: 'live', receptions, contracts, salesSummaries, retentionOverrides, retentionFromContracts: false,
    receptionsLoaded: withReceptions || failedSummaries.length > 0, asOf, stale, warnings,
  };
}

export function clearSalonOneCache() {
  cache.clear();
}
