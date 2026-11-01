// 施術消化売上（施術 1回あたり）: SalonOne の消化額が 0円のサブスクの来店にプランの 1回分を当てる・購入額を外す・物販を除く
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  monthlySessionsOf, customerPlans, planUnits, treatmentValue, valueReceptions, planKey,
} from '../shared/consumption.js';

const SUB = (amount = 15000, name = '月2回プラン') => ({ name, kind: 'subscription', amount, totalSessions: null });
const TICKET = { name: '回数券 6回', kind: 'ticket', amount: 30000, totalSessions: 6 };
let seq = 0;
const visit = (o) => ({
  id: `r${++seq}`, shopId: '101', staffId: '201', customerId: o.c, date: o.date || '2026-11-05', status: o.status || 'completed',
  consumedAmount: o.consumed || 0, salesAmount: o.amount || 0, plans: o.plans || [], billing: !!o.billing,
});

test('プラン名から月の回数を読む（月2回・月一フル・週1回。わからなければ null）', () => {
  assert.equal(monthlySessionsOf('月2回プラン'), 2);
  assert.equal(monthlySessionsOf('Standard 月4回'), 4);
  assert.equal(monthlySessionsOf('月１回メンテナンス'), 1);
  assert.equal(monthlySessionsOf('月一フル'), 1);
  assert.equal(monthlySessionsOf('週1回コース'), 4);
  assert.equal(monthlySessionsOf('60分コース'), null);
  assert.equal(planKey(' Premium　月4回 '), 'Premium 月4回');
});

test('お客様のプラン: 継続管理の顧客一覧と受付履歴の購入を合わせる（プリペイドは除く）', () => {
  const plans = customerPlans(
    [
      { customerId: 'c1', planName: 'Premium 月4回', churned: false, paymentAt: '2026-10-01' },
      { customerId: 'c1', planName: 'プリペイド 1万円', churned: false, paymentAt: '2026-09-01' },
      { customerId: 'c2', planName: '月2回プラン', churned: true, paymentAt: '2026-08-01' },
    ],
    [visit({ c: 'c2', consumed: 3000, amount: 18000, plans: [SUB()], date: '2026-11-02' })],
  );
  assert.deepEqual(plans.get('c1').map((p) => p.name), ['Premium 月4回']);
  const c2 = plans.get('c2');
  assert.equal(c2.length, 1);
  assert.equal(c2[0].churned, false); // 受付履歴で買い直している
  assert.equal(c2[0].at, '2026-11-02');
});

test('1回分の金額: 設定 → SalonOne が消化額を付けた来店（いちばん多い金額）→ 購入額 ÷ 回数', () => {
  const receptions = [
    visit({ c: 'a', consumed: 3000, amount: 18000, plans: [SUB()] }),
    visit({ c: 'a', consumed: 7500 }),
    visit({ c: 'b', consumed: 7500 }),
    visit({ c: 'b', consumed: 9500 }), // オプション込みなどの例外は多数決で外れる
    visit({ c: 'b', consumed: 7500, amount: 2000 }), // 支払いのある来店は 1回分の手がかりにしない
    visit({ c: 't', consumed: 5000, amount: 30000, plans: [TICKET] }),
  ];
  const plansOf = customerPlans([{ customerId: 'b', planName: '月2回プラン', churned: false }, { customerId: 'p', planName: 'Premium 月4回', churned: false }], receptions);
  const units = planUnits({ receptions, plansOf });
  assert.deepEqual(
    { unit: units.get('月2回プラン').unit, source: units.get('月2回プラン').source, samples: units.get('月2回プラン').samples },
    { unit: 7500, source: 'salonone', samples: 3 },
  );
  assert.deepEqual({ unit: units.get('回数券 6回').unit, source: units.get('回数券 6回').source }, { unit: 5000, source: 'price' });
  assert.deepEqual({ unit: units.get('Premium 月4回').unit, source: units.get('Premium 月4回').source }, { unit: null, source: null });

  const withSetting = planUnits({ receptions, plansOf, overrides: { 'Premium　月4回': 8000, '月2回プラン': 7000 } });
  assert.deepEqual({ unit: withSetting.get('Premium 月4回').unit, source: withSetting.get('Premium 月4回').source }, { unit: 8000, source: 'setting' });
  assert.equal(withSetting.get('月2回プラン').unit, 7000); // 設定がいちばん強い

  // SalonOne の 1回分が無いサブスクは、購入額 ÷ プラン名の回数
  const onlyBought = [visit({ c: 'z', consumed: 3000, amount: 31000, plans: [SUB(28000, 'Standard 月4回')] })];
  assert.equal(planUnits({ receptions: onlyBought, plansOf: customerPlans([], onlyBought) }).get('Standard 月4回').unit, 7000);
});

test('受付 1件の金額: 初回 3,000円・サブスクの 2回目 7,500円（SalonOne の消化額が 0円でも）・回数券・都度・課金の行', () => {
  const receptions = [
    visit({ c: 'c1', consumed: 3000, amount: 18000, plans: [SUB()] }), // 初回: 体験 3,000円 + サブスク 15,000円
    visit({ c: 'c1', consumed: 7500 }), // 2回目: SalonOne が 1回分を付けた
    visit({ c: 'c2', consumed: 18000, amount: 18000, plans: [SUB()] }), // 初回: SalonOne が購入額まで消化額に入れた
    visit({ c: 'c2', consumed: 0 }), // 2回目: SalonOne の消化額が 0円
    visit({ c: 'c2', consumed: 0, amount: 2000 }), // 3回目: 物販 2,000円を買った（物販は月の合計で差し引く）
    visit({ c: 'c3', consumed: 5000, amount: 30000, plans: [TICKET] }), // 回数券を買って 1回目を使った
    visit({ c: 'c3', consumed: 0 }), // 回数券の 2回目（消化額 0円）
    visit({ c: 'c4', consumed: 8000, amount: 8000 }), // 都度払い
    visit({ c: 'c5', consumed: 0, amount: 8000 }), // 都度払い（SalonOne の消化額が 0円）
    visit({ c: 'c6', consumed: 0, amount: 0 }), // プランの無い 0円の来店（お直しなど）
    visit({ c: 'c7', consumed: 0, amount: 15000, plans: [SUB()] }), // 0円体験でサブスクに入会
    visit({ c: 'c8', consumed: 0 }), // プランはあるが 1回分の金額がわからない
    visit({ c: 'c2', consumed: 15000, amount: 15000, billing: true }), // サブスク課金（来店ではない）
    visit({ c: 'c1', consumed: 7500, status: 'cancelled' }),
  ];
  const { receptions: out, stats, units } = valueReceptions(receptions, {
    retentionPlans: [{ customerId: 'c8', planName: 'Premium 月4回', churned: false }],
  });
  assert.deepEqual(out.map((r) => [r.consumedAmount, r.valueSource || null]), [
    [3000, 'salonone'],
    [7500, 'salonone'],
    [3000, 'salonone-adjusted'],
    [7500, 'plan'],
    [9500, 'plan'],
    [5000, 'salonone'],
    [5000, 'plan'],
    [8000, 'salonone'],
    [8000, 'paid'],
    [0, 'free'],
    [0, 'free'],
    [0, 'unknown'],
    [0, 'billing'],
    [7500, null], // 会計完了でない受付はそのまま
  ]);
  assert.equal(out[2].salonOneConsumed, 18000);
  assert.equal(units.get('月2回プラン').source, 'salonone');
  assert.deepEqual(stats, { plan: 3, planValue: 22000, unknown: 1, unknownPlans: { 'Premium 月4回': 1 }, adjusted: 1, billing: 1 });

  // 設定で 1回分を入れると、わからなかった来店にも付く
  const set = valueReceptions(receptions, {
    retentionPlans: [{ customerId: 'c8', planName: 'Premium 月4回', churned: false }],
    overrides: { 'Premium 月4回': 8000 },
  });
  assert.equal(set.receptions[11].consumedAmount, 8000);
  assert.equal(set.stats.unknown, 0);
});

test('0円の来店に当てるプラン: 1回分がわかるもの → 離反していないもの → 最近のもの', () => {
  const units = new Map([
    ['月2回プラン', { unit: 7500 }],
    ['Premium 月4回', { unit: 8000 }],
    ['旧プラン', { unit: null }],
  ]);
  const plansOf = new Map([
    ['x', [{ key: '旧プラン', name: '旧プラン', churned: false, at: '2026-10-30' }, { key: '月2回プラン', name: '月2回プラン', churned: false, at: '2026-01-01' }]],
    ['y', [{ key: '月2回プラン', name: '月2回プラン', churned: true, at: '2026-10-01' }, { key: 'Premium 月4回', name: 'Premium 月4回', churned: false, at: '2026-05-01' }]],
  ]);
  assert.deepEqual(treatmentValue(visit({ c: 'x' }), { plansOf, units }), { value: 7500, source: 'plan', plan: '月2回プラン' });
  assert.deepEqual(treatmentValue(visit({ c: 'y' }), { plansOf, units }), { value: 8000, source: 'plan', plan: 'Premium 月4回' });
});
