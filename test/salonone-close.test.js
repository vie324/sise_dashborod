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

test('毎日の継続指標の記録（Cron）: 1店舗も記録できなければ 502、手で動かすのは続けてできない', async () => {
  at('2026-11-29T23:30:00+09:00');
  process.env.CRON_SECRET = 'cron-secret-for-test';
  const base = fakeFetch(calls);
  globalThis.fetch = async (input, init) => (String(input).includes('/marketing/retention')
    ? new Response(JSON.stringify({ error: { code: 'internal_error', message: 'down' } }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    : base(input, init));
  const res = await call(salononeHandler, { query: { action: 'cron' }, headers: { authorization: 'Bearer cron-secret-for-test' } });
  assert.equal(res.code, 502, JSON.stringify(res.body));
  assert.equal(res.body.saved, 0);
  assert.equal(res.body.failed.length, 2);
  const saved = await db.from('dash_config').select('value').eq('key', provider.RETENTION_KEY).maybeSingle();
  assert.ok(!saved.data || !saved.data.value['2026-11'] || saved.data.value['2026-11']['101'].asOf !== '2026-11-29', '失敗した日は記録しない');

  // 管理者が手で動かす（Cron の鍵なし）: 続けては動かせない
  globalThis.fetch = base;
  provider.clearSalonOneCache();
  const manual = await call(salononeHandler, { query: { action: 'cron' } });
  assert.equal(manual.code, 200, JSON.stringify(manual.body));
  assert.equal(manual.body.saved, 2);
  const again = await call(salononeHandler, { query: { action: 'cron' } });
  assert.equal(again.code, 429);
});

/**
 * 支給期間（2026年11〜12月）に次のスタッフ・店舗を足す:
 *   205 退職 さくら … スタッフ一覧に無い（辞めた）。11月だけ中央店（101）で 600,000円・1回
 *   206 ヘルプ 花子 … SalonOne の所属店舗 103 はダッシュボードと未連携。11月は中央店、12月は駅前店（102）で施術
 *   207 休職 ゆり   … 中央店の所属。施術なし
 *   104 新店舗     … ダッシュボードの店舗と未連携。11月に売上がある
 */
function withPeriodStaff(base) {
  const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  return async (input, init = {}) => {
    const url = new URL(String(input));
    const p = url.pathname;
    const month = (url.searchParams.get('from') || '').slice(0, 7);
    const shop = url.searchParams.get('shop_id');
    if (shop === '104') {
      calls.push(url);
      if (p.endsWith('/sales/summary')) {
        return ok({ data: { consumed_sales: month === '2026-11' ? 50000 : 0, digest_sales: 0, treatment_count: month === '2026-11' ? 5 : 0, by_day: [], by_staff: [] } });
      }
      return ok({ data: [], meta: { has_more: false } });
    }
    const res = await base(input, init);
    if (!res.ok) return res;
    const body = await res.json();
    if (p.endsWith('/shops') && !url.searchParams.get('cursor')) body.data.push({ id: 104, brand_id: 11, name: '新店舗', deleted_at: null });
    if (p.endsWith('/staffs') && !url.searchParams.get('cursor')) {
      body.data.push({ id: 206, brand_id: 11, shop_id: 103, name: 'ヘルプ 花子', deleted_at: null }, { id: 207, brand_id: 11, shop_id: 101, name: '休職 ゆり', deleted_at: null });
    }
    if (p.endsWith('/sales/summary')) {
      const extra = (id, name, consumed) => ({ staff_id: id, staff_name: name, consumed_sales: consumed, digest_sales: consumed, new_visit_count: 0, repeat_visit_count: 1, customer_count: 1, treatment_count: 1, purchase_count: 0 });
      if (month === '2026-11' && shop === '101') body.data.by_staff.push(extra(205, '退職 さくら', 600000), extra(206, 'ヘルプ 花子', 300000));
      if (month === '2026-12' && shop === '102') body.data.by_staff.push(extra(206, 'ヘルプ 花子', 300000));
    }
    return ok(body);
  };
}

test('支給期間の途中で辞めた人・所属店舗が未連携の人: どちらの月を開いても期間の金額が同じで、確定にも入る', async () => {
  at('2027-01-05T12:00:00+09:00');
  globalThis.fetch = withPeriodStaff(fakeFetch(calls));
  await summary.reopenPeriod(null, { month: '2026-11' });
  // 中央店は継続率の条件を満たし、駅前店は満たさない。12月の中央店は月末より前の記録しか無い
  const snap = (asOf, good) => ({ memberCount: good ? 60 : 12, membersAtStart: good ? 60 : 12, churnCount: good ? 1 : 0, churnRatePct: good ? 1.6 : 0, avgTenureMonths: good ? 5 : 2, asOf });
  await db.from('dash_config').upsert({
    key: provider.RETENTION_KEY,
    value: {
      '2026-11': { 101: snap('2026-11-30', true), 102: snap('2026-11-30', false) },
      '2026-12': { 101: snap('2026-12-28', true), 102: snap('2026-12-31', false) },
    },
  }, { onConflict: 'key' });

  const nov = await summary.buildSummary(null, { month: '2026-11', storeId: 'all' });
  const dec = await summary.buildSummary(null, { month: '2026-12', storeId: 'all' });
  const row = (s, key) => s.staff.find((r) => r.key === key);
  const months = (s, key) => row(s, key).period.months.map((m) => [m.month, m.total]);
  // 205: 11月だけ（ランク1 5,000円 + 継続率 5,000円）。12月はスタッフ一覧に無く施術も無いので継続率も無し
  assert.deepEqual(months(nov, '205'), [['2026-11', 10000], ['2026-12', 0]]);
  assert.deepEqual(months(dec, '205'), months(nov, '205'));
  assert.equal(row(dec, '205').storeId, 'store-1');
  // 売上分析のスタッフ別には、実績のある月だけ出す
  assert.ok(nov.staffInScope.some((r) => r.key === '205'));
  assert.ok(!dec.staffInScope.some((r) => r.key === '205'));
  assert.ok(dec.staffInScope.some((r) => r.key === '207'), 'スタッフ一覧にいる人は実績が無くても出す（従来どおり）');
  // 206: 継続率は月ごとに施術した店舗で見る（11月 中央店 5,000円・12月 駅前店 0円）。一覧は最後に施術した駅前店
  assert.deepEqual(months(nov, '206'), [['2026-11', 5000], ['2026-12', 0]]);
  assert.deepEqual(months(dec, '206'), months(nov, '206'));
  assert.equal(row(nov, '206').storeId, 'store-2');
  assert.equal(row(dec, '206').storeId, 'store-2');
  // 207: 施術は無いが中央店の所属なので継続率インセンティブ（確定の前に確認を求める）
  assert.deepEqual(months(dec, '207'), [['2026-11', 5000], ['2026-12', 5000]]);
  // 対応付いていない店舗の実績は、管理者に知らせる
  assert.ok(dec.warnings.some((w) => w.code === 'unmappedShop' && w.message.includes('新店舗')), JSON.stringify(dec.warnings));
  assert.ok(!(await summary.buildSummary(MANAGER, { month: '2026-12', storeId: 'store-1' })).warnings.some((w) => w.code === 'unmappedShop'));

  // 確定の前の確認: 月末の記録ではない継続指標・施術の無い月の継続率・未連携の店舗
  const first = await summary.closePeriod(null, { month: '2026-12', operator: 'オーナー' });
  assert.equal(first.needsConfirm, true);
  const issue = (code) => first.issues.find((i) => i.code === code);
  assert.match(issue('retentionNotMonthEnd').message, /12月（中央店: 12\/28時点）/);
  assert.match(issue('retentionIdle').message, /休職 ゆり/);
  assert.ok(!issue('retentionIdle').message.includes('退職 さくら'));
  assert.ok(issue('unmappedShop'));
  assert.equal(issue('retentionMissing'), undefined, '辞めた人の対象外の月を「記録なし」にしない');
  const closed = await summary.closePeriod(null, { month: '2026-12', operator: 'オーナー', accept: first.issues.map((i) => i.code) });
  assert.equal(closed.success, true, JSON.stringify(closed));
  const rec = (key) => closed.close.staff.find((r) => r.key === key);
  assert.equal(rec('205').total, 10000);
  assert.deepEqual(rec('205').months.map((m) => m.basis.retentionShopId), ['101', null]);
  assert.equal(rec('206').total, 5000);
  assert.deepEqual(rec('206').months.map((m) => [m.basis.retentionShopId, m.basis.retentionAsOf, m.basis.treatmentCount]), [['101', '2026-11-30', 1], ['102', '2026-12-31', 1]]);

  // 店長（中央店）には中央店のスタッフの確定分だけ。スタッフ本人にはメモを返さない
  const manager = await summary.buildSummary(MANAGER, { month: '2026-11', storeId: 'store-1' });
  assert.deepEqual(manager.close.staff.map((r) => r.key).sort(), ['201', '202', '205', '207']);
  assert.ok(manager.staff.every((r) => r.closed), '一覧のスタッフはすべて確定の記録がある');
  const owner1 = await summary.buildSummary(null, { month: '2026-11', storeId: 'store-1' });
  assert.deepEqual(owner1.close.staff.map((r) => r.key).sort(), ['201', '202', '205', '207']);
  assert.equal(owner1.close.total, owner1.close.staff.reduce((a, r) => a + r.total, 0));
  await summary.reopenPeriod(null, { month: '2026-11' });
  await summary.closePeriod(null, { month: '2026-12', note: '1月支給', force: true });
  assert.equal((await summary.buildSummary(SATO, { month: '2026-12', storeId: 'all' })).close.note, '');
  assert.equal((await summary.buildSummary(MANAGER, { month: '2026-12', storeId: 'store-1' })).close.note, '1月支給');
  await summary.reopenPeriod(null, { month: '2026-11' });
});

test('他の店舗は売上分析だけを取り、表示中の店舗のスタッフが施術していた時だけ受付履歴も取る', async () => {
  at('2027-01-05T12:00:00+09:00');
  const shopsOf = (suffix) => [...new Set(calls.filter((u) => u.pathname.endsWith(suffix)).map((u) => u.searchParams.get('shop_id')))].sort();
  // スタッフ本人（中央店）: 駅前店に佐藤さんの実績は無いので、駅前店は売上分析だけ
  await summary.buildSummary(SATO, { month: '2026-12', storeId: 'all' });
  assert.deepEqual(shopsOf('/sales/summary'), ['101', '102']);
  assert.deepEqual(shopsOf('/marketing/reception-history'), ['101']);

  // 中央店の店長: 12月に 206（所属店舗が未連携）が駅前店で施術しているので、駅前店の受付履歴も取る
  calls.length = 0;
  provider.clearSalonOneCache();
  globalThis.fetch = withPeriodStaff(fakeFetch(calls));
  await summary.buildSummary(MANAGER, { month: '2026-12', storeId: 'store-1' });
  assert.deepEqual(shopsOf('/marketing/reception-history'), ['101', '102']);
  assert.ok(!shopsOf('/marketing/reception-history').includes('104'), '実績のあるスタッフがいない店舗は取らない');
});

test('確定の取り直し: 10分以内に取得した分はそのまま使い、取り直せなかった分は確認の後にもう一度取りに行く', async () => {
  at('2027-01-05T12:00:00+09:00');
  await summary.reopenPeriod(null, { month: '2026-11' });
  await summary.buildSummary(null, { month: '2026-12', storeId: 'all' }); // 画面を開いた
  const nov101 = (u) => u.pathname.endsWith('/sales/summary') && u.searchParams.get('shop_id') === '101' && u.searchParams.get('from') === '2026-11-01';

  // 5分後に確定: 画面を開いた時のデータを使う（SalonOne は呼ばない）。12月の中央店の継続指標が月末の記録ではないので確認を求める
  calls.length = 0;
  at('2027-01-05T12:05:00+09:00');
  const first = await summary.closePeriod(null, { month: '2026-12', operator: 'オーナー' });
  assert.equal(first.needsConfirm, true);
  assert.equal(calls.length, 0, JSON.stringify(calls.map((u) => u.pathname)));

  // 20分後: 取り直す。11月の中央店の売上分析だけ取り直せず、前回の値で計算する → もう一度確認を求める
  at('2027-01-05T12:20:00+09:00');
  const base = fakeFetch(calls);
  let fail = true;
  globalThis.fetch = async (input, init) => (fail && nov101(new URL(String(input)))
    ? new Response(JSON.stringify({ error: { code: 'internal_error' } }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    : base(input, init));
  const again = await summary.closePeriod(null, { month: '2026-12', operator: 'オーナー', accept: first.issues.map((i) => i.code) });
  assert.equal(again.needsConfirm, true);
  assert.ok(again.issues.some((i) => i.code === 'stale'), JSON.stringify(again.issues));
  assert.ok(calls.filter((u) => u.pathname.endsWith('/sales/summary')).length > 1, '20分前のデータは取り直す');

  // 確認の後の確定: 取り直せなかった分だけ取りに行く（今度は取れたので、そのまま確定できる）
  fail = false;
  calls.length = 0;
  const done = await summary.closePeriod(null, { month: '2026-12', operator: 'オーナー', accept: again.issues.map((i) => i.code) });
  assert.equal(done.success, true, JSON.stringify(done));
  assert.deepEqual(calls.map((u) => u.pathname.replace(/^.*\/v1/, '')), ['/sales/summary']);
  assert.ok(nov101(calls[0]));
  await summary.reopenPeriod(null, { month: '2026-11' });
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
