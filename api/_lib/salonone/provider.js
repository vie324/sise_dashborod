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
  normalizeSalesSummary, contractsFromReceptions, normalizeVisit,
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

/**
 * @param {boolean|number} refresh true: 取り直す。数値: その ms 以内に取りに行ったもの（取りに行っている途中を含む）は
 *   そのまま使い、それより前のもの・取り直せなかったものだけ取り直す（インセンティブの確定。上限に当たって確認を挟んだ
 *   後の確定でも、取り直せなかった分だけを取りに行く）
 * @returns {Promise<{ value:any, fetchedAt:number, stale:boolean, error?:string }>}
 */
function cached(key, ttlMs, loader, refresh) {
  const now = Date.now();
  const hit = cache.get(key);
  const recentEnough = typeof refresh === 'number' && hit && hit.startedAt > 0 && now - hit.startedAt <= refresh;
  if (hit && (recentEnough || (!refresh && hit.expires > now))) return hit.pending;
  const last = hit ? hit.last : null;
  const pending = loader().then(
    (value) => {
      const res = { value, fetchedAt: Date.now(), stale: false };
      cache.set(key, { pending: Promise.resolve(res), expires: Date.now() + ttlMs, last: res, startedAt: now });
      return res;
    },
    (e) => {
      if (!last) { cache.delete(key); throw e; }
      const res = { ...last, stale: true, error: e && e.message ? e.message : String(e) };
      cache.set(key, { pending: Promise.resolve(res), expires: Date.now() + RETRY_AFTER_FAILURE_MS, last, startedAt: 0 });
      return res;
    },
  );
  cache.set(key, { pending, expires: now + ttlMs, last, startedAt: now });
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
// 施術ツールの「本日のお客様」。受付で予約が入る・来店になるのを早めに映すため短め
// （画面は 1分ごとに読み直す。同じ店舗を何台で開いていても SalonOne を呼ぶのは 50秒に 1回）
const TTL_DAY = 50 * 1000;

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
  // 2つの店舗を同じ SalonOne の店舗に対応付けている（全店舗の合計では 1回だけ数える）
  const duplicateShops = [];
  for (const store of appCtx.stores) {
    const shopId = demo ? store.id : (shopMap[store.id] ? String(shopMap[store.id]) : '');
    if (!shopId) continue;
    storeToShop.set(store.id, shopId);
    if (!shopToStore.has(shopId)) shopToStore.set(shopId, store.id);
    else if (!duplicateShops.includes(shopId)) duplicateShops.push(shopId);
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
    storeToShop, shopToStore, staffToS1, s1ToStaff, duplicateShops,
    unmappedStores: appCtx.stores.filter((s) => !storeToShop.has(s.id)).map((s) => s.id),
    knownStore: (id) => storeIds.has(id),
  };
}

// ------------------------------------------------------------
// 受付履歴・継続管理
// ------------------------------------------------------------
export function planPatterns(appCtx) {
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
 * 顧客一覧のプラン名が「都度払い」のキーワードに当たるお客様は会員数・平均継続期間に入れない。
 */
async function shopRetention(cfg, shopId, asOf, refresh, { payPerVisitPattern } = {}) {
  const [summary, customers] = await Promise.all([
    cached(`ret:${shopId}`, TTL_RETENTION, () => fetchRetentionSummary(cfg, { from: monthRange(monthOf(asOf)).from, to: asOf, shopId }), refresh),
    // 平均継続期間: 直近 1年にサブスクの支払いがあったお客様の継続月数
    cached(`tenure:${shopId}`, TTL_TENURE, () => fetchRetentionCustomers(cfg, { from: addDays(asOf, -365), to: asOf, shopId }), refresh),
  ]);
  return {
    value: { ...normalizeRetention(summary.value, customers.value, { payPerVisitPattern }), asOf },
    fetchedAt: Math.min(summary.fetchedAt, customers.fetchedAt),
    freshAt: summary.fetchedAt,
    stale: summary.stale || customers.stale,
    error: summary.error || customers.error,
  };
}

/**
 * 1店舗・1日分の予約（受付履歴。キャンセルを含む）→ 施術ツールの「本日のお客様」用の行
 * @returns {Promise<{ value:Array, fetchedAt:number, stale:boolean, error?:string }>}
 */
export function loadDayVisits(shopId, date, { refresh } = {}) {
  const cfg = salonOneConfig();
  return cached(`day:${shopId}:${date}`, TTL_DAY, async () => {
    const rows = await fetchReceptions(cfg, { from: date, to: date, shopId });
    return rows
      .map(normalizeVisit)
      .map((v) => (v.shopId ? v : { ...v, shopId: String(shopId) }))
      .filter((v) => v.id && v.date === date);
  }, refresh);
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
 * 全店舗の当月の継続指標を SalonOne から取り直して記録する（Vercel Cron から毎日 23時台に呼ぶ）。
 * 継続管理は取得時点の値しか返らないため、画面を開いた時だけの記録だと、月末近くに誰も開かなかった月は
 * 月の途中の値がその月の値になってしまう。毎日記録し、月の最後の日の記録をその月の値にする。
 * @returns {Promise<{ mode:string, month:string|null, asOf?:string, saved:number, failed:Array<{shopId:string,error:string}> }>}
 */
export async function snapshotRetention() {
  const appCtx = await loadAppContext();
  if (appCtx.dbError) throw new Error(`Supabase に接続できません: ${appCtx.dbError}`);
  const master = await loadMaster(appCtx, { refresh: true });
  if (master.mode !== 'live') return { mode: master.mode, month: null, saved: 0, failed: [] };
  const cfg = salonOneConfig();
  const asOf = todayJst();
  const month = monthOf(asOf);
  const { payPerVisitPattern } = planPatterns(appCtx);
  const results = await Promise.all(master.shops.map((s) => shopRetention(cfg, s.id, asOf, true, { payPerVisitPattern })
    .then((r) => ({ shopId: s.id, ...r }), (e) => ({ shopId: s.id, failed: e }))));
  const fresh = {};
  const failed = [];
  for (const r of results) {
    // 取り直せず前回の値が返ったもの（stale）は、その時点の値ではないので記録しない
    if (r.failed || r.stale) failed.push({ shopId: r.shopId, error: r.failed ? r.failed.message : String(r.error || '') });
    else fresh[r.shopId] = r.value;
  }
  if (Object.keys(fresh).length) await saveRetentionSnapshots(month, fresh);
  return { mode: 'live', month, asOf, saved: Object.keys(fresh).length, failed };
}

/**
 * 指定月のデータ一式
 * @param {Object} opts
 * @param {string[]} opts.months 集計する月（売上サマリ + 受付履歴）
 * @param {string[]} [opts.receptionMonths] 受付履歴だけ要る月（後の月の契約・前の月のキャンセルを見るため）
 * @param {boolean} [opts.receptions=true] 受付履歴を取るか（推移は売上サマリだけで足りるので false）
 * @param {boolean} [opts.summaries=true] 売上サマリを取るか（出納帳の現金売上は受付履歴だけで足りるので false）
 * @param {boolean} [opts.retention=true] 当月の継続管理を取るか
 * @param {string[]} [opts.shopIds] すべてを取る SalonOne 店舗（省略時は全店舗）。権限による絞り込みは呼び出し側で行う
 * @param {string[]} [opts.otherShopIds] スタッフの実績のためだけに見る店舗（ヘルプで入った分）。売上サマリを取り、
 *   そのスタッフ別に staffIds のスタッフがいる店舗だけ受付履歴も取る。取れなくても画面は出す（注意を返す）
 * @param {Set<string>} [opts.staffIds] otherShopIds の受付履歴を取るか決めるスタッフ（SalonOne のスタッフ ID）
 * @param {boolean} [opts.unlistedStaff] SalonOne のスタッフ一覧に無い（辞めた）スタッフで、shopIds の店舗に実績のある人も staffIds に加える
 * @param {string[]} [opts.retentionShopIds] 継続管理も取る otherShopIds（スタッフの所属店舗）
 * @param {boolean} [opts.refresh] 当月・前月を SalonOne から取り直す
 * @param {number} [opts.refreshOlderThan] すべての月で、この ms より前に取得したものを取り直す（インセンティブの確定）
 * @returns {Promise<{ mode, receptions, contracts, salesSummaries, retentionOverrides, retentionFromContracts, receptionsLoaded, asOf, stale, warnings, fetchedAt }>}
 */
export async function loadDataset(appCtx, master, {
  months, receptionMonths = [], receptions: withReceptions = true, summaries: withSummaries = true, retention: withRetention = true,
  shopIds, otherShopIds = [], staffIds = null, unlistedStaff = false, retentionShopIds = [], refresh, refreshOlderThan = null,
} = {}) {
  const asOf = todayJst();
  const current = monthOf(asOf);
  const notFuture = (m) => monthsBetween(m, current) >= 0;
  const wanted = [...new Set(months)].filter(notFuture);
  if (master.mode === 'demo') {
    const all = [...new Set([...wanted, ...receptionMonths])].filter(notFuture);
    const sim = simulateDemo({ shops: master.shops, staff: master.staff, months: all, asOf });
    return {
      mode: 'demo', receptions: sim.receptions, contracts: sim.contracts, salesSummaries: {}, retentionOverrides: {},
      retentionFromContracts: true, receptionsLoaded: true, asOf, stale: [], warnings: [], fetchedAt: Date.now(),
    };
  }

  const cfg = salonOneConfig();
  const targets = [...new Set((shopIds || master.shops.map((s) => s.id)).map(String).filter(Boolean))];
  const others = [...new Set((otherShopIds || []).map(String))].filter((id) => id && !targets.includes(id));
  const startedAt = Date.now();
  // 更新ボタンで取り直すのは当月と前月だけ（締まった月は長めのキャッシュのまま）。
  // 確定の時はすべての月で、少し前（refreshOlderThan）より前に取得したものを取り直す
  const recent = (m) => monthsBetween(m, current) <= 1;
  const refreshFor = (m) => (typeof refreshOlderThan === 'number' ? refreshOlderThan : !!refresh && recent(m));
  const recMonths = withReceptions ? [...new Set([...wanted, ...receptionMonths])].filter(notFuture) : [];
  const recJob = (m, shopId) => shopMonthReceptions(cfg, shopId, m, asOf, refreshFor(m));
  const sumJob = (m, shopId) => shopMonthSummary(cfg, shopId, m, asOf, refreshFor(m)).then((r) => ({ m, shopId, ...r }), (e) => ({ m, shopId, failed: e }));
  const sumJobs = [];
  const otherSumJobs = [];
  for (const m of withSummaries ? wanted : []) {
    for (const shopId of targets) sumJobs.push(sumJob(m, shopId));
    for (const shopId of others) otherSumJobs.push(sumJob(m, shopId));
  }
  const recJobs = [];
  for (const m of recMonths) for (const shopId of targets) recJobs.push(recJob(m, shopId));
  const { payPerVisitPattern } = planPatterns(appCtx);
  const retTargets = [...new Set([...targets, ...(retentionShopIds || []).map(String).filter((id) => others.includes(id))])];
  const retJobs = withRetention && wanted.includes(current)
    ? retTargets.map((shopId) => shopRetention(cfg, shopId, asOf, refresh, { payPerVisitPattern }).then((r) => ({ shopId, ...r }), (e) => ({ shopId, failed: e })))
    : [];
  // 他の店舗: 売上サマリのスタッフ別に対象のスタッフがいる店舗だけ受付履歴を取る（ヘルプが無ければ売上サマリだけで済む）
  const otherJob = (async () => {
    const sums = await Promise.all(otherSumJobs);
    if (!withReceptions || !sums.length) return { sums, recs: [] };
    let want = staffIds;
    if (want && unlistedStaff) {
      // スタッフ一覧に無い（辞めた）スタッフも、表示中の店舗に実績があれば一覧に出るので、ヘルプの分を取る
      const listed = new Set(master.staff.map((x) => String(x.id)));
      want = new Set(want);
      for (const r of await Promise.all(sumJobs)) {
        for (const x of (!r.failed && r.value && r.value.staff) || []) if (!listed.has(String(x.staffId))) want.add(String(x.staffId));
      }
    }
    const need = new Set();
    for (const r of sums) {
      if (r.failed) continue;
      const rows = r.value && r.value.staff;
      // スタッフ別が無い応答はいたかどうかわからないので取る
      if (!rows || !want || rows.some((x) => want.has(String(x.staffId)))) need.add(r.shopId);
    }
    const jobs = [];
    for (const shopId of need) for (const m of recMonths) jobs.push(recJob(m, shopId).catch((e) => ({ m, shopId, failed: e })));
    return { sums, recs: await Promise.all(jobs) };
  })();
  const [sumResults, recResults, retResults, other] = await Promise.all([Promise.all(sumJobs), Promise.all(recJobs), Promise.all(retJobs), otherJob]);

  const warnings = [];
  const salesSummaries = Object.fromEntries(wanted.map((m) => [m, {}]));
  const failedSummaries = sumResults.filter((r) => r.failed);
  for (const r of [...sumResults, ...other.sums]) if (!r.failed) salesSummaries[r.m][r.shopId] = r.value;
  // 売上サマリが取れなかった店舗・月は受付履歴から集計する（推移で受付履歴を取っていない場合は取りに行く）
  if (failedSummaries.length) {
    const first = failedSummaries[0].failed;
    if (failedSummaries.every((r) => r.failed && r.failed.code === 'unauthorized')) throw first;
    warnings.push({ code: 'salesSummary', message: `SalonOne の売上分析を取得できなかったため、受付履歴から集計しています（SalonOne の画面と数字が少しずれます）: ${first.message.replace(/^SalonOne API エラー \([^)]*\): /, '')}` });
    if (!withReceptions) {
      recResults.push(...await Promise.all(failedSummaries.map((r) => recJob(r.m, r.shopId))));
    }
  }
  // 他の店舗は取れなくても画面は出す（ヘルプで入った分がスタッフの実績に入っていないかもしれないと知らせる）
  const otherFailed = [...other.sums, ...other.recs].filter((r) => r.failed);
  if (otherFailed.length) {
    if (other.sums.length && other.sums.every((r) => r.failed && r.failed.code === 'unauthorized')) throw other.sums[0].failed;
    warnings.push({ code: 'otherShops', message: `他の店舗の実績の一部を取得できなかったため、ヘルプで入った分がスタッフのインセンティブに入っていない可能性があります: ${otherFailed[0].failed.message.replace(/^SalonOne API エラー \([^)]*\): /, '')}` });
  }
  const otherRecs = other.recs.filter((r) => !r.failed);

  const receptions = [...recResults, ...otherRecs].flatMap((r) => r.value);
  const contracts = contractsFromReceptions(receptions, planPatterns(appCtx));
  const loaded = [...sumResults, ...recResults, ...other.sums, ...otherRecs];
  const stale = loaded.filter((r) => r.stale).map((r) => ({ fetchedAt: r.fetchedAt, error: r.error }));
  // いちばん古いデータの取得時刻（キャッシュから返した分も含む。画面の「◯時◯分取得」に使う）
  const fetchedTimes = loaded.filter((r) => !r.failed && r.fetchedAt).map((r) => r.fetchedAt);

  // 継続指標: 過去の月は保存した値、当月は取得した値
  const snapshots = appCtx.config[RETENTION_KEY] || {};
  const retentionOverrides = {};
  for (const m of wanted) retentionOverrides[m] = { ...(snapshots[m] || {}) };
  const fresh = {};
  const retentionFailed = [];
  for (const r of retResults) {
    if (r.failed) { retentionFailed.push(r); continue; }
    retentionOverrides[current][r.shopId] = r.value;
    if (r.stale) stale.push({ fetchedAt: r.fetchedAt, error: r.error });
    else if (r.freshAt >= startedAt) fresh[r.shopId] = r.value;
  }
  if (retentionFailed.length) {
    warnings.push({ code: 'retention', message: `継続管理（会員数・退会率）を取得できませんでした: ${retentionFailed[0].failed.message}` });
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
    fetchedAt: fetchedTimes.length ? Math.min(...fetchedTimes) : Date.now(),
  };
}

export function clearSalonOneCache() {
  cache.clear();
}
