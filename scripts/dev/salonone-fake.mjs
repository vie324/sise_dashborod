// ============================================================
// 疑似 SalonOne 分析API（ローカル開発・テスト用。本番では使わない）
// ------------------------------------------------------------
// https://salonone.net/api-docs の形（schema_version 2026-10-16）で、決まった数字を返す。
//   認証    X-SalonOne-Api-Key: test-key（違えば 401 unauthorized）
//   明細    /shops /staffs /visit-sources（limit・cursor。1ページ 2件で返して続きを辿らせる）
//   マーケ  /marketing/reception-history（shop_id 必須。1ページ 4件）
//           /marketing/retention-summary /marketing/retention-customers（limit は受け付けない）
//
// 単体で動かす:
//   node scripts/dev/salonone-fake.mjs --port 4100
//   SALONONE_API_KEY=test-key SALONONE_API_BASE_URL=http://127.0.0.1:4100/api/analytics/v1 npm run dev:local
// ============================================================

import http from 'node:http';
import { fileURLToPath } from 'node:url';

export const FAKE_KEY = 'test-key';
const BASE = '/api/analytics/v1';

const SHOPS = [
  { id: 101, brand_id: 11, name: '中央店', deleted_at: null },
  { id: 102, brand_id: 11, name: '駅前店', deleted_at: null },
  { id: 103, brand_id: 11, name: '閉店した店舗', deleted_at: '2025-03-31T15:00:00+00:00' },
];

const STAFFS = [
  { id: 201, brand_id: 11, shop_id: 101, name: '佐藤 美咲', deleted_at: null },
  { id: 202, brand_id: 11, shop_id: 101, last_name: '鈴木', first_name: '健太', deleted_at: null },
  { id: 203, brand_id: 11, shop_id: 102, name: '田中 大輔', deleted_at: null },
  { id: 204, brand_id: 11, shop_id: 101, name: '退職した人', deleted_at: '2026-01-31T15:00:00+00:00' },
];

const VISIT_SOURCES = [
  { id: 1, name: 'ホットペッパー' },
  { id: 2, name: 'Instagram' },
  { id: 3, name: '紹介' },
  { id: 4, name: '旧チラシ', deleted_at: '2024-12-31T15:00:00+00:00' },
];

const staffName = (id) => {
  const s = STAFFS.find((x) => x.id === id);
  return s ? (s.name || `${s.last_name} ${s.first_name}`) : null;
};

/**
 * 1店舗・1ヶ月分の受付履歴。どの月を指定しても同じ並びを返す（日付だけ月に合わせる）。
 * 中央店（101）の 1ヶ月の期待値:
 *   会計完了 6件 / 消化 29,000 / 会計金額 103,000 / 現金 17,000（分割決済は現金の分だけ）
 *   佐藤（201）消化 20,000・4回 / 鈴木（202）消化 9,000・2回
 *   新規（会計完了）3名: HPB（佐藤・サブスク契約）/ Instagram（鈴木・契約なし）/ 紹介（佐藤・入会のみ）
 * 駅前店（102）: 田中（203）消化 14,000・2回 / 現金 7,000
 */
function receptionRows(shopId, month) {
  const at = (day, hm = '10:00') => `${month}-${String(day).padStart(2, '0')}T${hm}:00+09:00`;
  const row = (o) => ({
    appointment_id: o.id, shop_id: shopId, customer_id: o.customer, customer_number: `K${o.customer}`,
    received_at: at(1, '09:00'), reserved_at: at(o.day, o.hm), status: o.status || 'completed', cancel_type: o.cancelType || null,
    staff_id: o.staff, staff_name: staffName(o.staff), visit_source_id: o.sourceId || null, visit_source_name: o.source || null,
    classification: o.cls || 'existing', joined: !!o.joined, plans: o.plans || [],
    amount: o.amount || 0, consumed_amount: o.consumed || 0,
    payment_method_name: o.method === undefined ? null : o.method, payment_splits: o.splits || [],
  });
  if (shopId === 101) {
    const p = `${month.replace('-', '')}`;
    const nc = (n) => Number(`9${p.slice(2)}${n}`); // 新規客はその月だけの顧客ID
    return [
      row({ id: Number(`${p}01`), customer: 9001, day: 2, staff: 201, consumed: 8000, amount: 8000, method: '現金' }),
      row({
        id: Number(`${p}02`), customer: nc(1), day: 3, staff: 201, cls: 'new', source: 'ホットペッパー', sourceId: 1,
        consumed: 3000, amount: 53000, joined: true, method: '現金 / クレジットカード',
        plans: [{ plan_name: '月2回プラン', plan_kind: 'subscription', amount: 50000, total_sessions: null }],
        splits: [{ payment_method_name: '現金', amount: 3000 }, { payment_method_name: 'クレジットカード', amount: 50000 }],
      }),
      row({ id: Number(`${p}03`), customer: nc(2), day: 4, staff: 202, cls: 'new', source: 'Instagram', sourceId: 2, consumed: 3000, amount: 3000, method: '現金' }),
      row({ id: Number(`${p}04`), customer: nc(3), day: 5, staff: 202, cls: 'new', source: 'ホットペッパー', sourceId: 1, status: 'cancelled', cancelType: 'same_day' }),
      row({ id: Number(`${p}05`), customer: 9002, day: 6, staff: 202, consumed: 6000, amount: 0 }),
      row({
        id: Number(`${p}06`), customer: 9003, day: 7, staff: 201, cls: 'continuing', consumed: 6000, amount: 36000, method: 'クレジットカード',
        plans: [{ plan_name: '回数券 6回', plan_kind: 'ticket', amount: 30000, total_sessions: 6 }],
      }),
      row({ id: Number(`${p}07`), customer: nc(4), day: 8, staff: 201, cls: 'new', source: '紹介', sourceId: 3, consumed: 3000, amount: 3000, joined: true, method: '現金' }),
      row({ id: Number(`${p}08`), customer: 9004, day: 27, hm: '18:00', staff: 201, status: 'booked' }),
    ];
  }
  if (shopId === 102) {
    const p = `${month.replace('-', '')}`;
    return [
      row({ id: Number(`${p}51`), customer: 9501, day: 2, staff: 203, consumed: 7000, amount: 7000, method: 'PayPay' }),
      row({ id: Number(`${p}52`), customer: 9502, day: 9, staff: 203, consumed: 7000, amount: 7000, method: '現金' }),
    ];
  }
  return [];
}

/**
 * 売上サマリ（売上分析）。受付履歴とわざと違う数字にしてある（SalonOne の数字が優先されることの確認用）:
 *   中央店: 失効益 5,000円（20日・佐藤）を含む消化売上 34,000 / 入金 98,000（返金 5,000 を差し引き）
 *           新規数 2（紹介で来た 4人目の新規客は SalonOne で「既存顧客として扱う」）/ リピート 4 / 購入数 1
 */
function salesSummary(shopId, month) {
  const d = (day) => `${month}-${String(day).padStart(2, '0')}`;
  const row = (o) => ({
    gross_sales: o.gross ?? o.digest ?? 0, consumed_sales: o.consumed ?? 0, digest_sales: o.digest ?? 0,
    cancellation_fee_amount: 0, refund_amount: o.refund ?? 0, non_sales_refund_amount: 0,
    new_visit_count: o.newCount ?? 0, repeat_visit_count: o.repeat ?? 0, customer_count: o.customers ?? 0,
    cancel_count: o.cancel ?? 0, no_show_count: 0, treatment_count: o.treatments ?? 0, purchase_count: o.purchase ?? 0,
  });
  if (shopId === 101) {
    return {
      ...row({ consumed: 34000, digest: 98000, refund: 5000, newCount: 2, repeat: 4, customers: 6, cancel: 1, treatments: 6, purchase: 1 }),
      by_day: [
        { date: d(2), ...row({ consumed: 8000, digest: 8000, repeat: 1, customers: 1, treatments: 1 }) },
        { date: d(3), ...row({ consumed: 3000, digest: 53000, newCount: 1, customers: 1, treatments: 1, purchase: 1 }) },
        { date: d(4), ...row({ consumed: 3000, digest: 3000, newCount: 1, customers: 1, treatments: 1 }) },
        { date: d(6), ...row({ consumed: 6000, digest: 0, repeat: 1, customers: 1, treatments: 1 }) },
        { date: d(7), ...row({ consumed: 6000, digest: 36000, repeat: 1, customers: 1, treatments: 1 }) },
        { date: d(8), ...row({ consumed: 3000, digest: 3000, repeat: 1, customers: 1, treatments: 1 }) },
        { date: d(20), ...row({ consumed: 5000, digest: -5000, refund: 5000 }) },
      ],
      by_staff: [
        { staff_id: 201, staff_name: '佐藤 美咲', ...row({ consumed: 25000, digest: 94000, newCount: 1, repeat: 3, customers: 4, treatments: 4, purchase: 1 }) },
        { staff_id: 202, staff_name: '鈴木 健太', ...row({ consumed: 9000, digest: 3000, newCount: 1, repeat: 1, customers: 2, treatments: 2 }) },
        { staff_id: null, staff_name: '未割当', ...row({ refund: 0 }) },
      ],
    };
  }
  if (shopId === 102) {
    return {
      ...row({ consumed: 14000, digest: 14000, repeat: 2, customers: 2, treatments: 2 }),
      by_day: [
        { date: d(2), ...row({ consumed: 7000, digest: 7000, repeat: 1, customers: 1, treatments: 1 }) },
        { date: d(9), ...row({ consumed: 7000, digest: 7000, repeat: 1, customers: 1, treatments: 1 }) },
      ],
      by_staff: [{ staff_id: 203, staff_name: '田中 大輔', ...row({ consumed: 14000, digest: 14000, repeat: 2, customers: 2, treatments: 2 }) }],
    };
  }
  return { ...row({}), by_day: [], by_staff: [] };
}

const RETENTION = {
  101: {
    summary: {
      continuing_count: 40, follow_count: 6, attention_count: 4, churned_count: 30, balance_total: 1200000,
      next_month_subscription_sales: 380000,
      previous_month: { continuing_count: 42, follow_count: 5, attention_count: 3, churned_count: 27, balance_total: 1150000 },
      change_rate: { continuing: -4.8, follow: 20, attention: 33.3, churned: 11.1, balance_total: 4.3 },
      threshold_days: 30,
    },
    months: [2, 4, 6],
  },
  102: {
    summary: { continuing_count: 10, follow_count: 1, attention_count: 1, churned_count: 2, balance_total: 0, previous_month: { continuing_count: 12, follow_count: 0, attention_count: 0, churned_count: 2 } },
    months: [1, 2],
  },
};

const json = (status, body) => ({ status, body });
const error = (status, code, extra = {}) => json(status, { error: { code, error_id: `fake-${code}`, ...extra } });
const meta = (returned, hasMore, next) => ({ returned, has_more: hasMore, next_cursor: hasMore ? next : null, pii_included: false, schema_version: '2026-10-16', server_time: new Date().toISOString() });

function paginate(rows, url, pageSize) {
  const limit = Math.min(Number(url.searchParams.get('limit') || 200), 1000);
  const size = Math.min(limit, pageSize);
  const offset = Number(Buffer.from(url.searchParams.get('cursor') || '', 'base64').toString() || 0);
  const page = rows.slice(offset, offset + size);
  const more = offset + size < rows.length;
  return json(200, { data: page, meta: meta(page.length, more, Buffer.from(String(offset + size)).toString('base64')) });
}

const requireShop = (url) => {
  const id = Number(url.searchParams.get('shop_id'));
  return SHOPS.some((s) => s.id === id) ? id : null;
};

/**
 * @param {URL} url
 * @param {Object} headers  小文字・大文字どちらのキーでもよい
 * @returns {{ status:number, body:any }}
 */
export function fakeSalonOne(url, headers = {}) {
  const key = headers['x-salonone-api-key'] || headers['X-SalonOne-Api-Key'];
  if (key !== FAKE_KEY) return error(401, 'unauthorized');
  if (!url.pathname.startsWith(BASE)) return error(404, 'not_found');
  const path = url.pathname.slice(BASE.length);
  switch (path) {
    case '/meta':
      return json(200, { data: { brand_id: 11, brand_name: "si'se", key_name: '社内分析ダッシュボード', pii_included: false, user_auth_required: false, schema_version: '2026-10-16' } });
    case '/shops':
      return paginate(SHOPS, url, 2);
    case '/staffs':
      return paginate(STAFFS, url, 2);
    case '/visit-sources':
      return paginate(VISIT_SOURCES, url, 2);
    case '/sales/summary': {
      const from = url.searchParams.get('from') || '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return error(400, 'invalid_request', { fields: ['from'] });
      const shopId = Number(url.searchParams.get('shop_id'));
      if (url.searchParams.has('shop_id') && !SHOPS.some((s) => s.id === shopId)) return error(403, 'forbidden');
      return json(200, { data: salesSummary(shopId, from.slice(0, 7)) });
    }
    case '/marketing/reception-history': {
      const shopId = requireShop(url);
      if (!shopId) return error(400, 'invalid_request', { fields: ['shop_id'] });
      const from = url.searchParams.get('from') || '';
      const to = url.searchParams.get('to') || '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return error(400, 'invalid_request', { fields: ['from', 'to'] });
      const months = new Set([from.slice(0, 7), to.slice(0, 7)]);
      const rows = [...months].flatMap((m) => receptionRows(shopId, m))
        .filter((r) => r.reserved_at.slice(0, 10) >= from && r.reserved_at.slice(0, 10) <= to);
      return paginate(rows, url, 4);
    }
    case '/marketing/retention-summary': {
      const shopId = requireShop(url);
      const r = RETENTION[shopId];
      return json(200, { data: r ? r.summary : { continuing_count: 0, follow_count: 0, attention_count: 0, churned_count: 0 } });
    }
    case '/marketing/retention-customers': {
      if (url.searchParams.has('limit')) return error(400, 'invalid_request', { fields: ['limit'] });
      const shopId = requireShop(url);
      const r = RETENTION[shopId];
      const rows = (r ? r.months : []).map((m, i) => ({
        customer_id: shopId * 100 + i, shop_id: shopId, status: 'normal', plan_name: '月2回プラン', subscription_months: m,
        remaining_sessions: null, service_balance: 0, cumulative_sales: 50000 * (m + 1), payment_at: '2026-10-01', last_visit_at: '2026-10-05',
      }));
      return json(200, { data: rows, meta: meta(rows.length, false) });
    }
    default:
      return error(404, 'not_found');
  }
}

/** fetch の代わり（テストで globalThis.fetch に差し込む） */
export function fakeFetch(calls = []) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    calls.push(url);
    const res = fakeSalonOne(url, init.headers || {});
    return new Response(JSON.stringify(res.body), { status: res.status, headers: { 'Content-Type': 'application/json' } });
  };
}

// 単体起動
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = process.argv.indexOf('--port');
  const port = i > 0 ? Number(process.argv[i + 1]) : 4100;
  http.createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const out = fakeSalonOne(url, req.headers);
    console.log(req.method, url.pathname + url.search, out.status);
    res.writeHead(out.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(out.body));
  }).listen(port, () => console.log(`疑似 SalonOne: http://127.0.0.1:${port}${BASE}（キー: ${FAKE_KEY}）`));
}
