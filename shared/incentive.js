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
// 6. 系列店での契約（店長以上が登録した件数）
// ------------------------------------------------------------

export function computeCrossStoreIncentive(m, rules = INCENTIVE_RULES) {
  const r = rules.crossStore;
  const contracts = Math.max(0, num(m.crossStoreContracts));
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
    computeCrossStoreIncentive(m, rules),
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

/**
 * 1ヶ月分の結果を、支給額（項目ごと）と判定に使った数字だけにまとめる（確定の記録・CSV 用）
 * @param {Object} res computeStaffIncentive の結果
 */
export function summarizeIncentive(res) {
  if (!res) return null;
  const by = Object.fromEntries(res.items.map((it) => [it.key, it]));
  const cond = (item, key) => {
    const c = item && item.conditions ? item.conditions.find((x) => x.key === key) : null;
    return c ? c.current : null;
  };
  return {
    month: res.month,
    total: res.total,
    items: Object.fromEntries(res.items.map((it) => [it.key, it.amount])),
    basis: {
      consumedSales: by.sales.current,
      existingConsumedSales: cond(by.newContract, 'existingSales'),
      newVisits3ch: by.newContract.visits,
      contracts3ch: by.newContract.contracts,
      snsCustomers: by.sns.customers,
      snsContracts: by.sns.contracts,
      referralSubscriptions: by.referral.contracts,
      crossStoreContracts: by.crossStore ? by.crossStore.contracts : 0,
      retentionKnown: by.retention.known,
      memberCount: cond(by.retention, 'members'),
      churnRatePct: cond(by.retention, 'churn'),
      avgTenureMonths: cond(by.retention, 'tenure'),
    },
  };
}

// ------------------------------------------------------------
// 支給一覧の CSV（給与の計算用。Excel で開けるよう BOM 付き）
// ------------------------------------------------------------
const csvCell = (v) => {
  if (v == null) return '';
  let s = String(v);
  // 数式として解釈されないように（=・+・-・@ で始まる文字列）
  if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const round1 = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 10) / 10);

/**
 * @param {Array<{ key, name, storeName, total, months: Array<{ month, total, items, basis }> }>} rows
 *   確定の記録の staff、または summary の staff を { ...row, months: row.period.months, total: row.period.total } にしたもの
 * @param {{ periodLabel?: string, status?: string }} [opts] status は「確定」「見込み」など
 */
export function incentiveCsv(rows, { periodLabel = '', status = '' } = {}) {
  const head = [
    '支給期間', '状態', '店舗', 'スタッフ', 'SalonOne スタッフID', '対象月',
    '施術消化売上', '既存顧客の消化売上', '3経路の新規', '3経路の契約', 'SNSの集客', 'SNSの契約', '紹介のサブスク契約', '系列店での契約',
    '会員数', '退会率(%)', '平均継続(ヶ月)', '会員数の記録日',
    '①施術消化売上', '②継続率', '③新規契約', '④Minimo・Threads・Instagram', '⑤紹介', '⑥系列店での契約', '月の合計', '支給期間の合計',
  ];
  const lines = [head];
  for (const r of rows || []) {
    for (const m of r.months || []) {
      if (m.total == null) continue;
      const b = m.basis || {};
      const it = m.items || {};
      lines.push([
        periodLabel, status, r.storeName || '', r.name || '', r.key, m.month,
        b.consumedSales, b.existingConsumedSales, b.newVisits3ch, b.contracts3ch, b.snsCustomers, b.snsContracts, b.referralSubscriptions, b.crossStoreContracts || 0,
        b.retentionKnown ? b.memberCount : null, b.retentionKnown ? round1(b.churnRatePct) : null, b.retentionKnown ? round1(b.avgTenureMonths) : null,
        b.retentionKnown ? b.retentionAsOf || null : null,
        it.sales, it.retention, it.newContract, it.sns, it.referral, it.crossStore || 0, m.total, r.total,
      ]);
    }
  }
  return `﻿${lines.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
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
