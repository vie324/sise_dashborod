// ============================================================
// 特別目標の「達成までの道すじ」（サーバー / ブラウザ共通・純粋関数）
// ------------------------------------------------------------
// 店舗の月別の実績（SalonOne の売上分析の推移）から「今の水準」を出し、
// 目標の月までに、どの指標をどれだけ伸ばせば届くかを逆算する。
//
// 売上のしくみ（店舗・1ヶ月）
//   施術消化売上 = 施術数 × 1回あたりの単価
//   施術数       = 新規の来店 + 既存のお客様の来店
//   既存の来店   = 既存のお客様の数 × 来店頻度（1人あたり月の来店回数）
//   契約数       = 新規数 × 契約率
//   契約したお客様は月2回（月2回プランが中心）通い続ける（過去の退会率で少しずつ減る）
// → 新規・契約率を伸ばした効果は、目標の月までの月数ぶん積み上がる。
//   来店頻度・単価はその月のうちに効く。
//
// 今の水準 = 直近 3ヶ月（締まった月）の平均。今のペースが続くと仮定して、足りない分を
// 「新規を増やす」「契約率を上げる」「来店頻度を上げる」「単価を上げる」のそれぞれ単独と、
// 新規・契約率・来店頻度で 3等分する「バランス」で示す。
// ============================================================

import { INCENTIVE_RULES } from './incentive-rules.js';
import { listMonths, monthsBetween, addMonths, isMonth } from './dates.js';

export const SPECIAL_METRICS = [
  { key: 'consumedSales', label: '月の施術消化売上', short: '月売上', unit: 'yen' },
  { key: 'newCount', label: '月の新規数', short: '月の新規', unit: 'person' },
  { key: 'memberCount', label: '会員数（サブスク）', short: '会員', unit: 'person' },
];

export const specialMetric = (key) => SPECIAL_METRICS.find((m) => m.key === key) || SPECIAL_METRICS[0];

/** 1000000 → '100万' / 1250000 → '125万' / 1234567 → '123.5万' / 8000 → '8,000' */
function manYen(v) {
  const x = Math.round(Number(v) || 0);
  if (Math.abs(x) < 10000) return x.toLocaleString('ja-JP');
  const m = x / 10000;
  return `${Number.isInteger(m) ? m : Number(m.toFixed(1))}万`;
}

/** 目標値の表示（タイトル用）: 月売上 → '100万円'、人数 → '150名' */
export function formatSpecialValue(metricKey, value) {
  return specialMetric(metricKey).unit === 'yen' ? `${manYen(value)}円` : `${Math.round(Number(value) || 0)}名`;
}

/** タイトルを入れなかった時の名前: '12月までに月売上100万円！'（年が違えば '2027年3月までに…'） */
export function defaultSpecialTitle(metricKey, target, deadline, currentMonth) {
  if (!isMonth(deadline)) return '';
  const [y, m] = deadline.split('-').map(Number);
  const sameYear = isMonth(currentMonth) && currentMonth.slice(0, 4) === deadline.slice(0, 4);
  return `${sameYear ? '' : `${y}年`}${m}月までに${specialMetric(metricKey).short}${formatSpecialValue(metricKey, target)}！`;
}

// ------------------------------------------------------------
// 今の水準
// ------------------------------------------------------------
export const BASE_MONTHS = 3;
// 新しく契約したお客様の月の来店回数（月2回プランが中心）。来店頻度がわからない時の仮の値にも使う
export const CONTRACT_VISITS = 2;

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const avg = (vals) => {
  const xs = vals.filter((v) => v != null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
};
const sumOf = (rows, k) => rows.reduce((s, r) => s + (num(r[k]) || 0), 0);
const maxOf = (vals) => {
  const xs = vals.filter((v) => v != null && Number.isFinite(v));
  return xs.length ? Math.max(...xs) : null;
};
const byMonth = (a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0);

/** 1ヶ月の来店頻度（既存のお客様 1人あたり）。basis は goalBaseline の frequencyBasis */
export function monthFrequency(r, basis) {
  const repeat = num(r.treatmentCount) - (num(r.newCount) || 0);
  if (basis === 'customers' && num(r.customerCount) > (num(r.newCount) || 0)) return repeat / (num(r.customerCount) - (num(r.newCount) || 0));
  if (basis === 'members' && num(r.memberCount) > 0) return repeat / num(r.memberCount);
  return null;
}

/**
 * 直近の締まった月から今の水準を出す。
 * @param {Array} history 月別の実績（buildTrend の months。当月・未来の月は含めない）
 *   { month, consumedSales, treatmentCount, newCount, purchaseCount, customerCount, memberCount, churnRatePct }
 * @returns {Object|null} 実績が 1ヶ月も無ければ null
 */
export function goalBaseline(history, { months = BASE_MONTHS } = {}) {
  const rows = (history || []).filter((r) => r && isMonth(r.month) && num(r.consumedSales) > 0 && num(r.treatmentCount) > 0).sort(byMonth);
  if (!rows.length) return null;
  const recent = rows.slice(-months);
  const count = recent.length;
  const sales = sumOf(recent, 'consumedSales') / count;
  const treatments = sumOf(recent, 'treatmentCount') / count;
  const unitPrice = sumOf(recent, 'consumedSales') / sumOf(recent, 'treatmentCount');

  const newRows = recent.filter((r) => num(r.newCount) != null);
  const newCount = newRows.length ? sumOf(newRows, 'newCount') / newRows.length : null;
  const rateRows = recent.filter((r) => num(r.newCount) > 0 && num(r.purchaseCount) != null);
  const contractRate = rateRows.length ? sumOf(rateRows, 'purchaseCount') / sumOf(rateRows, 'newCount') : null;
  const contracts = (newCount || 0) * (contractRate || 0);
  const repeat = Math.max(0, treatments - (newCount || 0));

  // 来店頻度: 既存のお客様の数（顧客数 − 新規数）→ 会員数 → 仮の値 の順に使う
  let basis = 'default';
  let existingCustomers = null;
  const custRows = recent.filter((r) => num(r.customerCount) > (num(r.newCount) || 0));
  if (custRows.length) {
    existingCustomers = avg(custRows.map((r) => num(r.customerCount) - (num(r.newCount) || 0)));
    basis = 'customers';
  } else {
    const members = avg(recent.map((r) => (num(r.memberCount) > 0 ? num(r.memberCount) : null)));
    if (members) { existingCustomers = members; basis = 'members'; }
  }
  let frequency = existingCustomers ? repeat / existingCustomers : null;
  if (!frequency || frequency <= 0) {
    frequency = CONTRACT_VISITS;
    existingCustomers = repeat / frequency;
    basis = 'default';
  }

  const memberRow = [...recent].reverse().find((r) => num(r.memberCount) != null);
  const churnRate = avg(recent.map((r) => (num(r.churnRatePct) != null ? num(r.churnRatePct) / 100 : null)));

  const rates = rows.filter((r) => num(r.newCount) > 0 && num(r.purchaseCount) != null).map((r) => num(r.purchaseCount) / num(r.newCount));
  const churns = rows.map((r) => (num(r.churnRatePct) != null ? num(r.churnRatePct) / 100 : null)).filter((v) => v != null);
  return {
    months: recent.map((r) => r.month),
    lastMonth: recent[count - 1].month,
    sales,
    treatments,
    unitPrice: unitPrice > 0 ? unitPrice : INCENTIVE_RULES.unitPrice,
    newCount,
    contractRate,
    contracts,
    repeat,
    existingCustomers,
    frequency,
    frequencyBasis: basis,
    memberCount: memberRow ? num(memberRow.memberCount) : null,
    churnRate,
    // 過去（取得できた全期間）でいちばん良かった月の値。必要な値が現実的かの目安にする
    best: {
      sales: maxOf(rows.map((r) => num(r.consumedSales))),
      newCount: maxOf(rows.map((r) => num(r.newCount))),
      contractRate: maxOf(rates),
      frequency: basis === 'default' ? null : maxOf(rows.map((r) => monthFrequency(r, basis))),
      unitPrice: maxOf(rows.map((r) => num(r.consumedSales) / num(r.treatmentCount))),
      memberCount: maxOf(rows.map((r) => num(r.memberCount))),
      churnRate: churns.length ? Math.min(...churns) : null,
    },
  };
}

// ------------------------------------------------------------
// 見通し（ある月に各指標がこうなったら、売上はいくらか）
// ------------------------------------------------------------

/** 1ヶ月に 1件契約が増えるのを months ヶ月続けた時、目標の月に残っているお客様の数 */
export function retentionWeight(months, churnRate) {
  const keep = 1 - Math.min(0.9, Math.max(0, churnRate || 0));
  let s = 0;
  for (let i = 0; i < months; i++) s += keep ** i;
  return s;
}

/**
 * 今の水準から指標を変えた時の、目標の月の見通し。
 *   既存の来店 = 今の既存のお客様 × 来店頻度 + 増えた契約のお客様 × 月2回
 * @param {Object} base   goalBaseline の結果
 * @param {Object} change { newDelta, rateDelta, freqDelta, unitPrice }
 * @param {number} weight retentionWeight（契約の効果が何ヶ月分積み上がるか）
 */
export function projectMonth(base, { newDelta = 0, rateDelta = 0, freqDelta = 0, unitPrice } = {}, weight = 1) {
  const newCount = (base.newCount || 0) + newDelta;
  const contractRate = Math.max(0, (base.contractRate || 0) + rateDelta);
  const contracts = newCount * contractRate;
  const added = (contracts - base.contracts) * weight;
  const existing = base.existingCustomers + added;
  const frequency = base.frequency + freqDelta;
  const repeat = base.existingCustomers * frequency + added * CONTRACT_VISITS;
  const treatments = base.treatments + (newCount - (base.newCount || 0)) + (repeat - base.repeat);
  const price = unitPrice || base.unitPrice;
  return { newCount, contractRate, contracts, existing, frequency, repeat, treatments, unitPrice: price, sales: treatments * price };
}

/**
 * 必要な値が過去の実績から見て現実的か。
 *   reached    過去に同じくらいの月がある
 *   stretch    過去いちばん良かった月を少し（15%まで）超える
 *   hard       過去いちばん良かった月を大きく超える
 *   impossible 契約率 100% 超など、ありえない値
 *   lowerIsBetter: 退会率のように低いほど良い指標
 */
export function feasibility(value, best, { max, lowerIsBetter = false } = {}) {
  if (value == null || !Number.isFinite(value)) return 'impossible';
  if (max != null && value > max + 1e-9) return 'impossible';
  if (lowerIsBetter && value < 0) return 'impossible';
  if (best == null) return null;
  if (lowerIsBetter) {
    if (value >= best - 1e-9) return 'reached';
    return value >= best * 0.85 ? 'stretch' : 'hard';
  }
  if (value <= best + 1e-9) return 'reached';
  return value <= best * 1.15 ? 'stretch' : 'hard';
}

// 指標を変える手段
export const LEVERS = {
  balanced: { label: 'バランスよく', icon: 'scale', desc: '新規・契約率・来店頻度で 3分の1ずつ' },
  new: { label: '新規を増やす', icon: 'user-plus', desc: '契約率・来店頻度は今のまま' },
  rate: { label: '契約率を上げる', icon: 'handshake', desc: '新規数・来店頻度は今のまま' },
  frequency: { label: '来店頻度を上げる', icon: 'repeat', desc: '既存のお客様の来店を増やす' },
  price: { label: '単価を上げる', icon: 'tag', desc: '施術数は今のまま' },
  churn: { label: '退会を減らす', icon: 'shield-check', desc: '契約数は今のまま' },
};

// ------------------------------------------------------------
// 逆算
// ------------------------------------------------------------

/** 月売上の目標 */
function planSales(base, target, buildMonths) {
  const weight = retentionWeight(buildMonths, base.churnRate);
  const gap = target - base.sales;
  const gapTreatments = gap / base.unitPrice;
  const r = base.contractRate || 0;
  const f = base.frequency;
  const v = CONTRACT_VISITS;
  const N0 = base.newCount || 0;
  const best = base.best;
  // 1つの手段で gapTreatments 回ぶん増やすのに必要な変化
  const solve = {
    new: (t) => (base.newCount != null ? { newDelta: t / (1 + r * v * weight) } : null),
    rate: (t) => (N0 > 0 && base.contractRate != null ? { rateDelta: t / (N0 * v * weight) } : null),
    frequency: (t) => (base.existingCustomers > 0 ? { freqDelta: t / base.existingCustomers } : null),
  };
  const changeList = (change, p) => {
    const out = [];
    if (change.newDelta) out.push({ kpi: 'newCount', from: N0, to: p.newCount, feasibility: feasibility(p.newCount, best.newCount) });
    if (change.rateDelta) out.push({ kpi: 'contractRate', from: base.contractRate, to: p.contractRate, feasibility: feasibility(p.contractRate, best.contractRate, { max: 1 }) });
    if (change.freqDelta) out.push({ kpi: 'frequency', from: f, to: p.frequency, feasibility: feasibility(p.frequency, best.frequency) });
    if (change.unitPrice) out.push({ kpi: 'unitPrice', from: base.unitPrice, to: p.unitPrice, feasibility: feasibility(p.unitPrice, best.unitPrice) });
    return out;
  };
  const lever = (key, change) => {
    if (!change) return { key, ...LEVERS[key], available: false };
    const projection = projectMonth(base, change, weight);
    return { key, ...LEVERS[key], available: true, change, changes: changeList(change, projection), projection };
  };

  const levers = {};
  for (const key of ['new', 'rate', 'frequency']) levers[key] = lever(key, solve[key](gapTreatments));
  levers.price = lever('price', base.treatments > 0 ? { unitPrice: target / base.treatments } : null);
  // バランス: 使える手段（新規・契約率・来店頻度）で等分する
  const parts = ['new', 'rate', 'frequency'].filter((k) => levers[k].available);
  const balanced = parts.reduce((acc, k) => ({ ...acc, ...solve[k](gapTreatments / parts.length) }), {});
  levers.balanced = lever('balanced', parts.length ? balanced : null);
  return { gap, gapTreatments, weight, levers, order: ['balanced', 'new', 'rate', 'frequency', 'price'] };
}

/** 会員数の目標。毎月 a 件の契約（≒入会）を続けた時の会員数: M(t) = M(t-1) × (1 − 退会率) + a */
function planMembers(base, target, months) {
  const M0 = base.memberCount || 0;
  const c = base.churnRate || 0;
  const keep = 1 - c;
  const reach = (perMonth, churn) => {
    const k = 1 - churn;
    return M0 * k ** months + perMonth * retentionWeight(months, churn);
  };
  const needed = (target - M0 * keep ** months) / retentionWeight(months, c);
  const N0 = base.newCount || 0;
  const r = base.contractRate || 0;
  const best = base.best;
  const extra = needed - base.contracts;
  const changes = (newCount, rate) => [
    newCount !== N0 ? { kpi: 'newCount', from: N0, to: newCount, feasibility: feasibility(newCount, best.newCount) } : null,
    rate !== base.contractRate ? { kpi: 'contractRate', from: base.contractRate, to: rate, feasibility: feasibility(rate, best.contractRate, { max: 1 }) } : null,
  ].filter(Boolean);
  const lever = (key, newCount, rate, ok = true) => (ok
    ? { key, ...LEVERS[key], available: true, changes: changes(newCount, rate), projection: { newCount, contractRate: rate, contracts: newCount * rate, memberCount: target } }
    : { key, ...LEVERS[key], available: false });

  const levers = {
    new: lever('new', r > 0 ? needed / r : null, base.contractRate, r > 0),
    rate: lever('rate', N0, N0 > 0 ? needed / N0 : null, N0 > 0 && base.contractRate != null),
    // バランス: 増やす契約の半分を新規、半分を契約率で
    balanced: lever('balanced', r > 0 ? N0 + extra / 2 / r : null, N0 > 0 ? r + extra / 2 / N0 : null, r > 0 && N0 > 0),
  };
  // 退会を減らす: 契約数は今のまま、目標に届く退会率（二分探索）
  if (reach(base.contracts, 0) >= target) {
    let lo = 0;
    let hi = Math.max(c, 0);
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (reach(base.contracts, mid) >= target) lo = mid; else hi = mid;
    }
    levers.churn = { key: 'churn', ...LEVERS.churn, available: true,
      changes: [{ kpi: 'churnRate', from: c, to: lo, feasibility: feasibility(lo, best.churnRate, { lowerIsBetter: true }) }],
      projection: { contracts: base.contracts, churnRate: lo, memberCount: target } };
  } else {
    levers.churn = { key: 'churn', ...LEVERS.churn, available: false, reason: '退会が 0 でも今の契約数では届きません' };
  }
  return { gap: target - M0, neededContracts: needed, months, levers, order: ['balanced', 'new', 'rate', 'churn'] };
}

/**
 * 特別目標の道すじ。
 * @param {Object} p
 * @param {Array}  p.history      締まった月の実績（当月を含めない）
 * @param {Object} [p.current]    当月の途中までの実績（buildTrend の当月の行）
 * @param {Object} [p.progress]   当月の進み具合 { elapsed, total }
 * @param {string} p.metric       'consumedSales' | 'newCount' | 'memberCount'
 * @param {number} p.target
 * @param {string} p.deadline     'YYYY-MM'（この月に目標の値にする）
 * @param {string} p.currentMonth 'YYYY-MM'
 * @param {string} [p.startMonth] 目標を決めた月（スタート時点の値の表示用）
 */
export function buildGoalPlan({ history, current, progress, metric, target, deadline, currentMonth, startMonth }) {
  const base = goalBaseline(history);
  const rows = (history || []).filter((r) => r && isMonth(r.month)).sort(byMonth);
  const rowOf = (m) => rows.find((r) => r.month === m) || (current && current.month === m ? current : null);

  // 今の値: 売上・新規数は当月の着地見込み（日割り）、会員数は今の人数
  let now = null;
  if (current) {
    if (metric === 'memberCount') {
      if (num(current.memberCount) != null) now = { value: num(current.memberCount), kind: 'level', month: current.month };
    } else if (progress && progress.elapsed > 0 && num(current[metric]) != null) {
      const actual = num(current[metric]);
      now = { value: Math.round((actual / progress.elapsed) * progress.total), actual, kind: 'forecast', month: current.month };
    }
  }
  const startRow = startMonth ? rowOf(addMonths(startMonth, -1)) : null;
  const start = startRow && num(startRow[metric]) != null ? { month: startRow.month, value: num(startRow[metric]) } : null;

  const out = { metric, target, deadline, currentMonth, base, now, start, levers: null, order: [], milestones: [] };
  const monthsLeft = monthsBetween(currentMonth, deadline);
  if (monthsLeft < 0) {
    const row = rowOf(deadline);
    const value = row ? num(row[metric]) : null;
    return { ...out, status: 'ended', result: value, achieved: value != null && value >= target };
  }
  if (!base) return { ...out, status: 'noData' };

  const baseValue = metric === 'consumedSales' ? base.sales : metric === 'newCount' ? base.newCount : base.memberCount;
  if (baseValue == null) return { ...out, status: 'noData' };
  out.baseValue = baseValue;
  out.gap = target - baseValue;

  // 毎月の目安: 今の水準から目標の月へまっすぐ近づける
  const path = listMonths(currentMonth, deadline);
  out.milestones = path.map((m, i) => ({ month: m, value: baseValue + (out.gap * (i + 1)) / path.length }));
  return withTrack(planFor(out, base, metric, target, deadline, monthsLeft, path));
}

function planFor(out, base, metric, target, deadline, monthsLeft, path) {
  if (out.gap <= 0) return { ...out, status: 'reached' };
  if (metric === 'consumedSales') {
    const buildMonths = Math.max(1, monthsLeft);
    return { ...out, status: 'plan', buildMonths, ...planSales(base, target, buildMonths) };
  }
  if (metric === 'memberCount') {
    const months = Math.max(1, monthsBetween(base.lastMonth, deadline));
    const plan = planMembers(base, target, months);
    // 毎月の目安は「必要な契約数を続けた時の会員数」
    const keep = 1 - (base.churnRate || 0);
    let m = base.memberCount || 0;
    const byMonth = new Map();
    for (const ym of listMonths(addMonths(base.lastMonth, 1), deadline)) {
      m = m * keep + plan.neededContracts;
      byMonth.set(ym, m);
    }
    const milestones = path.map((ym) => ({ month: ym, value: byMonth.has(ym) ? byMonth.get(ym) : target }));
    // 今の契約ペースのままでも届く
    if (plan.neededContracts <= base.contracts) return { ...out, milestones, status: 'onPace', neededContracts: plan.neededContracts, months };
    return { ...out, milestones, status: 'plan', ...plan };
  }
  // 新規数: 増えた新規が契約して通い続けた時の、目標の月から 3ヶ月後の売上の見通し
  const effectMonths = 3;
  const effect = projectMonth(base, { newDelta: out.gap }, retentionWeight(effectMonths, base.churnRate));
  return { ...out, status: 'plan', effect: { months: effectMonths, contracts: effect.contracts - base.contracts, sales: effect.sales - base.sales } };
}

/** 今月の見込みと今月の目安を比べた進み具合 */
function withTrack(plan) {
  const { now, milestones, target } = plan;
  if (!now || !milestones.length) return plan;
  const m = milestones[0].value;
  const track = now.value >= target ? 'achieved' : now.value >= m ? 'onTrack' : now.value >= m * 0.95 ? 'close' : 'behind';
  return { ...plan, track };
}
