// ============================================================
// ダッシュボード用の集計レスポンスを組み立てる
// ------------------------------------------------------------
//   buildSummary : 1ヶ月分（KPI・日別推移・スタッフ別・インセンティブ・支給期間）
//   buildTrend   : 複数月の推移
//   buildMaster  : 設定画面の対応付け用マスタ
// 権限:
//   管理者 / 本部        … 全店舗・全スタッフ
//   店舗責任者(manager)  … 所属店舗のスタッフ全員
//   スタッフ(staff)      … 所属店舗の合計 + 自分の行だけ
// ============================================================

import { computeMonth, combineShops } from '../../../shared/metrics.js';
import { computeStaffIncentive, computeRetentionIncentive, paymentPeriodOf, sumPeriod } from '../../../shared/incentive.js';
import { INCENTIVE_RULES } from '../../../shared/incentive-rules.js';
import { addMonths, monthProgress, monthsBetween, monthOf, listMonths } from '../../../shared/dates.js';
import { loadAppContext, loadMaster, buildMapping, loadDataset } from './provider.js';

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

export class AccessError extends Error {
  constructor(message, status = 403) { super(message); this.status = status; }
}

/** staffCtx → 見られる店舗（ダッシュボード側 ID）。null = 全店舗 */
export function accessScope(staffCtx, appCtx) {
  if (staffCtx === null || (staffCtx && staffCtx.role === 'headquarter')) {
    return { all: true, storeIds: appCtx.stores.map((s) => s.id), role: staffCtx ? 'headquarter' : 'admin', staffId: staffCtx ? staffCtx.staffId : null };
  }
  const known = new Set(appCtx.stores.map((s) => s.id));
  const storeIds = (staffCtx.storeIds || []).map(String).filter((id) => known.has(id));
  return { all: false, storeIds, role: staffCtx.role || 'staff', staffId: staffCtx.staffId };
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
    referralSubscriptions: n(s.referralSubscriptions),
  };
}

const EMPTY_METRICS = pickMetrics({});

function contract3ch(m) {
  const ch = INCENTIVE_RULES.newContract.channels;
  const visits = ch.reduce((s, k) => s + n(m.newVisits && m.newVisits[k]), 0);
  const contracts = ch.reduce((s, k) => s + n(m.newContracts && m.newContracts[k]), 0);
  return { visits, contracts, ratePct: visits > 0 ? (contracts / visits) * 100 : null };
}

async function prepare(staffCtx, { refresh } = {}) {
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

export async function buildSummary(staffCtx, { month, storeId, refresh }) {
  const { appCtx, master, mapping, scope } = await prepare(staffCtx, { refresh });
  const selectedStoreIds = resolveSelection(scope, storeId);
  const selectedShopIds = selectedStoreIds.map((id) => mapping.storeToShop.get(id)).filter(Boolean);

  const period = paymentPeriodOf(month);
  const prevMonth = addMonths(month, -1);
  const months = [...new Set([prevMonth, month, ...period.months])];
  const data = await loadDataset(appCtx, master, { months, refresh });
  const channelMap = appCtx.config['salonone.channelMap'] || {};

  const computed = {};
  for (const m of months) {
    if (monthsBetween(m, monthOf(data.asOf)) < 0) { computed[m] = null; continue; }
    computed[m] = computeMonth({
      receptions: data.receptions,
      contracts: data.contracts,
      month: m,
      asOf: data.asOf,
      channelMap,
      retentionOverrides: data.retentionOverrides[m],
    });
  }
  const cur = computed[month] || computeMonth({ receptions: [], contracts: [], month, asOf: data.asOf });
  const prev = computed[prevMonth];

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
  for (const id of Object.keys(cur.staff)) {
    if (!s1StaffById.has(id)) s1StaffById.set(id, { id, name: id, shopId: cur.staff[id].shopId });
  }
  const shopSet = new Set(selectedShopIds);
  const rows = [];
  for (const s1 of s1StaffById.values()) {
    // 所属店舗: SalonOne 上の所属を優先し、選択外なら当月いちばん施術した店舗
    const metricsShop = cur.staff[s1.id] ? cur.staff[s1.id].shopId : s1.shopId;
    if (!shopSet.has(s1.shopId) && !shopSet.has(metricsShop)) continue;
    const homeShopId = shopSet.has(s1.shopId) ? s1.shopId : metricsShop;
    const ident = staffIdentity({ ...s1, shopId: homeShopId }, mapping, appCtx, master);
    const m = cur.staff[s1.id];
    const retentionOf = (c) => (c && c.shops[homeShopId] ? c.shops[homeShopId].retention : null);
    const incentive = computeStaffIncentive(m || {}, retentionOf(cur), month);
    const periodResults = period.months.map((pm) => {
      const c = computed[pm];
      if (!c) return null;
      return computeStaffIncentive(c.staff[s1.id] || {}, retentionOf(c), pm);
    });
    const periodSum = sumPeriod(periodResults);
    rows.push({
      ...ident,
      metrics: pickMetrics(m) || EMPTY_METRICS,
      prevConsumedSales: prev && prev.staff[s1.id] ? n(prev.staff[s1.id].consumedSales) : (prev ? 0 : null),
      daily: m ? m.daily.map((d) => ({ date: d.date, consumedSales: d.consumedSales, treatmentCount: d.treatmentCount })) : [],
      incentive,
      period: {
        total: periodSum.total,
        byKey: periodSum.byKey,
        months: period.months.map((pm, i) => ({ month: pm, total: periodResults[i] ? periodResults[i].total : null })),
      },
    });
  }
  rows.sort((a, b) => b.metrics.consumedSales - a.metrics.consumedSales || a.name.localeCompare(b.name, 'ja'));

  // 自分の行（スタッフURLでログインしている場合）
  const myS1 = scope.staffId ? mapping.staffToS1.get(scope.staffId) : null;
  const me = myS1 ? rows.find((r) => r.key === myS1) || null : null;
  const visibleRows = scope.role === 'staff' ? (me ? [me] : []) : rows;

  const warnings = [];
  if (master.mode === 'demo') warnings.push({ code: 'demo', message: 'SalonOne の APIキーが未設定のため、デモデータを表示しています。' });
  if (appCtx.dbError) warnings.push({ code: 'db', message: `Supabase に接続できません: ${appCtx.dbError}` });
  if (selectedStoreIds.some((id) => !mapping.storeToShop.has(id))) warnings.push({ code: 'unmappedStore', message: 'SalonOne の店舗と未連携の店舗があります（設定 > SalonOne連携）。' });
  if (scope.staffId && !myS1 && scope.role !== 'headquarter') warnings.push({ code: 'unmappedMe', message: 'あなたのアカウントが SalonOne のスタッフと未連携です。管理者に連携を依頼してください。' });

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
    me,
    sources: scope.role === 'staff' ? [] : cur.sources,
    warnings,
  };
}

export async function buildTrend(staffCtx, { months: count = 6, endMonth, storeId, refresh }) {
  const { appCtx, master, mapping, scope } = await prepare(staffCtx, { refresh });
  const selectedStoreIds = resolveSelection(scope, storeId);
  const selectedShopIds = selectedStoreIds.map((id) => mapping.storeToShop.get(id)).filter(Boolean);
  const last = endMonth;
  const first = addMonths(last, -(Math.min(Math.max(count, 1), 24) - 1));
  const months = listMonths(first, last);
  const data = await loadDataset(appCtx, master, { months, refresh });
  const channelMap = appCtx.config['salonone.channelMap'] || {};
  const myS1 = scope.staffId ? mapping.staffToS1.get(scope.staffId) : null;
  const shopSet = new Set(selectedShopIds);

  const series = [];
  const staffSeries = new Map();
  for (const m of months) {
    if (monthsBetween(m, monthOf(data.asOf)) < 0) { series.push({ month: m, future: true }); continue; }
    const c = computeMonth({ receptions: data.receptions, contracts: data.contracts, month: m, asOf: data.asOf, channelMap, retentionOverrides: data.retentionOverrides[m] });
    const combined = combineShops(selectedShopIds.map((id) => c.shops[id]).filter(Boolean));
    const ch = contract3ch(combined);
    series.push({
      month: m,
      consumedSales: combined.consumedSales,
      depositSales: combined.depositSales,
      treatmentCount: combined.treatmentCount,
      newVisitTotal: combined.newVisitTotal,
      newContractTotal: combined.newContractTotal,
      newVisits: combined.newVisits,
      contractRatePct: combined.newVisitTotal > 0 ? (combined.newContractTotal / combined.newVisitTotal) * 100 : null,
      contract3chRatePct: ch.ratePct,
      memberCount: combined.retention.memberCount,
      churnRatePct: combined.retention.churnRatePct,
    });
    for (const [s1Id, sm] of Object.entries(c.staff)) {
      if (!shopSet.has(sm.shopId)) continue;
      if (scope.role === 'staff' && s1Id !== myS1) continue;
      let row = staffSeries.get(s1Id);
      if (!row) {
        const s1 = master.staff.find((s) => s.id === s1Id) || { id: s1Id, name: s1Id, shopId: sm.shopId };
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
  };
}

export async function buildMaster(staffCtx, { refresh } = {}) {
  const { appCtx, master, mapping, scope } = await prepare(staffCtx, { refresh });
  if (!scope.all) throw new AccessError('管理者または本部のみ利用できます');
  // 来店経由はマスタ + 直近 2ヶ月の実データから集める
  const asOfMonth = monthOf(new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10));
  const months = [addMonths(asOfMonth, -1), asOfMonth];
  let seen = [];
  try {
    const data = await loadDataset(appCtx, master, { months, refresh });
    seen = [...new Set(data.receptions.map((r) => r.sourceName).filter(Boolean))];
  } catch (e) {
    console.warn('[salonone] master: dataset load failed:', e.message);
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
