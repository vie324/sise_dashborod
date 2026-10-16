import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeReception, normalizeContract, normalizeStaff, normalizeRetention, extractList, normalizeStatus,
} from '../api/_lib/salonone/normalize.js';
import { toJstDate } from '../shared/dates.js';

test('一覧の取り出し: 配列 / {data} / Laravel の {data:{data}}', () => {
  assert.deepEqual(extractList([1, 2]), [1, 2]);
  assert.deepEqual(extractList({ data: [1] }), [1]);
  assert.deepEqual(extractList({ success: true, data: { data: [3], current_page: 1 } }), [3]);
  assert.deepEqual(extractList({ message: 'x' }), []);
});

test('日付は JST に寄せる', () => {
  assert.equal(toJstDate('2026-11-02T16:00:00Z'), '2026-11-03');
  assert.equal(toJstDate('2026-11-03T00:30:00+09:00'), '2026-11-03');
  assert.equal(toJstDate('2026-11-03 23:59:00'), '2026-11-03');
  assert.equal(toJstDate('2026/11/03 10:00'), '2026-11-03');
});

test('受付明細: snake_case + ネスト', () => {
  const r = normalizeReception({
    id: 10, shop_id: 101, staff_id: 201, customer_id: 'c1', reserved_at: '2026-11-03 10:00:00',
    status: 'completed', classification: '新規', visit_source: { name: 'ホットペッパー' },
    consumed_sales: '7,500', sales: 3980, payment_method: { name: '現金' },
  });
  assert.deepEqual(r, {
    id: '10', shopId: '101', staffId: '201', customerId: 'c1', date: '2026-11-03', status: 'completed',
    customerClass: 'new', sourceName: 'ホットペッパー', consumedAmount: 7500, salesAmount: 3980, paymentMethod: '現金', referralStaffId: '',
  });
});

test('受付明細: camelCase・日本語ステータス・来店回数から新規判定', () => {
  const r = normalizeReception({ id: 'a', shopId: 's', staffId: 't', customerId: 'c', visitDate: undefined, startAt: '2026-11-04T01:00:00Z', status: '当日キャンセル', visitNumber: 1, consumedSales: 9000 });
  assert.equal(r.date, '2026-11-04');
  assert.equal(r.status, 'cancelled');
  assert.equal(r.customerClass, 'new');
  assert.equal(normalizeStatus('無断キャンセル'), 'no_show');
  assert.equal(normalizeStatus('会計済み'), 'completed');
  assert.equal(normalizeStatus(''), 'completed');
});

test('契約: 種別・シェアプラン・都度払い・終了日', () => {
  const sub = normalizeContract({ id: 1, customer_id: 'c1', shop_id: 101, plan: { name: '60分・月2回プラン', type: 'subscription' }, started_at: '2026-10-01T09:00:00+09:00', ended_at: null });
  assert.equal(sub.type, 'subscription');
  assert.equal(sub.startDate, '2026-10-01');
  assert.equal(sub.endDate, null);
  const share = normalizeContract({ customer_id: 'c2', plan_name: 'シェアプラン（ご家族）', type: 'サブスク', start_date: '2026-10-02' }, { sharePlanPattern: /シェア/ });
  assert.equal(share.isSharePlan, true);
  const ticket = normalizeContract({ customer_id: 'c3', plan_name: '回数券（5回）', purchased_at: '2026-10-03' });
  assert.equal(ticket.type, 'ticket');
  const perVisit = normalizeContract({ customer_id: 'c4', plan_name: '都度払い会員', type: 'subscription', start_date: '2026-10-04', cancelled_at: '2026-10-20' }, { payPerVisitPattern: /都度/ });
  assert.equal(perVisit.type, 'payPerVisit');
  assert.equal(perVisit.endDate, '2026-10-20');
});

test('スタッフと継続指標', () => {
  assert.deepEqual(normalizeStaff({ id: 3, name: '佐藤', shop: { id: 9 }, shops: [{ id: 9 }] }), { id: '3', name: '佐藤', shopId: '9', active: true });
  assert.equal(normalizeStaff({ id: 4, name: 'x', deleted: true }).active, false);
  assert.equal(normalizeRetention({ shop_id: 1, member_count: 80, churn_rate: 0.085, average_tenure_months: 7.2 }).churnRatePct, 8.5);
  assert.equal(normalizeRetention({ shop_id: 1, churn_rate: 8.5 }).churnRatePct, 8.5);
});
