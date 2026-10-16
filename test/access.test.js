// 権限まわり（SalonOne 集計の見える範囲・目標の設定権限）のテスト。
// ローカル開発用の疑似 DB（scripts/dev/supabase-mock.mjs）を差し込んで実際のハンドラを動かす。
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createMockClient } from '../scripts/dev/supabase-mock.mjs';

let buildSummary;
let AccessError;
let goalsGet;
let goalsPost;

const ctx = (staffId, role, storeIds) => ({ valid: true, staffId, role, storeIds, name: staffId });
const SATO = ctx('st-sato', 'staff', ['store-1']);
const TAKAHASHI = ctx('st-takahashi', 'manager', ['store-1']);
const YAMADA = ctx('st-yamada', 'headquarter', []);

before(async () => {
  delete process.env.SALONONE_API_KEY; // デモデータで動かす
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sise-test-')), 'db.json');
  globalThis.__SISE_SUPABASE_MOCK__ = createMockClient(file);
  ({ buildSummary, AccessError } = await import('../api/_lib/salonone/summary.js'));
  ({ goalsGet, goalsPost } = await import('../api/_lib/db-handlers-goals.js'));
});

test('管理者は全店舗・全スタッフを見られる', async () => {
  const s = await buildSummary(null, { month: '2026-10', storeId: 'all' });
  assert.equal(s.mode, 'demo');
  assert.deepEqual(s.scope.storeIds.sort(), ['store-1', 'store-2']);
  assert.ok(s.staff.length >= 5);
  assert.equal(s.me, null);
});

test('スタッフは自分の行だけ。他店舗は 403', async () => {
  const s = await buildSummary(SATO, { month: '2026-10', storeId: 'store-1' });
  assert.equal(s.staff.length, 1);
  assert.equal(s.staff[0].staffId, 'st-sato');
  assert.equal(s.me.staffId, 'st-sato');
  assert.ok(s.store.consumedSales >= s.me.metrics.consumedSales); // 店舗合計は見える
  assert.equal(s.sources.length, 0);
  await assert.rejects(() => buildSummary(SATO, { month: '2026-10', storeId: 'store-2' }), (e) => e instanceof AccessError && e.status === 403);
});

test('店舗責任者は所属店舗のスタッフ全員を見られる', async () => {
  const s = await buildSummary(TAKAHASHI, { month: '2026-10', storeId: 'store-1' });
  const ids = s.staff.map((r) => r.staffId).sort();
  assert.deepEqual(ids, ['st-sato', 'st-suzuki', 'st-takahashi']);
  // 「全店舗」を指定しても所属店舗だけになる
  const all = await buildSummary(TAKAHASHI, { month: '2026-10', storeId: 'all' });
  assert.deepEqual(all.scope.storeIds, ['store-1']);
});

test('本部は全店舗を見られる', async () => {
  const s = await buildSummary(YAMADA, { month: '2026-10', storeId: 'all' });
  assert.equal(s.scope.storeIds.length, 2);
  assert.equal(s.scope.canSeeAll, true);
});

test('目標: スタッフは自分の目標だけ設定できる', async () => {
  const ok = await goalsPost({ action: 'set', month: '2026-11', scope: 'staff', targetId: 'st-sato', values: { consumedSales: '808,000' } }, SATO);
  assert.equal(ok.success, true);
  assert.equal(ok.goal.consumedSales, 808000);
  const ng = await goalsPost({ action: 'set', month: '2026-11', scope: 'staff', targetId: 'st-suzuki', values: { consumedSales: 1 } }, SATO);
  assert.ok(ng.error);
  const ngStore = await goalsPost({ action: 'set', month: '2026-11', scope: 'store', targetId: 'store-1', values: { consumedSales: 1 } }, SATO);
  assert.ok(ngStore.error);
});

test('目標: 店舗責任者は自店舗と自店舗のスタッフだけ', async () => {
  assert.equal((await goalsPost({ action: 'set', month: '2026-11', scope: 'store', targetId: 'store-1', values: { consumedSales: 3000000, contractRatePct: 55.55 } }, TAKAHASHI)).success, true);
  assert.equal((await goalsPost({ action: 'set', month: '2026-11', scope: 'staff', targetId: 'st-suzuki', values: { consumedSales: 700000 } }, TAKAHASHI)).success, true);
  assert.ok((await goalsPost({ action: 'set', month: '2026-11', scope: 'store', targetId: 'store-2', values: { consumedSales: 1 } }, TAKAHASHI)).error);
  assert.ok((await goalsPost({ action: 'set', month: '2026-11', scope: 'staff', targetId: 'st-tanaka', values: { consumedSales: 1 } }, TAKAHASHI)).error);
});

test('目標: 見える範囲だけ返す', async () => {
  await goalsPost({ action: 'set', month: '2026-11', scope: 'store', targetId: 'store-2', values: { consumedSales: 2500000 } }, null);
  const admin = await goalsGet({ month: '2026-11' }, null);
  assert.deepEqual(Object.keys(admin.stores).sort(), ['store-1', 'store-2']);
  assert.equal(admin.stores['store-1'].contractRatePct, 55.6);
  const staffView = await goalsGet({ month: '2026-11' }, SATO);
  assert.deepEqual(Object.keys(staffView.stores), ['store-1']);
  assert.deepEqual(Object.keys(staffView.staff), ['st-sato']);
  const managerView = await goalsGet({ month: '2026-11' }, TAKAHASHI);
  assert.deepEqual(Object.keys(managerView.staff).sort(), ['st-sato', 'st-suzuki']);
});

test('目標: 前月の目標を未設定の対象にだけコピーする', async () => {
  const r = await goalsPost({ action: 'copyFrom', month: '2026-12', fromMonth: '2026-11' }, null);
  assert.equal(r.copied, 4);
  const again = await goalsPost({ action: 'copyFrom', month: '2026-12', fromMonth: '2026-11' }, null);
  assert.equal(again.copied, 0);
});
