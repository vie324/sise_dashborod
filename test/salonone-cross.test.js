// 系列店での契約（ドミナント出店）を、疑似 SalonOne と疑似 DB で通しで確かめる。
// 駅前店（102）の 11/9 に、新規のお客様（ホットペッパー）が田中さん（203）のもとで月2回プランを契約した受付を足す。
// 日付は Date.now を差し替えて決める。
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createMockClient } from '../scripts/dev/supabase-mock.mjs';
import { fakeFetch, FAKE_KEY } from '../scripts/dev/salonone-fake.mjs';

let summary;
let provider;
let cross;
let handler;
let dbHandler;
let calls = [];
const realNow = Date.now;
const at = (iso) => { Date.now = () => Date.parse(iso); };

const SATO = { valid: true, staffId: 'st-sato', role: 'staff', storeIds: ['store-1'], name: '佐藤' };
const TANAKA = { valid: true, staffId: 'st-tanaka', role: 'staff', storeIds: ['store-2'], name: '田中' };
const MANAGER = { valid: true, staffId: 'st-takahashi', role: 'manager', storeIds: ['store-1'], name: '高橋' };

const CONTRACT_DATE = '2026-11-09';
const contractRow = {
  appointment_id: 770001, shop_id: 102, customer_id: 7777, customer_number: 'K7777', reserved_at: `${CONTRACT_DATE}T14:00:00+09:00`,
  status: 'completed', cancel_type: null, staff_id: 203, staff_name: '田中 大輔', visit_source_id: 1, visit_source_name: 'ホットペッパー',
  classification: 'new', joined: true, plans: [{ plan_name: '月2回プラン', plan_kind: 'subscription', amount: 15000, total_sessions: null }],
  amount: 18000, consumed_amount: 3000, payment_method_name: 'クレジットカード', payment_splits: [],
};

/** 駅前店の受付履歴（月・日の取得とも）に 11/9 の契約を足す */
function withCrossContract(base) {
  return async (input, init) => {
    const url = new URL(String(input));
    const res = await base(input, init);
    if (!res.ok || !url.pathname.endsWith('/marketing/reception-history') || url.searchParams.get('shop_id') !== '102' || url.searchParams.get('cursor')) return res;
    const body = await res.json();
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    if (from <= CONTRACT_DATE && CONTRACT_DATE <= to) body.data.push(contractRow);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

before(async () => {
  process.env.SALONONE_API_KEY = FAKE_KEY;
  process.env.SALONONE_API_BASE_URL = 'http://fake.salonone.test/api/analytics/v1';
  process.env.SALONONE_RATE_LIMIT_PER_MINUTE = '100000';
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sise-cross-')), 'db.json');
  const db = createMockClient(file);
  globalThis.__SISE_SUPABASE_MOCK__ = db;
  await db.from('dash_config').upsert([
    { key: 'salonone.shopMap', value: { 'store-1': '101', 'store-2': '102' } },
    { key: 'salonone.staffMap', value: { 'st-sato': '201', 'st-suzuki': '202', 'st-tanaka': '203' } },
  ], { onConflict: 'key' });
  summary = await import('../api/_lib/salonone/summary.js');
  provider = await import('../api/_lib/salonone/provider.js');
  cross = await import('../api/_lib/salonone/cross-handlers.js');
  handler = (await import('../api/salonone/index.js')).default;
  dbHandler = (await import('../api/db/index.js')).default;
});

beforeEach(() => {
  calls = [];
  globalThis.fetch = withCrossContract(fakeFetch(calls));
  provider.clearSalonOneCache();
});

after(() => { Date.now = realNow; });

async function call({ method = 'GET', query = {}, body } = {}, h = handler) {
  const res = { code: 200, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  await h({ method, query, headers: {}, body }, res);
  return res;
}

const input = (o = {}) => ({
  date: CONTRACT_DATE, customerName: '山本 さくら', planName: '月2回プラン', contractStoreId: 'store-2', creditKey: '201', memo: '中央店で初回', ...o,
});

test('店長が登録すると、初回の店舗のスタッフに 2,000円。結びつけた契約は契約した店舗の新規契約に数えない', async () => {
  at('2026-11-20T12:00:00+09:00');
  // 契約した店舗・日の SalonOne の契約を選ぶ（担当店舗ではないので、お客様の名前は返さない）
  const cand = await cross.crossStoreCandidates(MANAGER, { storeId: 'store-2', date: CONTRACT_DATE });
  assert.equal(cand.linked, true);
  const item = cand.items.find((i) => i.plans.includes('月2回プラン'));
  assert.ok(item, JSON.stringify(cand));
  assert.equal(item.staffName, '田中 大輔');
  assert.equal(item.time, '14:00');
  assert.equal(item.customerName, null);
  assert.equal(item.registered, false);
  assert.ok(!JSON.stringify(cand).includes('"7777"') && !('customerId' in item), 'SalonOne の顧客 ID は返さない');

  const before = await summary.buildSummary(null, { month: '2026-11', storeId: 'all' });
  const satoBefore = before.staff.find((r) => r.key === '201');
  assert.equal(before.staff.find((r) => r.key === '203').metrics.newContracts.hotpepper, 1);

  const added = await cross.addCrossStore(MANAGER, input({ receptionId: item.receptionId }), '高橋');
  assert.equal(added.success, true);
  assert.deepEqual(added.entry.link, { staffName: '田中 大輔', time: '14:00' });
  assert.equal(added.entry.creditStoreName, '中央店');
  assert.equal(added.entry.contractStoreName, '駅前店');

  provider.clearSalonOneCache();
  const after = await summary.buildSummary(null, { month: '2026-11', storeId: 'all' });
  const sato = after.staff.find((r) => r.key === '201');
  assert.equal(sato.incentive.items.find((i) => i.key === 'crossStore').amount, 2000);
  assert.equal(sato.incentive.total - satoBefore.incentive.total, 2000);
  assert.equal(sato.period.months[0].items.crossStore, 2000);
  assert.equal(sato.period.months[0].basis.crossStoreContracts, 1);
  assert.deepEqual(sato.crossStore.map((e) => [e.date, e.customerName, e.planName, e.contractStoreName]), [[CONTRACT_DATE, '山本 さくら', '月2回プラン', '駅前店']]);
  // 契約した店舗の担当の新規契約からは除く（来店はそのまま）
  const tanaka = after.staff.find((r) => r.key === '203');
  assert.equal(tanaka.metrics.newContracts.hotpepper, 0);
  assert.equal(tanaka.metrics.newVisits.hotpepper, 1);
  assert.deepEqual(after.cross, { count: 1, unlinked: 0 });
  // 12月を開いても、支給期間の合計に 11月の 2,000円が入る
  const dec = await summary.buildSummary(null, { month: '2026-12', storeId: 'all' });
  assert.equal(dec.staff.find((r) => r.key === '201').period.months[0].items.crossStore, 2000);

  // 同じ契約は 2回登録できない。候補にも「登録済み」と出る
  await assert.rejects(cross.addCrossStore(MANAGER, input({ receptionId: item.receptionId }), '高橋'), (e) => e.status === 409);
  const again = await cross.crossStoreCandidates(null, { storeId: 'store-2', date: CONTRACT_DATE });
  assert.equal(again.items.find((i) => i.receptionId === item.receptionId).registered, true);
});

test('見える範囲と登録できる人: スタッフは自分の分を見るだけ、店長は担当店舗のスタッフの分だけ', async () => {
  at('2026-11-20T12:00:00+09:00');
  const mine = await cross.listCrossStore(SATO, { month: '2026-11' });
  assert.deepEqual(mine.items.map((e) => e.customerName), ['山本 さくら']);
  assert.equal(mine.canEdit, false);
  assert.equal(mine.items[0].editable, false);
  assert.deepEqual(mine.creditOptions, []);
  assert.deepEqual(mine.stores, []);
  assert.deepEqual((await cross.listCrossStore(TANAKA, { month: '2026-11' })).items, []);
  await assert.rejects(cross.addCrossStore(SATO, input({ date: '2026-11-10' })), (e) => e.status === 403);
  await assert.rejects(cross.crossStoreCandidates(SATO, { storeId: 'store-2', date: CONTRACT_DATE }), (e) => e.status === 403);

  // 店長: 担当店舗のスタッフにだけ付けられる・初回と同じ店舗の契約は対象外・今日より後の日付や空欄は不可
  await assert.rejects(cross.addCrossStore(MANAGER, input({ creditKey: '203', contractStoreId: 'store-1' })), (e) => e.status === 403);
  await assert.rejects(cross.addCrossStore(MANAGER, input({ contractStoreId: 'store-1' })), (e) => e.status === 400 && /同じ店舗/.test(e.message));
  await assert.rejects(cross.addCrossStore(MANAGER, input({ date: '2026-11-21' })), (e) => e.status === 400);
  await assert.rejects(cross.addCrossStore(MANAGER, input({ customerName: ' ' })), (e) => e.status === 400);
  await assert.rejects(cross.addCrossStore(MANAGER, input({ planName: '' })), (e) => e.status === 400);
  await assert.rejects(cross.addCrossStore(MANAGER, input({ receptionId: '999999' })), (e) => e.status === 400 && /見つかりません/.test(e.message));
  const listed = await cross.listCrossStore(MANAGER, { month: '2026-11' });
  assert.equal(listed.canEdit, true);
  assert.deepEqual(listed.creditOptions.map((o) => o.key).sort(), ['201', '202']);
  assert.deepEqual(listed.stores.map((s) => s.id), ['store-1', 'store-2']);

  // SalonOne の契約と結びつけない登録もできる（契約した店舗の契約数は減らさない）
  const free = await cross.addCrossStore(null, input({ date: '2026-11-10', customerName: '木村 花', planName: '回数券 6回', creditKey: '202' }), '管理者');
  assert.equal(free.entry.link, null);
  const s = await summary.buildSummary(null, { month: '2026-11', storeId: 'all' });
  assert.deepEqual(s.cross, { count: 2, unlinked: 1 });
  assert.equal(s.staff.find((r) => r.key === '202').incentive.items.find((i) => i.key === 'crossStore').amount, 2000);

  // 削除（店長は担当店舗のスタッフの分）。消した記録は残す
  const del = await cross.deleteCrossStore(MANAGER, { id: free.entry.id, month: '2026-11' }, '高橋');
  assert.equal(del.success, true);
  await assert.rejects(cross.deleteCrossStore(MANAGER, { id: free.entry.id, month: '2026-11' }), (e) => e.status === 404);
  assert.deepEqual((await summary.buildSummary(null, { month: '2026-11', storeId: 'all' })).cross, { count: 1, unlinked: 0 });
});

test('API: 一覧・候補は GET、登録・削除は POST。確定済みの支給期間は登録・削除できない', async () => {
  at('2026-11-25T12:00:00+09:00');
  assert.equal((await call({ query: { action: 'crossAdd' } })).code, 405);
  const list = await call({ query: { action: 'cross', month: '2026-11' } });
  assert.equal(list.code, 200, JSON.stringify(list.body));
  assert.equal(list.body.items.length, 1);
  const cand = await call({ query: { action: 'crossCandidates', storeId: 'store-2', date: CONTRACT_DATE } });
  assert.equal(cand.code, 200);
  assert.equal(cand.body.items.length, 1);
  const bad = await call({ query: { action: 'crossCandidates', storeId: 'store-2', date: '2026-13-01' } });
  assert.equal(bad.code, 400);
  const add = await call({ method: 'POST', query: { action: 'crossAdd' }, body: input({ date: '2026-11-24', customerName: '森 さやか', creditKey: '202' }) });
  assert.equal(add.code, 200, JSON.stringify(add.body));
  const del = await call({ method: 'POST', query: { action: 'crossDelete' }, body: { id: add.body.entry.id, month: '2026-11' } });
  assert.equal(del.body.success, true);
  // お客様名を含む記録は一般の設定（dashConfig）からは読めない・書けない
  assert.ok((await call({ query: { table: 'dashConfig', key: 'incentive.cross.2026-11' } }, dbHandler)).body.error);
  assert.ok((await call({ method: 'POST', query: { table: 'dashConfig' }, body: { action: 'set', key: 'incentive.cross.2026-11', value: {} } }, dbHandler)).body.error);
  const all = await call({ query: { table: 'dashConfig' } }, dbHandler);
  assert.ok(!JSON.stringify(all.body).includes('山本 さくら'));

  // 確定した後は登録・削除できない（取り消してから）。結びついていない登録があれば確定の前に確認する
  at('2027-01-05T12:00:00+09:00');
  await cross.addCrossStore(null, input({ date: '2026-12-01', customerName: '松本 結衣', creditKey: '202' }), '管理者');
  const first = await summary.closePeriod(null, { month: '2026-12', operator: 'オーナー' });
  assert.equal(first.needsConfirm, true);
  assert.ok(first.issues.some((i) => i.code === 'crossUnlinked' && /1件/.test(i.message)), JSON.stringify(first.issues));
  const closed = await summary.closePeriod(null, { month: '2026-12', operator: 'オーナー', accept: first.issues.map((i) => i.code) });
  assert.equal(closed.success, true, JSON.stringify(closed));
  assert.equal(closed.close.staff.find((r) => r.key === '201').months[0].items.crossStore, 2000);
  await assert.rejects(cross.addCrossStore(null, input({ date: '2026-12-02', customerName: '追加 さん', creditKey: '202' })), (e) => e.status === 409);
  const listDec = await cross.listCrossStore(null, { month: '2026-12' });
  assert.equal(listDec.closed, true);
  await assert.rejects(cross.deleteCrossStore(null, { id: listDec.items[0].id, month: '2026-12' }), (e) => e.status === 409);
  await summary.reopenPeriod(null, { month: '2026-12' });
  assert.equal((await cross.deleteCrossStore(null, { id: listDec.items[0].id, month: '2026-12' }, 'オーナー')).success, true);
});
