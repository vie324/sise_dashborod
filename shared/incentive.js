// ============================================================
// インセンティブ計算（サーバー / ブラウザ共通・純粋関数）
// ------------------------------------------------------------
// 入力はスタッフ 1人・1ヶ月分の実績（metrics.js が SalonOne のデータから集計）。
// 出力は各インセンティブの「支給額」「達成条件」「次の段階まであといくら」。
// 率の比較は浮動小数点の誤差を避けるため整数演算（件数×100 と %×件数）で行う。
// ============================================================

import { INCENTIVE_RULES } from './incentive-rules.js';
import { addMonths, monthsBetween, formatMonthJa } from './dates.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const sumKeys = (obj, keys) => keys.reduce((s, k) => s + num(obj && obj[k]), 0);

// ------------------------------------------------------------
// 支給期間（2ヶ月に1回）
// ------------------------------------------------------------

/**
 * 月が属する支給期間。制度開始前の月は index < 0 / preview: true。
 * @returns {{ index:number, months:string[], label:string, preview:boolean }}
 */
export function paymentPeriodOf(month, rules = INCENTIVE_RULES) {
  const diff = monthsBetween(rules.startMonth, month);
  const index = Math.floor(diff / rules.periodMonths);
  const first = addMonths(rules.startMonth, index * rules.periodMonths);
  const months = Array.from({ length: rules.periodMonths }, (_, i) => addMonths(first, i));
  const last = months[months.length - 1];
  const sameYear = first.slice(0, 4) === last.slice(0, 4);
  const label = sameYear
    ? `${formatMonthJa(first)}〜${Number(last.slice(5))}月`
    : `${formatMonthJa(first)}〜${formatMonthJa(last)}`;
  return { index, months, label, preview: diff < 0 };
}

export function isBeforeStart(month, rules = INCENTIVE_RULES) {
  return monthsBetween(rules.startMonth, month) < 0;
}

// ------------------------------------------------------------
// 1. 施術消化売上
// ------------------------------------------------------------

export function computeSalesIncentive(consumedSales, rules = INCENTIVE_RULES) {
  const r = rules.sales;
  const current = Math.max(0, num(consumedSales));
  let tierIndex = -1;
  r.tiers.forEach((t, i) => { if (current >= t.min) tierIndex = i; });
  const amount = tierIndex >= 0 ? r.tiers[tierIndex].amount : 0;
  const next = r.tiers[tierIndex + 1] || null;
  const nextTier = next
    ? {
        min: next.min,
        amount: next.amount,
        gap: next.min - current,
        sessions: Math.ceil((next.min - current) / rules.unitPrice),
      }
    : null;
  return {
    key: r.key,
    label: r.label,
    amount,
    achieved: amount > 0,
    current,
    tierIndex,
    tiers: r.tiers,
    nextTier,
  };
}

// ------------------------------------------------------------
// 2. 継続率（店舗全体の条件）
// ------------------------------------------------------------

/**
 * @param {{ memberCount:number, churnRatePct:number|null, avgTenureMonths:number|null }|null} retention
 */
export function computeRetentionIncentive(retention, rules = INCENTIVE_RULES) {
  const r = rules.retention;
  const known = !!retention;
  const churn = known && retention.churnRatePct != null ? num(retention.churnRatePct) : null;
  const tenure = known && retention.avgTenureMonths != null ? num(retention.avgTenureMonths) : null;
  const members = known ? num(retention.memberCount) : null;
  const conditions = [
    {
      key: 'churn',
      label: '店舗全体の退会率',
      current: churn,
      target: r.maxChurnRatePct,
      unit: '%',
      op: '<=',
      met: churn != null && churn <= r.maxChurnRatePct,
    },
    {
      key: 'tenure',
      label: '店舗全体の平均継続期間',
      current: tenure,
      target: r.minAvgTenureMonths,
      unit: 'ヶ月',
      op: '>=',
      met: tenure != null && tenure >= r.minAvgTenureMonths,
    },
    {
      key: 'members',
      label: '会員数（都度払いを除く）',
      current: members,
      target: r.minMembers,
      unit: '名',
      op: '>=',
      met: members != null && members >= r.minMembers,
      gap: members != null ? Math.max(0, r.minMembers - members) : null,
    },
  ];
  const eligible = known && conditions.every((c) => c.met);
  return {
    key: r.key,
    label: r.label,
    amount: eligible ? r.amountPerPerson : 0,
    achieved: eligible,
    eligible,
    known,
    conditions,
  };
}

// ------------------------------------------------------------
// 3. 新規契約
// ------------------------------------------------------------

/** 次の段階の契約率に届くまでの追加契約数（追加の新規来店がすべて契約する前提） */
export function contractsNeededForRate(contracts, visits, pct) {
  if (pct >= 100) return Math.max(0, visits - contracts);
  const need = Math.ceil((pct * visits - 100 * contracts) / (100 - pct));
  return Math.max(0, need);
}

/**
 * @param {{ existingConsumedSales:number, newVisits:Object, newContracts:Object }} m
 */
export function computeNewContractIncentive(m, rules = INCENTIVE_RULES) {
  const r = rules.newContract;
  const visits = sumKeys(m.newVisits, r.channels);
  const contracts = Math.min(visits, sumKeys(m.newContracts, r.channels));
  const existing = Math.max(0, num(m.existingConsumedSales));
  const ratePct = visits > 0 ? (contracts / visits) * 100 : 0;

  let tierIndex = -1;
  r.tiers.forEach((t, i) => { if (visits > 0 && contracts * 100 >= t.minPct * visits) tierIndex = i; });

  const conditions = [
    {
      key: 'existingSales',
      label: '既存顧客の施術消化売上',
      current: existing,
      target: r.minExistingSales,
      unit: '円',
      op: '>=',
      met: existing >= r.minExistingSales,
      gap: Math.max(0, r.minExistingSales - existing),
    },
    {
      key: 'newVisits',
      label: '3経路の新規初回来店数',
      current: visits,
      target: r.minNewVisits,
      unit: '名',
      op: '>=',
      met: visits >= r.minNewVisits,
      gap: Math.max(0, r.minNewVisits - visits),
    },
  ];
  const eligible = conditions.every((c) => c.met);
  const amount = eligible && tierIndex >= 0 ? r.tiers[tierIndex].amount : 0;
  const next = r.tiers[tierIndex + 1] || null;
  const nextTier = next
    ? { minPct: next.minPct, amount: next.amount, contractsNeeded: contractsNeededForRate(contracts, visits, next.minPct) }
    : null;
  const byChannel = r.channels.map((key) => ({
    key,
    visits: num(m.newVisits && m.newVisits[key]),
    contracts: num(m.newContracts && m.newContracts[key]),
  }));
  return {
    key: r.key,
    label: r.label,
    amount,
    achieved: amount > 0,
    eligible,
    conditions,
    visits,
    contracts,
    ratePct,
    tierIndex,
    tiers: r.tiers,
    nextTier,
    byChannel,
  };
}

// ------------------------------------------------------------
// 4. Minimo・Threads・Instagram
// ------------------------------------------------------------

export function computeSnsIncentive(m, rules = INCENTIVE_RULES) {
  const r = rules.sns;
  const customers = sumKeys(m.newVisits, r.channels);
  const contracts = sumKeys(m.newContracts, r.channels);
  const eligible = customers >= r.minCustomers;
  return {
    key: r.key,
    label: r.label,
    amount: eligible ? contracts * r.amountPerContract : 0,
    achieved: eligible && contracts > 0,
    eligible,
    customers,
    contracts,
    gap: Math.max(0, r.minCustomers - customers),
    // 条件未達でも「達成したらいくらになるか」を見せるための見込み額
    potential: contracts * r.amountPerContract,
    conditions: [
      {
        key: 'customers',
        label: '3媒体経由の集客数',
        current: customers,
        target: r.minCustomers,
        unit: '名',
        op: '>=',
        met: eligible,
        gap: Math.max(0, r.minCustomers - customers),
      },
    ],
  };
}

// ------------------------------------------------------------
// 5. 紹介
// ------------------------------------------------------------

export function computeReferralIncentive(m, rules = INCENTIVE_RULES) {
  const r = rules.referral;
  const contracts = Math.max(0, num(m.referralSubscriptions));
  return {
    key: r.key,
    label: r.label,
    amount: contracts * r.amountPerContract,
    achieved: contracts > 0,
    eligible: true,
    contracts,
  };
}

// ------------------------------------------------------------
// まとめ
// ------------------------------------------------------------

/**
 * スタッフ 1人・1ヶ月分のインセンティブ。
 * @param {Object} metrics      metrics.js の staffMonth
 * @param {Object|null} retention 店舗の継続指標（memberCount / churnRatePct / avgTenureMonths）
 * @param {string} month        'YYYY-MM'
 */
export function computeStaffIncentive(metrics, retention, month, rules = INCENTIVE_RULES) {
  const m = metrics || {};
  const items = [
    computeSalesIncentive(m.consumedSales, rules),
    computeRetentionIncentive(retention, rules),
    computeNewContractIncentive(m, rules),
    computeSnsIncentive(m, rules),
    computeReferralIncentive(m, rules),
  ];
  const total = items.reduce((s, it) => s + it.amount, 0);
  return {
    month,
    preview: isBeforeStart(month, rules),
    period: paymentPeriodOf(month, rules),
    total,
    items,
  };
}

/** 支給期間内の各月の結果を合算する（存在しない月は 0 扱い） */
export function sumPeriod(monthResults) {
  const list = (monthResults || []).filter(Boolean);
  const byKey = {};
  for (const res of list) {
    for (const it of res.items) byKey[it.key] = (byKey[it.key] || 0) + it.amount;
  }
  return { total: list.reduce((s, r) => s + r.total, 0), byKey, months: list.map((r) => r.month) };
}
