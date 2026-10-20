// カウンセリング（新規のお客様）: おすすめプラン・料金の計算と、SalonOne の「本日のお客様」。
// SalonOne は scripts/dev/salonone-fake.mjs の疑似 SalonOne（1日だけの取得はその日の予約のサンプルを返す）で置き換える。
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createMockClient } from '../scripts/dev/supabase-mock.mjs';
import { fakeFetch, FAKE_KEY, FAKE_PII_KEY } from '../scripts/dev/salonone-fake.mjs';
import {
  recommendPlans, PLAN_CATALOG, PLAN_CARDS, planByKey, planPricing, visitInterval, concernsByCategory,
} from '../shared/counseling.js';
import { toJstTime } from '../shared/dates.js';
import { normalizeVisit } from '../api/_lib/salonone/normalize.js';
import { demoVisits } from '../api/_lib/salonone/demo.js';

const DAY = '2026-10-20';
const ctx = (staffId, role, storeIds) => ({ valid: true, staffId, role, storeIds, name: staffId });
const SATO = ctx('st-sato', 'staff', ['store-1']);
const TANAKA = ctx('st-tanaka', 'staff', ['store-2']);
const OWNER = ctx('st-owner', 'owner', []);

let db;
let visits;
let provider;
let salonOneHandler;
let dbHandler;
let calls = [];

before(async () => {
  process.env.SALONONE_API_KEY = FAKE_KEY;
  process.env.SALONONE_API_BASE_URL = 'http://fake.salonone.test/api/analytics/v1';
  process.env.SALONONE_RATE_LIMIT_PER_MINUTE = '100000';
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sise-counseling-')), 'db.json');
  db = createMockClient(file);
  globalThis.__SISE_SUPABASE_MOCK__ = db;
  const now = new Date().toISOString();
  await db.from('stores').insert([{ id: 'store-3', name: '未連携店', status: 'active', memo: '', merged_into: null, created_at: now }]);
  await db.from('dash_config').upsert([{ key: 'salonone.shopMap', value: { 'store-1': '101', 'store-2': '102' } }], { onConflict: 'key' });
  visits = await import('../api/_lib/salonone/visits.js');
  provider = await import('../api/_lib/salonone/provider.js');
  salonOneHandler = (await import('../api/salonone/index.js')).default;
  dbHandler = (await import('../api/db/index.js')).default;
});

beforeEach(() => {
  calls = [];
  globalThis.fetch = fakeFetch(calls);
  process.env.SALONONE_API_KEY = FAKE_KEY;
  provider.clearSalonOneCache();
});

const receptionCalls = () => calls.filter((u) => u.pathname.endsWith('/marketing/reception-history'));

async function callHandler(handler, method, query, body) {
  const res = { code: 200, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  await handler({ method, query, headers: {}, body }, res);
  return res;
}

// ------------------------------------------------------------
// おすすめプラン・料金
// ------------------------------------------------------------
test('おすすめプラン: 種類の数と集中ケアの要否で 3つを選ぶ（以前の画面と同じ判定）', () => {
  assert.equal(recommendPlans({}, {}), null);
  const keys = (r) => [r.matsu.key, r.take.key, r.ume.key];

  const face = recommendPlans({ c2: true }, {});
  assert.deepEqual(keys(face), ['Premium-2', 'Standard-2', 'Monthly-1']);
  assert.deepEqual(face.reasons, ['お悩みの状態に合わせて']);
  assert.deepEqual(face.categories, ['face']);
  assert.equal(face.needIntensive, false);

  const all = recommendPlans({ c1: true, c7: true, c10: true, c12: true }, {});
  assert.deepEqual(keys(all), ['Premium-4', 'Premium-2', 'Standard-2']);
  assert.deepEqual(all.reasons, ['お悩みが4箇所', '3種類の矯正が対象']);
  assert.deepEqual(all.categories, ['face', 'posture', 'pelvis']);

  const allLight = recommendPlans({ c1: true, c7: true, c10: true }, {});
  assert.deepEqual(keys(allLight), ['Premium-4', 'Premium-2', 'Monthly-1']);

  const two = recommendPlans({ c7: true, c10: true }, { f6: true });
  assert.deepEqual(keys(two), ['Premium-4', 'Standard-4', 'Standard-2']);
  assert.deepEqual(two.reasons, ['施術後の評価から定期的なケアが重要', '2種類の矯正が対象']);

  const twoLight = recommendPlans({ c7: true, c10: true }, { f1: true });
  assert.deepEqual(keys(twoLight), ['Standard-4', 'Standard-2', 'Monthly-1']);

  const heavy = recommendPlans({ c7: true }, { f6: true, f8: true });
  assert.deepEqual(keys(heavy), ['Premium-4', 'Standard-4', 'Standard-2']);
  assert.deepEqual(heavy.reasons, ['身体の状態から集中ケアを推奨']);

  // 施術後の評価だけでも提案する
  assert.deepEqual(keys(recommendPlans({}, { f1: true })), ['Premium-2', 'Standard-2', 'Monthly-1']);
});

test('プランの金額は料金表から（以前の画面と同じ金額）。1回あたり・おトク額・次回の目安', () => {
  const price = Object.fromEntries(PLAN_CATALOG.map((p) => [p.key, p.price]));
  assert.deepEqual(price, {
    'Premium-4': 32000, 'Standard-4': 28000, 'Premium-2': 18000, 'Standard-2': 15000, 'Monthly-1': 10000, 'Quick-4': 24000, 'Quick-8': 44000,
  });
  // 料金表のすべての行が選べる
  assert.equal(PLAN_CATALOG.length, PLAN_CARDS.reduce((s, c) => s + c.prices.length, 0));
  assert.equal(planByKey('Standard-4').freqLabel, '月4回（週1回）');
  assert.equal(planByKey('nope'), null);

  assert.deepEqual(planPricing(planByKey('Standard-4')), { price: 28000, regular: 40000, perVisit: 7000, savings: 12000 });
  assert.deepEqual(planPricing(planByKey('Monthly-1')), { price: 10000, regular: 11000, perVisit: 10000, savings: 1000 });
  assert.equal(planPricing(null), null);

  assert.equal(visitInterval(8).next, '3〜4日後');
  assert.equal(visitInterval(4).next, '1週間後');
  assert.equal(visitInterval(2).next, '2週間後');
  assert.equal(visitInterval(1).next, '1ヶ月後');
});

test('お悩みを部位（コース）ごとにまとめる', () => {
  const g = concernsByCategory({ c7: true, c8: true, c10: true });
  assert.deepEqual(g.map((x) => [x.course, x.items.map((i) => i.label)]), [
    ['小顔矯正', []],
    ['姿勢矯正', ['肩こり', '姿勢・猫背']],
    ['骨盤矯正', ['腰痛']],
  ]);
});

// ------------------------------------------------------------
// SalonOne の受付履歴 → 本日のお客様
// ------------------------------------------------------------
test('時刻は JST の HH:mm', () => {
  assert.equal(toJstTime('2026-10-20T10:00:00+09:00'), '10:00');
  assert.equal(toJstTime('2026-10-20T01:30:00Z'), '10:30');
  assert.equal(toJstTime('2026-10-20 18:15:00'), '18:15');
  assert.equal(toJstTime(''), '');
  assert.equal(toJstTime('あした'), '');
});

test('受付履歴 1行 → 本日のお客様。氏名は「含める」キーの時だけ・予約メモは持たない', () => {
  const raw = {
    appointment_id: 1, shop_id: 101, customer_id: 9, customer_number: '1234', reserved_at: '2026-10-20T13:30:00+09:00',
    status: 'booked', cancel_type: null, staff_id: 201, staff_name: '佐藤 美咲', visit_source_name: 'Instagram',
    classification: 'new', joined: false, plans: [{ plan_name: 'Standard 月4回', plan_kind: 'subscription' }, { plan_name: '物販', plan_kind: 'normal' }],
  };
  const v = normalizeVisit(raw);
  assert.equal(v.time, '13:30');
  assert.equal(v.date, DAY);
  assert.equal(v.status, 'reserved');
  assert.equal(v.isNew, true);
  assert.equal(v.customerName, null);
  assert.equal(v.hasNameField, false);
  assert.deepEqual(v.plans, [{ name: 'Standard 月4回', kind: 'subscription' }]); // 物販などは契約に数えない

  const withName = normalizeVisit({ ...raw, customer_name: ' 山本 さくら ', memo: '腰に注意' });
  assert.equal(withName.customerName, '山本 さくら');
  assert.equal(withName.hasNameField, true);
  assert.equal(JSON.stringify(withName).includes('腰に注意'), false);
  assert.equal(normalizeVisit({ ...raw, customer_name: null }).hasNameField, true); // 名前の無いお客様でも「含める」キー

  assert.equal(normalizeVisit({ ...raw, status: 'cancelled', cancel_type: 'no_show' }).status, 'no_show');
  assert.equal(normalizeVisit({ ...raw, status: 'checked_in' }).status, 'checked_in');
  assert.equal(normalizeVisit({ ...raw, classification: 'continuing' }).isNew, false);
});

test('本日のお客様: 時刻順・キャンセルは出さない・初回と契約が分かる。顧客ID・予約メモは返さない', async () => {
  const r = await visits.buildVisits(OWNER, { storeId: 'store-1', date: DAY });
  assert.equal(r.mode, 'live');
  assert.equal(r.linked, true);
  assert.equal(r.storeName, '中央店');
  assert.equal(r.names, false); // 「含めない」キー
  assert.deepEqual(r.visits.map((v) => [v.time, v.status, v.isNew]), [
    ['10:00', 'completed', true],
    ['11:30', 'completed', false],
    ['13:00', 'checked_in', true],
    ['16:30', 'reserved', false],
    ['18:00', 'reserved', true],
  ]);
  const first = r.visits[0];
  assert.equal(first.customerName, null);
  assert.equal(first.customerNumber, '5011');
  assert.equal(first.staffName, '佐藤 美咲');
  assert.equal(first.sourceName, 'ホットペッパー');
  assert.equal(first.contracted, true);
  assert.deepEqual(first.plans, ['Standard 月4回']);
  assert.equal(r.visits[1].sourceName, ''); // 既存のお客様は媒体を出さない
  const json = JSON.stringify(r);
  assert.equal(json.includes('80011') || json.includes('customerId') || json.includes('予約メモ'), false);

  const call = receptionCalls()[0];
  assert.equal(call.searchParams.get('from'), DAY);
  assert.equal(call.searchParams.get('to'), DAY);
  assert.equal(call.searchParams.get('shop_id'), '101');
});

test('「個人情報を含める」キーならお名前も返す（予約メモは返さない）', async () => {
  process.env.SALONONE_API_KEY = FAKE_PII_KEY;
  const r = await visits.buildVisits(SATO, { storeId: 'store-1', date: DAY });
  assert.equal(r.names, true);
  assert.deepEqual(r.visits.map((v) => v.customerName), ['新井 ゆい', '常連 一郎', '上田 美咲', '継続 二郎', '森 さやか']);
  assert.equal(JSON.stringify(r).includes('予約メモ'), false);
});

test('見える範囲: スタッフは所属店舗だけ。店舗の指定が無い・対応付けの無い店舗', async () => {
  const mine = await visits.buildVisits(TANAKA, { storeId: 'store-2', date: DAY });
  assert.deepEqual(mine.visits.map((v) => v.time), ['12:00']);

  const before = receptionCalls().length;
  await assert.rejects(visits.buildVisits(SATO, { storeId: 'store-2', date: DAY }), (e) => e.status === 403);
  await assert.rejects(visits.buildVisits(SATO, { storeId: '', date: DAY }), (e) => e.status === 400);
  await assert.rejects(visits.buildVisits(OWNER, { storeId: 'all', date: DAY }), (e) => e.status === 400);
  const unlinked = await visits.buildVisits(OWNER, { storeId: 'store-3', date: DAY });
  assert.equal(unlinked.linked, false);
  assert.deepEqual(unlinked.visits, []);
  assert.equal(receptionCalls().length, before); // SalonOne は呼ばない
});

test('50秒以内の読み直しは SalonOne を呼ばない（refresh なら呼ぶ）', async () => {
  await visits.buildVisits(OWNER, { storeId: 'store-1', date: DAY });
  const n = receptionCalls().length;
  await visits.buildVisits(SATO, { storeId: 'store-1', date: DAY });
  assert.equal(receptionCalls().length, n);
  await visits.buildVisits(SATO, { storeId: 'store-1', date: DAY, refresh: true });
  assert.ok(receptionCalls().length > n);
});

test('API: /api/salonone?action=visits（店舗の指定が無ければ 400、所属外は 403）', async () => {
  const ok = await callHandler(salonOneHandler, 'GET', { action: 'visits', storeId: 'store-1' });
  assert.equal(ok.code, 200);
  assert.equal(ok.body.storeId, 'store-1');
  assert.ok(Array.isArray(ok.body.visits));
  assert.equal((await callHandler(salonOneHandler, 'GET', { action: 'visits' })).code, 400);
});

test('デモ: 店舗と日付ごとに決まった予約。時刻を過ぎると来店中 → 会計済みになる', () => {
  const staff = [{ id: 's1', name: '佐藤', shopId: 'store-1' }, { id: 's2', name: '鈴木', shopId: 'store-1' }];
  const at = (hm) => Date.parse(`${DAY}T${hm}:00+09:00`);
  const morning = demoVisits({ shopId: 'store-1', staff, date: DAY, now: at('09:00') });
  assert.deepEqual(demoVisits({ shopId: 'store-1', staff, date: DAY, now: at('09:00') }), morning);
  assert.ok(morning.filter((v) => v.isNew).length >= 2);
  assert.ok(morning.every((v) => v.status === 'reserved' && v.customerName && v.time));
  const night = demoVisits({ shopId: 'store-1', staff, date: DAY, now: at('23:00') });
  assert.ok(night.every((v) => v.status === 'completed'));
  assert.deepEqual(night.map((v) => v.id), morning.map((v) => v.id));
  const v = morning.find((x) => x.time === '11:00');
  const during = demoVisits({ shopId: 'store-1', staff, date: DAY, now: at('11:20') }).find((x) => x.id === v.id);
  assert.equal(during.status, 'checked_in');
});

test('デモモード（APIキー未設定）でも本日のお客様を返す（デモの表示が付く）', async () => {
  delete process.env.SALONONE_API_KEY;
  const r = await visits.buildVisits(SATO, { storeId: 'store-1', date: DAY, now: Date.parse(`${DAY}T12:00:00+09:00`) });
  assert.equal(r.mode, 'demo');
  assert.equal(r.linked, true);
  assert.ok(r.visits.length > 0);
  assert.equal(calls.length, 0);
});

// ------------------------------------------------------------
// 以前の Google フォーム連携（GAS）の設定は読み書きさせない
// ------------------------------------------------------------
test('以前の GAS の URL・合言葉（dash_config の counseling.*）は一般の設定から読めず、書き換えもできない', async () => {
  await db.from('dash_config').upsert({ key: 'counseling.config', value: { gasUrl: 'https://script.google.com/macros/s/AKfycbOLD/exec', token: 'secret-word' } }, { onConflict: 'key' });
  const all = await callHandler(dbHandler, 'GET', { table: 'dashConfig' });
  assert.equal('counseling.config' in all.body.config, false);
  assert.ok((await callHandler(dbHandler, 'GET', { table: 'dashConfig', key: 'counseling.config' })).body.error);
  assert.ok((await callHandler(dbHandler, 'POST', { table: 'dashConfig' }, { action: 'set', key: 'counseling.config', value: {} })).body.error);
  // カウンセリングの table は無くなった
  assert.equal((await callHandler(dbHandler, 'GET', { table: 'counseling', action: 'stores' })).code, 400);
});
