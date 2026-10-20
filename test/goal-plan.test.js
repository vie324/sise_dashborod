import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  goalBaseline, buildGoalPlan, projectMonth, retentionWeight, feasibility, defaultSpecialTitle, formatSpecialValue, CONTRACT_VISITS,
} from '../shared/goal-plan.js';
import { quarterStart, isQuarterStart, quarterMonths, formatQuarterJa, quarterProgress } from '../shared/dates.js';

// 月 80万（施術 100回 × 8,000円）、新規 10名・契約 5件（50%）、顧客 60名（既存 50名 → 来店頻度 1.8回）
const M = (month, o = {}) => ({ month, consumedSales: 800000, treatmentCount: 100, newCount: 10, purchaseCount: 5, customerCount: 60, memberCount: 45, churnRatePct: 10, ...o });
const HISTORY = [
  M('2026-05', { consumedSales: 700000, treatmentCount: 90, newCount: 14, purchaseCount: 9 }),
  M('2026-07'),
  M('2026-08'),
  M('2026-09'),
];
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('今の水準は直近 3ヶ月の平均。過去いちばん良かった月も覚える', () => {
  const b = goalBaseline(HISTORY);
  assert.deepEqual(b.months, ['2026-07', '2026-08', '2026-09']);
  assert.equal(b.lastMonth, '2026-09');
  near(b.sales, 800000);
  near(b.unitPrice, 8000);
  near(b.newCount, 10);
  near(b.contractRate, 0.5);
  near(b.contracts, 5);
  near(b.repeat, 90);
  assert.equal(b.frequencyBasis, 'customers');
  near(b.existingCustomers, 50);
  near(b.frequency, 1.8);
  assert.equal(b.memberCount, 45);
  near(b.churnRate, 0.1);
  assert.equal(b.best.newCount, 14);
  near(b.best.contractRate, 9 / 14);
  assert.equal(goalBaseline([]), null);
  assert.equal(goalBaseline([{ month: '2026-09', consumedSales: 0, treatmentCount: 0 }]), null);
});

test('顧客数が無ければ会員数、それも無ければ月2回で来店頻度を出す', () => {
  const noCustomers = HISTORY.map((r) => ({ ...r, customerCount: null }));
  const b1 = goalBaseline(noCustomers);
  assert.equal(b1.frequencyBasis, 'members');
  near(b1.frequency, 90 / 45);
  const b2 = goalBaseline(noCustomers.map((r) => ({ ...r, memberCount: null })));
  assert.equal(b2.frequencyBasis, 'default');
  assert.equal(b2.frequency, CONTRACT_VISITS);
  near(b2.existingCustomers, 90 / CONTRACT_VISITS);
  assert.equal(b2.best.frequency, null);
});

test('契約の積み上がりは退会率で減る', () => {
  assert.equal(retentionWeight(1, 0.1), 1);
  near(retentionWeight(2, 0.1), 1.9);
  near(retentionWeight(3, 0), 3);
  // 何も変えなければ今の水準のまま
  const b = goalBaseline(HISTORY);
  near(projectMonth(b, {}, 2).sales, 800000);
});

test('月売上: それぞれの手段が単独で目標ちょうどに届き、バランスは等分', () => {
  const plan = buildGoalPlan({ history: HISTORY, metric: 'consumedSales', target: 1000000, deadline: '2026-12', currentMonth: '2026-10' });
  assert.equal(plan.status, 'plan');
  assert.equal(plan.buildMonths, 2);
  near(plan.gap, 200000);
  near(plan.gapTreatments, 25);
  for (const key of ['new', 'rate', 'frequency', 'price']) {
    assert.equal(plan.levers[key].available, true, key);
    near(plan.levers[key].projection.sales, 1000000, 1e-3);
  }
  // 新規: 1名増やすと 初回 1回 + 契約 0.5件 × 月2回 × 1.9ヶ月分 = 2.9回
  near(plan.levers.new.changes[0].to, 10 + 25 / 2.9);
  // 契約率: 新規 10名 × 月2回 × 1.9 = 38回 / 契約率 1.0
  near(plan.levers.rate.changes[0].to, 0.5 + 25 / 38);
  assert.equal(plan.levers.rate.changes[0].feasibility, 'impossible'); // 100% を超える
  near(plan.levers.frequency.changes[0].to, 1.8 + 25 / 50);
  near(plan.levers.price.changes[0].to, 10000);
  const bal = plan.levers.balanced;
  assert.deepEqual(bal.changes.map((c) => c.kpi), ['newCount', 'contractRate', 'frequency']);
  assert.ok(bal.projection.sales >= 1000000); // 掛け合わせの分だけ少し上回る
  // 毎月の目安は今の水準から目標へまっすぐ
  assert.deepEqual(plan.milestones.map((m) => m.month), ['2026-10', '2026-11', '2026-12']);
  near(plan.milestones[0].value, 800000 + 200000 / 3);
  near(plan.milestones[2].value, 1000000);
});

test('月売上: 今月の見込みで進み具合を判定する', () => {
  const current = M('2026-10', { consumedSales: 450000 });
  const plan = buildGoalPlan({ history: HISTORY, current, progress: { elapsed: 15, total: 31 }, metric: 'consumedSales', target: 1000000, deadline: '2026-12', currentMonth: '2026-10', startMonth: '2026-10' });
  assert.equal(plan.now.kind, 'forecast');
  assert.equal(plan.now.value, Math.round((450000 / 15) * 31));
  assert.equal(plan.track, 'onTrack'); // 93万 ≥ 今月の目安 86.7万
  assert.deepEqual(plan.start, { month: '2026-09', value: 800000 });
});

test('月売上: すでに届いている・期限が過ぎた・データが無い', () => {
  assert.equal(buildGoalPlan({ history: HISTORY, metric: 'consumedSales', target: 700000, deadline: '2026-12', currentMonth: '2026-10' }).status, 'reached');
  const ended = buildGoalPlan({ history: HISTORY, metric: 'consumedSales', target: 750000, deadline: '2026-09', currentMonth: '2026-10' });
  assert.equal(ended.status, 'ended');
  assert.equal(ended.achieved, true);
  assert.equal(ended.result, 800000);
  assert.equal(buildGoalPlan({ history: [], metric: 'consumedSales', target: 1, deadline: '2026-12', currentMonth: '2026-10' }).status, 'noData');
});

test('月売上: 新規数がわからなければ、新規・契約率の手段は出さず来店頻度だけでバランスを取る', () => {
  const history = HISTORY.map((r) => ({ ...r, newCount: null, purchaseCount: null }));
  const plan = buildGoalPlan({ history, metric: 'consumedSales', target: 1000000, deadline: '2026-12', currentMonth: '2026-10' });
  assert.equal(plan.levers.new.available, false);
  assert.equal(plan.levers.rate.available, false);
  assert.equal(plan.levers.frequency.available, true);
  assert.deepEqual(plan.levers.balanced.changes.map((c) => c.kpi), ['frequency']);
  near(plan.levers.balanced.projection.sales, 1000000, 1e-3);
});

test('会員数: 必要な契約数を逆算し、退会を減らす手段も出す', () => {
  const plan = buildGoalPlan({ history: HISTORY, metric: 'memberCount', target: 60, deadline: '2026-12', currentMonth: '2026-10' });
  assert.equal(plan.status, 'plan');
  assert.equal(plan.months, 3); // 9月末 → 12月末
  const keep = 0.9;
  const needed = (60 - 45 * keep ** 3) / (1 + keep + keep ** 2);
  near(plan.neededContracts, needed);
  near(plan.levers.new.changes[0].to, needed / 0.5);
  near(plan.levers.rate.changes[0].to, needed / 10);
  near(plan.milestones[2].value, 60);
  const churn = plan.levers.churn;
  assert.equal(churn.available, true);
  const c = churn.changes[0].to;
  near(45 * (1 - c) ** 3 + 5 * retentionWeight(3, c), 60, 1e-3);
  // 今の契約ペースでも届く
  assert.equal(buildGoalPlan({ history: HISTORY, metric: 'memberCount', target: 46, deadline: '2026-12', currentMonth: '2026-10' }).status, 'onPace');
});

test('新規数: 目標の新規数が続いた時の売上の見通し', () => {
  const plan = buildGoalPlan({ history: HISTORY, metric: 'newCount', target: 14, deadline: '2026-11', currentMonth: '2026-10' });
  assert.equal(plan.status, 'plan');
  near(plan.effect.contracts, 2);
  // 初回 4回 + 契約 2件 × 月2回 × 2.71ヶ月分 = 14.84回 × 8,000円
  near(plan.effect.sales, (4 + 2 * 2 * retentionWeight(3, 0.1)) * 8000, 1e-3);
});

test('現実的かの目安', () => {
  assert.equal(feasibility(10, 12), 'reached');
  assert.equal(feasibility(13, 12), 'stretch');
  assert.equal(feasibility(20, 12), 'hard');
  assert.equal(feasibility(1.2, 0.8, { max: 1 }), 'impossible');
  assert.equal(feasibility(5, null), null);
  assert.equal(feasibility(0.06, 0.05, { lowerIsBetter: true }), 'reached');
  assert.equal(feasibility(0.03, 0.05, { lowerIsBetter: true }), 'hard');
});

test('特別目標のタイトル', () => {
  assert.equal(defaultSpecialTitle('consumedSales', 1000000, '2026-12', '2026-10'), '12月までに月売上100万円！');
  assert.equal(defaultSpecialTitle('memberCount', 150, '2027-03', '2026-10'), '2027年3月までに会員150名！');
  assert.equal(formatSpecialValue('consumedSales', 1250000), '125万円');
  assert.equal(formatSpecialValue('newCount', 40), '40名');
});

test('3ヶ月の区切り', () => {
  assert.equal(quarterStart('2026-11'), '2026-10');
  assert.equal(quarterStart('2027-01'), '2027-01');
  assert.equal(isQuarterStart('2026-10'), true);
  assert.equal(isQuarterStart('2026-11'), false);
  assert.deepEqual(quarterMonths('2026-10'), ['2026-10', '2026-11', '2026-12']);
  assert.equal(formatQuarterJa('2026-10'), '2026年10〜12月');
  const p = quarterProgress('2026-10', '2026-11-05');
  assert.equal(p.total, 92);
  assert.equal(p.elapsed, 36);
  assert.equal(p.remaining, 56);
});
