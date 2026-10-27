// インセンティブの確定・毎日の継続指標の記録（Cron）・出納帳用の現金売上 API を、
// 疑似 SalonOne と疑似 DB で通しで確かめる。日付は Date.now を差し替えて決める。
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createMockClient } from '../scripts/dev/supabase-mock.mjs';
import { fakeFetch, FAKE_KEY } from '../scripts/dev/salonone-fake.mjs';

let summary;
let provider;
let salononeHandler;
let dbHandler;
let db;
let calls = [];
const realNow = Date.now;
const at = (iso) => { Date.now = () => Date.parse(iso); };

const SATO = { valid: true, staffId: 'st-sato', role: 'staff', storeIds: ['store-1'], name: '佐藤' };
const TANAKA = { valid: true, staffId: 'st-tanaka', role: 'staff', storeIds: ['store-2'], name: '田中' };
const MANAGER = { valid: true, staffId: 'st-takahashi', role: 'manager', storeIds: ['store-1'], name: '高橋' };

before(async () => {
  process.env.SALONONE_API_KEY = FAKE_KEY;
  process.env.SALONONE_API_BASE_URL = 'http://fake.salonone.test/api/analytics/v1';
  process.env.SALONONE_RATE_LIMIT_PER_MINUTE = '100000';
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sise-close-')), 'db.json');
  db = createMockClient(file);
  globalThis.__SISE_SUPABASE_MOCK__ = db;
  await db.from('dash_config').upsert([
    { key: 'salonone.shopMap', value: { 'store-1': '101', 'store-2': '102' } },
    { key: 'salonone.staffMap', value: { 'st-sato': '201', 'st-suzuki': '202', 'st-tanaka': '203' } },
  ], { onConflict: 'key' });
  summary = await import('../api/_lib/salonone/summary.js');
  provider = await import('../api/_lib/salonone/provider.js');
  salononeHandler = (await import('../api/salonone/index.js')).default;
  dbHandler = (await import('../api/db/index.js')).default;
});

beforeEach(() => {
  calls = [];
  globalThis.fetch = fakeFetch(calls);
  provider.clearSalonOneCache();
  delete process.env.CRON_SECRET;
});

after(() => { Date.now = realNow; });

async function call(handler, { method = 'GET', query = {}, headers = {}, body } = {}) {
  const res = { code: 200, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  await handler({ method, query, headers, body }, res);
  return res;
}

test('支給期間の確定: 期間が終わってから・確認事項があれば確かめてから保存し、見られる範囲だけ返す', async () => {
  // 12月中は 11〜12月の期間を確定できない
  at('2026-12-20T12:00:00+09:00');
  await assert.rejects(summary.closePeriod(null, { month: '2026-11', operator: 'オーナー' }), (e) => e.status === 400 && /終わってから/.test(e.message));
  await assert.rejects(summary.closePeriod(null, { month: '2026-10' }), (e) => e.status === 400 && /制度開始前/.test(e.message));
  await assert.rejects(summary.closePeriod(SATO, { month: '2026-11' }), (e) => e.status === 403);

  at('2027-01-05T12:00:00+09:00');
  // 11月・12月の継続指標の記録が無いので、先に確認を求める（保存しない）
  const first = await summary.closePeriod(null, { month: '2026-11', operator: 'オーナー' });
  assert.equal(first.needsConfirm, true);
  assert.ok(first.issues.some((i) => i.code === 'retentionMissing'), JSON.stringify(first.issues));
  assert.equal((await summary.buildSummary(null, { month: '2026-11', storeId: 'all' })).close, null);

  // 確認したものとは別の確認事項があれば、もう一度確認を求める
  const other = await summary.closePeriod(null, { month: '2026-12', operator: 'オーナー', accept: ['stale'] });
  assert.equal(other.needsConfirm, true);
  const closed = await summary.closePeriod(null, { month: '2026-12', operator: 'オーナー', note: '1月支給分', accept: first.issues.map((i) => i.code) });
  assert.equal(closed.success, true);
  assert.equal(closed.close.label, '2026年11月〜12月');
  assert.equal(closed.close.closedBy, 'オーナー');
  const sato = closed.close.staff.find((r) => r.key === '201');
  // 疑似 SalonOne は毎月同じ数字: 佐藤さんは 25,000円（ランク外）・紹介はサブスクではない → 0円
  assert.deepEqual(sato.months.map((m) => [m.month, m.total, m.basis.consumedSales]), [['2026-11', 0, 25000], ['2026-12', 0, 25000]]);
  assert.equal(closed.close.total, closed.close.staff.reduce((a, r) => a + r.total, 0));

  // 確定した後は、どちらの月を開いても確定の情報が付く
  const nov = await summary.buildSummary(null, { month: '2026-11', storeId: 'all' });
  assert.equal(nov.close.closedBy, 'オーナー');
  assert.equal(nov.close.note, '1月支給分');
  assert.equal(nov.staff.find((r) => r.key === '201').closed.total, 0);

  // スタッフには自分の分だけ、店長には担当店舗のスタッフだけ
  const mine = await summary.buildSummary(SATO, { month: '2026-12', storeId: 'all' });
  assert.deepEqual(mine.close.staff.map((r) => r.key), ['201']);
  assert.equal(mine.me.closed.key, '201');
  const tanaka = await summary.buildSummary(TANAKA, { month: '2026-12', storeId: 'all' });
  assert.deepEqual(tanaka.close.staff.map((r) => r.key), ['203']);
  const manager = await summary.buildSummary(MANAGER, { month: '2026-12', storeId: 'store-1' });
  assert.deepEqual(manager.close.staff.map((r) => r.key).sort(), ['201', '202']);

  // 確定の記録は一般の設定（dashConfig）からは読めず、書き換えもできない
  const all = await call(dbHandler, { query: { table: 'dashConfig' } });
  assert.equal(Object.keys(all.body.config).some((k) => k.startsWith('incentive.')), false);
  const one = await call(dbHandler, { query: { table: 'dashConfig', key: 'incentive.close.2026-11' } });
  assert.ok(one.body.error);
  const set = await call(dbHandler, { method: 'POST', query: { table: 'dashConfig' }, body: { action: 'set', key: 'incentive.close.2026-11', value: {} } });
  assert.ok(set.body.error);

  // 取り消すと見込みに戻り、記録は履歴に残る
  const reopened = await summary.reopenPeriod(null, { month: '2026-11', operator: 'オーナー' });
  assert.equal(reopened.reopened, true);
  assert.equal((await summary.buildSummary(null, { month: '2026-11', storeId: 'all' })).close, null);
  const saved = await db.from('dash_config').select('value').eq('key', 'incentive.close.2026-11').maybeSingle();
  assert.equal(saved.data.value.current, null);
  assert.equal(saved.data.value.history[0].reopenedBy, 'オーナー');
});

test('確定の API: オーナー・管理者だけが POST で使える', async () => {
  at('2027-01-05T12:00:00+09:00');
  const get = await call(salononeHandler, { query: { action: 'closePeriod' } });
  assert.equal(get.code, 405);
  const ok = await call(salononeHandler, { method: 'POST', query: { action: 'closePeriod' }, body: { month: '2026-11', operator: '管理者', force: true } });
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.success, true);
  const reopen = await call(salononeHandler, { method: 'POST', query: { action: 'reopenPeriod' }, body: { month: '2026-11' } });
  assert.equal(reopen.body.reopened, true);
});

test('毎日の継続指標の記録（Cron）: CRON_SECRET で呼べて、全店舗の当月の値を残す', async () => {
  at('2026-11-30T23:30:00+09:00');
  process.env.CRON_SECRET = 'cron-secret-for-test';
  const res = await call(salononeHandler, { query: { action: 'cron' }, headers: { authorization: 'Bearer cron-secret-for-test' } });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.month, '2026-11');
  assert.equal(res.body.saved, 2);
  const saved = await db.from('dash_config').select('value').eq('key', provider.RETENTION_KEY).maybeSingle();
  assert.equal(saved.data.value['2026-11']['101'].memberCount, 50);
  assert.equal(saved.data.value['2026-11']['102'].memberCount, 12);
  assert.equal(saved.data.value['2026-11']['101'].asOf, '2026-11-30');

  // 月が替わった後、前の月は月末の記録で継続率インセンティブを判定する
  at('2026-12-05T10:00:00+09:00');
  provider.clearSalonOneCache();
  const nov = await summary.buildSummary(null, { month: '2026-11', storeId: 'store-1' });
  assert.equal(nov.stores[0].retention.asOf, '2026-11-30');
  assert.equal(nov.stores[0].retentionIncentive.eligible, true);
  assert.equal(nov.staff.find((r) => r.key === '201').incentive.items.find((i) => i.key === 'retention').amount, 5000);
});

test('出納帳用の現金売上: 受付履歴だけを取り、日ごとの現金を返す', async () => {
  at('2026-11-30T20:00:00+09:00');
  const res = await call(salononeHandler, { query: { action: 'cash', storeId: 'store-1', month: '2026-11' } });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.linked, true);
  assert.deepEqual(res.body.days, [{ date: '2026-11-02', cashSales: 8000 }, { date: '2026-11-03', cashSales: 3000 }, { date: '2026-11-04', cashSales: 3000 }, { date: '2026-11-06', cashSales: 0 }, { date: '2026-11-07', cashSales: 0 }, { date: '2026-11-08', cashSales: 3000 }]);
  assert.ok(!calls.some((u) => u.pathname.endsWith('/sales/summary') || u.pathname.includes('retention')), '売上サマリ・継続管理は取らない');
  assert.ok(calls.filter((u) => u.pathname.endsWith('/marketing/reception-history')).every((u) => u.searchParams.get('shop_id') === '101'));
  // スタッフは所属店舗だけ。店舗を選ばない取得はできない
  await assert.rejects(summary.dailyCashSales(SATO, { storeId: 'store-2', months: ['2026-11'] }), (e) => e.status === 403);
  await assert.rejects(summary.dailyCashSales(SATO, { storeId: 'all', months: ['2026-11'] }), (e) => e.status === 400);
  assert.equal((await summary.dailyCashSales(SATO, { storeId: 'store-1', months: ['2026-11'] })).days['2026-11-02'], 8000);
});
