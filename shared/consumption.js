// ============================================================
// 施術消化売上（施術 1回あたり）— サーバー / ブラウザ共通・純粋関数
// ------------------------------------------------------------
// 施術した日に、施術した担当スタッフへ「その施術 1回分の金額」を計上する（オーナー決定 2026-11。11月の支給期間から）。
//   都度払い・初回体験 … その来店で払った施術代（例: 初回 3,000円）
//   サブスク          … 月額 ÷ 月の回数（例: 月2回 15,000円 → 1回 7,500円）
//   回数券            … 購入額 ÷ 回数
//   含めない          … プランの購入・毎月のサブスク課金そのもの（入金売上のほう）、使わなかった回・失効、物販、キャンセル料
//
// SalonOne の受付履歴の「消化額」（consumed_amount）を基にする。
//   - サブスクの来店の消化額は、SalonOne の登録の都合で 0円の時と 1回分（7,500円）の時がある。
//     0円の来店は、そのお客様のプラン（継続管理の顧客一覧・受付履歴での購入）の 1回分の金額を当てる
//   - 1回分の金額はプランごとに「設定」→「同じプランで SalonOne が消化額を付けた来店（いちばん多い金額）」→
//     「購入額 ÷ 回数（サブスクはプラン名の『月2回』など、回数券は回数）」の順で決める
//   - サブスクを買った来店で、SalonOne が購入額まで消化額に入れている（会計金額の全額が消化額）時はその分を外す
//   - 物販は来店ごとに分けられないため、月の合計から SalonOne の売上分析の物販売上を差し引く（shared/metrics.js）
// ============================================================

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** プラン名の比較用（全角・半角と空白をそろえる） */
export const planKey = (name) => String(name || '').normalize('NFKC').replace(/\s+/g, ' ').trim();

const PREPAID = /プリペイド|prepaid|チャージ/i;
const isPlanKind = (kind) => kind === 'subscription' || kind === 'ticket';

/** プラン名から月の回数（「月2回」→ 2、「月一フル」→ 1、「週1回」→ 4）。わからなければ null */
export function monthlySessionsOf(name) {
  const s = planKey(name);
  let m = s.match(/月\s*(\d+)\s*回/);
  if (m) return Number(m[1]) || null;
  if (/月\s*(一|イチ|いち)/.test(s)) return 1;
  m = s.match(/週\s*(\d+)\s*回?/);
  if (m) return Number(m[1]) * 4 || null;
  return null;
}

/** 受付の中のプランの購入（サブスク・回数券） */
function purchases(r) {
  let subscription = 0;
  let ticket = 0;
  for (const p of r.plans || []) {
    if (p.kind === 'subscription') subscription += n(p.amount);
    else if (p.kind === 'ticket') ticket += n(p.amount);
  }
  return { subscription, ticket, total: subscription + ticket };
}

/** いちばん多い金額（同数なら真ん中に近いもの） */
function modeOf(values) {
  if (!values.length) return null;
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  let best = null;
  for (const [v, c] of counts) {
    if (!best || c > best.c || (c === best.c && Math.abs(v - median) < Math.abs(best.v - median))) best = { v, c };
  }
  return best.v;
}

/**
 * お客様ごとのプラン（継続管理の顧客一覧 + 受付履歴でのプランの購入）
 * @param {Array<{ customerId, planName, churned, paymentAt }>} retentionPlans 継続管理の顧客一覧（normalizeRetentionPlans）
 * @param {Array} receptions 正規化済みの受付（plans: [{ name, kind, amount, totalSessions }]）
 * @returns {Map<string, Array<{ key, name, churned, at }>>} customerId → プラン（プリペイドは除く）
 */
export function customerPlans(retentionPlans, receptions) {
  const out = new Map();
  const add = (customerId, name, churned, at) => {
    const key = planKey(name);
    if (!customerId || !key || PREPAID.test(key)) return;
    const list = out.get(customerId) || [];
    const hit = list.find((p) => p.key === key);
    if (hit) {
      hit.churned = hit.churned && churned;
      if (at && (!hit.at || at > hit.at)) hit.at = at;
    } else {
      list.push({ key, name: String(name), churned, at: at || '' });
    }
    out.set(customerId, list);
  };
  for (const p of retentionPlans || []) add(String(p.customerId || ''), p.planName, !!p.churned, p.paymentAt || '');
  for (const r of receptions || []) {
    if (!r || r.status !== 'completed' || !r.customerId) continue;
    for (const p of r.plans || []) if (isPlanKind(p.kind)) add(String(r.customerId), p.name, false, r.date || '');
  }
  return out;
}

/**
 * プランごとの 1回分の金額
 * @param {Object} opts
 * @param {Array} opts.receptions 正規化済みの受付（月・店舗をまたいでよい。多いほど SalonOne の 1回分が拾える）
 * @param {Map} opts.plansOf customerPlans の戻り値
 * @param {Object<string, number>} [opts.overrides] 設定（プラン名 → 1回分の金額）
 * @returns {Map<string, { key, name, unit:number|null, source:'setting'|'salonone'|'price'|null, samples:number,
 *   learned:number|null, price:number|null, sessions:number|null, priceUnit:number|null }>}
 *   learned: SalonOne が付けた 1回分（いちばん多い金額）/ priceUnit: 購入額 ÷ 回数
 */
export function planUnits({ receptions, plansOf, overrides = {} }) {
  const plans = new Map();
  const get = (name) => {
    const key = planKey(name);
    let p = plans.get(key);
    if (!p) { p = { key, name: String(name), values: [], prices: [], sessions: null }; plans.set(key, p); }
    return p;
  };
  for (const list of plansOf.values()) for (const p of list) get(p.name);
  for (const r of receptions || []) {
    if (!r || r.status !== 'completed') continue;
    for (const p of r.plans || []) {
      if (!isPlanKind(p.kind) || PREPAID.test(planKey(p.name))) continue;
      const plan = get(p.name);
      if (n(p.amount) > 0) plan.prices.push(n(p.amount));
      const sessions = p.kind === 'ticket' ? n(p.totalSessions) || null : monthlySessionsOf(p.name);
      if (sessions) plan.sessions = sessions;
    }
    // SalonOne が 1回分の消化額を付けた来店（プランの購入も支払いも無く、プランが 1つだけのお客様）
    const consumed = n(r.consumedAmount);
    if (consumed <= 0 || r.billing || purchases(r).total > 0 || n(r.salesAmount) > 0) continue;
    const own = plansOf.get(String(r.customerId || '')) || [];
    if (own.length === 1) get(own[0].name).values.push(consumed);
  }
  const keyedOverrides = new Map(Object.entries(overrides || {}).map(([k, v]) => [planKey(k), n(v)]));
  const out = new Map();
  for (const p of plans.values()) {
    const sessions = p.sessions || monthlySessionsOf(p.name);
    const price = modeOf(p.prices);
    const learned = modeOf(p.values);
    const setting = keyedOverrides.get(p.key);
    const priceUnit = price > 0 && sessions ? Math.round(price / sessions) : null;
    let unit = null;
    let source = null;
    if (setting > 0) { unit = Math.round(setting); source = 'setting'; }
    else if (learned > 0) { unit = learned; source = 'salonone'; }
    else if (priceUnit) { unit = priceUnit; source = 'price'; }
    out.set(p.key, { key: p.key, name: p.name, unit, source, samples: p.values.length, learned, price, sessions, priceUnit });
  }
  return out;
}

/** 0円の来店に当てるプラン（1回分の金額がわかるもの → 離反していないもの → 最近支払った・買ったものの順） */
function pickPlan(list, units) {
  if (!list || !list.length) return null;
  const ranked = list.map((p) => ({ ...p, unit: (units.get(p.key) || {}).unit || null }))
    .sort((a, b) => (b.unit ? 1 : 0) - (a.unit ? 1 : 0) || (a.churned ? 1 : 0) - (b.churned ? 1 : 0) || String(b.at).localeCompare(String(a.at)));
  return ranked[0];
}

/**
 * 受付 1件の施術 1回分の金額
 * @param {Object} r 正規化済みの受付（consumedAmount = SalonOne の消化額, salesAmount = 会計金額）
 * @param {{ plansOf:Map, units:Map }} ctx
 * @returns {{ value:number, source:string, plan?:string }}
 *   source: salonone（SalonOne の消化額）/ salonone-adjusted（サブスクの購入額を外した）/ plan（プランの 1回分を当てた）/
 *           unknown（プランはあるが 1回分の金額がわからない）/ paid（支払った額）/ free（0円）/ billing（来店ではない課金）/ none（会計完了でない）
 */
export function treatmentValue(r, { plansOf, units }) {
  if (!r || r.status !== 'completed') return { value: 0, source: 'none' };
  if (r.billing) return { value: 0, source: 'billing' };
  const bought = purchases(r);
  const paid = n(r.salesAmount);
  const paidOther = Math.max(0, paid - bought.total);
  const consumed = n(r.consumedAmount);
  if (consumed > 0) {
    if (bought.subscription > 0 && consumed >= paid) return { value: Math.max(0, consumed - bought.subscription), source: 'salonone-adjusted' };
    return { value: consumed, source: 'salonone' };
  }
  if (bought.total === 0) {
    const plan = pickPlan(plansOf.get(String(r.customerId || '')), units);
    if (plan && plan.unit) return { value: plan.unit + paidOther, source: 'plan', plan: plan.name };
    if (plan) return { value: paidOther, source: 'unknown', plan: plan.name };
  }
  return { value: paidOther, source: paidOther > 0 ? 'paid' : 'free' };
}

/**
 * 受付に施術 1回分の金額を付ける（consumedAmount を置き換え、SalonOne の消化額は salonOneConsumed に残す）
 * @param {Array} receptions 正規化済みの受付
 * @param {{ retentionPlans?:Array, overrides?:Object }} opts
 * @returns {{ receptions:Array, units:Map, stats:Object }}
 */
export function valueReceptions(receptions, { retentionPlans = [], overrides = {} } = {}) {
  const plansOf = customerPlans(retentionPlans, receptions);
  const units = planUnits({ receptions, plansOf, overrides });
  const stats = { plan: 0, planValue: 0, unknown: 0, unknownPlans: {}, adjusted: 0, billing: 0 };
  const out = (receptions || []).map((r) => {
    if (!r || r.status !== 'completed') return r;
    const v = treatmentValue(r, { plansOf, units });
    if (v.source === 'plan') { stats.plan += 1; stats.planValue += v.value; }
    else if (v.source === 'unknown') { stats.unknown += 1; stats.unknownPlans[v.plan] = (stats.unknownPlans[v.plan] || 0) + 1; }
    else if (v.source === 'salonone-adjusted') stats.adjusted += 1;
    else if (v.source === 'billing') stats.billing += 1;
    return { ...r, salonOneConsumed: n(r.consumedAmount), consumedAmount: v.value, valueSource: v.source, valuePlan: v.plan || null };
  });
  return { receptions: out, units, stats };
}
