// SalonOne とつないだ状態（ライブ）の集計を、疑似 SalonOne と疑似 DB で通しで確かめる。
// 期待値は scripts/dev/salonone-fake.mjs の売上サマリ・受付履歴（中央店 101 / 駅前店 102）から。
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createMockClient } from '../scripts/dev/supabase-mock.mjs';
import { fakeFetch, FAKE_KEY } from '../scripts/dev/salonone-fake.mjs';
import { todayJst, monthOf, addMonths } from '../shared/dates.js';

let summary;
let provider;
let db;
let calls = [];

const CURRENT = monthOf(todayJst());
const PREV = addMonths(CURRENT, -1);
const SATO = { valid: true, staffId: 'st-sato', role: 'staff', storeIds: ['store-1'], name: '佐藤' };

before(async () => {
  process.env.SALONONE_API_KEY = FAKE_KEY;
  process.env.SALONONE_API_BASE_URL = 'http://fake.salonone.test/api/analytics/v1';
  process.env.SALONONE_RATE_LIMIT_PER_MINUTE = '100000'; // テストは毎回キャッシュを消して取り直すため
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sise-live-')), 'db.json');
  db = createMockClient(file);
  globalThis.__SISE_SUPABASE_MOCK__ = db;
  await db.from('dash_config').upsert([
    { key: 'salonone.shopMap', value: { 'store-1': '101', 'store-2': '102' } },
    { key: 'salonone.staffMap', value: { 'st-sato': '201', 'st-suzuki': '202', 'st-tanaka': '203' } },
  ], { onConflict: 'key' });
  summary = await import('../api/_lib/salonone/summary.js');
  provider = await import('../api/_lib/salonone/provider.js');
});

beforeEach(() => {
  calls = [];
  globalThis.fetch = fakeFetch(calls);
  process.env.SALONONE_API_KEY = FAKE_KEY;
  provider.clearSalonOneCache();
});

test('締まった月: 消化売上・入金・施術数・新規数・既存数・契約数は SalonOne の売上分析の数字', async () => {
  const s = await summary.buildSummary(null, { month: PREV, storeId: 'all' });
  assert.equal(s.mode, 'live');
  assert.deepEqual(s.warnings.filter((w) => w.code !== 'retention'), []);
  assert.equal(s.store.consumedSales, 48000); // 受付履歴の消化額（43,000）ではなく売上分析の消化売上
  assert.equal(s.store.newCount, 2);
  assert.equal(s.store.repeatCount, 6);
  assert.equal(s.store.purchaseCount, 1);
  assert.equal(s.store.cashSales, 24000); // 現金は受付履歴から

  const central = s.stores.find((x) => x.storeId === 'store-1');
  assert.equal(central.basis, 'salonone');
  assert.equal(central.consumedSales, 34000);
  assert.equal(central.depositSales, 98000);
  assert.equal(central.treatmentCount, 6);
  assert.equal(central.newCount, 2);
  assert.equal(central.repeatCount, 4);
  assert.equal(central.purchaseCount, 1);
  // 経路別（インセンティブ用）は受付履歴から
  assert.equal(central.newVisitTotal, 3);
  assert.equal(central.newContractTotal, 2); // HPB のサブスク + 紹介の入会
  assert.deepEqual(central.contract3ch, { visits: 1, contracts: 1, ratePct: 100 });
  assert.equal(central.retention, null); // 過去の月は保存した継続指標が無ければ出さない
  const day20 = s.store.daily.find((d) => d.date === `${PREV}-20`);
  assert.equal(day20.consumedSales, 5000); // 失効益の日も売上分析どおり

  const byName = Object.fromEntries(s.staff.map((r) => [r.name, r]));
  assert.deepEqual(Object.keys(byName).sort(), ['佐藤 美咲', '田中 大輔', '鈴木 健太']); // 退職者は出さない
  const sato = byName['佐藤 美咲'];
  assert.equal(sato.staffId, 'st-sato');
  assert.equal(sato.metrics.consumedSales, 25000);
  assert.equal(sato.metrics.existingConsumedSales, 19000); // 25,000 − 新規 2名の初回来店 6,000
  assert.equal(sato.metrics.treatmentCount, 4);
  assert.equal(sato.metrics.newCount, 1);
  assert.equal(sato.metrics.repeatCount, 3);
  assert.equal(sato.metrics.purchaseCount, 1);
  assert.equal(sato.metrics.newVisitTotal, 2);
  assert.equal(sato.metrics.referralSubscriptions, 0); // 紹介は入会のみでサブスクではない
  assert.equal(sato.daily.reduce((a, d) => a + d.consumedSales, 0), 25000); // 日別の合計も売上分析に合わせる
  assert.equal(sato.incentive.items[0].current, 25000);
  assert.equal(byName['鈴木 健太'].metrics.consumedSales, 9000);
  assert.equal(byName['鈴木 健太'].metrics.purchaseCount, 0);
  assert.equal(byName['田中 大輔'].storeId, 'store-2');
});

test('推移は売上分析だけで出す（受付履歴は取らない）', async () => {
  const t = await summary.buildTrend(null, { months: 3, endMonth: CURRENT, storeId: 'all' });
  const prev = t.months.find((m) => m.month === PREV);
  assert.equal(prev.consumedSales, 48000);
  assert.equal(prev.newCount, 2);
  assert.equal(prev.repeatCount, 6);
  assert.equal(prev.purchaseCount, 1);
  assert.equal(prev.contractRatePct, 50);
  assert.ok(!calls.some((u) => u.pathname.endsWith('/marketing/reception-history')));
  const sato = t.staff.find((r) => r.name === '佐藤 美咲');
  assert.equal(sato.values[PREV], 25000);
});

test('売上分析を取れないときは受付履歴から集計し、その旨を知らせる', async () => {
  const base = fakeFetch(calls);
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('/sales/summary')) return new Response(JSON.stringify({ error: { code: 'feature_disabled', error_id: 'f1' } }), { status: 403 });
    return base(input, init);
  };
  const s = await summary.buildSummary(null, { month: PREV, storeId: 'store-1' });
  const w = s.warnings.find((x) => x.code === 'salesSummary');
  assert.ok(w, JSON.stringify(s.warnings));
  assert.match(w.message, /機能が無効/);
  assert.equal(s.stores[0].consumedSales, 29000);
  assert.equal(s.stores[0].newCount, 3);
  const t = await summary.buildTrend(null, { months: 2, endMonth: PREV, storeId: 'store-1' });
  assert.equal(t.months.find((m) => m.month === PREV).consumedSales, 29000);
});

test('当月: 継続管理から会員数・退会率・平均継続期間を出し、月ごとの記録を残す', async () => {
  const s = await summary.buildSummary(null, { month: CURRENT, storeId: 'store-1' });
  const r = s.stores[0].retention;
  assert.equal(r.memberCount, 50);
  assert.equal(r.churnRatePct, 6);
  assert.equal(r.avgTenureMonths, 4);
  assert.equal(r.basis, 'api');
  assert.equal(s.stores[0].retentionIncentive.eligible, true);

  const saved = await db.from('dash_config').select('value').eq('key', provider.RETENTION_KEY).maybeSingle();
  assert.equal(saved.data.value[CURRENT]['101'].memberCount, 50);
  // 店舗を絞ったときは、その店舗の分だけ取りに行く
  assert.ok(calls.every((u) => !u.searchParams.get('shop_id') || u.searchParams.get('shop_id') === '101'));
});

test('スタッフは自分の店舗の分だけ取得し、自分の行だけ見える', async () => {
  const s = await summary.buildSummary(SATO, { month: PREV, storeId: 'all' });
  assert.equal(s.staff.length, 1);
  assert.equal(s.me.metrics.consumedSales, 25000);
  const shopsRequested = new Set(calls.map((u) => u.searchParams.get('shop_id')).filter(Boolean));
  assert.deepEqual([...shopsRequested], ['101']);
});

test('出納帳への取り込み用: 日ごとの現金売上（分割決済は現金の分だけ）', async () => {
  const out = await summary.dailyCashSales(null, { storeId: 'store-1', months: [PREV] });
  assert.equal(out.mode, 'live');
  assert.equal(out.linked, true);
  assert.equal(out.days[`${PREV}-02`], 8000);
  assert.equal(out.days[`${PREV}-03`], 3000);
  assert.equal(out.days[`${PREV}-07`], 0);
  assert.equal(Object.values(out.days).reduce((a, b) => a + b, 0), 17000);
});

test('取り直しに失敗したら前回の値を表示し、その旨を知らせる', async () => {
  await summary.buildSummary(null, { month: CURRENT, storeId: 'store-1' });
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'internal_error', error_id: 'x1' } }), { status: 500 });
  const s = await summary.buildSummary(null, { month: CURRENT, storeId: 'store-1', refresh: true });
  assert.equal(s.stores[0].retention.memberCount, 50);
  const stale = s.warnings.find((w) => w.code === 'stale');
  assert.ok(stale, JSON.stringify(s.warnings));
  assert.match(stale.message, /時点のデータを表示しています/);
  assert.match(stale.message, /SalonOne 側でエラーが発生しました/);
});

test('キーが無効なら、原因がわかるエラーにする', async () => {
  process.env.SALONONE_API_KEY = 'wrong-key';
  await assert.rejects(summary.buildSummary(null, { month: PREV, storeId: 'all' }), (e) => {
    assert.equal(e.name, 'SalonOneError');
    assert.match(e.message, /APIキーが無効です/);
    return true;
  });
});

test('設定画面のマスタ: 削除済みの店舗・スタッフ・流入元は出さない', async () => {
  const m = await summary.buildMaster(null, {});
  assert.deepEqual(m.shops.map((x) => x.name), ['中央店', '駅前店']);
  assert.deepEqual(m.staff.map((x) => x.name), ['佐藤 美咲', '鈴木 健太', '田中 大輔']);
  assert.deepEqual(m.sources, ['ホットペッパー', 'Instagram', '紹介']);
  assert.equal(m.resolved.storeToShop['store-1'], '101');
});
