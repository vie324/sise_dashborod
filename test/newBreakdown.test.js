// 新規の内訳（媒体別の新規数・契約数・契約率）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newBreakdown, contractRatePct } from '../shared/newBreakdown.js';
import { computeMonth, combineShops } from '../shared/metrics.js';

const metrics = {
  newVisits: { hotpepper: 8, meta: 2, homepage: 0, minimo: 2, threads: 2, instagram: 8, referral: 0, other: 1 },
  newContracts: { hotpepper: 1, meta: 1, homepage: 0, minimo: 1, threads: 1, instagram: 3, referral: 0, other: 1 },
};

test('媒体ごとの新規数・構成比・契約率（新規の多い順。同数は経路の並び順）', () => {
  const b = newBreakdown(metrics);
  assert.deepEqual(b.media.map((m) => [m.label, m.visits, m.contracts]), [
    ['ホットペッパー', 8, 1],
    ['Instagram', 8, 3],
    ['Meta広告', 2, 1],
    ['Minimo', 2, 1],
    ['Threads', 2, 1],
    ['その他', 1, 1],
    ['ホームページ', 0, 0], // 3経路は 0名でも並べる
  ]);
  assert.equal(b.media.find((m) => m.key === 'referral'), undefined); // 3経路以外の 0名は出さない
  assert.equal(b.media[1].ratePct, 37.5);
  assert.equal(b.media.at(-1).ratePct, null); // 新規 0名の契約率は出さない
  assert.ok(Math.abs(b.media.reduce((s, m) => s + m.share, 0) - 1) < 1e-9);
  assert.equal(b.media[0].share, 8 / 23);
  assert.deepEqual(b.media.filter((m) => m.incentive).map((m) => m.key), ['hotpepper', 'meta', 'homepage']);
  assert.deepEqual({ ...b.total, ratePct: Math.round(b.total.ratePct * 10) / 10 }, { visits: 23, contracts: 8, ratePct: 34.8 });
});

test('3経路の合計（新規契約インセンティブの判定と同じ契約率）', () => {
  const b = newBreakdown(metrics);
  assert.deepEqual(b.threeChannels, { visits: 10, contracts: 2, ratePct: 20, labels: ['ホットペッパー', 'Meta広告', 'ホームページ'] });
});

test('来店経由ごとの数字と、媒体名と違う来店経由の名前', () => {
  const b = newBreakdown(metrics, [
    { name: 'ホットペッパー', channel: 'hotpepper', newVisits: 6, contracts: 1 },
    { name: 'HPB', channel: 'hotpepper', newVisits: 2, contracts: 0 },
    { name: 'Ｉｎｓｔａｇｒａｍ', channel: 'instagram', newVisits: 8, contracts: 3 }, // 全角でも同じ名前
    { name: 'Googleマップ', channel: 'other', newVisits: 1, contracts: 1 },
    { name: 'チラシ', channel: 'other', newVisits: 0, contracts: 0 }, // 新規 0名は出さない
    { name: '（未設定）', channel: 'unknown', newVisits: 2, contracts: 1 }, // 知らない経路はその他
  ]);
  assert.deepEqual(b.media.find((m) => m.key === 'hotpepper').aliases, ['HPB']);
  assert.deepEqual(b.media.find((m) => m.key === 'instagram').aliases, []);
  assert.deepEqual(b.media.find((m) => m.key === 'other').aliases, ['（未設定）', 'Googleマップ']);
  assert.deepEqual(b.sources.map((s) => [s.name, s.channelLabel, s.visits, s.contracts, s.ratePct]), [
    ['Ｉｎｓｔａｇｒａｍ', 'Instagram', 8, 3, 37.5],
    ['ホットペッパー', 'ホットペッパー', 6, 1, (1 / 6) * 100],
    ['HPB', 'ホットペッパー', 2, 0, 0],
    ['（未設定）', 'その他', 2, 1, 50],
    ['Googleマップ', 'その他', 1, 1, 100],
  ]);
});

test('新規が無い月・数字が無いとき', () => {
  for (const m of [undefined, {}, { newVisits: {}, newContracts: {} }]) {
    const b = newBreakdown(m);
    assert.deepEqual(b.total, { visits: 0, contracts: 0, ratePct: null });
    assert.deepEqual(b.media.map((x) => [x.key, x.visits, x.share, x.ratePct]), [['hotpepper', 0, 0, null], ['meta', 0, 0, null], ['homepage', 0, 0, null]]);
    assert.deepEqual(b.sources, []);
  }
  assert.equal(contractRatePct(1, 0), null);
  assert.equal(contractRatePct(3, 4), 75);
});

test('受付履歴からの集計とつながる（経路ごとの合計 = 来店経由の合計。2回目以降の来店での契約も初回の月に数える）', () => {
  const R = (o) => ({ status: 'completed', customerClass: 'new', consumedAmount: 3000, salesAmount: 3000, shopId: 'A', staffId: 's1', ...o });
  const receptions = [
    R({ date: '2026-11-02', customerId: 'n1', sourceName: 'ホットペッパー' }),
    R({ date: '2026-11-03', customerId: 'n2', sourceName: 'HPB' }),
    R({ date: '2026-11-04', customerId: 'n3', sourceName: 'Instagram' }),
    R({ date: '2026-11-05', customerId: 'n4', sourceName: 'Googleマップ' }),
    R({ date: '2026-11-06', customerId: 'n5', sourceName: 'ホットペッパー', shopId: 'B', staffId: 's2' }),
    R({ date: '2026-11-20', customerId: 'n1', customerClass: 'repeat', sourceName: 'ホットペッパー' }),
  ];
  const contracts = [
    { customerId: 'n1', shopId: 'A', type: 'subscription', startDate: '2026-11-20' }, // 2回目の来店で契約
    { customerId: 'n3', shopId: 'A', type: 'ticket', startDate: '2026-11-04' },
    { customerId: 'n5', shopId: 'B', type: 'subscription', startDate: '2026-11-06' },
  ];
  const m = computeMonth({ receptions, contracts, month: '2026-11', asOf: '2026-11-25' });
  const b = newBreakdown(combineShops(Object.values(m.shops)), m.sources);
  assert.deepEqual(b.media.map((x) => [x.key, x.visits, x.contracts]), [
    ['hotpepper', 3, 2], ['instagram', 1, 1], ['other', 1, 0], ['meta', 0, 0], ['homepage', 0, 0],
  ]);
  for (const x of b.media) {
    const fromSources = b.sources.filter((s) => s.channel === x.key);
    assert.equal(fromSources.reduce((s, v) => s + v.visits, 0), x.visits, x.key);
    assert.equal(fromSources.reduce((s, v) => s + v.contracts, 0), x.contracts, x.key);
  }
  assert.deepEqual(b.media[0].aliases, ['HPB']);
  assert.deepEqual(b.total, { visits: 5, contracts: 3, ratePct: 60 });
  assert.deepEqual({ visits: b.threeChannels.visits, contracts: b.threeChannels.contracts }, { visits: 3, contracts: 2 });
});
