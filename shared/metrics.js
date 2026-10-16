// ============================================================
// 実績の集計（サーバー / ブラウザ共通・純粋関数）
// ------------------------------------------------------------
// SalonOne から取得して正規化したレコードを、月次の店舗・スタッフ実績へ集計する。
//
// 受付（来店）レコード reception（SalonOne の受付履歴 1行）:
//   { id, shopId, staffId, staffName?, customerId, date:'YYYY-MM-DD',
//     status:'completed'|'reserved'|'checked_in'|'cancelled'|'no_show',
//     customerClass:'new'|'repeat'|'existing', sourceName,
//     consumedAmount,   // 消化額（施術消化売上）
//     salesAmount,      // 会計金額（入金）
//     cashAmount?,      // そのうち現金（分割決済の内訳から。無ければ paymentMethod で判定）
//     paymentMethod, referralStaffId? }
//
// 契約レコード contract（サブスク・回数券・入会）:
//   { id, customerId, shopId, staffId?, type:'subscription'|'ticket'|'member'|'prepaid'|'payPerVisit',
//     planName, isSharePlan, startDate, endDate|null }
//
// 集計ルール
//   - 売上・施術数は会計完了（completed）の予約のみ
//   - 新規 = その店舗で最初の予約が、その月に会計完了したお客様。担当はその予約のスタッフ
//   - 契約 = 新規のお客様が、初回来店の月のうちに回数券・サブスクを購入（または入会）したか
//            （月が締まった後に数字が変わらないよう、翌月以降の契約は数えない）
//   - 紹介 = 紹介経路の新規客がサブスク（シェアプラン除く）を契約した件数
// ============================================================

import { resolveChannel, CHANNEL_KEYS } from './channels.js';
import { monthOf, monthRange, addDays, daysBetween, todayJst, monthsBetween } from './dates.js';

const DAYS_PER_MONTH = 30.4375;

const emptyChannelMap = () => Object.fromEntries(CHANNEL_KEYS.map((k) => [k, 0]));
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const sumValues = (obj) => Object.values(obj || {}).reduce((s, v) => s + n(v), 0);

function newStaffBucket(staffId, shopId) {
  return {
    staffId,
    shopId,
    consumedSales: 0,
    existingConsumedSales: 0,
    depositSales: 0,
    treatmentCount: 0,
    customerIds: new Set(),
    newVisits: emptyChannelMap(),
    newContracts: emptyChannelMap(),
    referralSubscriptions: 0,
    daily: new Map(),
    shopVotes: new Map(),
    name: '',
  };
}

function newShopBucket(shopId) {
  return {
    shopId,
    consumedSales: 0,
    existingConsumedSales: 0,
    depositSales: 0,
    treatmentCount: 0,
    cashSales: 0,
    customerIds: new Set(),
    newVisits: emptyChannelMap(),
    newContracts: emptyChannelMap(),
    referralSubscriptions: 0,
    daily: new Map(),
  };
}

function dayBucket(map, date) {
  let d = map.get(date);
  if (!d) {
    d = { date, consumedSales: 0, depositSales: 0, treatmentCount: 0, newVisits: 0, cashSales: 0 };
    map.set(date, d);
  }
  return d;
}

const isCash = (method) => /現金|cash/i.test(String(method || ''));
const cashOf = (r) => (r.cashAmount != null ? n(r.cashAmount) : (isCash(r.paymentMethod) ? n(r.salesAmount) : 0));
const isContractType = (t) => t === 'subscription' || t === 'ticket' || t === 'member';

/**
 * 契約一覧から customerId → 契約[] の索引を作る
 */
function indexContracts(contracts) {
  const byCustomer = new Map();
  for (const c of contracts || []) {
    if (!c || !c.customerId) continue;
    const list = byCustomer.get(c.customerId) || [];
    list.push(c);
    byCustomer.set(c.customerId, list);
  }
  return byCustomer;
}

/**
 * 店舗の継続指標（会員数・退会率・平均継続期間）。
 *   会員       : その日に有効なサブスク契約を持つ顧客（都度払い・回数券は含めない）
 *   退会率     : 月内に全サブスクが終了した顧客数 ÷ 月初（前月末）会員数
 *   平均継続期間: サブスク契約歴のある全顧客の継続月数の平均
 *                （初回契約開始〜最終契約終了。継続中は基準日まで）
 */
export function computeRetention(contracts, shopId, month, asOf) {
  const { from, to } = monthRange(month);
  const endDate = asOf && asOf < to ? asOf : to;
  const prevEnd = addDays(from, -1);
  const subs = (contracts || []).filter((c) => c.shopId === shopId && c.type === 'subscription' && c.startDate && c.startDate <= endDate);

  const byCustomer = new Map();
  for (const c of subs) {
    const list = byCustomer.get(c.customerId) || [];
    list.push(c);
    byCustomer.set(c.customerId, list);
  }
  const activeOn = (list, date) => list.some((c) => c.startDate <= date && (!c.endDate || c.endDate > date));

  let memberCount = 0;
  let membersAtStart = 0;
  let churnCount = 0;
  let tenureSum = 0;
  for (const list of byCustomer.values()) {
    const activeEnd = activeOn(list, endDate);
    const activeStart = activeOn(list, prevEnd);
    if (activeEnd) memberCount += 1;
    if (activeStart) membersAtStart += 1;
    if (activeStart && !activeEnd) churnCount += 1;
    const first = list.reduce((m, c) => (c.startDate < m ? c.startDate : m), list[0].startDate);
    const last = activeEnd ? endDate : list.reduce((m, c) => {
      const e = c.endDate && c.endDate < endDate ? c.endDate : endDate;
      return e > m ? e : m;
    }, first);
    tenureSum += Math.max(0, daysBetween(first, last)) / DAYS_PER_MONTH;
  }
  const customers = byCustomer.size;
  return {
    memberCount,
    membersAtStart,
    churnCount,
    churnRatePct: membersAtStart > 0 ? (churnCount / membersAtStart) * 100 : null,
    avgTenureMonths: customers > 0 ? tenureSum / customers : null,
    basis: 'computed',
    asOf: endDate,
  };
}

/**
 * 1ヶ月分の集計。
 * @param {Object} input
 * @param {Array} input.receptions   その月を含む受付レコード（月外は無視）
 * @param {Array} input.contracts    契約レコード（全期間）
 * @param {string} input.month       'YYYY-MM'
 * @param {string} [input.asOf]      データ基準日（当月はその日まで）
 * @param {Object} [input.channelMap] 媒体名 → 経路キー
 * @param {Object} [input.retentionOverrides] shopId → API 提供の継続指標
 * @param {boolean} [input.retentionFromContracts=true]
 *   継続指標が API に無い店舗を契約データから計算するか。
 *   受付履歴から作った契約（期間内の購入だけ）では会員数を出せないので、ライブでは false
 */
export function computeMonth({ receptions, contracts, month, asOf, channelMap, retentionOverrides, retentionFromContracts = true }) {
  const today = asOf || todayJst();
  const contractsByCustomer = indexContracts(contracts);
  const shops = new Map();
  const staff = new Map();
  const sources = new Map();
  const firstVisits = new Map(); // customerId → 最初の新規来店 reception

  const getShop = (id) => {
    let s = shops.get(id);
    if (!s) { s = newShopBucket(id); shops.set(id, s); }
    return s;
  };
  const getStaff = (id, shopId) => {
    let s = staff.get(id);
    if (!s) { s = newStaffBucket(id, shopId); staff.set(id, s); }
    return s;
  };

  const inMonth = (receptions || []).filter((r) => r && r.date && monthOf(r.date) === month && r.status === 'completed');
  inMonth.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  for (const r of inMonth) {
    const shop = getShop(r.shopId);
    const consumed = n(r.consumedAmount);
    const sales = n(r.salesAmount);
    const existing = r.customerClass !== 'new';
    shop.consumedSales += consumed;
    shop.depositSales += sales;
    shop.treatmentCount += 1;
    if (existing) shop.existingConsumedSales += consumed;
    if (r.customerId) shop.customerIds.add(r.customerId);
    const cash = cashOf(r);
    shop.cashSales += cash;
    const sd = dayBucket(shop.daily, r.date);
    sd.consumedSales += consumed;
    sd.depositSales += sales;
    sd.treatmentCount += 1;
    sd.cashSales += cash;

    if (r.staffId) {
      const st = getStaff(r.staffId, r.shopId);
      st.consumedSales += consumed;
      st.depositSales += sales;
      st.treatmentCount += 1;
      if (existing) st.existingConsumedSales += consumed;
      if (r.customerId) st.customerIds.add(r.customerId);
      if (r.staffName) st.name = r.staffName;
      st.shopVotes.set(r.shopId, (st.shopVotes.get(r.shopId) || 0) + 1);
      const dd = dayBucket(st.daily, r.date);
      dd.consumedSales += consumed;
      dd.depositSales += sales;
      dd.treatmentCount += 1;
    }

    if (r.customerClass === 'new' && r.customerId && !firstVisits.has(r.customerId)) {
      firstVisits.set(r.customerId, r);
    }
  }

  // 新規客（初回来店）の経路・契約（初回来店の月のうち、基準日までの契約）
  const { from, to } = monthRange(month);
  const until = today < to ? today : to;
  for (const [customerId, r] of firstVisits) {
    const channel = resolveChannel(r.sourceName, channelMap);
    const list = contractsByCustomer.get(customerId) || [];
    const relevant = list.filter((c) => c.startDate && c.startDate >= from && c.startDate <= until);
    const contracted = relevant.some((c) => isContractType(c.type));
    const subscribed = relevant.some((c) => c.type === 'subscription' && !c.isSharePlan);

    const shop = getShop(r.shopId);
    shop.newVisits[channel] += 1;
    if (contracted) shop.newContracts[channel] += 1;
    if (channel === 'referral' && subscribed) shop.referralSubscriptions += 1;
    dayBucket(shop.daily, r.date).newVisits += 1;

    if (r.staffId) {
      const st = getStaff(r.staffId, r.shopId);
      st.newVisits[channel] += 1;
      if (contracted) st.newContracts[channel] += 1;
      dayBucket(st.daily, r.date).newVisits += 1;
    }
    if (channel === 'referral' && subscribed) {
      const credited = r.referralStaffId || r.staffId;
      if (credited) getStaff(credited, r.shopId).referralSubscriptions += 1;
    }

    const name = String(r.sourceName || '（未設定）');
    const src = sources.get(name) || { name, channel, newVisits: 0, contracts: 0 };
    src.newVisits += 1;
    if (contracted) src.contracts += 1;
    sources.set(name, src);
  }

  const finishDaily = (map) => Array.from(map.values()).sort((a, b) => (a.date < b.date ? -1 : 1));

  const retentionOf = (shopId) => {
    const override = retentionOverrides && retentionOverrides[shopId];
    if (override) return { ...override, basis: 'api' };
    return retentionFromContracts ? computeRetention(contracts, shopId, month, today) : null;
  };
  const shopOut = {};
  for (const s of shops.values()) {
    shopOut[s.shopId] = {
      shopId: s.shopId,
      consumedSales: s.consumedSales,
      existingConsumedSales: s.existingConsumedSales,
      depositSales: s.depositSales,
      treatmentCount: s.treatmentCount,
      customerCount: s.customerIds.size,
      cashSales: s.cashSales,
      newVisits: s.newVisits,
      newContracts: s.newContracts,
      newVisitTotal: sumValues(s.newVisits),
      newContractTotal: sumValues(s.newContracts),
      referralSubscriptions: s.referralSubscriptions,
      daily: finishDaily(s.daily),
      retention: retentionOf(s.shopId),
    };
  }
  // 受付が 1件も無い店舗でも、契約データ・継続指標があれば継続指標だけは出す
  const retentionShops = new Set([
    ...(retentionFromContracts ? (contracts || []).map((c) => c.shopId) : []),
    ...Object.keys(retentionOverrides || {}),
  ].filter(Boolean));
  for (const shopId of retentionShops) {
    if (shopOut[shopId]) continue;
    const empty = newShopBucket(shopId);
    shopOut[shopId] = {
      shopId,
      consumedSales: 0, existingConsumedSales: 0, depositSales: 0, treatmentCount: 0, customerCount: 0, cashSales: 0,
      newVisits: empty.newVisits, newContracts: empty.newContracts, newVisitTotal: 0, newContractTotal: 0,
      referralSubscriptions: 0, daily: [],
      retention: retentionOf(shopId),
    };
  }

  const staffOut = {};
  for (const s of staff.values()) {
    let primaryShop = s.shopId;
    let best = -1;
    for (const [shopId, votes] of s.shopVotes) if (votes > best) { best = votes; primaryShop = shopId; }
    staffOut[s.staffId] = {
      staffId: s.staffId,
      shopId: primaryShop,
      name: s.name,
      consumedSales: s.consumedSales,
      existingConsumedSales: s.existingConsumedSales,
      depositSales: s.depositSales,
      treatmentCount: s.treatmentCount,
      customerCount: s.customerIds.size,
      newVisits: s.newVisits,
      newContracts: s.newContracts,
      newVisitTotal: sumValues(s.newVisits),
      newContractTotal: sumValues(s.newContracts),
      referralSubscriptions: s.referralSubscriptions,
      daily: finishDaily(s.daily),
    };
  }

  return {
    month,
    asOf: monthsBetween(month, monthOf(today)) > 0 ? monthRange(month).to : today,
    shops: shopOut,
    staff: staffOut,
    sources: Array.from(sources.values()).sort((a, b) => b.newVisits - a.newVisits),
  };
}

/** 複数店舗の合計（「全店舗」表示用） */
export function combineShops(shopList) {
  const out = {
    consumedSales: 0, existingConsumedSales: 0, depositSales: 0, treatmentCount: 0, customerCount: 0, cashSales: 0,
    newVisits: emptyChannelMap(), newContracts: emptyChannelMap(), newVisitTotal: 0, newContractTotal: 0,
    referralSubscriptions: 0, daily: [],
    retention: { memberCount: 0, membersAtStart: 0, churnCount: 0, churnRatePct: null, avgTenureMonths: null, basis: 'combined' },
  };
  const daily = new Map();
  let tenureWeighted = 0;
  let tenureWeight = 0;
  let retentionShops = 0;
  let churnKnown = true;
  for (const s of shopList || []) {
    if (!s) continue;
    for (const k of ['consumedSales', 'existingConsumedSales', 'depositSales', 'treatmentCount', 'customerCount', 'cashSales', 'newVisitTotal', 'newContractTotal', 'referralSubscriptions']) {
      out[k] += n(s[k]);
    }
    for (const k of CHANNEL_KEYS) {
      out.newVisits[k] += n(s.newVisits && s.newVisits[k]);
      out.newContracts[k] += n(s.newContracts && s.newContracts[k]);
    }
    for (const d of s.daily || []) {
      const b = dayBucket(daily, d.date);
      b.consumedSales += n(d.consumedSales);
      b.depositSales += n(d.depositSales);
      b.treatmentCount += n(d.treatmentCount);
      b.newVisits += n(d.newVisits);
      b.cashSales += n(d.cashSales);
    }
    const r = s.retention;
    if (r) {
      retentionShops += 1;
      if (r.membersAtStart == null || r.churnCount == null) churnKnown = false;
      out.retention.memberCount += n(r.memberCount);
      out.retention.membersAtStart += n(r.membersAtStart);
      out.retention.churnCount += n(r.churnCount);
      if (r.avgTenureMonths != null && n(r.memberCount) > 0) {
        tenureWeighted += n(r.avgTenureMonths) * n(r.memberCount);
        tenureWeight += n(r.memberCount);
      }
    }
  }
  out.daily = Array.from(daily.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
  const rr = out.retention;
  if (!retentionShops) {
    // 継続指標が 1店舗も無い（ライブで過去の月の記録が無いなど）
    rr.memberCount = null;
    rr.membersAtStart = null;
    rr.churnCount = null;
  }
  rr.churnRatePct = retentionShops && churnKnown && rr.membersAtStart > 0 ? (rr.churnCount / rr.membersAtStart) * 100 : null;
  rr.avgTenureMonths = tenureWeight > 0 ? tenureWeighted / tenureWeight : null;
  return out;
}

/** 月末着地予測（日割りの単純ペース） */
export function forecastMonthEnd(actual, elapsedDays, totalDays) {
  if (!elapsedDays) return 0;
  return Math.round((n(actual) / elapsedDays) * totalDays);
}
