// 出納帳と SalonOne の現金売上（突合・取り込み）のテスト
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createMockClient } from '../scripts/dev/supabase-mock.mjs';
import { reconcileDaily } from '../src/features/cashbook/calc.js';
import { salonOneCashEntryId, isManualSalesCash, isSalonOneCashEntry } from '../shared/cashbook.js';

let cashbookPost;
let menuItemsPost;

before(async () => {
  delete process.env.SALONONE_API_KEY; // デモデータ（取り込みは拒否される）
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sise-cb-')), 'db.json');
  globalThis.__SISE_SUPABASE_MOCK__ = createMockClient(file);
  ({ cashbookPost } = await import('../api/_lib/db-handlers-cashbook.js'));
  ({ menuItemsPost } = await import('../api/_lib/db-handlers-master.js'));
});

const entry = (o) => ({ type: 'income', paymentMethod: 'CASH', cashType: 'register', store: 'store-1', category: '施術売上', amount: 0, ...o });

test('取り込んだ記録と手入力の売上を見分ける', () => {
  const imported = entry({ id: salonOneCashEntryId('store-1', '2026-10-05'), amount: 1000 });
  assert.equal(isSalonOneCashEntry(imported), true);
  assert.equal(isManualSalesCash(imported), false);
  assert.equal(isManualSalesCash(entry({ id: 'cb_1', amount: 1000 })), true);
  // 売上でない入金・現金以外・出金は手入力の売上に数えない
  assert.equal(isManualSalesCash(entry({ id: 'cb_2', category: 'その他収入' })), false);
  assert.equal(isManualSalesCash(entry({ id: 'cb_3', paymentMethod: 'CARD' })), false);
  assert.equal(isManualSalesCash(entry({ id: 'cb_4', type: 'expense', category: '消耗品' })), false);
});

test('突合: 売上だけを比べ、取り込める日を出す', () => {
  const entries = [
    entry({ id: salonOneCashEntryId('store-1', '2026-10-01'), date: '2026-10-01', amount: 5000 }), // 取り込み済み・一致
    entry({ id: salonOneCashEntryId('store-1', '2026-10-02'), date: '2026-10-02', amount: 3000 }), // 取り込み済み・SalonOne 側が変わった
    entry({ id: 'cb_a', date: '2026-10-03', amount: 7000 }), // 手入力（取り込まない）
    entry({ id: 'cb_b', date: '2026-10-04', category: 'その他収入', amount: 9999 }), // 釣銭補充などは比べない
    entry({ id: 'cb_c', date: '2026-10-04', store: 'store-2', amount: 1234 }), // 別の店舗
  ];
  const salonDaily = [
    { date: '2026-10-01', cashSales: 5000 },
    { date: '2026-10-02', cashSales: 4000 },
    { date: '2026-10-03', cashSales: 8000 },
    { date: '2026-10-04', cashSales: 2000 },
    { date: '2026-10-20', cashSales: 1000 }, // 集計日より後
  ];
  const r = reconcileDaily({ entries, storeId: 'store-1', month: '2026-10', salonDaily, asOf: '2026-10-10' });
  const day = (d) => r.rows.find((x) => x.date === d);
  assert.equal(r.rows.length, 31);
  assert.deepEqual([day('2026-10-01').source, day('2026-10-01').status, day('2026-10-01').canImport], ['imported', 'match', false]);
  assert.deepEqual([day('2026-10-02').source, day('2026-10-02').diff, day('2026-10-02').canImport], ['imported', -1000, true]);
  assert.deepEqual([day('2026-10-03').source, day('2026-10-03').diff, day('2026-10-03').canImport], ['manual', -1000, false]);
  assert.deepEqual([day('2026-10-04').source, day('2026-10-04').cashbook, day('2026-10-04').canImport], ['none', 0, true]);
  assert.deepEqual([day('2026-10-20').status, day('2026-10-20').canImport], ['pending', false]);
  assert.deepEqual(r.importable, ['2026-10-02', '2026-10-04']);
  // 集計日より後は合計に入れない
  assert.equal(r.total.salon, 19000);
  assert.equal(r.total.cashbook, 15000);
});

test('取り込み: デモデータは出納帳へ書き込まない', async () => {
  const r = await cashbookPost({ action: 'importSalonOneCash', storeId: 'store-1', dates: ['2026-10-05'] }, null);
  assert.match(r.error, /未接続/);
  assert.equal(r.demo, true);
});

test('取り込み: 入力と権限の確認', async () => {
  assert.match((await cashbookPost({ action: 'importSalonOneCash', storeId: 'store-1', dates: [] }, null)).error, /必要/);
  assert.match((await cashbookPost({ action: 'importSalonOneCash', storeId: 'store-1', dates: ['10/05'] }, null)).error, /形式/);
  const tanaka = { valid: true, staffId: 'st-tanaka', role: 'staff', storeIds: ['store-2'], name: '田中' };
  assert.match((await cashbookPost({ action: 'importSalonOneCash', storeId: 'store-1', dates: ['2026-10-05'] }, tanaka)).error, /権限/);
});

test('メニューの変更は店舗責任者以上', async () => {
  const sato = { valid: true, staffId: 'st-sato', role: 'staff', storeIds: ['store-1'], name: '佐藤' };
  const takahashi = { valid: true, staffId: 'st-takahashi', role: 'manager', storeIds: ['store-1'], name: '高橋' };
  assert.match((await menuItemsPost({ action: 'addItem', item: { name: 'テスト', price: 1000 } }, sato)).error, /店舗責任者/);
  assert.equal((await menuItemsPost({ action: 'addItem', item: { name: 'テスト', price: 1000 } }, takahashi)).success, true);
  assert.equal((await menuItemsPost({ action: 'addItem', item: { name: '管理者', price: 1000 } }, null)).success, true);
});
