// ============================================================
// SalonOne 分析API レスポンスの正規化
// ------------------------------------------------------------
// 仕様: https://salonone.net/api-docs（schema_version 2026-10-16）
//   /shops /staffs /visit-sources        明細（id・deleted_at など。項目の一覧は非公開）
//   /marketing/reception-history         受付履歴の明細（予約 1件 1行）
//   /marketing/retention-summary         継続管理のサマリー
//   /marketing/retention-customers       継続管理の顧客一覧
// 明細（/shops など）の項目名は仕様に載っていないため、候補を複数受け付ける。
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
const toNumOrNull = (v) => (v == null || v === '' ? null : toNum(v));
const toId = (v) => (v == null || v === '' ? '' : String(v));
const toBool = (v) => v === true || v === 1 || v === '1' || v === 'true';

/**
 * 一覧を取り出す。{ data: [...] }（明細）/ { data: { rows: [...] } }（マーケ集計）/ [...] のどれでも配列にする
 */
export function extractList(json) {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return [];
  for (const key of ['data', 'items', 'results', 'records', 'rows']) {
    const v = json[key];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      for (const inner of ['rows', 'items', 'data', 'customers', 'records']) {
        if (Array.isArray(v[inner])) return v[inner];
      }
    }
  }
  return [];
}

/** 削除済み（deleted_at に値がある・deleted フラグ） */
const isDeleted = (raw) => !!pick(raw, ['deleted_at', 'deletedAt']) || toBool(pick(raw, ['deleted', 'is_deleted', 'isDeleted'], false));

export function normalizeShop(raw) {
  return {
    id: toId(pick(raw, ['id', 'shop_id', 'shopId'])),
    name: String(pick(raw, ['name', 'shop_name', 'shopName', 'display_name'], '')),
    active: !isDeleted(raw),
  };
}

function staffName(raw) {
  const name = pick(raw, ['name', 'staff_name', 'staffName', 'display_name', 'full_name', 'nickname']);
  if (name) return String(name);
  const last = pick(raw, ['last_name', 'family_name', 'sei'], '');
  const first = pick(raw, ['first_name', 'given_name', 'mei'], '');
  return `${last}${last && first ? ' ' : ''}${first}`.trim();
}

export function normalizeStaff(raw) {
  const retired = isDeleted(raw)
    || toBool(pick(raw, ['retired', 'is_retired', 'resigned', 'is_resigned'], false))
    || !!pick(raw, ['retired_at', 'resigned_at', 'retirement_date']);
  return {
    id: toId(pick(raw, ['id', 'staff_id', 'staffId'])),
    name: staffName(raw),
    shopId: toId(pick(raw, ['shop_id', 'shopId', 'main_shop_id', 'shop.id', 'shops.0.id', 'shop_ids.0'])),
    active: !retired,
  };
}

/** 流入元（来店経由）の名前 */
export function normalizeVisitSourceName(raw) {
  return String(pick(raw, ['name', 'visit_source_name', 'label', 'title'], ''));
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

/** 区分: new（その店舗で最初の予約）/ continuing（継続）/ existing */
export function normalizeCustomerClass(raw) {
  const v = String(pick(raw, ['classification', 'customer_class', 'customerClass', 'visit_type', 'visitType'], '')).trim();
  if (/^new$|新規|first/i.test(v)) return 'new';
  if (/continu|repeat|継続|リピート/i.test(v)) return 'repeat';
  if (v) return 'existing';
  if (toNum(pick(raw, ['visit_number', 'visitNumber'], 0)) === 1) return 'new';
  if (toBool(pick(raw, ['is_new', 'isNew', 'is_first_visit'], false))) return 'new';
  return 'existing';
}

const CASH = /現金|cash/i;

/**
 * 現金で受け取った額。分割決済なら内訳のうち現金の分、そうでなければ決済方法が現金なら会計金額。
 * 決済方法の情報が無いときは null（呼び出し側で決済方法の名前から判定する）。
 */
export function cashPortion(raw, amount) {
  const splits = pick(raw, ['payment_splits', 'paymentSplits']);
  if (Array.isArray(splits) && splits.length > 0) {
    return splits.reduce((s, sp) => s + (CASH.test(String(pick(sp, ['payment_method_name', 'name', 'method'], ''))) ? toNum(pick(sp, ['amount'], 0)) : 0), 0);
  }
  const method = pick(raw, ['payment_method_name', 'paymentMethodName', 'payment_method.name', 'payment_method']);
  if (method == null) return null;
  return CASH.test(String(method)) ? amount : 0;
}

/** この予約で購入したプラン */
function normalizePlans(raw) {
  const plans = pick(raw, ['plans']);
  if (!Array.isArray(plans)) return [];
  return plans.map((p) => ({
    name: String(pick(p, ['plan_name', 'name'], '')),
    kind: String(pick(p, ['plan_kind', 'kind', 'type'], '')).toLowerCase(),
    amount: toNum(pick(p, ['amount'], 0)),
  }));
}

/**
 * 受付履歴の明細 1行 → 受付レコード
 * 日時は店舗のタイムゾーン（オフセット付き）なので、そのまま JST の日付にする。
 */
export function normalizeReception(raw) {
  const status = pick(raw, ['cancel_type']) === 'no_show' ? 'no_show' : normalizeStatus(pick(raw, ['status', 'state']));
  const salesAmount = toNum(pick(raw, ['amount', 'sales', 'sales_amount', 'total_amount'], 0));
  const sourceName = pick(raw, ['visit_source_name', 'visit_source.name', 'visitSourceName', 'source_name']);
  return {
    id: toId(pick(raw, ['appointment_id', 'id', 'reception_id', 'reservation_id'])),
    shopId: toId(pick(raw, ['shop_id', 'shopId', 'shop.id'])),
    staffId: toId(pick(raw, ['staff_id', 'staffId', 'staff.id'])),
    staffName: String(pick(raw, ['staff_name', 'staff.name'], '')),
    customerId: toId(pick(raw, ['customer_id', 'customerId', 'customer.id'])),
    date: toJstDate(pick(raw, ['reserved_at', 'reservedAt', 'start_at', 'visit_date', 'date'])),
    status,
    customerClass: normalizeCustomerClass(raw),
    sourceName: sourceName == null ? '' : String(sourceName),
    consumedAmount: toNum(pick(raw, ['consumed_amount', 'consumedAmount', 'consumed', 'consumed_sales'], 0)),
    salesAmount,
    cashAmount: cashPortion(raw, salesAmount),
    paymentMethod: String(pick(raw, ['payment_method_name', 'paymentMethodName', 'payment_method.name', 'payment_method'], '')),
    joined: toBool(pick(raw, ['joined'], false)),
    plans: normalizePlans(raw),
    referralStaffId: toId(pick(raw, ['referral_staff_id', 'referralStaffId'])),
  };
}

const TYPE_MAP = [
  [/subsc|サブスク|月額|monthly/i, 'subscription'],
  [/ticket|回数券/i, 'ticket'],
  [/prepaid|プリペイド/i, 'prepaid'],
  [/per.?visit|都度/i, 'payPerVisit'],
];

export function normalizeContractType(value, planName) {
  const s = `${value || ''} ${planName || ''}`;
  for (const [re, key] of TYPE_MAP) if (re.test(s)) return key;
  return String(value || 'other');
}

/**
 * 受付明細の「この予約で購入したプラン」「入会」から契約レコードを作る。
 *   plan_kind = subscription / ticket → その種別の契約
 *   プランの種別が無い入会（joined）   → member（入会）
 *   プラン名が「都度」払いのキーワードに当たるものは payPerVisit（契約に数えない）
 * @param {Array} receptions 正規化済みの受付レコード
 * @param {{ sharePlanPattern?: RegExp, payPerVisitPattern?: RegExp }} [opts]
 */
export function contractsFromReceptions(receptions, opts = {}) {
  const out = [];
  for (const r of receptions || []) {
    if (!r || r.status !== 'completed' || !r.customerId || !r.date) continue;
    let contracted = false;
    (r.plans || []).forEach((p, i) => {
      let type = p.kind === 'subscription' || p.kind === 'ticket' ? p.kind : '';
      if (!type) return;
      if (opts.payPerVisitPattern && opts.payPerVisitPattern.test(p.name)) type = 'payPerVisit';
      else contracted = true;
      out.push({
        id: `${r.id}:${i}`,
        customerId: r.customerId,
        shopId: r.shopId,
        staffId: r.staffId,
        type,
        planName: p.name,
        isSharePlan: opts.sharePlanPattern ? opts.sharePlanPattern.test(p.name) : false,
        startDate: r.date,
        endDate: null,
      });
    });
    if (r.joined && !contracted) {
      out.push({
        id: `${r.id}:join`, customerId: r.customerId, shopId: r.shopId, staffId: r.staffId,
        type: 'member', planName: '', isSharePlan: false, startDate: r.date, endDate: null,
      });
    }
  }
  return out;
}

/**
 * 売上サマリ（管理画面「売上分析」と同じ計算）の 1行（全体・日別・スタッフ別に共通）
 *   消化売上 consumed_sales（会計金額＋回数券・サブスクの消化分と失効分−前受の購入額）
 *   入金売上 digest_sales / 新規数 new_visit_count（店舗ごとの初回来店）/ リピート数 repeat_visit_count（2回目以降）
 *   施術数 treatment_count / 顧客数 customer_count / 購入数 purchase_count（新規のうち回数券・サブスクの契約。生涯基準）
 * 項目が無いものは null（呼び出し側で受付履歴からの集計を使う）
 */
function normalizeSalesRow(raw) {
  const numOrNull = (paths) => toNumOrNull(pick(raw, paths));
  const newCount = numOrNull(['new_visit_count', 'new_count', 'new_visits']);
  const repeatCount = numOrNull(['repeat_visit_count', 'repeat_count', 'repeat_visits']);
  const visits = numOrNull(['visit_count', 'visits']) ?? (newCount != null || repeatCount != null ? (newCount || 0) + (repeatCount || 0) : null);
  return {
    consumedSales: numOrNull(['consumed_sales']),
    depositSales: numOrNull(['digest_sales']),
    newCount,
    repeatCount,
    treatmentCount: numOrNull(['treatment_count', 'treatments']) ?? visits,
    customerCount: numOrNull(['customer_count']),
    purchaseCount: numOrNull(['purchase_count']),
  };
}

/** 売上サマリ（店舗を指定した取得）→ 全体・日別・スタッフ別。「未割当」の行はスタッフ別から外す */
export function normalizeSalesSummary(raw) {
  const days = pick(raw, ['by_day']);
  const staff = pick(raw, ['by_staff']);
  return {
    ...normalizeSalesRow(raw),
    daily: Array.isArray(days)
      ? days.map((d) => ({ date: toJstDate(pick(d, ['date', 'day', 'business_date'])), ...normalizeSalesRow(d) })).filter((d) => d.date)
      : null,
    staff: Array.isArray(staff)
      ? staff.map((r) => ({
        staffId: toId(pick(r, ['staff_id', 'id'])),
        name: String(pick(r, ['staff_name', 'name'], '')),
        ...normalizeSalesRow(r),
      })).filter((r) => r.staffId)
      : null,
  };
}

const countOf = (obj, key) => toNum(pick(obj, [`${key}_count`, key], 0));

/**
 * 継続管理（サブスク）のサマリー + 顧客一覧 → 店舗の継続指標
 *   会員数        取得時点の 正常 + 要フォロー + 要注意（離反以外）
 *   退会率        直近 1か月に離反へ移った人数 ÷ 1か月前の会員数
 *   平均継続期間  顧客一覧のサブスク継続月数の平均
 * @param {Object} summary   /marketing/retention-summary の data
 * @param {Array}  customers /marketing/retention-customers の一覧
 */
export function normalizeRetention(summary, customers = []) {
  const members = (o) => countOf(o, 'continuing') + countOf(o, 'follow') + countOf(o, 'attention');
  const memberCount = members(summary);
  const prev = pick(summary, ['previous_month', 'previousMonth']);
  const membersAtStart = prev ? members(prev) : null;
  const churnCount = prev ? Math.max(0, countOf(summary, 'churned') - countOf(prev, 'churned')) : null;
  const months = (customers || [])
    .map((c) => toNumOrNull(pick(c, ['subscription_months', 'subscriptionMonths'])))
    .filter((v) => v != null);
  return {
    memberCount,
    membersAtStart,
    churnCount,
    churnRatePct: membersAtStart ? (churnCount / membersAtStart) * 100 : null,
    avgTenureMonths: months.length ? months.reduce((s, v) => s + v, 0) / months.length : null,
    tenureSample: months.length,
  };
}
