import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSalesIncentive,
  computeRetentionIncentive,
  computeNewContractIncentive,
  computeSnsIncentive,
  computeReferralIncentive,
  computeStaffIncentive,
  contractsNeededForRate,
  paymentPeriodOf,
  sumPeriod,
  summarizeIncentive,
  incentiveCsv,
} from '../shared/incentive.js';

test('施術消化売上: 各段階の境界は「以上」で判定する', () => {
  const cases = [
    [0, 0],
    [575999, 0],
    [576000, 5000],
    [687999, 5000],
    [688000, 30000],
    [808000, 40000],
    [927999, 40000],
    [928000, 50000],
    [1047999, 50000],
    [1048000, 100000],
    [2000000, 100000],
  ];
  for (const [sales, expected] of cases) {
    assert.equal(computeSalesIncentive(sales).amount, expected, `sales=${sales}`);
  }
});

test('施術消化売上: 次の段階まで「あと何円・何回（8,000円/回）」', () => {
  const r = computeSalesIncentive(656000);
  assert.equal(r.amount, 5000);
  assert.deepEqual(r.nextTier, { min: 688000, amount: 30000, gap: 32000, sessions: 4 });

  const r2 = computeSalesIncentive(680001);
  assert.equal(r2.nextTier.gap, 7999);
  assert.equal(r2.nextTier.sessions, 1);

  const top = computeSalesIncentive(1100000);
  assert.equal(top.nextTier, null);
  assert.equal(top.tierIndex, 4);
});

test('継続率: 3条件すべて満たした時だけ 5,000円', () => {
  const ok = computeRetentionIncentive({ memberCount: 50, churnRatePct: 10, avgTenureMonths: 3 });
  assert.equal(ok.amount, 5000);
  assert.equal(ok.eligible, true);

  const churnNg = computeRetentionIncentive({ memberCount: 80, churnRatePct: 10.1, avgTenureMonths: 6 });
  assert.equal(churnNg.amount, 0);
  assert.equal(churnNg.conditions.find((c) => c.key === 'churn').met, false);

  const membersNg = computeRetentionIncentive({ memberCount: 49, churnRatePct: 3, avgTenureMonths: 6 });
  assert.equal(membersNg.amount, 0);
  assert.equal(membersNg.conditions.find((c) => c.key === 'members').gap, 1);

  const unknown = computeRetentionIncentive(null);
  assert.equal(unknown.amount, 0);
  assert.equal(unknown.known, false);
});

test('新規契約: 資料の計算例（新規18名・契約11名 → 61.1% → 15,000円）', () => {
  const r = computeNewContractIncentive({
    existingConsumedSales: 450000,
    newVisits: { hotpepper: 10, meta: 5, homepage: 3 },
    newContracts: { hotpepper: 6, meta: 3, homepage: 2 },
  });
  assert.equal(r.visits, 18);
  assert.equal(r.contracts, 11);
  assert.equal(Math.round(r.ratePct * 10) / 10, 61.1);
  assert.equal(r.eligible, true);
  assert.equal(r.amount, 15000);
  // 70% まで: (11+k)/(18+k) >= 0.7 → k >= 5.33 → 6（17/24=70.8%、16/23=69.6%）
  assert.equal(r.nextTier.minPct, 70);
  assert.equal(r.nextTier.contractsNeeded, 6);
});

test('新規契約: 率の境界は整数演算で「以上」判定（浮動小数点誤差なし）', () => {
  const base = { existingConsumedSales: 400000 };
  const at = (visits, contracts) => computeNewContractIncentive({
    ...base,
    newVisits: { hotpepper: visits },
    newContracts: { hotpepper: contracts },
  });
  assert.equal(at(10, 4).amount, 2000); // 40%
  assert.equal(at(10, 5).amount, 10000); // 50%
  assert.equal(at(10, 7).amount, 20000); // 70%（0.7 の誤差で 15,000 にならない）
  assert.equal(at(10, 9).amount, 30000); // 90%
  assert.equal(at(10, 3).amount, 0); // 30% は対象外
  assert.equal(at(9, 9).amount, 30000); // 100%
});

test('新規契約: 適用条件（既存消化売上40万・3経路新規9名）を満たさないと 0円', () => {
  const lowExisting = computeNewContractIncentive({
    existingConsumedSales: 399999,
    newVisits: { hotpepper: 10 },
    newContracts: { hotpepper: 9 },
  });
  assert.equal(lowExisting.amount, 0);
  assert.equal(lowExisting.conditions[0].gap, 1);

  const fewVisits = computeNewContractIncentive({
    existingConsumedSales: 500000,
    newVisits: { hotpepper: 4, meta: 2, homepage: 2, minimo: 5 }, // Minimo は 3経路に含めない
    newContracts: { hotpepper: 4, meta: 2, homepage: 2, minimo: 5 },
  });
  assert.equal(fewVisits.visits, 8);
  assert.equal(fewVisits.amount, 0);
  assert.equal(fewVisits.conditions[1].gap, 1);
});

test('contractsNeededForRate', () => {
  assert.equal(contractsNeededForRate(4, 10, 50), 2); // (4+2)/(10+2)=50%
  assert.equal(contractsNeededForRate(5, 10, 50), 0);
  assert.equal(contractsNeededForRate(0, 0, 40), 0);
});

test('Minimo・Threads・Instagram: 10名以上集客で契約1件 2,000円', () => {
  const ng = computeSnsIncentive({ newVisits: { minimo: 4, threads: 2, instagram: 3 }, newContracts: { minimo: 3 } });
  assert.equal(ng.customers, 9);
  assert.equal(ng.amount, 0);
  assert.equal(ng.gap, 1);
  assert.equal(ng.potential, 6000);

  const ok = computeSnsIncentive({ newVisits: { minimo: 5, threads: 2, instagram: 3 }, newContracts: { minimo: 3, instagram: 1 } });
  assert.equal(ok.amount, 8000);
});

test('紹介: サブスク契約 1件 2,000円', () => {
  assert.equal(computeReferralIncentive({ referralSubscriptions: 3 }).amount, 6000);
  assert.equal(computeReferralIncentive({}).amount, 0);
});

test('支給期間: 2026年11月開始・2ヶ月ごと', () => {
  assert.deepEqual(paymentPeriodOf('2026-11').months, ['2026-11', '2026-12']);
  assert.deepEqual(paymentPeriodOf('2026-12').months, ['2026-11', '2026-12']);
  assert.deepEqual(paymentPeriodOf('2027-01').months, ['2027-01', '2027-02']);
  assert.equal(paymentPeriodOf('2027-02').index, 1);
  assert.equal(paymentPeriodOf('2026-11').label, '2026年11月〜12月');
  assert.equal(paymentPeriodOf('2026-10').preview, true);
  assert.equal(paymentPeriodOf('2026-11').preview, false);
});

test('合計と支給期間の合算', () => {
  const metrics = {
    consumedSales: 700000,
    existingConsumedSales: 420000,
    newVisits: { hotpepper: 10, meta: 5, homepage: 3, instagram: 10 },
    newContracts: { hotpepper: 6, meta: 3, homepage: 2, instagram: 2 },
    referralSubscriptions: 1,
  };
  const retention = { memberCount: 60, churnRatePct: 5, avgTenureMonths: 7 };
  const nov = computeStaffIncentive(metrics, retention, '2026-11');
  // 30,000 + 5,000 + 15,000 + 4,000 + 2,000
  assert.equal(nov.total, 56000);
  assert.equal(nov.preview, false);
  const dec = computeStaffIncentive({ consumedSales: 600000 }, retention, '2026-12');
  assert.equal(dec.total, 10000);
  const period = sumPeriod([nov, dec]);
  assert.equal(period.total, 66000);
  assert.equal(period.byKey.sales, 35000);
});

test('確定・CSV 用のまとめ: 支給額（項目ごと）と判定に使った数字', () => {
  const m = {
    consumedSales: 700000, existingConsumedSales: 450000,
    newVisits: { hotpepper: 6, meta: 3, homepage: 1, instagram: 7, minimo: 3 },
    newContracts: { hotpepper: 4, meta: 1, homepage: 1, instagram: 2 },
    referralSubscriptions: 1,
    crossStoreContracts: 2,
  };
  const res = computeStaffIncentive(m, { memberCount: 60, churnRatePct: 8, avgTenureMonths: 4.2 }, '2026-11');
  const s = summarizeIncentive(res);
  // 系列店での契約は 1件 2,000円
  assert.deepEqual(s.items, { sales: 30000, retention: 5000, newContract: 15000, sns: 4000, referral: 2000, crossStore: 4000 });
  assert.equal(s.total, 60000);
  assert.deepEqual(s.basis, {
    consumedSales: 700000, existingConsumedSales: 450000, newVisits3ch: 10, contracts3ch: 6, snsCustomers: 10, snsContracts: 2,
    referralSubscriptions: 1, crossStoreContracts: 2, retentionKnown: true, memberCount: 60, churnRatePct: 8, avgTenureMonths: 4.2,
  });
  assert.equal(summarizeIncentive(null), null);
  // 継続指標の記録が無い月は「わからない」として残す
  assert.equal(summarizeIncentive(computeStaffIncentive(m, null, '2026-11')).basis.retentionKnown, false);
});

test('支給一覧の CSV: BOM 付き・月ごとの行・数式にならない名前', () => {
  const res = computeStaffIncentive({ consumedSales: 576000 }, { memberCount: 10, churnRatePct: 3, avgTenureMonths: 2 }, '2026-11');
  const sum = summarizeIncentive(res);
  const nov = { month: '2026-11', ...sum, basis: { ...sum.basis, retentionAsOf: '2026-11-30' } };
  const row = { key: '201', name: '=佐藤', storeName: '中央店, 本店', total: 5000, months: [nov, { month: '2026-12', total: null }] };
  const csv = incentiveCsv([row], { periodLabel: '2026年11月〜12月', status: '確定' });
  assert.ok(csv.startsWith('\uFEFF'));
  const lines = csv.slice(1).trim().split('\r\n');
  assert.equal(lines.length, 2); // 見出し + 11月（まだ無い 12月は出さない）
  assert.match(lines[0], /^支給期間,状態,店舗,スタッフ/);
  assert.equal(lines[1], `2026年11月〜12月,確定,"中央店, 本店",'=佐藤,201,2026-11,576000,0,0,0,0,0,0,0,10,3,2,2026-11-30,5000,0,0,0,0,0,5000,5000`);
  assert.match(lines[0], /紹介のサブスク契約,系列店での契約,会員数/);
  assert.match(lines[0], /⑤紹介,⑥系列店での契約,月の合計/);
});
