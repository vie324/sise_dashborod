// ============================================================
// ダッシュボード用の集計レスポンスを組み立てる
// ------------------------------------------------------------
//   buildSummary : 1ヶ月分（KPI・日別推移・スタッフ別・インセンティブ・支給期間）
//   buildTrend   : 複数月の推移
//   buildMaster  : 設定画面の対応付け用マスタ
// 権限（shared/roles.js）:
//   管理者 / オーナー           … 全店舗・全スタッフ
//   店長・マネージャー          … 所属（管轄）店舗の全体とスタッフ全員
//   スタッフ                    … 所属店舗の合計 + 自分の行だけ
// ============================================================

import { computeMonth, combineShops, cashByDay } from '../../../shared/metrics.js';
import {
  computeStaffIncentive, computeRetentionIncentive, paymentPeriodOf, sumPeriod, summarizeIncentive,
} from '../../../shared/incentive.js';
import { INCENTIVE_RULES } from '../../../shared/incentive-rules.js';
import { addMonths, monthProgress, monthsBetween, monthOf, listMonths, todayJst, formatMonthJa } from '../../../shared/dates.js';
import { loadAppContext, loadMaster, buildMapping, loadDataset } from './provider.js';
import { loadCloseDoc, saveCloseDoc, closeView } from './closes.js';
import { normalizeRole, isOwnerRole } from '../../../shared/roles.js';

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const nOrNull = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

/** ミリ秒 → JST の「M/D HH:mm」 */
export function jstStamp(ms) {
  const iso = new Date(ms + 9 * 3600 * 1000).toISOString();
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))} ${iso.slice(11, 16)}`;
}

/** SalonOne の取得状況に関する注意（前回の値を表示中・継続管理を取れなかった など） */
function dataWarnings(master, data) {
  const out = [];
  const stale = [...(master.stale || []), ...(data.stale || [])];
  if (stale.length) {
    const oldest = Math.min(...stale.map((x) => x.fetchedAt));
    const reason = stale.find((x) => x.error);
    out.push({ code: 'stale', message: `SalonOne から最新のデータを取得できなかったため、${jstStamp(oldest)} 時点のデータを表示しています${reason ? `（${reason.error.replace(/^SalonOne API エラー \([^)]*\): /, '')}）` : ''}` });
  }
  return out.concat(data.warnings || []);
}

export class AccessError extends Error {
  constructor(message, status = 403) { super(message); this.status = status; }
}

/** staffCtx → 見られる店舗（ダッシュボード側 ID）。null = 全店舗 */
export function accessScope(staffCtx, appCtx) {
  if (staffCtx === null || (staffCtx && isOwnerRole(staffCtx.role))) {
    return { all: true, storeIds: appCtx.stores.map((s) => s.id), role: staffCtx ? 'owner' : 'admin', staffId: staffCtx ? staffCtx.staffId : null };
  }
  const known = new Set(appCtx.stores.map((s) => s.id));
  const storeIds = (staffCtx.storeIds || []).map(String).filter((id) => known.has(id));
  return { all: false, storeIds, role: normalizeRole(staffCtx.role), staffId: staffCtx.staffId };
}

function resolveSelection(scope, storeId) {
  if (!storeId || storeId === 'all') {
    return scope.storeIds;
  }
  if (!scope.storeIds.includes(storeId)) throw new AccessError('この店舗を表示する権限がありません');
  return [storeId];
}

function pickMetrics(s) {
  if (!s) return null;
  return {
    consumedSales: n(s.consumedSales),
    existingConsumedSales: n(s.existingConsumedSales),
    depositSales: n(s.depositSales),
    treatmentCount: n(s.treatmentCount),
    customerCount: n(s.customerCount),
    newVisits: s.newVisits,
    newContracts: s.newContracts,
    newVisitTotal: n(s.newVisitTotal),
    newContractTotal: n(s.newContractTotal),
    // SalonOne の売上分析の 新規数・リピート（既存）数・購入（契約）数
    newCount: nOrNull(s.newCount),
    repeatCount: nOrNull(s.repeatCount),
    purchaseCount: nOrNull(s.purchaseCount),
    referralSubscriptions: n(s.referralSubscriptions),
    basis: s.basis || null,
  };
}

const EMPTY_METRICS = pickMetrics({});

function contract3ch(m) {
  const ch = INCENTIVE_RULES.newContract.channels;
  const visits = ch.reduce((s, k) => s + n(m.newVisits && m.newVisits[k]), 0);
  const contracts = ch.reduce((s, k) => s + n(m.newContracts && m.newContracts[k]), 0);
  return { visits, contracts, ratePct: visits > 0 ? (contracts / visits) * 100 : null };
}

export async function prepare(staffCtx, { refresh } = {}) {
  const appCtx = await loadAppContext();
  const master = await loadMaster(appCtx, { refresh });
  // デモでダッシュボード側に店舗が無い（未登録・DB未接続）ときはサンプル店舗を店舗として扱う
  if (master.mode === 'demo' && appCtx.stores.length === 0) {
    appCtx.stores = master.shops.map((s) => ({ id: s.id, name: s.name }));
  }
  const mapping = buildMapping(appCtx, master);
  const scope = accessScope(staffCtx, appCtx);
  return { appCtx, master, mapping, scope };
}

/** SalonOne スタッフ → 表示用の行情報 */
function staffIdentity(s1Staff, mapping, appCtx, master) {
  const staffId = mapping.s1ToStaff.get(s1Staff.id) || null;
  const dash = staffId ? appCtx.staff.find((s) => s.id === staffId) : null;
  const storeId = mapping.shopToStore.get(s1Staff.shopId) || null;
  const store = appCtx.stores.find((s) => s.id === storeId);
  const shop = master.shops.find((s) => s.id === s1Staff.shopId);
  return {
    key: s1Staff.id,
    staffId,
    name: (dash && dash.name) || s1Staff.name || s1Staff.id,
    salonOneName: s1Staff.name,
    storeId,
    storeName: (store && store.name) || (shop && shop.name) || '',
    linked: !!staffId,
  };
}

/** インセンティブの計算に使う店舗（SalonOne の全店舗。ヘルプで入った他店舗の分もスタッフの実績に含める） */
function allShopIdsOf(master, selectedShopIds) {
  return [...new Set([...master.shops.map((s) => String(s.id)), ...selectedShopIds])];
}

/** 受付履歴・契約・売上サマリ・継続指標を、表示中の店舗のぶんだけにする */
function onlyShops(data, m, shopSet) {
  const pickShops = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([id]) => shopSet.has(id)));
  return {
    receptions: data.receptions.filter((r) => shopSet.has(r.shopId)),
    contracts: data.contracts.filter((c) => shopSet.has(c.shopId)),
    salesSummaries: pickShops(data.salesSummaries[m]),
    retentionOverrides: pickShops(data.retentionOverrides[m]),
  };
}

/**
 * スタッフの所属店舗（インセンティブの一覧に出す店舗・継続率インセンティブで見る店舗）。
 * SalonOne の所属店舗が対応付け済みならそれ、無ければその月いちばん施術した店舗。
 */
function homeShopOf(s1, sm, mapping) {
  if (s1.shopId && mapping.shopToStore.has(s1.shopId)) return s1.shopId;
  if (sm && sm.shopId && mapping.shopToStore.has(sm.shopId)) return sm.shopId;
  return s1.shopId || (sm && sm.shopId) || null;
}

/** 支給期間の 1ヶ月分（確定の記録・CSV にも使う形） */
function periodMonth(pm, res) {
  const s = summarizeIncentive(res);
  return s ? { month: pm, total: s.total, items: s.items, basis: s.basis } : { month: pm, total: null, items: null, basis: null };
}

async function loadCloseRecord(period, appCtx) {
  // 制度開始前の月は確定しない。Supabase につながらない時は別の注意（db）を出しているので読まない
  if (period.preview || appCtx.dbError) return { record: null };
  try {
    const doc = await loadCloseDoc(period.months[0]);
    return { record: doc.current };
  } catch (e) {
    return { record: null, error: e && e.message ? e.message : String(e) };
  }
}

export async function buildSummary(staffCtx, { month, storeId, refresh }) {
  const { appCtx, master, mapping, scope } = await prepare(staffCtx, { refresh });
  const selectedStoreIds = resolveSelection(scope, storeId);
  const selectedShopIds = [...new Set(selectedStoreIds.map((id) => mapping.storeToShop.get(id)).filter(Boolean))];
  const shopSet = new Set(selectedShopIds);
  // スタッフのインセンティブは、表示中の店舗にかかわらず全店舗の実績で計算する
  // （店舗を絞った時・スタッフ本人が見た時も、オーナーが全店舗で見た時と同じ金額にする）
  const allShopIds = allShopIdsOf(master, selectedShopIds);
  const wholeBrand = allShopIds.every((id) => shopSet.has(id));

  const period = paymentPeriodOf(month);
  const prevMonth = addMonths(month, -1);
  const months = [...new Set([prevMonth, month, ...period.months])].sort();
  const last = months[months.length - 1];
  const [data, close] = await Promise.all([
    loadDataset(appCtx, master, {
      months,
      // 新規の判定に前の月（最初の予約をキャンセルして後日来店）、契約に後の 2ヶ月（生涯基準）の受付履歴も見る。
      // 支給期間の最初の月の前の月も取り、支給期間のどちらの月を開いても期間の金額が同じになるようにする
      receptionMonths: [addMonths(period.months[0], -1), ...listMonths(addMonths(last, 1), addMonths(last, 2))],
      shopIds: allShopIds,
      refresh,
    }),
    loadCloseRecord(period, appCtx),
  ]);
  const channelMap = appCtx.config['salonone.channelMap'] || {};
  const monthInput = (m) => ({
    receptions: data.receptions,
    contracts: data.contracts,
    month: m,
    asOf: data.asOf,
    channelMap,
    retentionOverrides: data.retentionOverrides[m],
    retentionFromContracts: data.retentionFromContracts,
    salesSummaries: data.salesSummaries[m],
  });

  const computed = {};
  for (const m of months) {
    computed[m] = monthsBetween(m, monthOf(data.asOf)) < 0 ? null : computeMonth(monthInput(m));
  }
  const cur = computed[month] || computeMonth({ receptions: [], contracts: [], month, asOf: data.asOf });
  const prev = computed[prevMonth];
  // 表示中の店舗だけの集計（売上分析のスタッフ別・来店経由）。店舗ごとの数字は cur と同じ
  const curSel = wholeBrand || !computed[month] ? cur : computeMonth({ ...monthInput(month), ...onlyShops(data, month, shopSet) });

  // 店舗（選択範囲の合計 + 店舗別）
  const storeRows = selectedStoreIds.map((sid) => {
    const shopId = mapping.storeToShop.get(sid);
    const shop = shopId ? cur.shops[shopId] : null;
    const prevShop = shopId && prev ? prev.shops[shopId] : null;
    const retention = shop ? shop.retention : null;
    return {
      storeId: sid,
      name: (appCtx.stores.find((s) => s.id === sid) || {}).name || sid,
      linked: !!shopId,
      ...(pickMetrics(shop) || EMPTY_METRICS),
      contract3ch: contract3ch(shop || {}),
      prevConsumedSales: prevShop ? n(prevShop.consumedSales) : null,
      retention,
      retentionIncentive: computeRetentionIncentive(retention),
    };
  });
  const combined = combineShops(selectedShopIds.map((id) => cur.shops[id]).filter(Boolean));
  const combinedPrev = prev ? combineShops(selectedShopIds.map((id) => prev.shops[id]).filter(Boolean)) : null;
  const store = {
    ...pickMetrics(combined),
    contract3ch: contract3ch(combined),
    cashSales: combined.cashSales,
    daily: combined.daily,
    retention: selectedShopIds.length === 1 ? (cur.shops[selectedShopIds[0]] || {}).retention || null : combined.retention,
    prev: combinedPrev ? { ...pickMetrics(combinedPrev), contract3ch: contract3ch(combinedPrev) } : null,
  };

  // スタッフ（SalonOne スタッフ + 当月に実績のあるスタッフ）
  const s1StaffById = new Map(master.staff.map((s) => [s.id, s]));
  for (const [id, sm] of Object.entries(cur.staff)) {
    const known = s1StaffById.get(id);
    if (!known) s1StaffById.set(id, { id, name: sm.name || id, shopId: sm.shopId });
    else if (!known.name && sm.name) s1StaffById.set(id, { ...known, name: sm.name });
  }
  const myS1 = scope.staffId ? mapping.staffToS1.get(scope.staffId) : null;
  const rows = [];
  for (const s1 of s1StaffById.values()) {
    const m = cur.staff[s1.id];
    const homeShopId = homeShopOf(s1, m, mapping);
    const home = !!homeShopId && shopSet.has(homeShopId);
    const inScope = curSel.staff[s1.id];
    // インセンティブの一覧は所属店舗のスタッフ、売上分析のスタッフ別は表示中の店舗で施術したスタッフも
    if (!home && !inScope && s1.id !== myS1) continue;
    const ident = staffIdentity({ ...s1, shopId: homeShopId }, mapping, appCtx, master);
    const retentionOf = (c) => (c && homeShopId && c.shops[homeShopId] ? c.shops[homeShopId].retention : null);
    const homeRetention = retentionOf(cur);
    const incentive = computeStaffIncentive(m || {}, homeRetention, month);
    const periodResults = period.months.map((pm) => (computed[pm]
      ? computeStaffIncentive(computed[pm].staff[s1.id] || {}, retentionOf(computed[pm]), pm)
      : null));
    const periodSum = sumPeriod(periodResults);
    rows.push({
      ...ident,
      home,
      active: !!inScope,
      metrics: pickMetrics(m) || EMPTY_METRICS,
      // 表示中の店舗での実績（売上分析のスタッフ別・店舗内シェア）
      scopeMetrics: pickMetrics(inScope) || EMPTY_METRICS,
      prevConsumedSales: prev && prev.staff[s1.id] ? n(prev.staff[s1.id].consumedSales) : (prev ? 0 : null),
      daily: m ? m.daily.map((d) => ({ date: d.date, consumedSales: d.consumedSales, treatmentCount: d.treatmentCount })) : [],
      // 継続率インセンティブで見た所属店舗の継続指標（取得した日・都度払いを除いた人数つき）
      homeRetention,
      incentive,
      period: {
        total: periodSum.total,
        byKey: periodSum.byKey,
        months: period.months.map((pm, i) => periodMonth(pm, periodResults[i])),
      },
    });
  }
  rows.sort((a, b) => b.metrics.consumedSales - a.metrics.consumedSales || a.name.localeCompare(b.name, 'ja'));

  // 自分の行（スタッフURLでログインしている場合）
  const me = myS1 ? rows.find((r) => r.key === myS1) || null : null;
  const ownOnly = scope.role === 'staff';
  const visibleRows = ownOnly ? (me ? [me] : []) : rows.filter((r) => r.home);
  const inScopeRows = (ownOnly ? (me ? [me] : []) : rows.filter((r) => r.home || r.active))
    .map((r) => ({
      key: r.key, staffId: r.staffId, name: r.name, salonOneName: r.salonOneName, storeId: r.storeId, storeName: r.storeName,
      linked: r.linked, home: r.home, metrics: r.scopeMetrics,
    }))
    .sort((a, b) => b.metrics.consumedSales - a.metrics.consumedSales || a.name.localeCompare(b.name, 'ja'));

  // 確定済みの支給期間なら、確定した金額を並べる（見られる範囲のスタッフだけ）
  const canSeeClosed = (r) => (scope.all ? true : ownOnly ? r.key === myS1 : scope.storeIds.includes(r.storeId) || r.key === myS1);
  const closeInfo = closeView(close.record, canSeeClosed);
  const closedByKey = new Map((closeInfo ? closeInfo.staff : []).map((r) => [r.key, r]));
  for (const r of rows) r.closed = closedByKey.get(r.key) || null;

  const warnings = [];
  if (master.mode === 'demo') warnings.push({ code: 'demo', message: 'SalonOne の APIキーが未設定のため、デモデータを表示しています。' });
  if (appCtx.dbError) warnings.push({ code: 'db', message: `Supabase に接続できません: ${appCtx.dbError}` });
  if (selectedStoreIds.some((id) => !mapping.storeToShop.has(id))) warnings.push({ code: 'unmappedStore', message: 'SalonOne の店舗と未連携の店舗があります（設定 > SalonOne連携）。' });
  if (mapping.duplicateShops.length) warnings.push({ code: 'duplicateShop', message: '同じ SalonOne の店舗に対応付けた店舗があります。店舗の対応付けを確認してください（設定 > SalonOne連携）。' });
  // オーナー・マネージャーは施術しないこともあるので、未連携の注意は出さない
  if (scope.staffId && !myS1 && (scope.role === 'staff' || scope.role === 'manager')) warnings.push({ code: 'unmappedMe', message: 'あなたのアカウントが SalonOne のスタッフと未連携です。管理者に連携を依頼してください。' });
  if (close.error) warnings.push({ code: 'close', message: `インセンティブの確定の記録を読めませんでした: ${close.error}` });
  warnings.push(...dataWarnings(master, data));

  return {
    mode: master.mode,
    month,
    asOf: data.asOf,
    generatedAt: new Date().toISOString(),
    rules: INCENTIVE_RULES,
    period,
    progress: monthProgress(month, data.asOf),
    scope: { storeId: storeId || 'all', storeIds: selectedStoreIds, canSeeAll: scope.all, role: scope.role },
    store,
    stores: storeRows,
    staff: visibleRows,
    staffInScope: inScopeRows,
    me,
    sources: scope.role === 'staff' ? [] : curSel.sources,
    close: closeInfo,
    warnings,
  };
}

/**
 * 1店舗の日別の現金売上（出納帳への取り込み・突合用）。受付履歴だけを取る（売上サマリ・継続管理は取らない）。
 * 権限の確認は buildSummary と同じ（見られない店舗は AccessError）。
 * @returns {{ mode:string, storeId:string, asOf:string, linked:boolean, days:Object<string,number>, fetchedAt:number, warnings:Array }}
 */
export async function dailyCashSales(staffCtx, { storeId, months, refresh = false }) {
  const id = storeId && storeId !== 'all' ? String(storeId) : '';
  if (!id) throw new AccessError('店舗を選んでください', 400);
  const { appCtx, master, mapping, scope } = await prepare(staffCtx);
  if (!scope.storeIds.includes(id)) throw new AccessError('この店舗を表示する権限がありません');
  const shopId = mapping.storeToShop.get(id);
  const out = { mode: master.mode, storeId: id, asOf: todayJst(), linked: !!shopId, days: {}, fetchedAt: Date.now(), warnings: [] };
  if (!shopId) return out;
  const data = await loadDataset(appCtx, master, { months, shopIds: [shopId], summaries: false, retention: false, refresh });
  for (const m of months) Object.assign(out.days, cashByDay(data.receptions, shopId, m));
  return { ...out, asOf: data.asOf, fetchedAt: data.fetchedAt, warnings: dataWarnings(master, data) };
}

// ------------------------------------------------------------
// インセンティブの確定（支給期間ごと。オーナー・管理者のみ）
// ------------------------------------------------------------
const CLOSE_ISSUE_CODES = new Set(['stale', 'salesSummary', 'retention', 'db', 'unmappedStore', 'duplicateShop']);

/** 確定の前に確認してほしいこと（取得できなかったデータ・記録の無い継続指標・未連携のスタッフ） */
function closeIssues(s) {
  const out = s.warnings.filter((w) => CLOSE_ISSUE_CODES.has(w.code)).map((w) => ({ code: w.code, message: w.message }));
  const missing = new Map();
  for (const r of s.staff) {
    for (const pm of r.period.months) {
      if (!pm.basis || pm.basis.retentionKnown) continue;
      const set = missing.get(pm.month) || new Set();
      set.add(r.storeName || r.storeId || '所属店舗なし');
      missing.set(pm.month, set);
    }
  }
  if (missing.size) {
    const list = [...missing].sort().map(([m, set]) => `${formatMonthJa(m)}（${[...set].join('・')}）`).join('、');
    out.push({ code: 'retentionMissing', message: `${list}の会員数・退会率の記録がありません。継続率インセンティブは 0円で確定されます` });
  }
  const unlinked = s.staff.filter((r) => !r.linked && n(r.period.total) > 0);
  if (unlinked.length) {
    out.push({ code: 'unlinkedStaff', message: `ダッシュボードのスタッフと未連携の SalonOne スタッフにも支給額があります（${unlinked.map((r) => r.name).join('・')}）` });
  }
  return out;
}

function assertCanClose(staffCtx) {
  if (!(staffCtx === null || (staffCtx && isOwnerRole(staffCtx.role)))) {
    throw new AccessError('インセンティブを確定できるのはオーナー・管理者のみです');
  }
}

/**
 * 支給期間の金額を確定する。期間が終わってから（期間の最後の月より後に）行う。
 * 取得できなかったデータなど確認してほしいことがあれば、保存せずに issues を返す。
 * 画面で確認した issues の code を accept で受け取り、それ以外の新しい issue（取り直しに失敗した など）が
 * 出た時はもう一度確認を求める。force はすべて受け入れる（スクリプト・テスト用）。
 */
export async function closePeriod(staffCtx, { month, operator = '', note = '', force = false, accept = [] } = {}) {
  assertCanClose(staffCtx);
  const period = paymentPeriodOf(month);
  if (period.preview) throw new AccessError('制度開始前の月は確定できません', 400);
  const last = period.months[period.months.length - 1];
  if (monthsBetween(last, monthOf(todayJst())) <= 0) {
    throw new AccessError(`支給期間（${period.label}）が終わってから確定してください`, 400);
  }
  const accepted = new Set(Array.isArray(accept) ? accept.map(String) : []);
  // 最初の確定で SalonOne から読み直す。確認した後の確定（accept あり）は同じデータで行う（呼び出し回数を抑える）
  const s = await buildSummary(staffCtx, { month: last, storeId: 'all', refresh: !force && accepted.size === 0 });
  if (s.mode !== 'live') throw new AccessError('SalonOne が未接続（デモデータ）のため確定できません', 400);
  const issues = closeIssues(s);
  if (!force && issues.some((i) => !accepted.has(i.code))) return { needsConfirm: true, label: period.label, issues };
  const record = {
    periodStart: period.months[0],
    months: period.months,
    label: period.label,
    rulesVersion: s.rules.version,
    closedAt: new Date().toISOString(),
    closedBy: String(operator || '').slice(0, 60),
    note: String(note || '').slice(0, 200),
    dataAsOf: s.asOf,
    issues,
    staff: s.staff.map((r) => ({
      key: r.key, staffId: r.staffId, name: r.name, storeId: r.storeId, storeName: r.storeName, linked: r.linked,
      total: r.period.total, months: r.period.months,
    })),
  };
  record.total = record.staff.reduce((a, r) => a + n(r.total), 0);
  const doc = await loadCloseDoc(record.periodStart);
  if (doc.current) doc.history.unshift({ ...doc.current, replacedAt: record.closedAt, replacedBy: record.closedBy });
  doc.current = record;
  await saveCloseDoc(record.periodStart, doc);
  return { success: true, close: closeView(record, () => true) };
}

/** 確定を取り消す（記録は履歴に残す） */
export async function reopenPeriod(staffCtx, { month, operator = '' } = {}) {
  assertCanClose(staffCtx);
  const period = paymentPeriodOf(month);
  const doc = await loadCloseDoc(period.months[0]);
  if (!doc.current) return { success: true, reopened: false };
  doc.history.unshift({ ...doc.current, reopenedAt: new Date().toISOString(), reopenedBy: String(operator || '').slice(0, 60) });
  doc.current = null;
  await saveCloseDoc(period.months[0], doc);
  return { success: true, reopened: true };
}

export async function buildTrend(staffCtx, { months: count = 6, endMonth, storeId, refresh }) {
  const { appCtx, master, mapping, scope } = await prepare(staffCtx, { refresh });
  const selectedStoreIds = resolveSelection(scope, storeId);
  const selectedShopIds = [...new Set(selectedStoreIds.map((id) => mapping.storeToShop.get(id)).filter(Boolean))];
  const last = endMonth;
  const first = addMonths(last, -(Math.min(Math.max(count, 1), 24) - 1));
  const months = listMonths(first, last);
  const myS1 = scope.staffId ? mapping.staffToS1.get(scope.staffId) : null;
  const ownOnly = scope.role === 'staff';
  // スタッフ本人の推移（自己ベスト）はインセンティブと同じく全店舗の実績で出す。店舗の推移は表示中の店舗だけ
  const shopIds = ownOnly && myS1 ? allShopIdsOf(master, selectedShopIds) : selectedShopIds;
  // 推移は SalonOne の売上分析（売上サマリ）だけで出す（受付履歴は取らない＝呼び出し回数を抑える）
  const data = await loadDataset(appCtx, master, { months, receptions: false, shopIds, refresh });
  const channelMap = appCtx.config['salonone.channelMap'] || {};
  const shopSet = new Set(selectedShopIds);

  const series = [];
  const staffSeries = new Map();
  for (const m of months) {
    if (monthsBetween(m, monthOf(data.asOf)) < 0) { series.push({ month: m, future: true }); continue; }
    const c = computeMonth({
      receptions: data.receptions, contracts: data.contracts, month: m, asOf: data.asOf, channelMap,
      retentionOverrides: data.retentionOverrides[m], retentionFromContracts: data.retentionFromContracts,
      salesSummaries: data.salesSummaries[m], countsFromReceptions: data.receptionsLoaded,
    });
    const combined = combineShops(selectedShopIds.map((id) => c.shops[id]).filter(Boolean));
    series.push({
      month: m,
      consumedSales: combined.consumedSales,
      depositSales: combined.depositSales,
      treatmentCount: combined.treatmentCount,
      customerCount: combined.customerCount,
      newCount: combined.newCount,
      repeatCount: combined.repeatCount,
      purchaseCount: combined.purchaseCount,
      contractRatePct: combined.newCount > 0 && combined.purchaseCount != null ? (combined.purchaseCount / combined.newCount) * 100 : null,
      memberCount: combined.retention.memberCount,
      churnRatePct: combined.retention.churnRatePct,
    });
    for (const [s1Id, sm] of Object.entries(c.staff)) {
      if (ownOnly ? s1Id !== myS1 : !shopSet.has(sm.shopId)) continue;
      let row = staffSeries.get(s1Id);
      if (!row) {
        const s1 = master.staff.find((s) => s.id === s1Id) || { id: s1Id, name: sm.name || s1Id, shopId: sm.shopId };
        row = { ...staffIdentity(s1, mapping, appCtx, master), values: {} };
        staffSeries.set(s1Id, row);
      }
      row.values[m] = sm.consumedSales;
    }
  }
  return {
    mode: master.mode,
    asOf: data.asOf,
    months: series,
    staff: Array.from(staffSeries.values()).sort((a, b) => a.name.localeCompare(b.name, 'ja')),
    warnings: dataWarnings(master, data),
  };
}

export async function buildMaster(staffCtx, { refresh } = {}) {
  const { appCtx, master, mapping, scope } = await prepare(staffCtx, { refresh });
  if (!scope.all) throw new AccessError('管理者またはオーナーのみ利用できます');
  // 来店経由はマスタ（/visit-sources）から。取れなかったときは直近 2ヶ月の受付履歴から集める
  let seen = [];
  if (master.sources.length === 0) {
    const asOfMonth = monthOf(todayJst());
    try {
      // 媒体名を集めるだけなので受付履歴だけを取る
      const data = await loadDataset(appCtx, master, { months: [addMonths(asOfMonth, -1), asOfMonth], summaries: false, retention: false, refresh });
      seen = [...new Set(data.receptions.map((r) => r.sourceName).filter(Boolean))];
    } catch (e) {
      console.warn('[salonone] master: dataset load failed:', e.message);
    }
  }
  return {
    mode: master.mode,
    shops: master.shops,
    staff: master.staff,
    sources: [...new Set([...master.sources, ...seen])],
    mapping: {
      shopMap: appCtx.config['salonone.shopMap'] || {},
      staffMap: appCtx.config['salonone.staffMap'] || {},
      channelMap: appCtx.config['salonone.channelMap'] || {},
      planRules: appCtx.config['salonone.planRules'] || {},
    },
    resolved: {
      storeToShop: Object.fromEntries(mapping.storeToShop),
      staffToS1: Object.fromEntries(mapping.staffToS1),
    },
  };
}
