import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeReception, normalizeStaff, normalizeShop, normalizeRetention, extractList, normalizeStatus,
  contractsFromReceptions, cashPortion, normalizeSalesSummary,
} from '../api/_lib/salonone/normalize.js';
import { toJstDate } from '../shared/dates.js';

test('一覧の取り出し: 明細 {data:[]} / マーケ集計 {data:{rows}} / 配列', () => {
  assert.deepEqual(extractList([1, 2]), [1, 2]);
  assert.deepEqual(extractList({ data: [1], meta: { has_more: false } }), [1]);
  assert.deepEqual(extractList({ data: { rows: [3], total: {} } }), [3]);
  assert.deepEqual(extractList({ data: { continuing_count: 1 } }), []);
  assert.deepEqual(extractList({ error: { code: 'x' } }), []);
});

test('日付は JST に寄せる', () => {
  assert.equal(toJstDate('2026-11-02T16:00:00Z'), '2026-11-03');
  assert.equal(toJstDate('2026-11-03T00:30:00+09:00'), '2026-11-03');
  assert.equal(toJstDate('2026-11-03 23:59:00'), '2026-11-03');
});

const HISTORY_ROW = {
  appointment_id: 501, shop_id: 12, customer_id: 9001, customer_number: 'K0123',
  received_at: '2026-10-28T12:00:00+09:00', reserved_at: '2026-11-03T10:00:00+09:00',
  status: 'completed', cancel_type: null, staff_id: 25, staff_name: '佐藤 美咲',
  visit_source_id: 3, visit_source_name: 'ホットペッパー', classification: 'new', joined: true,
  plans: [{ plan_name: '月2回プラン', plan_kind: 'subscription', amount: 50000, total_sessions: null }],
  amount: 53000, consumed_amount: 3000, payment_method_name: '現金 / クレジットカード',
  payment_splits: [{ payment_method_name: '現金', amount: 3000 }, { payment_method_name: 'クレジットカード', amount: 50000 }],
};

test('受付履歴の明細（仕様の項目名）', () => {
  const r = normalizeReception(HISTORY_ROW);
  assert.equal(r.id, '501');
  assert.equal(r.shopId, '12');
  assert.equal(r.staffId, '25');
  assert.equal(r.staffName, '佐藤 美咲');
  assert.equal(r.customerId, '9001');
  assert.equal(r.date, '2026-11-03'); // 受付日時ではなく予約日時（来店日）
  assert.equal(r.status, 'completed');
  assert.equal(r.customerClass, 'new');
  assert.equal(r.sourceName, 'ホットペッパー');
  assert.equal(r.consumedAmount, 3000);
  assert.equal(r.salesAmount, 53000);
  assert.equal(r.cashAmount, 3000); // 分割決済は現金の分だけ
  assert.equal(r.joined, true);
  assert.deepEqual(r.plans, [{ name: '月2回プラン', kind: 'subscription', amount: 50000 }]);
});

test('状態・区分・現金の判定', () => {
  assert.equal(normalizeReception({ ...HISTORY_ROW, status: 'booked' }).status, 'reserved');
  assert.equal(normalizeReception({ ...HISTORY_ROW, status: 'cancelled', cancel_type: 'no_show' }).status, 'no_show');
  assert.equal(normalizeReception({ ...HISTORY_ROW, status: 'cancelled', cancel_type: 'same_day' }).status, 'cancelled');
  assert.equal(normalizeReception({ ...HISTORY_ROW, classification: 'continuing' }).customerClass, 'repeat');
  assert.equal(normalizeReception({ ...HISTORY_ROW, classification: 'existing' }).customerClass, 'existing');
  assert.equal(normalizeReception({ ...HISTORY_ROW, visit_source_name: null }).sourceName, '');
  assert.equal(normalizeStatus('会計済み'), 'completed');
  assert.equal(cashPortion({ payment_method_name: '現金', payment_splits: [] }, 8000), 8000);
  assert.equal(cashPortion({ payment_method_name: 'PayPay', payment_splits: [] }, 8000), 0);
  assert.equal(cashPortion({ payment_method_name: null, payment_splits: [] }, 0), null);
});

test('購入プラン・入会から契約を作る（シェアプラン・都度払いの判定つき）', () => {
  const base = normalizeReception(HISTORY_ROW);
  const rows = [
    base,
    { ...base, id: '502', customerId: 'c2', plans: [{ name: '回数券 6回', kind: 'ticket', amount: 30000 }], joined: false },
    { ...base, id: '503', customerId: 'c3', plans: [], joined: true },
    { ...base, id: '504', customerId: 'c4', plans: [{ name: 'シェアプラン（ご家族）', kind: 'subscription', amount: 8000 }] },
    { ...base, id: '505', customerId: 'c5', plans: [{ name: '都度払い会員', kind: 'subscription', amount: 0 }], joined: false },
    { ...base, id: '506', customerId: 'c6', plans: [{ name: '物販', kind: 'normal', amount: 2000 }], joined: false },
    { ...base, id: '507', customerId: 'c7', status: 'cancelled' },
  ];
  const cs = contractsFromReceptions(rows, { sharePlanPattern: /シェア/, payPerVisitPattern: /都度/ });
  const byCustomer = Object.fromEntries(cs.map((c) => [c.customerId, c]));
  assert.equal(byCustomer['9001'].type, 'subscription');
  assert.equal(byCustomer['9001'].startDate, '2026-11-03');
  assert.equal(byCustomer.c2.type, 'ticket');
  assert.equal(byCustomer.c3.type, 'member');
  assert.equal(byCustomer.c4.isSharePlan, true);
  assert.equal(byCustomer.c5.type, 'payPerVisit');
  assert.equal(byCustomer.c6, undefined);
  assert.equal(byCustomer.c7, undefined);
  assert.equal(cs.filter((c) => c.customerId === '9001').length, 1); // サブスクを買った入会は二重にしない
});

test('店舗・スタッフ（削除済み・氏名の分割）', () => {
  assert.deepEqual(normalizeShop({ id: 12, name: '中央店', deleted_at: null }), { id: '12', name: '中央店', active: true });
  assert.equal(normalizeShop({ id: 13, name: '閉店', deleted_at: '2025-01-01T00:00:00+00:00' }).active, false);
  assert.deepEqual(normalizeStaff({ id: 3, name: '佐藤', shop_id: 9 }), { id: '3', name: '佐藤', shopId: '9', active: true });
  assert.equal(normalizeStaff({ id: 4, last_name: '鈴木', first_name: '健太' }).name, '鈴木 健太');
  assert.equal(normalizeStaff({ id: 5, name: 'x', deleted_at: '2026-01-31T15:00:00+00:00' }).active, false);
});

test('継続管理: 会員数・退会率（直近1か月）・平均継続期間', () => {
  const summary = {
    continuing_count: 40, follow_count: 6, attention_count: 4, churned_count: 30,
    previous_month: { continuing_count: 42, follow_count: 5, attention_count: 3, churned_count: 27 },
  };
  const r = normalizeRetention(summary, [{ subscription_months: 2 }, { subscription_months: 4 }, { subscription_months: 6 }, { subscription_months: null }]);
  assert.equal(r.memberCount, 50);
  assert.equal(r.membersAtStart, 50);
  assert.equal(r.churnCount, 3);
  assert.equal(r.churnRatePct, 6);
  assert.equal(r.avgTenureMonths, 4);
  assert.equal(r.tenureSample, 3);
  // 1か月前の値が無ければ退会率は出さない
  const noPrev = normalizeRetention({ continuing_count: 5 }, []);
  assert.equal(noPrev.memberCount, 5);
  assert.equal(noPrev.churnRatePct, null);
  assert.equal(noPrev.avgTenureMonths, null);
});

test('売上サマリ（売上分析）: 全体・日別・スタッフ別。未割当の行は外し、無い項目は null', () => {
  const s = normalizeSalesSummary({
    consumed_sales: 34000, digest_sales: 98000, new_visit_count: 2, repeat_visit_count: 4, customer_count: 6, treatment_count: 6, purchase_count: 1,
    by_day: [{ date: '2026-10-03', consumed_sales: 3000, digest_sales: 53000, new_visit_count: 1, repeat_visit_count: 0 }],
    by_staff: [
      { staff_id: 25, staff_name: '佐藤 美咲', consumed_sales: 25000, new_visit_count: 1, repeat_visit_count: 3 },
      { staff_id: null, staff_name: '未割当', consumed_sales: 0 },
    ],
  });
  assert.equal(s.consumedSales, 34000);
  assert.equal(s.depositSales, 98000);
  assert.equal(s.newCount, 2);
  assert.equal(s.repeatCount, 4);
  assert.equal(s.treatmentCount, 6);
  assert.equal(s.purchaseCount, 1);
  assert.deepEqual(s.daily[0], { date: '2026-10-03', consumedSales: 3000, depositSales: 53000, newCount: 1, repeatCount: 0, treatmentCount: 1, customerCount: null, purchaseCount: null });
  assert.equal(s.staff.length, 1);
  assert.equal(s.staff[0].staffId, '25');
  assert.equal(s.staff[0].treatmentCount, 4); // 施術数が無ければ 新規 + リピート
  assert.equal(s.staff[0].purchaseCount, null);
  assert.equal(normalizeSalesSummary({ consumed_sales: 1 }).daily, null); // 店舗を指定しない取得には日別が無い
});
