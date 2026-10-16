import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMonth, computeRetention, combineShops, forecastMonthEnd } from '../shared/metrics.js';
import { resolveChannel, guessChannel } from '../shared/channels.js';
import { computeStaffIncentive } from '../shared/incentive.js';

const R = (o) => ({ status: 'completed', customerClass: 'existing', consumedAmount: 8000, salesAmount: 0, shopId: 'A', staffId: 's1', ...o });

test('媒体名から経路キーを推定し、明示マッピングを優先する', () => {
  assert.equal(guessChannel('ホットペッパー'), 'hotpepper');
  assert.equal(guessChannel('HPB'), 'hotpepper');
  assert.equal(guessChannel('Meta広告'), 'meta');
  assert.equal(guessChannel('Instagram広告'), 'meta');
  assert.equal(guessChannel('インスタ'), 'instagram');
  assert.equal(guessChannel('ホームページ'), 'homepage');
  assert.equal(guessChannel('ミニモ'), 'minimo');
  assert.equal(guessChannel('Threads'), 'threads');
  assert.equal(guessChannel('ご紹介'), 'referral');
  assert.equal(guessChannel('Googleマップ'), 'other');
  assert.equal(guessChannel('チラシ'), 'other');
  assert.equal(resolveChannel('Googleマップ', { 'Googleマップ': 'homepage' }), 'homepage');
});

test('消化売上・既存顧客売上・施術数は会計確定の来店だけを数える', () => {
  const receptions = [
    R({ id: 1, date: '2026-11-02', customerId: 'c1', consumedAmount: 9000, salesAmount: 18000, paymentMethod: '現金' }),
    R({ id: 2, date: '2026-11-03', customerId: 'c2', consumedAmount: 7500, customerClass: 'new', sourceName: 'ホットペッパー' }),
    R({ id: 3, date: '2026-11-04', customerId: 'c3', status: 'cancelled', consumedAmount: 9999 }),
    R({ id: 4, date: '2026-10-31', customerId: 'c1', consumedAmount: 9999 }), // 前月
    R({ id: 5, date: '2026-11-05', customerId: 'c4', staffId: 's2', consumedAmount: 8000 }),
  ];
  const m = computeMonth({ receptions, contracts: [], month: '2026-11', asOf: '2026-11-30' });
  assert.equal(m.staff.s1.consumedSales, 16500);
  assert.equal(m.staff.s1.existingConsumedSales, 9000);
  assert.equal(m.staff.s1.treatmentCount, 2);
  assert.equal(m.shops.A.consumedSales, 24500);
  assert.equal(m.shops.A.cashSales, 18000);
  assert.equal(m.shops.A.daily.length, 3);
});

test('新規の契約は初回来店の月のうちの契約だけを数え、紹介はサブスク（シェアプラン除く）のみ', () => {
  const receptions = [
    R({ date: '2026-11-03', customerId: 'n1', customerClass: 'new', sourceName: 'ホットペッパー' }),
    R({ date: '2026-11-20', customerId: 'n1', customerClass: 'new', sourceName: 'ホットペッパー' }), // 2回目は新規数に数えない
    R({ date: '2026-11-04', customerId: 'n2', customerClass: 'new', sourceName: 'Meta広告' }),
    R({ date: '2026-11-05', customerId: 'n3', customerClass: 'new', sourceName: '紹介', staffId: 's2' }),
    R({ date: '2026-11-06', customerId: 'n4', customerClass: 'new', sourceName: '紹介', referralStaffId: 's3' }),
    R({ date: '2026-11-07', customerId: 'n5', customerClass: 'new', sourceName: '紹介' }),
    R({ date: '2026-11-08', customerId: 'n6', customerClass: 'new', sourceName: 'ホームページ' }),
  ];
  const contracts = [
    { customerId: 'n1', shopId: 'A', type: 'subscription', startDate: '2026-11-20' }, // 2回目の来店で契約 → 数える
    { customerId: 'n2', shopId: 'A', type: 'ticket', startDate: '2026-12-02' }, // 翌月の契約 → 数えない
    { customerId: 'n3', shopId: 'A', type: 'subscription', startDate: '2026-11-05' },
    { customerId: 'n4', shopId: 'A', type: 'subscription', startDate: '2026-11-06' },
    { customerId: 'n5', shopId: 'A', type: 'subscription', startDate: '2026-11-07', isSharePlan: true },
    { customerId: 'n6', shopId: 'A', type: 'member', startDate: '2026-11-08' }, // プランの種別が無い入会も契約
  ];
  const m = computeMonth({ receptions, contracts, month: '2026-11', asOf: '2026-12-10' });
  assert.equal(m.staff.s1.newVisits.hotpepper, 1);
  assert.equal(m.staff.s1.newContracts.hotpepper, 1);
  assert.equal(m.staff.s1.newContracts.meta, 0);
  assert.equal(m.staff.s1.newContracts.homepage, 1);
  assert.equal(m.shops.A.newVisitTotal, 6);
  assert.equal(m.staff.s2.referralSubscriptions, 1);
  assert.equal(m.staff.s3.referralSubscriptions, 1); // 紹介リンクのスタッフに付ける
  assert.equal(m.staff.s1.referralSubscriptions, 0); // n5 はシェアプラン
  assert.equal(m.shops.A.referralSubscriptions, 2);

  // 基準日より後の契約はまだ数えない
  const early = computeMonth({ receptions, contracts, month: '2026-11', asOf: '2026-11-10' });
  assert.equal(early.staff.s1.newContracts.hotpepper, 0);
});

test('現金は分割決済の内訳（cashAmount）を優先する', () => {
  const receptions = [
    R({ id: 1, date: '2026-11-02', customerId: 'c1', salesAmount: 53000, cashAmount: 3000, paymentMethod: '現金 / クレジットカード' }),
    R({ id: 2, date: '2026-11-02', customerId: 'c2', salesAmount: 8000, paymentMethod: '現金' }),
    R({ id: 3, date: '2026-11-03', customerId: 'c3', salesAmount: 8000, cashAmount: 0, paymentMethod: 'PayPay' }),
  ];
  const m = computeMonth({ receptions, contracts: [], month: '2026-11', asOf: '2026-11-30' });
  assert.equal(m.shops.A.cashSales, 11000);
  assert.equal(m.shops.A.daily[0].cashSales, 11000);
  assert.equal(m.shops.A.daily[1].cashSales, 0);
});

test('ライブでは継続指標を契約から計算せず、API の値だけを使う', () => {
  const receptions = [R({ date: '2026-11-02', customerId: 'c1' })];
  const contracts = [{ customerId: 'c1', shopId: 'A', type: 'subscription', startDate: '2026-11-02' }];
  const live = computeMonth({ receptions, contracts, month: '2026-11', asOf: '2026-11-30', retentionFromContracts: false });
  assert.equal(live.shops.A.retention, null);
  const withApi = computeMonth({
    receptions, contracts, month: '2026-11', asOf: '2026-11-30', retentionFromContracts: false,
    retentionOverrides: { A: { memberCount: 50, churnRatePct: 6, avgTenureMonths: 4 }, B: { memberCount: 12 } },
  });
  assert.equal(withApi.shops.A.retention.memberCount, 50);
  assert.equal(withApi.shops.A.retention.basis, 'api');
  assert.equal(withApi.shops.B.retention.memberCount, 12); // 受付が無い店舗も継続指標は出す
  assert.equal(combineShops([live.shops.A]).retention.memberCount, null);
});

test('継続指標: 会員数・退会率・平均継続期間', () => {
  const contracts = [
    { customerId: 'a', shopId: 'A', type: 'subscription', startDate: '2026-05-01', endDate: null },
    { customerId: 'b', shopId: 'A', type: 'subscription', startDate: '2026-08-01', endDate: '2026-11-15' }, // 11月退会
    { customerId: 'c', shopId: 'A', type: 'subscription', startDate: '2026-11-10', endDate: null }, // 11月入会
    { customerId: 'd', shopId: 'A', type: 'payPerVisit', startDate: '2026-01-01', endDate: null }, // 都度払いは対象外
    { customerId: 'e', shopId: 'A', type: 'subscription', startDate: '2026-01-01', endDate: '2026-03-01' }, // 過去に退会
  ];
  const r = computeRetention(contracts, 'A', '2026-11', '2026-11-30');
  assert.equal(r.memberCount, 2); // a, c
  assert.equal(r.membersAtStart, 2); // a, b
  assert.equal(r.churnCount, 1); // b
  assert.equal(r.churnRatePct, 50);
  // a: 5/1→11/30 = 213日, b: 8/1→11/15 = 106日, c: 11/10→11/30 = 20日, e: 1/1→3/1 = 59日
  const expected = (213 + 106 + 20 + 59) / 30.4375 / 4;
  assert.ok(Math.abs(r.avgTenureMonths - expected) < 1e-9);
});

test('集計結果からそのままインセンティブを計算できる', () => {
  const receptions = [];
  for (let i = 0; i < 90; i++) {
    receptions.push(R({ date: `2026-11-${String((i % 28) + 1).padStart(2, '0')}`, customerId: `x${i % 30}`, consumedAmount: 8000 }));
  }
  const m = computeMonth({ receptions, contracts: [], month: '2026-11', asOf: '2026-11-30' });
  const inc = computeStaffIncentive(m.staff.s1, null, '2026-11');
  assert.equal(m.staff.s1.consumedSales, 720000);
  assert.equal(inc.items[0].amount, 30000);
  assert.equal(inc.items[0].nextTier.gap, 88000);
  assert.equal(inc.items[0].nextTier.sessions, 11);
});

test('全店舗合算と月末予測', () => {
  const a = { consumedSales: 100, treatmentCount: 2, newVisits: { hotpepper: 1 }, newContracts: {}, daily: [{ date: '2026-11-01', consumedSales: 100 }], retention: { memberCount: 10, membersAtStart: 10, churnCount: 1, avgTenureMonths: 4 } };
  const b = { consumedSales: 50, treatmentCount: 1, newVisits: { hotpepper: 2 }, newContracts: {}, daily: [{ date: '2026-11-01', consumedSales: 50 }], retention: { memberCount: 30, membersAtStart: 30, churnCount: 2, avgTenureMonths: 8 } };
  const c = combineShops([a, b]);
  assert.equal(c.consumedSales, 150);
  assert.equal(c.newVisits.hotpepper, 3);
  assert.equal(c.daily[0].consumedSales, 150);
  assert.equal(c.retention.memberCount, 40);
  assert.equal(c.retention.churnRatePct, 7.5);
  assert.equal(c.retention.avgTenureMonths, 7);
  assert.equal(forecastMonthEnd(300000, 10, 30), 900000);
});
