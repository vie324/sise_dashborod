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

test('締まった月: 施術消化売上は施術 1回分の合計 − 物販。入金・施術数・新規数・既存数・契約数は SalonOne の売上分析の数字', async () => {
  const s = await summary.buildSummary(null, { month: PREV, storeId: 'all' });
  assert.equal(s.mode, 'live');
  assert.deepEqual(s.warnings.filter((w) => w.code !== 'retention'), []);
  // 中央店 37,000 − 物販 2,000 + 駅前店 14,000（SalonOne の売上分析の消化売上 48,000 は失効益などを含む別の定義）
  assert.equal(s.store.consumedSales, 49000);
  assert.equal(s.store.salonOneConsumedSales, 48000);
  assert.equal(s.store.newCount, 2);
  assert.equal(s.store.repeatCount, 6);
  assert.equal(s.store.purchaseCount, 1);
  assert.equal(s.store.cashSales, 24000); // 現金は受付履歴から

  const central = s.stores.find((x) => x.storeId === 'store-1');
  assert.equal(central.basis, 'salonone');
  assert.equal(central.consumedSales, 35000);
  assert.equal(central.salonOneConsumedSales, 34000);
  assert.equal(central.productSales, 2000);
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
  assert.equal(day20.consumedSales, 0); // 失効益は施術ではない（入金の返金はそのまま）
  assert.equal(day20.depositSales, -5000);

  const byName = Object.fromEntries(s.staff.map((r) => [r.name, r]));
  assert.deepEqual(Object.keys(byName).sort(), ['佐藤 美咲', '田中 大輔', '鈴木 健太']); // 退職者は出さない
  const sato = byName['佐藤 美咲'];
  assert.equal(sato.staffId, 'st-sato');
  assert.equal(sato.metrics.consumedSales, 20000); // 施術 22,000 − 物販 2,000
  assert.equal(sato.metrics.salonOneConsumedSales, 25000);
  // 新規 2名の初回来店 6,000 も物販を同じ割合で差し引いてから除く（20,000 − 5,455）
  assert.equal(sato.metrics.existingConsumedSales, 14545);
  assert.equal(sato.metrics.treatmentCount, 4);
  assert.equal(sato.metrics.newCount, 1);
  assert.equal(sato.metrics.repeatCount, 3);
  assert.equal(sato.metrics.purchaseCount, 1);
  assert.equal(sato.metrics.newVisitTotal, 2);
  assert.equal(sato.metrics.referralSubscriptions, 0); // 紹介は入会のみでサブスクではない
  assert.equal(sato.daily.reduce((a, d) => a + d.consumedSales, 0), 20000); // 日別の合計も物販を差し引いた金額に合わせる
  assert.equal(sato.incentive.items[0].current, 20000);
  // 鈴木: 3,000 + 6,000 + SalonOne の消化額が 0円のサブスクの来店に 月2回プラン の 1回分 6,000
  assert.equal(byName['鈴木 健太'].metrics.consumedSales, 15000);
  assert.equal(byName['鈴木 健太'].daily.find((d) => d.date === `${PREV}-10`).consumedSales, 6000);
  assert.equal(byName['鈴木 健太'].metrics.purchaseCount, 0);
  assert.equal(byName['田中 大輔'].storeId, 'store-2');
});

test('推移: 施術消化売上は月ごとの記録（無い月は SalonOne の売上分析の消化売上）。受付履歴は取らない', async () => {
  await db.from('dash_config').delete().eq('key', provider.CONSUMPTION_KEY);
  const before = await summary.buildTrend(null, { months: 3, endMonth: CURRENT, storeId: 'all' });
  const prev = before.months.find((m) => m.month === PREV);
  assert.equal(prev.consumedSales, 48000); // 記録が無い月は SalonOne の消化売上（定義が違うので印を付ける）
  assert.equal(prev.consumedBasis, 'salonone');
  assert.equal(prev.newCount, 2);
  assert.equal(prev.repeatCount, 6);
  assert.equal(prev.purchaseCount, 1);
  assert.equal(prev.contractRatePct, 50);
  assert.equal(before.staff.find((r) => r.name === '佐藤 美咲').values[PREV], 25000);
  assert.ok(!calls.some((u) => u.pathname.endsWith('/marketing/reception-history')));

  // その月を開くと記録が残り、推移も施術消化売上になる
  await summary.buildSummary(null, { month: PREV, storeId: 'all' });
  const saved = await db.from('dash_config').select('value').eq('key', provider.CONSUMPTION_KEY).maybeSingle();
  assert.deepEqual(saved.data.value[PREV].shops, { 101: 35000, 102: 14000 });
  assert.equal(saved.data.value[PREV].staff['201'], 20000);
  provider.clearSalonOneCache();
  calls.length = 0;
  const after = await summary.buildTrend(null, { months: 3, endMonth: CURRENT, storeId: 'all' });
  const prev2 = after.months.find((m) => m.month === PREV);
  assert.equal(prev2.consumedSales, 49000);
  assert.equal(prev2.consumedBasis, 'treatment');
  assert.equal(after.staff.find((r) => r.name === '佐藤 美咲').values[PREV], 20000);
  assert.ok(!calls.some((u) => u.pathname.endsWith('/marketing/reception-history')));
});

test('毎日の記録（Cron）: 当月と記録の無い過去の月を 1つ、全店舗の分を残す', async () => {
  await db.from('dash_config').delete().eq('key', provider.CONSUMPTION_KEY);
  const r = await summary.snapshotConsumption();
  assert.deepEqual(r.failed, []);
  assert.deepEqual(r.months.slice(0, 1), [CURRENT]);
  const saved = (await db.from('dash_config').select('value').eq('key', provider.CONSUMPTION_KEY).maybeSingle()).data.value;
  const backfilled = r.months.find((m) => m !== CURRENT && m !== PREV) || PREV;
  assert.ok(r.months.includes(backfilled));
  assert.deepEqual(saved[backfilled].shops, { 101: 35000, 102: 14000 });
  assert.deepEqual(saved[backfilled].staff, { 201: 20000, 202: 15000, 203: 14000 });
});

test('売上分析を取れないときは受付履歴から集計し、その旨を知らせる', async () => {
  const base = fakeFetch(calls);
  globalThis.fetch = async (input, init) => {
    if (String(input).includes('/sales/summary')) return new Response(JSON.stringify({ error: { code: 'feature_disabled', error_id: 'f1' } }), { status: 403 });
    return base(input, init);
  };
  await db.from('dash_config').delete().eq('key', provider.CONSUMPTION_KEY);
  const s = await summary.buildSummary(null, { month: PREV, storeId: 'store-1' });
  const w = s.warnings.find((x) => x.code === 'salesSummary');
  assert.ok(w, JSON.stringify(s.warnings));
  assert.match(w.message, /機能が無効/);
  assert.equal(s.stores[0].consumedSales, 37000); // 物販売上がわからないので差し引けない
  assert.equal(s.stores[0].newCount, 3);
  // 売上分析が取れない時は記録を残さない
  assert.equal((await db.from('dash_config').select('value').eq('key', provider.CONSUMPTION_KEY).maybeSingle()).data, null);
  const t = await summary.buildTrend(null, { months: 2, endMonth: PREV, storeId: 'store-1' });
  assert.equal(t.months.find((m) => m.month === PREV).consumedSales, 37000);
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
  // スタッフのインセンティブ（継続率は所属店舗の条件）のため、店舗を絞っていても全店舗の分を取る
  assert.equal(saved.data.value[CURRENT]['102'].memberCount, 12);
  assert.equal(s.store.retention.memberCount, 50); // 店舗の数字は中央店だけ
});

test('スタッフには自分の行と所属店舗の数字だけを返す（インセンティブの計算には全店舗の実績を使う）', async () => {
  const s = await summary.buildSummary(SATO, { month: PREV, storeId: 'all' });
  assert.equal(s.staff.length, 1);
  assert.equal(s.me.metrics.consumedSales, 20000);
  assert.deepEqual(s.staffInScope.map((r) => r.key), ['201']);
  assert.deepEqual(s.stores.map((r) => r.storeId), ['store-1']);
  assert.equal(s.store.consumedSales, 35000);
  assert.deepEqual(s.sources, []);
  assert.ok(!JSON.stringify(s).includes('田中'), '他店舗のスタッフの名前を返さない');
  await assert.rejects(summary.buildSummary(SATO, { month: PREV, storeId: 'store-2' }), (e) => e.status === 403);
});

/**
 * 佐藤（201・中央店 101 の所属）が駅前店（102）にヘルプで入った月にする:
 * 駅前店の売上分析のスタッフ別に 佐藤 10,000円・1回、受付履歴に 15日の来店 1件を足す。
 */
function withHelperAtStation(base) {
  return async (input, init) => {
    const url = new URL(String(input));
    const res = await base(input, init);
    if (url.searchParams.get('shop_id') !== '102' || !res.ok) return res;
    const body = await res.json();
    if (url.pathname.endsWith('/sales/summary')) {
      const d = body.data;
      d.consumed_sales += 10000;
      d.digest_sales += 10000;
      d.treatment_count += 1;
      d.repeat_visit_count += 1;
      d.by_staff.push({ staff_id: 201, staff_name: '佐藤 美咲', consumed_sales: 10000, digest_sales: 10000, new_visit_count: 0, repeat_visit_count: 1, customer_count: 1, treatment_count: 1, purchase_count: 0 });
    }
    if (url.pathname.endsWith('/marketing/reception-history') && !url.searchParams.get('cursor')) {
      const month = url.searchParams.get('from').slice(0, 7);
      body.data.push({
        appointment_id: 990001, shop_id: 102, customer_id: 9599, reserved_at: `${month}-15T11:00:00+09:00`, status: 'completed',
        staff_id: 201, staff_name: '佐藤 美咲', classification: 'existing', joined: false, plans: [],
        amount: 10000, consumed_amount: 10000, payment_method_name: 'クレジットカード', payment_splits: [],
      });
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

test('他店舗にヘルプで入ったスタッフ: インセンティブは表示中の店舗に関係なく全店舗の実績で計算する', async () => {
  globalThis.fetch = withHelperAtStation(fakeFetch(calls));
  const all = await summary.buildSummary(null, { month: PREV, storeId: 'all' });
  const satoAll = all.staff.find((r) => r.name === '佐藤 美咲');
  assert.equal(satoAll.metrics.consumedSales, 30000); // 中央店 20,000 + 駅前店 10,000
  assert.equal(satoAll.metrics.treatmentCount, 5);
  assert.equal(satoAll.storeId, 'store-1'); // 所属は SalonOne の所属店舗

  provider.clearSalonOneCache();
  const central = await summary.buildSummary(null, { month: PREV, storeId: 'store-1' });
  const satoCentral = central.staff.find((r) => r.name === '佐藤 美咲');
  assert.equal(satoCentral.metrics.consumedSales, 30000); // 中央店だけを見ていても全店舗の合計
  assert.deepEqual(satoCentral.incentive, satoAll.incentive);
  assert.equal(satoCentral.period.total, satoAll.period.total);
  // 売上分析のスタッフ別（表示中の店舗だけの数字）
  assert.equal(central.staffInScope.find((r) => r.name === '佐藤 美咲').metrics.consumedSales, 20000);
  assert.equal(central.store.consumedSales, 35000); // 店舗の数字は中央店だけのまま

  // 駅前店: 佐藤さんは所属ではないのでインセンティブの一覧には出さず、売上分析のスタッフ別には出す
  const station = await summary.buildSummary(null, { month: PREV, storeId: 'store-2' });
  assert.equal(station.staff.find((r) => r.name === '佐藤 美咲'), undefined);
  assert.equal(station.staffInScope.find((r) => r.name === '佐藤 美咲').metrics.consumedSales, 10000);
  assert.equal(station.store.consumedSales, 24000);
  assert.deepEqual(station.sources, []); // 来店経由は表示中の店舗のぶんだけ

  // 本人（スタッフURL・所属は中央店のみ）も同じ金額を見る
  provider.clearSalonOneCache();
  const mine = await summary.buildSummary(SATO, { month: PREV, storeId: 'all' });
  assert.equal(mine.me.metrics.consumedSales, 30000);
  assert.deepEqual(mine.me.incentive, satoAll.incentive);
  assert.deepEqual(mine.staff.map((r) => r.name), ['佐藤 美咲']);
  assert.deepEqual(mine.stores.map((s) => s.storeId), ['store-1']); // 店舗の数字は所属店舗だけ

  // 本人の推移（自己ベスト）も全店舗の実績。店舗の推移は所属店舗だけ
  const trend = await summary.buildTrend(SATO, { months: 2, endMonth: PREV, storeId: 'all' });
  assert.deepEqual(trend.staff.map((r) => [r.key, r.values[PREV]]), [['201', 30000]]);
  assert.equal(trend.months.find((m) => m.month === PREV).consumedSales, 35000);
});

/** 中央店に、1回分の金額が決まらないプラン（新プラン 月3回。購入も SalonOne の 1回分も無い）のお客様の 0円の来店を足す */
function withUnknownPlan(base) {
  return async (input, init) => {
    const url = new URL(String(input));
    const res = await base(input, init);
    if (url.searchParams.get('shop_id') !== '101' || !res.ok) return res;
    const body = await res.json();
    if (url.pathname.endsWith('/marketing/reception-history') && !url.searchParams.get('cursor')) {
      const month = url.searchParams.get('from').slice(0, 7);
      body.data.push({
        appointment_id: 990101, shop_id: 101, customer_id: 9007, reserved_at: `${month}-12T11:00:00+09:00`, status: 'completed',
        staff_id: 202, staff_name: '鈴木 健太', classification: 'existing', joined: false, plans: [],
        amount: 0, consumed_amount: 0, payment_method_name: null, payment_splits: [],
      });
    }
    if (url.pathname.endsWith('/marketing/retention-customers')) {
      body.data.push({ customer_id: 9007, shop_id: 101, status: 'normal', plan_name: '新プラン 月3回', subscription_months: null, payment_at: '2026-10-01' });
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

test('プランの 1回分の金額: 自動で決まった金額・0円の来店に当てた数。決まらないプランは知らせ、設定で入れると付く', async () => {
  globalThis.fetch = withUnknownPlan(fakeFetch(calls));
  const units = await summary.buildPlanUnits(null, { month: PREV });
  const plan = (name) => units.plans.find((p) => p.name === name);
  assert.deepEqual(
    { unit: plan('月2回プラン').unit, source: plan('月2回プラン').source, visits: plan('月2回プラン').visits },
    { unit: 6000, source: 'salonone', visits: 1 },
  );
  assert.deepEqual({ unit: plan('回数券 6回').unit, source: plan('回数券 6回').source }, { unit: 5000, source: 'price' }); // 30,000円 ÷ 6回
  assert.deepEqual({ unit: plan('新プラン 月3回').unit, unknownVisits: plan('新プラン 月3回').unknownVisits }, { unit: null, unknownVisits: 1 });
  assert.equal(units.unknownVisits, 1);
  assert.equal(units.plans[0].name, '新プラン 月3回'); // わからない来店のあるプランを先に
  await assert.rejects(summary.buildPlanUnits(SATO, { month: PREV }), (e) => e.status === 403);

  provider.clearSalonOneCache();
  const s = await summary.buildSummary(null, { month: PREV, storeId: 'all' });
  const w = s.warnings.find((x) => x.code === 'planUnit');
  assert.ok(w, JSON.stringify(s.warnings));
  assert.match(w.message, /新プラン 月3回 \d+件/); // 表示中の月と支給期間の月の分
  assert.equal(s.staff.find((r) => r.name === '鈴木 健太').metrics.consumedSales, 15000); // わからない来店は入らない
  assert.ok(!(await summary.buildSummary(SATO, { month: PREV, storeId: 'all' })).warnings.some((x) => x.code === 'planUnit'), 'スタッフには出さない');

  // 設定で 1回分を入れると、その来店にも付く
  await db.from('dash_config').upsert({ key: provider.PLAN_UNITS_KEY, value: { '新プラン 月3回': 7000 } }, { onConflict: 'key' });
  provider.clearSalonOneCache();
  const fixed = await summary.buildSummary(null, { month: PREV, storeId: 'all' });
  assert.ok(!fixed.warnings.some((x) => x.code === 'planUnit'));
  assert.equal(fixed.staff.find((r) => r.name === '鈴木 健太').metrics.consumedSales, 22000);
  const after = await summary.buildPlanUnits(null, { month: PREV });
  assert.deepEqual({ unit: after.plans.find((p) => p.name === '新プラン 月3回').unit, source: after.plans.find((p) => p.name === '新プラン 月3回').source, setting: after.plans.find((p) => p.name === '新プラン 月3回').setting },
    { unit: 7000, source: 'setting', setting: 7000 });
  await db.from('dash_config').delete().eq('key', provider.PLAN_UNITS_KEY);
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

test('店舗の合算の対応付け: 1つ目の後に足し、ほかの店舗に対応付いた店舗は合算せず重複として知らせる', () => {
  const appCtx = {
    stores: [{ id: 'yamato', name: '大和店' }, { id: 'yokohama', name: '横浜店' }],
    staff: [],
    config: {
      'salonone.shopMap': { yamato: '101', yokohama: '103' },
      [provider.SHOP_MERGE_KEY]: { yamato: ['102', '103', '101', '102'], yokohama: ['102'] },
    },
  };
  const m = provider.buildMapping(appCtx, { mode: 'live', shops: [], staff: [] });
  assert.deepEqual(m.shopsOf('yamato'), ['101', '102']); // 103 は横浜店の 1つ目なので足さない・重なりは 1つ
  assert.deepEqual(m.shopsOf('yokohama'), ['103']); // 102 は先に大和店に足した
  assert.equal(m.shopToStore.get('102'), 'yamato');
  assert.deepEqual(m.duplicateShops.sort(), ['102', '103']);
  assert.equal(m.storeToShop.get('yamato'), '101');
  assert.deepEqual(m.shopsOf('none'), []);
});

test('店舗の合算: 数字・内訳・スタッフ・出納帳・本日のお客様を合わせ、店舗ごとの売上インセンティブ（入金売上）で判定する', async () => {
  // 合算の前（店舗ごと）の現金売上
  const before101 = await summary.dailyCashSales(null, { storeId: 'store-1', months: [PREV] });
  const before102 = await summary.dailyCashSales(null, { storeId: 'store-2', months: [PREV] });
  await db.from('dash_config').upsert([
    { key: 'salonone.shopMap', value: { 'store-1': '101' } },
    { key: provider.SHOP_MERGE_KEY, value: { 'store-1': ['102'] } },
    { key: provider.STORE_SALES_RULES_KEY, value: { 'store-1': { metric: 'depositSales' } } },
  ], { onConflict: 'key' });
  try {
    provider.clearSalonOneCache();
    const s = await summary.buildSummary(null, { month: PREV, storeId: 'store-1' });
    const parts = s.store.parts;
    assert.deepEqual(parts.map((p) => p.shopId), ['101', '102']);
    for (const k of ['consumedSales', 'depositSales', 'treatmentCount', 'newCount', 'purchaseCount']) {
      assert.equal(s.store[k], parts.reduce((a, p) => a + p[k], 0), k);
      assert.equal(s.stores[0][k], s.store[k], k);
    }
    assert.ok(s.store.consumedSales > 0);
    assert.deepEqual(s.stores[0].parts.map((p) => p.name), ['中央店', '駅前店']);
    assert.equal(s.warnings.some((w) => w.code === 'unmappedShop'), false); // 足した店舗は対応付いた店舗として扱う
    // 足した店舗が所属のスタッフも、その店舗のスタッフ
    assert.equal(s.staff.find((r) => r.key === '203').storeId, 'store-1');
    // 売上インセンティブは店舗の設定（入金売上）で判定し、確定の記録にも指標を残す
    const sato = s.staff.find((r) => r.key === '201');
    assert.equal(sato.incentive.items[0].metric, 'depositSales');
    assert.equal(sato.incentive.items[0].label, '入金売上');
    assert.equal(sato.incentive.items[0].current, sato.metrics.depositSales);
    assert.equal(sato.period.months.find((pm) => pm.month === PREV).basis.salesMetric, 'depositSales');
    assert.deepEqual(s.salesRules.map((r) => [r.storeId, r.metric]), [['store-1', 'depositSales']]);
    // 全店舗の合計は 1回だけ数える
    const all = await summary.buildSummary(null, { month: PREV, storeId: 'all' });
    assert.equal(all.store.consumedSales, s.store.consumedSales);
    // 出納帳は 2つの店舗の現金を合わせる（同じレジ）
    const cash = await summary.dailyCashSales(null, { storeId: 'store-1', months: [PREV] });
    const days = new Set([...Object.keys(before101.days), ...Object.keys(before102.days)]);
    for (const d of days) assert.equal(cash.days[d], (before101.days[d] || 0) + (before102.days[d] || 0), d);
    // 本日のお客様は 2つの店舗の予約を合わせ、どちらの店舗かを付ける
    const { buildVisits } = await import('../api/_lib/salonone/visits.js');
    const v = await buildVisits(null, { storeId: 'store-1' });
    assert.equal(v.linked, true);
    assert.ok(v.visits.every((x) => ['中央店', '駅前店'].includes(x.shopName)));
  } finally {
    await db.from('dash_config').upsert({ key: 'salonone.shopMap', value: { 'store-1': '101', 'store-2': '102' } }, { onConflict: 'key' });
    await db.from('dash_config').delete().eq('key', provider.SHOP_MERGE_KEY);
    await db.from('dash_config').delete().eq('key', provider.STORE_SALES_RULES_KEY);
  }
});
