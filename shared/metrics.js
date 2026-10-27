// ============================================================
// 実績の集計（サーバー / ブラウザ共通・純粋関数）
// ------------------------------------------------------------
// SalonOne から取得して正規化したレコードを、月次の店舗・スタッフ実績へ集計する。
//
// 受付（来店）レコード reception（SalonOne の受付履歴 1行）:
//   { id, shopId, staffId, staffName?, customerId, date:'YYYY-MM-DD',
//     status:'completed'|'reserved'|'checked_in'|'cancelled'|'no_show',
//     customerClass:'new'|'repeat'|'existing', sourceName,
//     consumedAmount,   // 消化額
//     salesAmount,      // 会計金額（入金）
//     cashAmount?,      // そのうち現金（分割決済の内訳から。無ければ paymentMethod で判定）
//     paymentMethod, referralStaffId? }
//
// 契約レコード contract（サブスク・回数券・入会）:
//   { id, customerId, shopId, staffId?, type:'subscription'|'ticket'|'member'|'prepaid'|'payPerVisit',
//     planName, isSharePlan, startDate, endDate|null }
//
// 売上サマリ salesSummary（SalonOne の「売上分析」と同じ数字。店舗ごと）:
//   { consumedSales, depositSales, newCount, repeatCount, treatmentCount, customerCount, purchaseCount,
//     daily:[{ date, ...同じ項目 }] | null, staff:[{ staffId, name, ...同じ項目 }] | null }
//   null の項目は受付履歴からの集計のまま。
//
// 集計ルール
//   - 消化売上・入金売上・新規数・既存数（2回目以降の来店）・施術数・顧客数・契約数（購入数）は、
//     売上サマリがあればその値を使う（SalonOne の売上分析と同じ数字にする）。
//     無いとき（デモ・取得失敗）は受付履歴の会計完了（completed）の予約から集計する
//   - 新規 = その店舗で初めての来店（会計完了）。最初の予約をキャンセルして後日来店した場合も含む。
//            担当はその来店のスタッフ。経路はその来店の媒体（無ければ最初の予約の媒体）
//   - 契約 = 新規のお客様が回数券・サブスクを購入（または入会）したか。初回来店の月に計上し、
//            基準日までの契約を数える（SalonOne の「購入数」と同じ生涯基準。後の月の契約で増えることがある）
//   - 経路別の新規・契約（インセンティブの 3経路・SNS・紹介）は受付履歴から集計する
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
    firstVisitConsumed: 0,
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
    firstVisitConsumed: 0,
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

/**
 * 1店舗・1ヶ月の日別の現金売上（出納帳への取り込み・突合用）。computeMonth の店舗の日別 cashSales と同じ数え方
 * @returns {Object<string, number>} 'YYYY-MM-DD' → 現金売上（会計完了の予約のうち現金で受け取った額）
 */
export function cashByDay(receptions, shopId, month) {
  const out = {};
  for (const r of receptions || []) {
    if (!r || r.status !== 'completed' || !r.date || monthOf(r.date) !== month) continue;
    if (String(r.shopId) !== String(shopId)) continue;
    out[r.date] = (out[r.date] || 0) + cashOf(r);
  }
  return out;
}
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

const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/**
 * 店舗ごとの「初めての来店」を探す。
 *   区分 new（その店舗で最初の予約）が会計完了した来店。
 *   最初の予約がキャンセル・無断だったお客様は、その後の最初の会計完了の来店（SalonOne の売上分析と同じく来店で数える）。
 * @returns {Map<string, { r:Object, sourceName:string }>} `${shopId}|${customerId}` → その月の初回来店
 */
function findFirstVisits(receptions, month) {
  const byKey = new Map();
  for (const r of receptions) {
    if (!r.customerId || !r.date) continue;
    const key = `${r.shopId}|${r.customerId}`;
    const list = byKey.get(key) || [];
    list.push(r);
    byKey.set(key, list);
  }
  const out = new Map();
  for (const [key, list] of byKey) {
    list.sort(byDate);
    const i = list.findIndex((r) => r.customerClass === 'new');
    if (i < 0) continue;
    const firstBooking = list[i];
    // 最初の予約より前に会計完了の来店があるなら、その店舗の初回ではない
    if (list.slice(0, i).some((r) => r.status === 'completed' && r.date < firstBooking.date)) continue;
    const firstVisit = firstBooking.status === 'completed' ? firstBooking : list.slice(i + 1).find((r) => r.status === 'completed');
    if (!firstVisit || monthOf(firstVisit.date) !== month) continue;
    out.set(key, { r: firstVisit, sourceName: firstVisit.sourceName || firstBooking.sourceName || '' });
  }
  return out;
}

/**
 * 合計を保ったまま日別の値を比例で配分し直す（整数。端数は大きい順に 1円ずつ）。
 * スタッフ別は SalonOne から日別の値が取れないため、受付履歴の日別の形で売上分析の合計に合わせる。
 */
function rescaleDaily(daily, key, total, fallbackDate) {
  const sum = daily.reduce((a, d) => a + n(d[key]), 0);
  if (total == null || sum === total) return daily;
  if (sum <= 0) {
    if (!total) return daily.map((d) => ({ ...d, [key]: 0 }));
    const out = daily.map((d) => ({ ...d, [key]: 0 }));
    const last = out.find((d) => d.date === fallbackDate) || { date: fallbackDate, consumedSales: 0, depositSales: 0, treatmentCount: 0, newVisits: 0 };
    last[key] = total;
    if (!out.includes(last)) out.push(last);
    return out.sort(byDate);
  }
  const raw = daily.map((d) => (n(d[key]) * total) / sum);
  const floors = raw.map(Math.floor);
  let rest = Math.round(total - floors.reduce((a, v) => a + v, 0));
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) floors[order[k][1]] += 1;
  return daily.map((d, i) => ({ ...d, [key]: floors[i] }));
}

const OFFICIAL_KEYS = ['consumedSales', 'depositSales', 'treatmentCount', 'customerCount', 'newCount', 'repeatCount', 'purchaseCount'];
const DAILY_KEYS = { consumedSales: 'consumedSales', depositSales: 'depositSales', treatmentCount: 'treatmentCount', newCount: 'newVisits' };

/** 売上サマリ（SalonOne の売上分析）の値で、店舗・日別・スタッフ別の数字を置き換える */
function applySalesSummaries(summaries, shopOut, staffOut, { emptyShop, emptyStaff, lastDate }) {
  const official = new Map(); // staffId → 全店舗の合計
  for (const [shopId, sum] of Object.entries(summaries || {})) {
    if (!sum) continue;
    const shop = shopOut[shopId] || (shopOut[shopId] = emptyShop(shopId));
    for (const k of OFFICIAL_KEYS) if (sum[k] != null) shop[k] = sum[k];
    if (sum.consumedSales != null) shop.existingConsumedSales = Math.max(0, sum.consumedSales - shop.firstVisitConsumed);
    if (sum.daily) {
      // 売上分析にある項目だけ日別を置き換える（現金売上は受付履歴のまま）
      const keys = Object.keys(DAILY_KEYS).filter((k) => sum.daily.some((d) => d[k] != null));
      const map = new Map(shop.daily.map((d) => [d.date, { ...d }]));
      for (const d of map.values()) for (const k of keys) d[DAILY_KEYS[k]] = 0;
      for (const d of sum.daily) {
        const b = map.get(d.date) || { date: d.date, consumedSales: 0, depositSales: 0, treatmentCount: 0, newVisits: 0, cashSales: 0 };
        for (const k of keys) if (d[k] != null) b[DAILY_KEYS[k]] = d[k];
        map.set(d.date, b);
      }
      shop.daily = Array.from(map.values()).filter((d) => d.consumedSales || d.depositSales || d.treatmentCount || d.newVisits || d.cashSales).sort(byDate);
    }
    shop.basis = 'salonone';
    for (const row of sum.staff || []) {
      const acc = official.get(row.staffId) || { shopId, name: row.name, best: -Infinity };
      for (const k of OFFICIAL_KEYS) if (row[k] != null) acc[k] = n(acc[k]) + row[k];
      if (n(row.consumedSales) > acc.best) { acc.best = n(row.consumedSales); acc.shopId = shopId; }
      if (!acc.name && row.name) acc.name = row.name;
      official.set(row.staffId, acc);
    }
  }
  for (const [staffId, acc] of official) {
    const st = staffOut[staffId] || (staffOut[staffId] = emptyStaff(staffId, acc.shopId));
    if (!st.name && acc.name) st.name = acc.name;
    for (const k of OFFICIAL_KEYS) if (acc[k] != null) st[k] = acc[k];
    if (acc.consumedSales != null) {
      st.existingConsumedSales = Math.max(0, acc.consumedSales - st.firstVisitConsumed);
      st.daily = rescaleDaily(st.daily, 'consumedSales', acc.consumedSales, lastDate);
    }
    st.basis = 'salonone';
  }
}

/**
 * 1ヶ月分の集計。
 * @param {Object} input
 * @param {Array} input.receptions   その月を含む受付レコード（初回来店の判定に前の月も使う）
 * @param {Array} input.contracts    契約レコード（全期間）
 * @param {string} input.month       'YYYY-MM'
 * @param {string} [input.asOf]      データ基準日（当月はその日まで）
 * @param {Object} [input.channelMap] 媒体名 → 経路キー
 * @param {Object} [input.retentionOverrides] shopId → API 提供の継続指標
 * @param {boolean} [input.retentionFromContracts=true]
 *   継続指標が API に無い店舗を契約データから計算するか。
 *   受付履歴から作った契約（期間内の購入だけ）では会員数を出せないので、ライブでは false
 * @param {Object} [input.salesSummaries] shopId → 売上サマリ（SalonOne の売上分析）
 * @param {boolean} [input.countsFromReceptions=true]
 *   受付履歴を取っていない（推移）ときは false。新規数・既存数・契約数は売上サマリに無ければ null にする
 */
export function computeMonth({ receptions, contracts, month, asOf, channelMap, retentionOverrides, retentionFromContracts = true, salesSummaries, countsFromReceptions = true }) {
  const today = asOf || todayJst();
  const { from, to } = monthRange(month);
  const contractsByCustomer = indexContracts(contracts);
  const shops = new Map();
  const staff = new Map();
  const sources = new Map();

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

  const all = (receptions || []).filter((r) => r && r.date);
  const firstVisits = findFirstVisits(all, month);
  const firstVisitSet = new Set([...firstVisits.values()].map((v) => v.r));
  const inMonth = all.filter((r) => monthOf(r.date) === month && r.status === 'completed').sort(byDate);

  for (const r of inMonth) {
    const shop = getShop(r.shopId);
    const consumed = n(r.consumedAmount);
    const sales = n(r.salesAmount);
    const first = firstVisitSet.has(r);
    shop.consumedSales += consumed;
    shop.depositSales += sales;
    shop.treatmentCount += 1;
    if (first) shop.firstVisitConsumed += consumed;
    else shop.existingConsumedSales += consumed;
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
      if (first) st.firstVisitConsumed += consumed;
      else st.existingConsumedSales += consumed;
      if (r.customerId) st.customerIds.add(r.customerId);
      if (r.staffName) st.name = r.staffName;
      st.shopVotes.set(r.shopId, (st.shopVotes.get(r.shopId) || 0) + 1);
      const dd = dayBucket(st.daily, r.date);
      dd.consumedSales += consumed;
      dd.depositSales += sales;
      dd.treatmentCount += 1;
    }
  }

  // 新規客（初回来店）の経路・契約。契約は月初から基準日まで（生涯基準）
  for (const { r, sourceName } of firstVisits.values()) {
    const channel = resolveChannel(sourceName, channelMap);
    const list = contractsByCustomer.get(r.customerId) || [];
    const relevant = list.filter((c) => c.startDate && c.startDate >= from && c.startDate <= today
      && (!c.shopId || !r.shopId || c.shopId === r.shopId));
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

    const name = String(sourceName || '（未設定）');
    const src = sources.get(name) || { name, channel, newVisits: 0, contracts: 0 };
    src.newVisits += 1;
    if (contracted) src.contracts += 1;
    sources.set(name, src);
  }

  const finishDaily = (map) => Array.from(map.values()).sort(byDate);

  const retentionOf = (shopId) => {
    const override = retentionOverrides && retentionOverrides[shopId];
    if (override) return { ...override, basis: 'api' };
    return retentionFromContracts ? computeRetention(contracts, shopId, month, today) : null;
  };
  // 受付履歴からの数字。新規数・既存数・契約数は経路別の合計から（売上サマリがあれば後で置き換える）
  const counts = (b, treatmentCount) => {
    if (!countsFromReceptions) {
      return { newVisits: b.newVisits, newContracts: b.newContracts, newVisitTotal: null, newContractTotal: null, newCount: null, repeatCount: null, purchaseCount: null };
    }
    const newVisitTotal = sumValues(b.newVisits);
    const newContractTotal = sumValues(b.newContracts);
    return {
      newVisits: b.newVisits,
      newContracts: b.newContracts,
      newVisitTotal,
      newContractTotal,
      newCount: newVisitTotal,
      repeatCount: Math.max(0, treatmentCount - newVisitTotal),
      purchaseCount: newContractTotal,
    };
  };
  const emptyShop = (shopId) => {
    const empty = newShopBucket(shopId);
    return {
      shopId,
      consumedSales: 0, existingConsumedSales: 0, firstVisitConsumed: 0, depositSales: 0, treatmentCount: 0, customerCount: 0, cashSales: 0,
      ...counts(empty, 0),
      referralSubscriptions: 0, daily: [], basis: 'receptions',
      retention: retentionOf(shopId),
    };
  };
  const emptyStaff = (staffId, shopId) => {
    const empty = newStaffBucket(staffId, shopId);
    return {
      staffId, shopId, name: '',
      consumedSales: 0, existingConsumedSales: 0, firstVisitConsumed: 0, depositSales: 0, treatmentCount: 0, customerCount: 0,
      ...counts(empty, 0),
      referralSubscriptions: 0, daily: [], basis: 'receptions',
    };
  };

  const shopOut = {};
  for (const s of shops.values()) {
    shopOut[s.shopId] = {
      shopId: s.shopId,
      consumedSales: s.consumedSales,
      existingConsumedSales: s.existingConsumedSales,
      firstVisitConsumed: s.firstVisitConsumed,
      depositSales: s.depositSales,
      treatmentCount: s.treatmentCount,
      customerCount: s.customerIds.size,
      cashSales: s.cashSales,
      ...counts(s, s.treatmentCount),
      referralSubscriptions: s.referralSubscriptions,
      daily: finishDaily(s.daily),
      basis: 'receptions',
      retention: retentionOf(s.shopId),
    };
  }
  // 受付が 1件も無い店舗でも、契約データ・継続指標があれば継続指標だけは出す
  const retentionShops = new Set([
    ...(retentionFromContracts ? (contracts || []).map((c) => c.shopId) : []),
    ...Object.keys(retentionOverrides || {}),
  ].filter(Boolean));
  for (const shopId of retentionShops) {
    if (!shopOut[shopId]) shopOut[shopId] = emptyShop(shopId);
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
      firstVisitConsumed: s.firstVisitConsumed,
      depositSales: s.depositSales,
      treatmentCount: s.treatmentCount,
      customerCount: s.customerIds.size,
      ...counts(s, s.treatmentCount),
      referralSubscriptions: s.referralSubscriptions,
      daily: finishDaily(s.daily),
      basis: 'receptions',
    };
  }

  const lastDate = today < to ? today : to;
  if (salesSummaries) applySalesSummaries(salesSummaries, shopOut, staffOut, { emptyShop, emptyStaff, lastDate });

  return {
    month,
    asOf: monthsBetween(month, monthOf(today)) > 0 ? to : today,
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
    newCount: 0, repeatCount: 0, purchaseCount: 0,
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
    // 新規数・既存数・契約数は、わからない店舗が 1つでもあれば合計もわからない（null）
    for (const k of ['newCount', 'repeatCount', 'purchaseCount']) {
      out[k] = out[k] == null || s[k] == null ? null : out[k] + n(s[k]);
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
