// 目標（3ヶ月・単月への振り分け・特別目標）のテスト。
// ローカル開発用の疑似 DB（scripts/dev/supabase-mock.mjs）を差し込んで実際のハンドラを動かす。
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createMockClient } from '../scripts/dev/supabase-mock.mjs';
import { addMonths, monthOf, todayJst } from '../shared/dates.js';

let goalsGet;
let goalsPost;
let buildTrend;

const ctx = (staffId, role, storeIds) => ({ valid: true, staffId, role, storeIds, name: staffId });
const SATO = ctx('st-sato', 'staff', ['store-1']);
const TAKAHASHI = ctx('st-takahashi', 'manager', ['store-1']);
const OWNER = ctx('st-yamada', 'owner', []);
const THIS_MONTH = monthOf(todayJst());
const NEXT_MONTH = addMonths(THIS_MONTH, 1);

before(async () => {
  delete process.env.SALONONE_API_KEY; // デモデータで動かす
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sise-goals-')), 'db.json');
  globalThis.__SISE_SUPABASE_MOCK__ = createMockClient(file);
  ({ goalsGet, goalsPost } = await import('../api/_lib/db-handlers-goals.js'));
  ({ buildTrend } = await import('../api/_lib/salonone/summary.js'));
});

test('3ヶ月の目標: 期の最初の月で保存し、単月の目標とは別に持つ', async () => {
  const ok = await goalsPost({ action: 'set', period: 'quarter', month: '2027-01', scope: 'store', targetId: 'store-1', values: { consumedSales: '7,500,000', depositSales: '9,000,000円', newVisits: 100, contractRatePct: 50, memberCount: 160 } }, TAKAHASHI);
  assert.equal(ok.success, true);
  assert.equal(ok.goal.consumedSales, 7500000);
  assert.equal(ok.goal.depositSales, 9000000); // 入金売上の目標
  // 期の途中の月は受け付けない
  assert.ok((await goalsPost({ action: 'set', period: 'quarter', month: '2027-02', scope: 'store', targetId: 'store-1', values: { consumedSales: 1 } }, null)).error);
  assert.ok((await goalsGet({ period: 'quarter', month: '2027-02' }, null)).error);
  // スタッフは店舗の 3ヶ月の目標を設定できない・自分の分は設定できる
  assert.ok((await goalsPost({ action: 'set', period: 'quarter', month: '2027-01', scope: 'store', targetId: 'store-1', values: { consumedSales: 1 } }, SATO)).error);
  assert.equal((await goalsPost({ action: 'set', period: 'quarter', month: '2027-01', scope: 'staff', targetId: 'st-sato', values: { consumedSales: 2424000, depositSales: 3000000 } }, SATO)).success, true);
  const q = await goalsGet({ period: 'quarter', month: '2027-01' }, SATO);
  assert.equal(q.period, 'quarter');
  assert.equal(q.stores['store-1'].consumedSales, 7500000);
  assert.deepEqual(Object.keys(q.staff), ['st-sato']);
  const monthly = await goalsGet({ month: '2027-01' }, null);
  assert.deepEqual(monthly.stores, {});
});

test('3ヶ月の目標を単月に振り分ける（決めてある単月の目標は上書きしない）', async () => {
  await goalsPost({ action: 'set', month: '2027-02', scope: 'staff', targetId: 'st-sato', values: { consumedSales: 900000 } }, null);
  const r = await goalsPost({ action: 'splitQuarter', period: 'quarter', month: '2027-01' }, null);
  assert.equal(r.success, true);
  assert.equal(r.filled, 5); // 店舗 3ヶ月 + 佐藤さん 1・3月
  assert.equal(r.skipped, 1); // 佐藤さんの 2月
  const [jan, feb, mar] = await Promise.all(['2027-01', '2027-02', '2027-03'].map((m) => goalsGet({ month: m }, null)));
  assert.deepEqual([jan, feb, mar].map((d) => d.stores['store-1'].consumedSales), [2500000, 2500000, 2500000]);
  assert.deepEqual([jan, feb, mar].map((d) => d.stores['store-1'].depositSales), [3000000, 3000000, 3000000]);
  assert.deepEqual([jan, feb, mar].map((d) => d.stores['store-1'].newVisits), [33, 33, 34]);
  assert.equal(jan.stores['store-1'].contractRatePct, 50);
  assert.equal(jan.stores['store-1'].memberCount, undefined);
  assert.equal(mar.stores['store-1'].memberCount, 160); // 期末の人数は 3ヶ月目
  assert.deepEqual([jan, feb, mar].map((d) => d.staff['st-sato'].consumedSales), [808000, 900000, 808000]);
  assert.deepEqual([jan, mar].map((d) => d.staff['st-sato'].depositSales), [1000000, 1000000]);
  assert.equal(feb.staff['st-sato'].depositSales, undefined); // 決めてあった 2月はそのまま
  // 2回目は何もしない
  assert.equal((await goalsPost({ action: 'splitQuarter', period: 'quarter', month: '2027-01' }, null)).filled, 0);
});

test('3ヶ月の目標: 前の期からコピー', async () => {
  const r = await goalsPost({ action: 'copyFrom', period: 'quarter', month: '2027-04', fromMonth: '2027-01' }, TAKAHASHI);
  assert.equal(r.copied, 2);
  assert.ok((await goalsPost({ action: 'copyFrom', period: 'quarter', month: '2027-04', fromMonth: '2027-02' }, null)).error);
});

test('特別目標: 設定・変更・削除はオーナーだけ', async () => {
  const goal = { storeId: 'store-1', metric: 'consumedSales', target: '3,000,000', deadline: NEXT_MONTH, title: '', memo: '全員で' };
  assert.ok((await goalsPost({ action: 'specialSet', goal }, TAKAHASHI)).error);
  assert.ok((await goalsPost({ action: 'specialSet', goal }, SATO)).error);
  const r = await goalsPost({ action: 'specialSet', goal }, OWNER);
  assert.equal(r.success, true);
  assert.match(r.goal.id, /^sg_/);
  assert.equal(r.goal.target, 3000000);
  assert.equal(r.goal.startMonth, THIS_MONTH);
  assert.match(r.goal.title, /までに月売上300万円！$/);
  // 変更（タイトル・目標）
  const upd = await goalsPost({ action: 'specialSet', goal: { ...goal, id: r.goal.id, title: '冬のチャレンジ', target: 3200000 } }, null);
  assert.equal(upd.success, true);
  assert.equal(upd.goal.title, '冬のチャレンジ');
  assert.equal(upd.goal.createdAt, r.goal.createdAt);
  assert.ok((await goalsPost({ action: 'specialDelete', id: r.goal.id }, TAKAHASHI)).error);
  // 入力の確認
  assert.ok((await goalsPost({ action: 'specialSet', goal: { ...goal, storeId: 'store-x' } }, OWNER)).error);
  assert.ok((await goalsPost({ action: 'specialSet', goal: { ...goal, metric: 'contractRatePct' } }, OWNER)).error);
  assert.ok((await goalsPost({ action: 'specialSet', goal: { ...goal, target: 0 } }, OWNER)).error);
  assert.ok((await goalsPost({ action: 'specialSet', goal: { ...goal, deadline: addMonths(THIS_MONTH, -1) } }, OWNER)).error);
  assert.ok((await goalsPost({ action: 'specialSet', goal: { ...goal, id: 'sg_nope' } }, OWNER)).error);
});

test('特別目標: その店舗を見られる人だけに見せる', async () => {
  await goalsPost({ action: 'specialSet', goal: { storeId: 'store-2', metric: 'memberCount', target: 150, deadline: NEXT_MONTH } }, OWNER);
  const all = await goalsGet({ period: 'special' }, OWNER);
  assert.deepEqual(all.items.map((g) => g.storeId).sort(), ['store-1', 'store-2']);
  const staff = await goalsGet({ period: 'special' }, SATO);
  assert.deepEqual(staff.items.map((g) => g.storeId), ['store-1']);
  const manager = await goalsGet({ period: 'special' }, TAKAHASHI);
  assert.deepEqual(manager.items.map((g) => g.storeId), ['store-1']);
  const id = all.items.find((g) => g.storeId === 'store-2').id;
  assert.equal((await goalsPost({ action: 'specialDelete', id }, OWNER)).success, true);
  assert.deepEqual((await goalsGet({ period: 'special' }, null)).items.map((g) => g.storeId), ['store-1']);
});

test('推移に顧客数が入る（来店頻度の計算用）', async () => {
  const t = await buildTrend(null, { months: 3, endMonth: '2026-09', storeId: 'store-1' });
  assert.ok(t.months.every((m) => m.customerCount > m.newCount));
});
