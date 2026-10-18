// 4つのロール（スタッフ・店長・マネージャー・オーナー）の見える範囲と、スタッフURLの確認。
// ローカル開発用の疑似 DB（scripts/dev/supabase-mock.mjs）を差し込んで実際のハンドラを動かす。
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createMockClient } from '../scripts/dev/supabase-mock.mjs';
import { normalizeRole, roleLabel, isOwnerRole, isStoreManagerRole, isKnownRole } from '../shared/roles.js';

let db;
let summary;
let goals;
let master;
let auth;
let sign;
let dbHandler;

const ctx = (staffId, role, storeIds) => ({ valid: true, staffId, role, storeIds, name: staffId });
const AREA = ctx('st-area', 'area_manager', ['store-1', 'store-2']);
const OWNER = ctx('st-owner', 'owner', []);

before(async () => {
  delete process.env.SALONONE_API_KEY; // デモデータで動かす
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sise-roles-')), 'db.json');
  db = createMockClient(file);
  globalThis.__SISE_SUPABASE_MOCK__ = db;
  // 3店舗目と、マネージャー・オーナーを足す
  await db.from('stores').insert({ id: 'store-3', name: '北口店', status: 'active', memo: '', merged_into: null, created_at: new Date().toISOString() });
  await db.from('staff').insert([
    { id: 'st-kato', name: '加藤 茜', role: 'staff', password: '', status: 'active', created_at: new Date().toISOString() },
    { id: 'st-area', name: '木村 マネージャー', role: 'area_manager', password: '', status: 'active', created_at: new Date().toISOString() },
    { id: 'st-owner', name: 'オーナー', role: 'owner', password: '', status: 'active', created_at: new Date().toISOString() },
  ]);
  await db.from('staff_stores').insert([
    { staff_id: 'st-kato', store_id: 'store-3' },
    { staff_id: 'st-area', store_id: 'store-1' },
    { staff_id: 'st-area', store_id: 'store-2' },
  ]);
  summary = await import('../api/_lib/salonone/summary.js');
  goals = await import('../api/_lib/db-handlers-goals.js');
  master = await import('../api/_lib/db-handlers-master.js');
  auth = await import('../api/_lib/auth.js');
  sign = await import('../api/_lib/sign.js');
  dbHandler = (await import('../api/db/index.js')).default;
});

test('ロールの名前と、旧「本部」の読み替え', () => {
  assert.equal(normalizeRole('headquarter'), 'owner');
  assert.equal(normalizeRole('area_manager'), 'area_manager');
  assert.equal(normalizeRole('???'), 'staff');
  assert.equal(normalizeRole(undefined), 'staff');
  assert.deepEqual(['staff', 'manager', 'area_manager', 'owner'].map(roleLabel), ['スタッフ', '店長', 'マネージャー', 'オーナー']);
  assert.equal(roleLabel('headquarter'), 'オーナー');
  assert.equal(isOwnerRole('headquarter'), true);
  assert.equal(isStoreManagerRole('area_manager'), true);
  assert.equal(isStoreManagerRole('owner'), false);
  assert.equal(isKnownRole('headquarter'), true);
  assert.equal(isKnownRole('admin'), false);
});

test('マネージャーは管轄の店舗（複数）の全体とスタッフ全員。管轄外は見えない', async () => {
  const all = await summary.buildSummary(AREA, { month: '2026-10', storeId: 'all' });
  assert.deepEqual(all.scope.storeIds.sort(), ['store-1', 'store-2']);
  assert.equal(all.scope.canSeeAll, false);
  const ids = all.staff.map((r) => r.staffId);
  assert.ok(ids.includes('st-sato') && ids.includes('st-tanaka')); // 両店舗のスタッフ
  assert.ok(!ids.includes('st-kato')); // 管轄外の店舗のスタッフ
  await assert.rejects(() => summary.buildSummary(AREA, { month: '2026-10', storeId: 'store-3' }), (e) => e instanceof summary.AccessError);
  // 目標も管轄の店舗だけ
  assert.equal((await goals.goalsPost({ action: 'set', month: '2026-11', scope: 'store', targetId: 'store-2', values: { consumedSales: 2000000 } }, AREA)).success, true);
  assert.ok((await goals.goalsPost({ action: 'set', month: '2026-11', scope: 'store', targetId: 'store-3', values: { consumedSales: 1 } }, AREA)).error);
  assert.equal((await goals.goalsPost({ action: 'set', month: '2026-11', scope: 'staff', targetId: 'st-tanaka', values: { consumedSales: 600000 } }, AREA)).success, true);
  // スタッフ一覧も管轄の店舗のスタッフだけ
  const list = await master.staffGet({}, AREA);
  const names = list.staff.map((s) => s.id);
  assert.ok(names.includes('st-ito') && !names.includes('st-kato'));
});

test('オーナーは全店舗・全スタッフ（旧「本部」も同じ）', async () => {
  for (const owner of [OWNER, ctx('st-yamada', 'headquarter', [])]) {
    const s = await summary.buildSummary(owner, { month: '2026-10', storeId: 'all' });
    assert.equal(s.scope.canSeeAll, true);
    assert.deepEqual(s.scope.storeIds.sort(), ['store-1', 'store-2', 'store-3']);
    assert.ok(s.staff.map((r) => r.staffId).includes('st-kato'));
    assert.equal(auth.isAdminOrOwner(owner), true);
    assert.equal(auth.canAccessStore(owner, 'store-3'), true);
  }
  assert.equal(auth.isAdminOrOwner(AREA), false);
  assert.equal(auth.canAccessStore(AREA, 'store-3'), false);
});

test('スタッフの保存: 4つのロールを保存でき、旧「本部」はオーナーとして保存する', async () => {
  const save = (role) => master.staffPost({ action: 'saveStaff', staff: [{ id: `st-new-${role}`, name: role, role, storeIds: ['store-1'] }] }, null);
  for (const role of ['staff', 'manager', 'area_manager', 'owner']) assert.equal((await save(role)).success, true);
  await save('headquarter');
  const list = await master.staffGet({}, null);
  const byId = Object.fromEntries(list.staff.map((s) => [s.id, s.role]));
  assert.equal(byId['st-new-area_manager'], 'area_manager');
  assert.equal(byId['st-new-headquarter'], 'owner');
  assert.equal(byId['st-yamada'], 'owner'); // DB に残っている旧「本部」もオーナーとして返す
  assert.ok((await master.staffPost({ action: 'updateStaff', staffId: 'st-kato', updates: { role: 'king' } }, null)).error);
  assert.equal((await master.staffPost({ action: 'updateStaff', staffId: 'st-kato', updates: { role: 'manager' } }, null)).success, true);
  // オーナー以外は変更できない
  assert.ok((await master.staffPost({ action: 'updateStaff', staffId: 'st-kato', updates: { role: 'owner' } }, AREA)).error);
});

function fakeRes() {
  return {
    code: 200, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}
const callAuth = async (headers) => {
  const res = fakeRes();
  await dbHandler({ method: 'GET', query: { table: 'auth' }, headers }, res);
  return res;
};

test('スタッフURLを開くと、今の権限（DB の値）を返す。ロールを変えても再発行は不要', async () => {
  const token = sign.signToken({ id: 'st-tanaka', n: '田中 大輔', r: 'staff', sid: ['store-2'] });
  let r = await callAuth({ 'x-staff-token': token });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.staff, { id: 'st-tanaka', name: '田中 大輔', role: 'staff', storeIds: ['store-2'] });
  // 設定でマネージャーに変えて管轄店舗を足すと、同じ URL のまま反映される
  await master.staffPost({ action: 'updateStaff', staffId: 'st-tanaka', updates: { role: 'area_manager', storeIds: ['store-2', 'store-3'] } }, null);
  r = await callAuth({ 'x-staff-token': token });
  assert.equal(r.body.staff.role, 'area_manager');
  assert.deepEqual(r.body.staff.storeIds.sort(), ['store-2', 'store-3']);
  // 旧「本部」のスタッフはオーナーとして返る
  const yamada = sign.signToken({ id: 'st-yamada', n: '山田 本部', r: 'headquarter', sid: [] });
  assert.equal((await callAuth({ 'x-staff-token': yamada })).body.staff.role, 'owner');
});

test('以前のダッシュボードの URL（スタッフ ID が無い）は使えない理由を返す', async () => {
  const old = Buffer.from(JSON.stringify({ n: '鈴木', r: 'manager', sid: ['2'] })).toString('base64');
  const r = await callAuth({ 'x-staff-token': old });
  assert.equal(r.code, 401);
  assert.match(r.body.error, /staff_id_missing/);
  const tampered = `${sign.signToken({ id: 'st-sato', n: '佐藤', r: 'staff', sid: [] }).split('.')[0]}.AAAA`;
  assert.match((await callAuth({ 'x-staff-token': tampered })).body.error, /signed_bad_signature/);
});
