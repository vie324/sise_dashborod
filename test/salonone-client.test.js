// SalonOne 分析API クライアントのテスト（疑似 SalonOne を fetch に差し込む）
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fakeFetch, FAKE_KEY } from '../scripts/dev/salonone-fake.mjs';
import {
  salonOneConfig, fetchShops, fetchStaff, fetchReceptions, fetchRetentionCustomers, fetchObject, probe, SalonOneError,
} from '../api/_lib/salonone/client.js';

const BASE = 'http://fake.salonone.test/api/analytics/v1';
let calls;

beforeEach(() => {
  calls = [];
  process.env.SALONONE_API_KEY = FAKE_KEY;
  process.env.SALONONE_API_BASE_URL = BASE;
  delete process.env.SALONONE_API_ENDPOINTS;
  globalThis.fetch = fakeFetch(calls);
});

test('ベースURL: 既定・ドメインだけの指定・上書き', () => {
  delete process.env.SALONONE_API_BASE_URL;
  assert.equal(salonOneConfig().baseUrl, 'https://salonone.net/api/analytics/v1');
  process.env.SALONONE_API_BASE_URL = 'https://salonone.net/';
  assert.equal(salonOneConfig().baseUrl, 'https://salonone.net/api/analytics/v1');
  process.env.SALONONE_API_BASE_URL = 'https://staging.salonone.net/api/analytics/v1/';
  assert.equal(salonOneConfig().baseUrl, 'https://staging.salonone.net/api/analytics/v1');
  process.env.SALONONE_API_ENDPOINTS = '{"receptions":"/marketing/reception-history2","unknown":"/x"}';
  assert.equal(salonOneConfig().endpoints.receptions, '/marketing/reception-history2');
  assert.equal(salonOneConfig().endpoints.unknown, undefined);
});

test('キーは X-SalonOne-Api-Key ヘッダで送り、Bearer には入れない', async () => {
  let seen = null;
  globalThis.fetch = async (url, init) => {
    seen = init.headers;
    return new Response(JSON.stringify({ data: { brand_id: 1 } }), { status: 200 });
  };
  await fetchObject(salonOneConfig(), '/meta');
  assert.equal(seen['X-SalonOne-Api-Key'], FAKE_KEY);
  assert.equal(seen.Authorization, undefined);
});

test('明細は next_cursor で最後まで辿る（削除済みの行も返る）', async () => {
  const shops = await fetchShops(salonOneConfig());
  assert.equal(shops.length, 3);
  const pages = calls.filter((u) => u.pathname.endsWith('/shops'));
  assert.equal(pages.length, 2);
  assert.equal(pages[0].searchParams.get('limit'), '1000');
  assert.ok(pages[1].searchParams.get('cursor'));
  assert.equal((await fetchStaff(salonOneConfig())).length, 4);
});

test('受付履歴は店舗ごと・ページを辿って取得する', async () => {
  const rows = await fetchReceptions(salonOneConfig(), { from: '2026-09-01', to: '2026-09-30', shopId: '101' });
  assert.equal(rows.length, 8);
  const pages = calls.filter((u) => u.pathname.endsWith('/marketing/reception-history'));
  assert.equal(pages.length, 2);
  assert.equal(pages[0].searchParams.get('shop_id'), '101');
});

test('limit を受け付けない一覧は外して取り直す', async () => {
  const rows = await fetchRetentionCustomers(salonOneConfig(), { from: '2025-10-16', to: '2026-10-16', shopId: '101' });
  assert.equal(rows.length, 3);
  const tries = calls.filter((u) => u.pathname.endsWith('/retention-customers'));
  assert.equal(tries.length, 2);
  assert.equal(tries[1].searchParams.has('limit'), false);
  assert.equal(tries[1].searchParams.get('plan_kind'), 'subscription');
});

test('エラーは仕様のコードから日本語の説明にする', async () => {
  process.env.SALONONE_API_KEY = 'wrong-key';
  await assert.rejects(fetchShops(salonOneConfig()), (e) => {
    assert.ok(e instanceof SalonOneError);
    assert.equal(e.status, 401);
    assert.equal(e.code, 'unauthorized');
    assert.match(e.message, /APIキーが無効です/);
    assert.match(e.message, /error_id: fake-unauthorized/);
    return true;
  });
  process.env.SALONONE_API_KEY = FAKE_KEY;
  await assert.rejects(fetchReceptions(salonOneConfig(), { from: '2026-09-01', to: '2026-09-30', shopId: '' }), (e) => {
    assert.equal(e.code, 'invalid_request');
    assert.deepEqual(e.fields, ['shop_id']);
    assert.match(e.message, /項目: shop_id/);
    return true;
  });
});

test('error.code の無い 404（ルートが無い）も説明をつける', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ message: 'The route api/analytics/staffs could not be found.' }), { status: 404 });
  await assert.rejects(fetchStaff(salonOneConfig()), (e) => {
    assert.equal(e.code, 'not_found');
    assert.match(e.message, /API の URL が見つかりません/);
    assert.match(e.message, /could not be found/);
    return true;
  });
});

test('429 は 1回だけ待って取り直す', async () => {
  let n = 0;
  globalThis.fetch = async () => {
    n += 1;
    if (n === 1) return new Response(JSON.stringify({ error: { code: 'rate_limited' } }), { status: 429, headers: { 'Retry-After': '0.01' } });
    return new Response(JSON.stringify({ data: [{ id: 1, name: 'A' }], meta: { has_more: false } }), { status: 200 });
  };
  const shops = await fetchShops(salonOneConfig());
  assert.equal(shops.length, 1);
  assert.equal(n, 2);

  n = 0;
  globalThis.fetch = async () => {
    n += 1;
    return new Response(JSON.stringify({ error: { code: 'rate_limited', error_id: 'e1' } }), { status: 429, headers: { 'Retry-After': '0.01' } });
  };
  await assert.rejects(fetchShops(salonOneConfig()), /利用上限/);
  assert.equal(n, 2);
});

test('接続テスト: 各エンドポイントの件数と項目名（値は返さない）', async () => {
  const results = await probe(salonOneConfig(), { from: '2026-09-01', to: '2026-09-30', payPerVisitPattern: /月2回/ });
  assert.deepEqual(results.map((r) => r.name), ['meta', 'shops', 'staff', 'visitSources', 'salesSummary', 'receptions', 'retentionSummary', 'retentionCustomers']);
  const sales = results.find((r) => r.name === 'salesSummary');
  assert.ok(sales.sampleKeys.includes('consumed_sales'));
  assert.ok(sales.nested.by_staff.includes('purchase_count'));
  assert.ok(sales.nested.by_day.includes('new_visit_count'));
  assert.ok(results.every((r) => r.ok), JSON.stringify(results.filter((r) => !r.ok)));
  const rec = results.find((r) => r.name === 'receptions');
  assert.equal(rec.shopId, 101);
  assert.ok(rec.sampleKeys.includes('consumed_amount'));
  assert.deepEqual(rec.nested.plans, ['plan_name', 'plan_kind', 'amount', 'total_sessions']);
  assert.deepEqual(rec.nested.payment_splits, ['payment_method_name', 'amount']);
  assert.ok(results.find((r) => r.name === 'retentionSummary').nested.previous_month.includes('churned_count'));
  // SalonOne の画面と見比べる人数と、受付履歴の値の扱い（顧客の情報は出さない）
  assert.deepEqual(results.find((r) => r.name === 'retentionSummary').counts, {
    continuing: 40, follow: 6, attention: 4, churned: 30, previousMonth: { continuing: 42, follow: 5, attention: 3, churned: 27 },
  });
  const as = (list, value) => (list.find((v) => v.value === value) || {}).as;
  assert.equal(as(rec.values.status, 'completed'), '会計完了（集計する）');
  assert.equal(as(rec.values.status, 'cancelled'), 'キャンセル');
  assert.equal(as(rec.values.classification, 'new'), '新規（初回の判定に使う）');
  assert.equal(as(rec.values.planKind, 'subscription'), 'サブスク（契約）');
  assert.equal(as(rec.values.paymentMethod, '現金'), '現金');
  assert.equal(as(rec.values.paymentMethod, '現金 / クレジットカード'), '分割決済（内訳の現金の分だけ）');
  assert.equal(as(rec.values.paymentMethod, 'クレジットカード'), '現金以外');
  assert.ok(!JSON.stringify(rec).includes('customer_name'));
  // 継続管理の顧客一覧: 状態・プラン名と、会員数での扱い（都度払いのキーワードに当たるか）
  const cust = results.find((r) => r.name === 'retentionCustomers');
  assert.deepEqual(cust.values.customerStatus, [{ value: 'normal', as: '離反以外' }]);
  assert.deepEqual(cust.values.planName, [{ value: '月2回プラン', as: '都度払い（このプランだけのお客様は会員数・平均継続期間から除く）' }]);
  assert.equal(results[0].info.brand_name, "si'se");
  assert.ok(!JSON.stringify(results).includes('53000')); // 金額などの値は含めない

  process.env.SALONONE_API_KEY = 'wrong-key';
  const bad = await probe(salonOneConfig(), { from: '2026-09-01', to: '2026-09-30' });
  assert.equal(bad[0].ok, false);
  assert.equal(bad[0].status, 401);
  assert.equal(bad[0].code, 'unauthorized');
});

test('1分の上限に達したら、長く待たずに「上限」として返す', async () => {
  process.env.SALONONE_RATE_LIMIT_PER_MINUTE = '1';
  try {
    await assert.rejects(fetchShops(salonOneConfig()), (e) => {
      assert.equal(e.code, 'rate_limited');
      assert.match(e.message, /1分ほど待って/);
      return true;
    });
  } finally {
    delete process.env.SALONONE_RATE_LIMIT_PER_MINUTE;
  }
});
