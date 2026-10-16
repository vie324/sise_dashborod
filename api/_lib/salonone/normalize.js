// ============================================================
// SalonOne API レスポンスの正規化
// ------------------------------------------------------------
// 分析API の仕様（https://salonone.net/api-docs）はログインしないと
// 閲覧できないため、フィールド名は SalonOne 画面の用語・CSV 項目名から
// 推定したものを複数候補で受け付ける（snake_case / camelCase / ネスト）。
// 実際の仕様に合わせる時は、ここの候補リストに 1 つ追加するだけでよい。
// 正規化後の形は shared/metrics.js 冒頭のコメントを参照。
// ============================================================

import { toJstDate } from '../../../shared/dates.js';

/** obj から候補パス（'a.b' 形式可）を順に探して最初に見つかった値を返す */
export function pick(obj, paths, fallback = undefined) {
  if (!obj || typeof obj !== 'object') return fallback;
  for (const p of paths) {
    let cur = obj;
    for (const key of p.split('.')) {
      if (cur == null || typeof cur !== 'object') { cur = undefined; break; }
      cur = cur[key];
    }
    if (cur !== undefined && cur !== null && cur !== '') return cur;
  }
  return fallback;
}

const toNum = (v) => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = Number(String(v).replace(/[,¥円\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};
const toId = (v) => (v == null || v === '' ? '' : String(v));
const toBool = (v) => v === true || v === 1 || v === '1' || v === 'true';

/** API が { data: [...] } / { data: { data: [...] } } / [...] のどれで返しても配列を取り出す */
export function extractList(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return [];
  for (const key of ['data', 'items', 'results', 'records', 'rows']) {
    const v = json[key];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object' && Array.isArray(v.data)) return v.data;
  }
  return [];
}

export function normalizeShop(raw) {
  return {
    id: toId(pick(raw, ['id', 'shop_id', 'shopId'])),
    name: String(pick(raw, ['name', 'shop_name', 'shopName', 'display_name'], '')),
  };
}

export function normalizeStaff(raw) {
  return {
    id: toId(pick(raw, ['id', 'staff_id', 'staffId'])),
    name: String(pick(raw, ['name', 'staff_name', 'staffName', 'display_name', 'full_name'], '')),
    shopId: toId(pick(raw, ['shop_id', 'shopId', 'shop.id', 'shops.0.id', 'main_shop_id'])),
    active: !toBool(pick(raw, ['deleted', 'is_deleted', 'retired'], false)),
  };
}

const STATUS_MAP = [
  [/^(completed|complete|done|paid|checked_out|settled|finished)$|完了|会計済/i, 'completed'],
  [/^(checked_in|in_progress|visiting)$|来店中/i, 'checked_in'],
  [/no.?show|無断/i, 'no_show'],
  [/cancel|キャンセル/i, 'cancelled'],
  [/^(reserved|booked|pending|confirmed)$|予約/i, 'reserved'],
];

export function normalizeStatus(value) {
  const s = String(value || '').trim();
  if (!s) return 'completed';
  for (const [re, key] of STATUS_MAP) if (re.test(s)) return key;
  return s.toLowerCase();
}

export function normalizeCustomerClass(raw) {
  const v = String(pick(raw, ['classification', 'customer_class', 'customerClass', 'visit_type', 'visitType', 'class'], '')).trim();
  if (/^new$|新規|first/i.test(v)) return 'new';
  if (/continu|repeat|継続|リピート/i.test(v)) return 'repeat';
  if (v) return 'existing';
  const visitNumber = toNum(pick(raw, ['visit_number', 'visitNumber', 'visit_count', 'visitCount'], 0));
  if (visitNumber === 1) return 'new';
  if (toBool(pick(raw, ['is_new', 'isNew', 'is_first_visit', 'first_visit'], false))) return 'new';
  return 'existing';
}

export function normalizeReception(raw) {
  const date = toJstDate(pick(raw, [
    'visit_date', 'visited_at', 'reserved_at', 'reservation_datetime', 'start_at', 'starts_at', 'date', 'appointment_date',
    'visitDate', 'visitedAt', 'reservedAt', 'reservationDatetime', 'startAt', 'startsAt', 'appointmentDate',
  ]));
  return {
    id: toId(pick(raw, ['id', 'reception_id', 'appointment_id', 'reservation_id'])),
    shopId: toId(pick(raw, ['shop_id', 'shopId', 'shop.id'])),
    staffId: toId(pick(raw, ['staff_id', 'staffId', 'staff.id', 'assigned_staff_id', 'main_staff_id'])),
    customerId: toId(pick(raw, ['customer_id', 'customerId', 'customer.id', 'karte_id'])),
    date,
    status: normalizeStatus(pick(raw, ['status', 'state', 'reception_status'])),
    customerClass: normalizeCustomerClass(raw),
    sourceName: String(pick(raw, ['visit_source.name', 'visit_source_name', 'visitSourceName', 'source_name', 'source', 'media.name', 'media_name', 'media', 'channel'], '')),
    consumedAmount: toNum(pick(raw, ['consumed_sales', 'consumedSales', 'consumed_amount', 'consumedAmount', 'consumed', 'consumption_amount'], 0)),
    salesAmount: toNum(pick(raw, ['sales', 'sales_amount', 'salesAmount', 'deposit_sales', 'digest_sales', 'total_amount', 'amount', 'total'], 0)),
    paymentMethod: String(pick(raw, ['payment_method.name', 'payment_method_name', 'paymentMethodName', 'payment_method', 'paymentMethod'], '')),
    referralStaffId: toId(pick(raw, ['referral_staff_id', 'referralStaffId', 'introducer_staff_id', 'forced_link.staff_id'])),
  };
}

const TYPE_MAP = [
  [/subsc|サブスク|月額|monthly/i, 'subscription'],
  [/ticket|回数券|coupon_book/i, 'ticket'],
  [/prepaid|プリペイド/i, 'prepaid'],
  [/per.?visit|都度/i, 'payPerVisit'],
];

export function normalizeContractType(value, planName) {
  const s = `${value || ''} ${planName || ''}`;
  for (const [re, key] of TYPE_MAP) if (re.test(s)) return key;
  return String(value || 'subscription');
}

/**
 * @param {Object} raw
 * @param {{ sharePlanPattern?: RegExp, payPerVisitPattern?: RegExp }} [opts]
 */
export function normalizeContract(raw, opts = {}) {
  const planName = String(pick(raw, ['plan.name', 'plan_name', 'planName', 'menu_name', 'name'], ''));
  let type = normalizeContractType(pick(raw, ['type', 'plan_type', 'planType', 'kind', 'plan.type']), planName);
  if (opts.payPerVisitPattern && opts.payPerVisitPattern.test(planName)) type = 'payPerVisit';
  const isSharePlan = toBool(pick(raw, ['is_share_plan', 'isSharePlan', 'share', 'plan.is_share'], false))
    || (opts.sharePlanPattern ? opts.sharePlanPattern.test(planName) : false);
  const end = pick(raw, [
    'ended_at', 'end_date', 'cancelled_at', 'canceled_at', 'leaved_at', 'withdraw_date', 'expired_at',
    'endedAt', 'endDate', 'cancelledAt', 'canceledAt', 'leavedAt', 'withdrawDate', 'expiredAt',
  ]);
  return {
    id: toId(pick(raw, ['id', 'contract_id', 'subscription_id', 'entitlement_id'])),
    customerId: toId(pick(raw, ['customer_id', 'customerId', 'customer.id'])),
    shopId: toId(pick(raw, ['shop_id', 'shopId', 'shop.id'])),
    staffId: toId(pick(raw, ['staff_id', 'staffId', 'staff.id', 'sold_by_staff_id'])),
    type,
    planName,
    isSharePlan,
    startDate: toJstDate(pick(raw, [
      'started_at', 'start_date', 'contracted_at', 'purchased_at', 'joined_at', 'created_at',
      'startedAt', 'startDate', 'contractedAt', 'purchasedAt', 'joinedAt', 'createdAt',
    ])),
    endDate: end ? toJstDate(end) : null,
  };
}

/** API が継続指標を集計済みで返す場合（任意） */
export function normalizeRetention(raw) {
  const churn = pick(raw, ['churn_rate', 'churnRate', 'withdrawal_rate', 'cancel_rate']);
  const churnNum = churn == null ? null : toNum(churn);
  return {
    shopId: toId(pick(raw, ['shop_id', 'shopId'])),
    memberCount: toNum(pick(raw, ['member_count', 'memberCount', 'members', 'active_members'], 0)),
    // 0〜1 の比率で返ってきた場合は % に直す
    churnRatePct: churnNum == null ? null : (churnNum <= 1 ? churnNum * 100 : churnNum),
    avgTenureMonths: pick(raw, ['average_tenure_months', 'avg_tenure_months', 'avgTenureMonths', 'average_continuation_months']) ?? null,
  };
}
