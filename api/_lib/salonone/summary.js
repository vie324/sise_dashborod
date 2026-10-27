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

import { computeMonth, combineShops, cashByDay, cashUnknownByDay } from '../../../shared/metrics.js';
import {
  computeStaffIncentive, computeRetentionIncentive, paymentPeriodOf, sumPeriod, summarizeIncentive,
} from '../../../shared/incentive.js';
import { INCENTIVE_RULES } from '../../../shared/incentive-rules.js';
import { addMonths, monthProgress, monthsBetween, monthOf, monthRange, listMonths, todayJst, formatMonthJa } from '../../../shared/dates.js';
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
  // 同じ注意は 1回だけ
  const seen = new Set();
  return out.concat(data.warnings || []).filter((w) => {
    const k = `${w.code}|${w.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
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
 * 支給期間の 1ヶ月分（確定の記録・CSV にも使う形）
 * basis には判定に使った数字に加えて、継続指標の記録日（retentionAsOf）と施術数・継続指標を見た店舗
 * （retentionShopId。継続率の対象外の月は null）を残す
 */
function periodMonth(pm, res, { retention, metrics, homeShopId } = {}) {
  const s = summarizeIncentive(res);
  if (!s) return { month: pm, total: null, items: null, basis: null };
  return {
    month: pm,
    total: s.total,
    items: s.items,
    basis: {
      ...s.basis,
      treatmentCount: metrics ? n(metrics.treatmentCount) : 0,
      retentionAsOf: retention && retention.asOf ? retention.asOf : null,
      retentionShopId: homeShopId || null,
    },
  };
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

/**
 * インセンティブの一覧に出るスタッフ（ヘルプで入った他店舗の実績も取る対象）。
 * スタッフ本人は自分だけ。店長以上は所属店舗が表示中の店舗のスタッフ・所属のわからないスタッフ・本人
 */
function relevantStaffIds(master, mapping, scope, shopSet, myS1) {
  const out = new Set(myS1 ? [myS1] : []);
  if (scope.role === 'staff') return out;
  for (const s of master.staff) {
    if (!s.shopId || shopSet.has(s.shopId) || !mapping.shopToStore.has(s.shopId)) out.add(s.id);
  }
  return out;
}

/**
 * @param {Object|null} staffCtx
 * @param {{ month:string, storeId:string, refresh?:boolean, refreshOlderThan?:number }} opts
 *   refreshOlderThan: すべての月で、この ms より前に取得したデータを SalonOne から取り直す（インセンティブの確定。画面からは使わない）
 */
export async function buildSummary(staffCtx, { month, storeId, refresh, refreshOlderThan = null }) {
  const { appCtx, master, mapping, scope } = await prepare(staffCtx, { refresh: typeof refreshOlderThan === 'number' ? refreshOlderThan : refresh });
  const selectedStoreIds = resolveSelection(scope, storeId);
  const selectedShopIds = [...new Set(selectedStoreIds.map((id) => mapping.storeToShop.get(id)).filter(Boolean))];
  const shopSet = new Set(selectedShopIds);
  // スタッフのインセンティブは、表示中の店舗にかかわらず全店舗の実績で計算する
  // （店舗を絞った時・スタッフ本人が見た時も、オーナーが全店舗で見た時と同じ金額にする）。
  // 表示中の店舗はすべて、他の店舗は売上サマリを取り、対象のスタッフが施術していた店舗だけ受付履歴も取る
  const allShopIds = allShopIdsOf(master, selectedShopIds);
  const wholeBrand = allShopIds.every((id) => shopSet.has(id));
  const myS1 = scope.staffId ? mapping.staffToS1.get(scope.staffId) : null;
  const relevant = relevantStaffIds(master, mapping, scope, shopSet, myS1);
  // 他の店舗に所属するスタッフ（ダッシュボードの所属と SalonOne の所属店舗が違う人）の継続率の判定に、その店舗の継続管理も取る
  const homeShops = master.staff.filter((s) => relevant.has(s.id) && s.shopId && mapping.shopToStore.has(s.shopId)).map((s) => s.shopId);

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
      shopIds: selectedShopIds,
      otherShopIds: allShopIds.filter((id) => !shopSet.has(id)),
      staffIds: relevant,
      unlistedStaff: scope.role !== 'staff',
      retentionShopIds: homeShops,
      refresh,
      refreshOlderThan,
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

  // スタッフ（SalonOne スタッフ + この月・支給期間に実績のあるスタッフ。
  // 期間の途中で辞めた人も、実績のある月の分が期間の合計・確定に入るようにする）
  const s1StaffById = new Map(master.staff.map((s) => [s.id, s]));
  const listed = new Set(s1StaffById.keys());
  for (const c of [cur, ...period.months.map((pm) => computed[pm])]) {
    for (const [id, sm] of Object.entries(c ? c.staff : {})) {
      const known = s1StaffById.get(id);
      // スタッフ一覧に無い人の所属店舗は、月ごとの施術した店舗で決める（下の homeIn）
      if (!known) s1StaffById.set(id, { id, name: sm.name || id, shopId: null });
      else if (!known.name && sm.name) s1StaffById.set(id, { ...known, name: sm.name });
    }
  }
  const activityShop = (c, id) => (c && c.staff[id] ? c.staff[id].shopId : null);
  const mappedShop = (id) => (id && mapping.shopToStore.has(id) ? id : null);
  const rows = [];
  for (const s1 of s1StaffById.values()) {
    const m = cur.staff[s1.id];
    // 所属店舗（一覧・確定の記録に出す店舗）。SalonOne の所属店舗が対応付いていればそれ、
    // 無ければ支給期間に最後に施術した店舗。どちらの月を開いても同じ店舗になる
    const lastActivity = (mappedOnly) => [...period.months].reverse().map((pm) => activityShop(computed[pm], s1.id))
      .find((id) => id && (!mappedOnly || mapping.shopToStore.has(id))) || null;
    const homeShopId = mappedShop(s1.shopId) || lastActivity(true) || s1.shopId || lastActivity(false);
    // 継続率インセンティブで見る店舗は月ごと: 対応付いていない人は、その月にいちばん施術した店舗（施術の無い月は上の店舗）
    const homeIn = (c) => mappedShop(s1.shopId) || mappedShop(activityShop(c, s1.id)) || homeShopId;
    const home = !!homeShopId && shopSet.has(homeShopId);
    const inScope = curSel.staff[s1.id];
    // インセンティブの一覧は所属店舗のスタッフ、売上分析のスタッフ別は表示中の店舗で施術したスタッフも
    if (!home && !inScope && s1.id !== myS1) continue;
    const ident = staffIdentity({ ...s1, shopId: homeShopId }, mapping, appCtx, master);
    // 継続率は月ごとの所属店舗の条件で見る。スタッフ一覧に無い（辞めた）人は、施術のある月だけ対象
    const retentionEligible = (c) => !!c && (listed.has(s1.id) || !!c.staff[s1.id]);
    const retentionIn = (c) => {
      if (!retentionEligible(c)) return null;
      const shopId = homeIn(c);
      return shopId && c.shops[shopId] ? c.shops[shopId].retention : null;
    };
    const homeRetention = retentionIn(cur);
    const incentive = computeStaffIncentive(m || {}, homeRetention, month);
    const periodResults = period.months.map((pm) => (computed[pm]
      ? computeStaffIncentive(computed[pm].staff[s1.id] || {}, retentionIn(computed[pm]), pm)
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
        months: period.months.map((pm, i) => periodMonth(pm, periodResults[i], {
          retention: retentionIn(computed[pm]),
          metrics: computed[pm] ? computed[pm].staff[s1.id] : null,
          homeShopId: retentionEligible(computed[pm]) ? homeIn(computed[pm]) : null,
        })),
      },
    });
  }
  rows.sort((a, b) => b.metrics.consumedSales - a.metrics.consumedSales || a.name.localeCompare(b.name, 'ja'));

  // 自分の行（スタッフURLでログインしている場合）
  const me = myS1 ? rows.find((r) => r.key === myS1) || null : null;
  const ownOnly = scope.role === 'staff';
  const visibleRows = ownOnly ? (me ? [me] : []) : rows.filter((r) => r.home);
  // 売上分析のスタッフ別は、この月に実績が無い辞めた人（支給期間の合計のためだけに一覧にいる人）を出さない
  const inScopeRows = (ownOnly ? (me ? [me] : []) : rows.filter((r) => r.active || (r.home && (listed.has(r.key) || cur.staff[r.key]))))
    .map((r) => ({
      key: r.key, staffId: r.staffId, name: r.name, salonOneName: r.salonOneName, storeId: r.storeId, storeName: r.storeName,
      linked: r.linked, home: r.home, metrics: r.scopeMetrics,
    }))
    .sort((a, b) => b.metrics.consumedSales - a.metrics.consumedSales || a.name.localeCompare(b.name, 'ja'));

  // 確定済みの支給期間なら、確定した金額を並べる（表示中の店舗のスタッフだけ。スタッフ本人は自分だけ）
  const allStores = !storeId || storeId === 'all';
  const canSeeClosed = (r) => (ownOnly ? r.key === myS1
    : scope.all && allStores ? true
      : selectedStoreIds.includes(r.storeId));
  const closeInfo = closeView(close.record, canSeeClosed, { withNote: !ownOnly });
  const closedByKey = new Map((closeInfo ? closeInfo.staff : []).map((r) => [r.key, r]));
  for (const r of rows) r.closed = closedByKey.get(r.key) || null;

  const warnings = [];
  if (master.mode === 'demo') warnings.push({ code: 'demo', message: 'SalonOne の APIキーが未設定のため、デモデータを表示しています。' });
  if (appCtx.dbError) warnings.push({ code: 'db', message: `Supabase に接続できません: ${appCtx.dbError}` });
  if (selectedStoreIds.some((id) => !mapping.storeToShop.has(id))) warnings.push({ code: 'unmappedStore', message: 'SalonOne の店舗と未連携の店舗があります（設定 > SalonOne連携）。' });
  if (mapping.duplicateShops.length) warnings.push({ code: 'duplicateShop', message: '同じ SalonOne の店舗に対応付けた店舗があります。店舗の対応付けを確認してください（設定 > SalonOne連携）。' });
  // ダッシュボードの店舗と対応付いていない SalonOne の店舗に実績がある（新しい店舗の対応付け忘れ など）。
  // その店舗だけで施術したスタッフは、所属店舗が無いのでインセンティブの一覧・確定に入らない
  if (scope.all) {
    const activeIn = (shopId) => [month, ...period.months].some((m) => {
      const v = data.salesSummaries[m] && data.salesSummaries[m][shopId];
      return !!v && (n(v.consumedSales) > 0 || n(v.treatmentCount) > 0);
    });
    const unmappedShops = master.shops.filter((sh) => !mapping.shopToStore.has(String(sh.id)) && activeIn(String(sh.id)));
    if (unmappedShops.length) {
      warnings.push({ code: 'unmappedShop', message: `ダッシュボードの店舗と対応付いていない SalonOne の店舗に実績があります（${unmappedShops.map((sh) => sh.name || sh.id).join('・')}）。その店舗だけで施術したスタッフはインセンティブの一覧・確定に入りません（設定 > SalonOne連携）。` });
    }
  }
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
 * @returns {{ mode:string, storeId:string, asOf:string, linked:boolean, days:Object<string,number>,
 *   unknown:Object<string,{count:number,amount:number}>, fetchedAt:number, warnings:Array }}
 *   unknown: 現金の分がわからない会計（複数の決済方法で内訳が無い。days には入れていない）
 */
export async function dailyCashSales(staffCtx, { storeId, months, refresh = false }) {
  const id = storeId && storeId !== 'all' ? String(storeId) : '';
  if (!id) throw new AccessError('店舗を選んでください', 400);
  const { appCtx, master, mapping, scope } = await prepare(staffCtx);
  if (!scope.storeIds.includes(id)) throw new AccessError('この店舗を表示する権限がありません');
  const shopId = mapping.storeToShop.get(id);
  const out = { mode: master.mode, storeId: id, asOf: todayJst(), linked: !!shopId, days: {}, unknown: {}, fetchedAt: Date.now(), warnings: [] };
  if (!shopId) return out;
  const data = await loadDataset(appCtx, master, { months, shopIds: [shopId], summaries: false, retention: false, refresh });
  for (const m of months) {
    Object.assign(out.days, cashByDay(data.receptions, shopId, m));
    Object.assign(out.unknown, cashUnknownByDay(data.receptions, shopId, m));
  }
  return { ...out, asOf: data.asOf, fetchedAt: data.fetchedAt, warnings: dataWarnings(master, data) };
}

// ------------------------------------------------------------
// インセンティブの確定（支給期間ごと。オーナー・管理者のみ）
// ------------------------------------------------------------
// 確定の時は、この時間より前に取得したデータを SalonOne から取り直す（直前に開いた画面の分は取り直さない）
const CLOSE_FRESH_MS = 10 * 60 * 1000;
const CLOSE_ISSUE_CODES = new Set(['stale', 'salesSummary', 'retention', 'otherShops', 'db', 'unmappedStore', 'unmappedShop', 'duplicateShop']);

/** 確定の前に確認してほしいこと（取得できなかったデータ・記録の無い継続指標・未連携のスタッフ など） */
function closeIssues(s) {
  const out = s.warnings.filter((w) => CLOSE_ISSUE_CODES.has(w.code)).map((w) => ({ code: w.code, message: w.message }));
  const missing = new Map(); // 月 → 店舗
  const notMonthEnd = new Map(); // 月 → 店舗 → 記録の日
  const idle = new Map(); // 月 → スタッフ（施術が無いのに継続率インセンティブがある）
  const add = (map, m, v) => { const set = map.get(m) || new Set(); set.add(v); map.set(m, set); };
  for (const r of s.staff) {
    const storeName = r.storeName || r.storeId || '所属店舗なし';
    for (const pm of r.period.months) {
      const b = pm.basis;
      if (!b) continue;
      // 継続率の対象外の月（辞めた人の施術の無い月）は記録が無くてよい
      if (!b.retentionKnown) { if (b.retentionShopId) add(missing, pm.month, storeName); continue; }
      // 継続管理は取得した時点の値。月の最後の日の記録でなければ、月末より前の会員数・退会率で判定している
      if (b.retentionAsOf && b.retentionAsOf < monthRange(pm.month).to) add(notMonthEnd, pm.month, `${storeName}: ${Number(b.retentionAsOf.slice(5, 7))}/${Number(b.retentionAsOf.slice(8, 10))}時点`);
      if (n(pm.items && pm.items.retention) > 0 && n(b.treatmentCount) === 0) add(idle, pm.month, r.name);
    }
  }
  const byMonth = (map) => [...map].sort().map(([m, set]) => `${formatMonthJa(m)}（${[...set].join('・')}）`).join('、');
  if (missing.size) {
    out.push({ code: 'retentionMissing', message: `${byMonth(missing)}の会員数・退会率の記録がありません。継続率インセンティブは 0円で確定されます` });
  }
  if (notMonthEnd.size) {
    out.push({ code: 'retentionNotMonthEnd', message: `${byMonth(notMonthEnd)}の会員数・退会率は月末の記録ではありません。継続率インセンティブはこの時点の値で確定されます` });
  }
  if (idle.size) {
    out.push({ code: 'retentionIdle', message: `施術の無い月にも継続率インセンティブが入っています: ${byMonth(idle)}。所属店舗のスタッフとして支給してよいか確認してください` });
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
  // 支給期間のすべての月を、10分より前に取得したものは SalonOne から読み直す。
  // 呼び出しの上限に当たって確認を挟んだ後の確定では、取り直せなかった分だけを取りに行く
  const s = await buildSummary(staffCtx, { month: last, storeId: 'all', refreshOlderThan: CLOSE_FRESH_MS });
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
  // スタッフ本人の推移（自己ベスト）はインセンティブと同じく全店舗の実績で出す（他の店舗は売上サマリだけ）。
  // 店舗の推移は表示中の店舗だけ
  const otherShopIds = ownOnly && myS1 ? allShopIdsOf(master, selectedShopIds).filter((id) => !selectedShopIds.includes(id)) : [];
  // 推移は SalonOne の売上分析（売上サマリ）だけで出す（受付履歴は取らない＝呼び出し回数を抑える）
  const data = await loadDataset(appCtx, master, { months, receptions: false, shopIds: selectedShopIds, otherShopIds, refresh });
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
