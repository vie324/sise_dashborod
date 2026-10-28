// カウンセリングシート（Google フォーム → GAS）: フォームを使う店舗だけの任意の連携。
// チェック項目の対応・SalonOne の予約との結びつけ（お名前）・サーバーの見える範囲・設定の保存。
// GAS は scripts/dev/gas-fake.mjs の疑似 GAS で置き換える。
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createMockClient } from '../scripts/dev/supabase-mock.mjs';
import { fakeGasFetch, FAKE_GAS_TOKEN } from '../scripts/dev/gas-fake.mjs';
import {
  mapFormConcerns, matchConcern, isNoAnswer, guessGasStore, resolveGasStore, GAS_STORES,
  personKey, personKeys, linkSheetsToVisits, visitForSheet, rankSheetsFor, nameSearch, CONCERN_ITEMS,
} from '../shared/counseling.js';

const GAS_URL = 'https://script.google.com/macros/s/AKfycbFAKEDEPLOYMENT1234TA/exec';
const ctx = (staffId, role, storeIds) => ({ valid: true, staffId, role, storeIds, name: staffId });
const HON_STAFF = ctx('st-hon', 'staff', ['store-hon']);
const SATO = ctx('st-sato', 'staff', ['store-1']);
const OWNER = ctx('st-owner', 'owner', []);

let db;
let counseling;
let dbHandler;
let calls = [];

before(async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sise-counseling-')), 'db.json');
  db = createMockClient(file);
  globalThis.__SISE_SUPABASE_MOCK__ = db;
  const now = new Date().toISOString();
  await db.from('stores').insert([
    { id: 'store-hon', name: '本厚木店', status: 'active', memo: '', merged_into: null, created_at: now },
    { id: 'store-shy', name: '新横浜店', status: 'active', memo: '', merged_into: null, created_at: now },
  ]);
  counseling = await import('../api/_lib/counseling.js');
  dbHandler = (await import('../api/db/index.js')).default;
});

beforeEach(async () => {
  calls = [];
  globalThis.fetch = fakeGasFetch(calls);
  process.env.COUNSELING_GAS_URL = GAS_URL;
  delete process.env.COUNSELING_GAS_TOKEN;
  await db.from('dash_config').delete().eq('key', 'counseling.config');
  counseling.clearCounselingCache();
});

// ------------------------------------------------------------
// フォームの回答 → チェック項目 / おすすめプラン
// ------------------------------------------------------------
test('フォームのお悩み → チェック項目（部分一致）。項目に無い回答は unmatched に残す', () => {
  const r = mapFormConcerns(['肩こり', '姿勢・猫背', 'ストレートネック', '頭痛', ' ']);
  assert.deepEqual(Object.keys(r.checked).sort(), ['c6', 'c7', 'c8']);
  assert.deepEqual(r.unmatched, ['頭痛']);
  assert.deepEqual(matchConcern('首'), ['c6']); // 選択肢が短い言葉でも拾う
  assert.deepEqual(matchConcern('むくみ'), ['c12']);
  assert.deepEqual(matchConcern('肩凝りがひどい'), ['c7']);
  assert.deepEqual(mapFormConcerns(undefined), { checked: {}, unmatched: [] });
});

test('「いいえ」「なし」などは注意事項に出さない', () => {
  for (const v of ['いいえ', 'なし', '該当なし', ' なし。', '特になし', 'ー', '', null]) assert.equal(isNoAnswer(v), true, String(v));
  for (const v of ['金属アレルギー', 'はい（帝王切開）', '通院中']) assert.equal(isNoAnswer(v), false, v);
});

test('お名前の比べ方: 空白・全角半角・「様」の違いは同じ人として扱う', () => {
  assert.equal(personKey('山本　さくら 様'), '山本さくら');
  assert.equal(personKey(' 山本 さくら'), personKey('山本さくら'));
  assert.equal(personKey('ﾔﾏﾓﾄ ｻｸﾗ'), 'ヤマモトサクラ');
  assert.equal(personKey('小林 美穂さん'), '小林美穂');
  assert.equal(personKey(null), '');
  assert.notEqual(personKey('山本 さくら'), personKey('やまもと さくら')); // 読みが違う書き方は結びつけない（スタッフが選ぶ）
});

test('予約とフォームの回答をお名前で結びつける: 同じ人は新しい回答・3日より前の回答は使わない', () => {
  const visits = [
    { id: 'v1', customerName: '山本 さくら' },
    { id: 'v2', customerName: '小林美穂' },
    { id: 'v3', customerName: null }, // SalonOne のキーがお名前を返さない設定
    { id: 'v4', customerName: '加藤 由紀' },
    { id: 'v5', customerName: '高木 ゆかり' },
  ];
  const sheets = [
    { index: 3, name: '山本 さくら', submittedAt: '2026-10-19T00:10:00.000Z' },
    { index: 5, name: '山本　さくら', submittedAt: '2026-10-21T00:10:00.000Z' },
    { index: 4, name: '小林 美穂 様', submittedAt: '2026-10-20T03:00:00.000Z' },
    { index: 1, name: '加藤 由紀', submittedAt: '2026-10-10T03:00:00.000Z' },
    { index: 6, name: '高木 ゆかり', submittedAt: null },
    { index: 7, name: '', submittedAt: '2026-10-21T01:00:00.000Z' },
  ];
  const links = linkSheetsToVisits(visits, sheets, { today: '2026-10-21' });
  assert.deepEqual(Object.fromEntries(Object.entries(links).map(([id, s]) => [id, s.index])), { v1: 5, v2: 4 });
  assert.deepEqual(linkSheetsToVisits(visits, sheets, { today: '2026-10-21', days: 30 }).v4.index, 1);
  assert.deepEqual(linkSheetsToVisits(visits.map((v) => ({ ...v, customerName: null })), sheets, { today: '2026-10-21' }), {});
  assert.deepEqual(linkSheetsToVisits(undefined, undefined, { today: '2026-10-21' }), {});

  // 回答から予約を探す（フォームの回答の一覧から選んだ時）
  assert.equal(visitForSheet(visits, { name: '小林 美穂' }).id, 'v2');
  assert.equal(visitForSheet(visits, { name: '吉田 真央' }), null);
  assert.equal(visitForSheet(visits, { name: '' }), null);
});

test('SalonOne の登録の重なり（名の欄にも姓・姓の欄にもお名前）・読みのかっこ書き・異体字でも同じ人とみなす', () => {
  assert.deepEqual(personKeys('山田 山田　花子'), ['山田山田花子', '山田花子']);
  assert.deepEqual(personKeys('山田 山田花子 様'), ['山田山田花子', '山田花子']);
  assert.deepEqual(personKeys('山田花子 花子'), ['山田花子花子', '山田花子']);
  assert.deepEqual(personKeys('山田 花子 花子'), ['山田花子花子', '山田花子']);
  assert.deepEqual(personKeys('山田 花子'), ['山田花子']);
  assert.deepEqual(personKeys('林 林太郎'), ['林林太郎']); // 1文字の姓で始まる名は重なりとみなさない
  assert.deepEqual(personKeys('林 林　太郎'), ['林林太郎', '林太郎']);
  assert.deepEqual(personKeys(''), []);
  assert.equal(personKey('山田 花子（ヤマダ ハナコ）'), '山田花子');
  assert.equal(personKey('(ヤマダ)'), 'ヤマダ');
  assert.equal(personKey('髙橋　愛'), personKey('高橋 愛'));
  assert.equal(personKey('𠮷川 舞'), personKey('吉川 舞'));
  assert.equal(personKey('マリア・ロペス'), personKey('マリア ロペス'));

  const visits = [
    { id: 'v1', customerName: '山田 山田　花子' },
    { id: 'v2', customerName: '髙橋 愛' },
    { id: 'v3', customerName: '林 林太郎' },
    { id: 'v4', customerName: '大野 さき' },
  ];
  const sheets = [
    { index: 1, name: '山田花子', submittedAt: '2026-10-21T01:00:00.000Z' },
    { index: 2, name: '高橋　愛 様', submittedAt: '2026-10-21T02:00:00.000Z' },
    { index: 3, name: '林 太郎', submittedAt: '2026-10-21T03:00:00.000Z' },
    { index: 4, name: '大野 さき（オオノ）', submittedAt: '2026-10-21T04:00:00.000Z' },
  ];
  const links = linkSheetsToVisits(visits, sheets, { today: '2026-10-21' });
  assert.deepEqual(Object.fromEntries(Object.entries(links).map(([id, x]) => [id, x.index])), { v1: 1, v2: 2, v4: 4 });
  // 回答から予約を探す時も同じ
  assert.equal(visitForSheet(visits, { name: '山田 花子' }).id, 'v1');
  assert.equal(visitForSheet(visits, { name: '林 太郎' }), null);
  // 書き方まで同じ予約を先に（重なりを外して同じになる予約より）
  assert.equal(visitForSheet([{ id: 'a', customerName: '山田 山田花子' }, { id: 'b', customerName: '山田 花子' }], { name: '山田花子' }).id, 'b');
});

test('回答から選ぶ時の並び: 3日以内でお名前が近い回答 → 3日以内 → それより前（それぞれ新しい順）', () => {
  const sheets = [
    { index: 1, name: '山田 由美', submittedAt: '2026-10-10T01:00:00.000Z' },
    { index: 2, name: 'ヤマダ ハナコ', submittedAt: '2026-10-21T05:00:00.000Z' },
    { index: 3, name: '山田はなこ', submittedAt: '2026-10-21T01:00:00.000Z' },
    { index: 4, name: '佐藤 花子', submittedAt: '2026-10-20T01:00:00.000Z' },
    { index: 5, name: '鈴木 一美', submittedAt: '2026-10-21T06:00:00.000Z' },
  ];
  const order = (name) => rankSheetsFor(name, sheets, { today: '2026-10-21' }).map((x) => x.index);
  assert.deepEqual(order('山田 花子'), [3, 4, 5, 2, 1]);
  assert.deepEqual(order(''), [5, 2, 3, 4, 1]);
  assert.deepEqual(rankSheetsFor('山田 花子', undefined, { today: '2026-10-21' }), []);
});

test('お名前の検索: 空白・全角半角・「様」の違いで漏れない（GAS には最初の 2文字で聞く）', () => {
  const s = nameSearch('山田　花子 様');
  assert.equal(s.gasQuery, '山田');
  assert.equal(s.matches('山田花子'), true);
  assert.equal(s.matches('山田 花子'), true);
  assert.equal(s.matches('山田 由美'), false);
  assert.equal(nameSearch('花子').matches('山田 花子'), true);
  assert.equal(nameSearch('髙橋').gasQuery, '髙橋'); // GAS には書かれたまま聞く
  assert.equal(nameSearch('髙橋').matches('高橋 愛'), true);
  assert.equal(nameSearch(' 様 '), null);
  assert.equal(nameSearch(''), null);
});

test('フォームの選択肢はすべてチェック項目に入る（全店舗のフォームの選択肢。二の腕のたるみ は姿勢矯正）', () => {
  const FORM_OPTIONS = ['頭・はちの張り', '眼精疲労', '頬のたるみ', '食いしばり・エラの張り', '顔の左右差', '首・ストレートネック', '肩こり', '腰痛',
    '股関節・膝の痛み', '冷え・むくみ', '生理痛・生理不順', '下半身太り', '二の腕のたるみ', '骨盤の歪み', '姿勢・猫背', '反り腰', 'X脚・O脚'];
  for (const o of FORM_OPTIONS) assert.equal(matchConcern(o).length, 1, o);
  const ids = FORM_OPTIONS.map((o) => matchConcern(o)[0]);
  assert.equal(new Set(ids).size, FORM_OPTIONS.length);
  assert.equal(new Set(CONCERN_ITEMS.map((c) => c.id)).size, CONCERN_ITEMS.length);
  assert.equal(CONCERN_ITEMS.find((c) => c.id === matchConcern('二の腕のたるみ')[0]).cat, 'posture');
});

test('フォームの店舗との対応付け: 名前が同じ店舗だけ自動（新横浜店は横浜店にしない）', () => {
  assert.equal(guessGasStore('本厚木店'), 'honatsugi');
  assert.equal(guessGasStore("si'se 本厚木"), 'honatsugi');
  assert.equal(guessGasStore('横浜店'), 'yokohama');
  assert.equal(guessGasStore('新横浜店'), '');
  assert.equal(guessGasStore('中央店'), '');
  const hon = { id: 'store-hon', name: '本厚木店' };
  assert.equal(resolveGasStore(hon, {}, GAS_STORES), 'honatsugi');
  assert.equal(resolveGasStore(hon, { 'store-hon': 'none' }, GAS_STORES), '');
  assert.equal(resolveGasStore(hon, { 'store-hon': 'yamato' }, GAS_STORES), 'yamato');
  assert.equal(resolveGasStore(hon, { 'store-hon': 'deleted' }, GAS_STORES), 'honatsugi'); // 無くなった店舗は自動に戻す
});

test('GAS の URL の確認と伏せ字', () => {
  assert.deepEqual(counseling.validateGasUrl(`${GAS_URL}?type=counseling`), { ok: true, url: GAS_URL });
  assert.equal(counseling.validateGasUrl('https://script.google.com/a/macros/example.com/s/AKfycbFAKEDEPLOYMENT1234/exec').ok, true);
  assert.equal(counseling.validateGasUrl('http://script.google.com/macros/s/AKfycbFAKEDEPLOYMENT1234/exec').ok, false);
  assert.equal(counseling.validateGasUrl('https://example.com/macros/s/AKfycbFAKEDEPLOYMENT1234/exec').ok, false);
  assert.equal(counseling.validateGasUrl('https://script.google.com/macros/s/AKfycbFAKEDEPLOYMENT1234/dev').ok, false);
  assert.equal(counseling.validateGasUrl('かうんせりんぐ').ok, false);
  assert.equal(counseling.maskGasUrl(GAS_URL), 'https://script.google.com/macros/s/AKfycb…34TA/exec');
});

// ------------------------------------------------------------
// サーバー: 見える範囲と回答の整形
// ------------------------------------------------------------
test('未設定なら「未設定」を返し、GAS は呼ばない', async () => {
  delete process.env.COUNSELING_GAS_URL;
  const s = await counseling.counselingGet({ action: 'stores' }, null);
  assert.equal(s.configured, false);
  assert.ok(s.stores.every((x) => x.linked === false));
  const r = await counseling.counselingGet({ action: 'recent', storeId: 'store-hon' }, null);
  assert.equal(r.code, 'not_configured');
  assert.equal(calls.length, 0);
});

test('スタッフは所属店舗の回答だけ。新しい順で、GAS のデバッグ情報は返さない', async () => {
  const s = await counseling.counselingGet({ action: 'stores' }, HON_STAFF);
  assert.deepEqual(s.stores, [{ id: 'store-hon', name: '本厚木店', linked: true, formName: '本厚木店' }]);
  assert.equal(s.canConfigure, false);

  const r = await counseling.counselingGet({ action: 'recent', storeId: 'store-hon' }, HON_STAFF);
  assert.equal(r.error, undefined);
  assert.equal(r.customers[0].name, '山本 さくら');
  assert.deepEqual(r.customers[0].concerns, ['肩こり', '姿勢・猫背', 'ストレートネック', '頭痛']);
  assert.ok(r.customers.every((c, i) => i === 0 || r.customers[i - 1].submittedAt >= c.submittedAt));
  assert.equal(JSON.stringify(r).includes('_debug'), false);
  assert.equal(calls.find((u) => u.searchParams.get('action') === 'recent').searchParams.get('store'), 'honatsugi');

  // 所属外の店舗は断る（GAS も呼ばない）
  const before = calls.length;
  const denied = await counseling.counselingGet({ action: 'recent', storeId: 'store-hon' }, SATO);
  assert.equal(denied.code, 'forbidden');
  assert.equal((await counseling.counselingGet({ action: 'detail', storeId: 'store-hon', index: '0' }, SATO)).code, 'forbidden');
  assert.equal(calls.length, before);
});

test('名前の違う店舗は対応付けるまで読めない。対応付け・「連携しない」は設定で上書きできる', async () => {
  const all = await counseling.counselingGet({ action: 'stores' }, OWNER);
  const byId = Object.fromEntries(all.stores.map((x) => [x.id, x]));
  assert.equal(byId['store-hon'].linked, true);
  assert.equal(byId['store-1'].linked, false);
  assert.equal(byId['store-shy'].linked, false);
  assert.equal(all.canConfigure, true);
  assert.equal((await counseling.counselingGet({ action: 'recent', storeId: 'store-1' }, OWNER)).code, 'not_linked');

  assert.equal((await counseling.counselingPost({ action: 'saveSettings', storeMap: { 'store-1': 'yamato', 'store-hon': 'none' } }, OWNER)).success, true);
  const yamato = await counseling.counselingGet({ action: 'recent', storeId: 'store-1' }, SATO);
  assert.equal(yamato.customers[0].name, '松本 理沙');
  assert.equal((await counseling.counselingGet({ action: 'recent', storeId: 'store-hon' }, HON_STAFF)).code, 'not_linked');
});

test('1件の内容: 電話・メールは返さない / 同意文を除く / 注意事項は「いいえ」「なし」を除いて出す', async () => {
  const list = (await counseling.counselingGet({ action: 'recent', storeId: 'store-hon' }, HON_STAFF)).customers;
  const idx = (name) => String(list.find((c) => c.name === name).index);
  const detail = async (name) => (await counseling.counselingGet({ action: 'detail', storeId: 'store-hon', index: idx(name), name }, HON_STAFF)).customer;

  const yamamoto = await detail('山本 さくら');
  assert.equal(yamamoto.phone, undefined);
  assert.equal(yamamoto.email, undefined);
  assert.equal(JSON.stringify(yamamoto).includes('_rawConcerns'), false);
  assert.deepEqual(yamamoto.treatmentExperience, ['整体', 'マッサージ']);
  assert.deepEqual(yamamoto.cautions, [{ key: 'allergy', label: 'アレルギー', value: '金属アレルギー', warn: true }]);
  assert.equal(yamamoto.occupation, '会社員（デスクワーク）');
  assert.equal(yamamoto.treatmentRequest, '強すぎない圧でお願いしたいです');

  const kobayashi = await detail('小林 美穂');
  assert.deepEqual(kobayashi.cautions.map((c) => c.label), ['手術歴']);

  // 美容整形 / 妊娠・特定疾患（以前の画面と同じ割り当て。中身ではっきり分かる時はそちら）
  const nakamura = await detail('中村 あかり');
  assert.deepEqual(nakamura.cautions, [{ key: 'pregnancyCheck', label: '美容整形', value: 'ヒアルロン酸注射（1年前）', warn: false }]);
  const sasaki = await detail('佐々木 恵');
  assert.deepEqual(sasaki.cautions, [{ key: 'cosmeticSurgery', label: '妊娠・特定疾患', value: '産後3ヶ月', warn: true }]);
  const kato = await detail('加藤 由紀');
  assert.deepEqual(kato.cautions.map((c) => [c.label, c.value]), [['治療中', '整形外科に通院中（腰椎）']]);
});

test('行がずれていたら名前で取り直す・名前で検索できる', async () => {
  const list = (await counseling.counselingGet({ action: 'recent', storeId: 'store-hon' }, HON_STAFF)).customers;
  const yamamotoIndex = String(list.find((c) => c.name === '山本 さくら').index);
  const r = await counseling.counselingGet({ action: 'detail', storeId: 'store-hon', index: yamamotoIndex, name: '加藤 由紀' }, HON_STAFF);
  assert.equal(r.customer.name, '加藤 由紀');
  assert.equal((await counseling.counselingGet({ action: 'detail', storeId: 'store-hon', index: '99' }, HON_STAFF)).code, 'gas_error');

  const found = await counseling.counselingGet({ action: 'search', storeId: 'store-hon', q: '小林' }, HON_STAFF);
  assert.deepEqual(found.customers.map((c) => c.name), ['小林 美穂']);
  // 空白なし・敬称つき・名だけでも見つかる
  for (const q of ['小林美穂', '小林　美穂 様', '美穂']) {
    const r = await counseling.counselingGet({ action: 'search', storeId: 'store-hon', q }, HON_STAFF);
    assert.deepEqual(r.customers.map((c) => c.name), ['小林 美穂'], q);
  }
  assert.deepEqual((await counseling.counselingGet({ action: 'search', storeId: 'store-hon', q: '小林 由紀' }, HON_STAFF)).customers, []);
  assert.equal(calls.filter((u) => u.searchParams.get('action') === 'search').every((u) => Array.from(u.searchParams.get('q')).length <= 2), true);
  assert.equal((await counseling.counselingGet({ action: 'search', storeId: 'store-hon', q: ' ' }, HON_STAFF)).code, 'bad_request');
});

test('質問の並びが違うフォーム（川口店）: 以前の GAS が別の質問の列から読んだ項目は出さない', async () => {
  // 以前の GAS は「改善したい時期」を免責事項の列、「施術のご要望」を施術経験の列、「施術経験」を手術歴の列から読んでいた
  const headers = ['タイムスタンプ', 'お名前を教えてください。', '生年月日を教えてください。', '電話番号を教えてください。', 'メールアドレスを教えてください。',
    '職業を教えてください。', 'お住まいを教えてください。', '該当するものにチェックを入れてください。', 'お悩み箇所にチェックをお願いいたします。',
    '施術に関するご要望がございましたらご記入ください。', 'ご利用されたことのある施術がございましたら教えてください。', '手術歴があればご記入ください。',
    '現在治療中の病気や怪我があればご記入ください。', 'アレルギーがあればご記入ください。', '美容整形等をされている場合、ご記入ください。', '接客へのご要望',
    '妊娠中の方・特定疾患の方・ペースメーカー及び金属がある方はお知らせください。', '【免責事項及び注意事項】 1. 当サロンでは美容、身体の機能改善を目的とし']
    .map((h, i) => `${i}:${h.slice(0, 30)}`);
  const colMap = { TIMESTAMP: 0, NAME: 1, VISIT_PURPOSE: 7, CONCERNS: 8, IMPROVEMENT_TIMELINE: 17, TREATMENT_REQUEST: 10, TREATMENT_EXPERIENCE: 11, SURGERY_HISTORY: 11 };
  const customer = {
    index: 0, name: '川口 テスト', timestamp: '2026-10-21T01:00:00.000Z', concerns: ['肩こり'], visitPurpose: ['施術効果を確認したい'],
    improvementTimeline: '上記の内容を理解した上で施術をうけ、施術後の異議を申し立てません。', treatmentRequest: '整体, マッサージ', treatmentExperience: ['無'],
    surgeryHistory: '無', currentTreatment: '無', allergy: '無', cosmeticSurgery: '', pregnancyCheck: '',
  };
  const old = counseling.normDetail(customer, { colMap, headers });
  assert.equal(old.improvementTimeline, '');
  assert.equal(old.treatmentRequest, '');
  assert.deepEqual(old.treatmentExperience, []);
  assert.deepEqual(old.visitPurpose, ['施術効果を確認したい']);
  assert.deepEqual(old.concerns, ['肩こり']);

  // 新しい GAS（正しい列から読む・無い質問は -1）はそのまま出す
  const fixed = counseling.normDetail({ ...customer, improvementTimeline: '', treatmentRequest: '強めでお願いします', treatmentExperience: ['整体', 'マッサージ'] },
    { colMap: { ...colMap, IMPROVEMENT_TIMELINE: -1, TREATMENT_REQUEST: 9, TREATMENT_EXPERIENCE: 10 }, headers });
  assert.equal(fixed.treatmentRequest, '強めでお願いします');
  assert.deepEqual(fixed.treatmentExperience, ['整体', 'マッサージ']);
  // 見出しが返らない GAS（疑似 GAS など）は確かめずに出す
  assert.equal(counseling.normDetail(customer, undefined).treatmentRequest, '整体, マッサージ');

  // 標準の並び（本厚木店など）はそのまま
  const standard = ['タイムスタンプ', 'お名前を教えてください。', '', '', '', '', '', '該当するものにチェックを入れてください。', 'お悩み箇所にチェックをお願いいたします。',
    '上記で回答いただいたお悩みはいつまでに解消したいといった目標はございますか？', '施術に関するご要望がございましたらご記入ください。',
    'ご利用されたことのある施術がございましたら教えてください。'].map((h, i) => `${i}:${h.slice(0, 30)}`);
  const std = counseling.normDetail({ ...customer, improvementTimeline: '3ヶ月以内に解消したい。', treatmentRequest: '肩を重点的に', treatmentExperience: ['整体'] },
    { colMap: { ...colMap, IMPROVEMENT_TIMELINE: 9, TREATMENT_REQUEST: 10, TREATMENT_EXPERIENCE: 11 }, headers: standard });
  assert.equal(std.improvementTimeline, '3ヶ月以内に解消したい。');
  assert.equal(std.treatmentRequest, '肩を重点的に');
  assert.deepEqual(std.treatmentExperience, ['整体']);
});

test('1件の内容は GAS の列の見出しも見て返す（detail の _debug を使う）', async () => {
  const base = fakeGasFetch(calls);
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (url.searchParams.get('action') !== 'detail') return base(input);
    calls.push(url);
    const body = {
      store: 'honatsugi',
      _debug: { colMap: { TREATMENT_REQUEST: 10 }, headers: ['10:ご利用されたことのある施術がございましたら教えてください。'] },
      customer: { index: 0, name: '本厚木 テスト', timestamp: '2026-10-21T01:00:00.000Z', concerns: [], treatmentRequest: '整体' },
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const r = await counseling.counselingGet({ action: 'detail', storeId: 'store-hon', index: '0', name: '本厚木 テスト' }, HON_STAFF);
  assert.equal(r.customer.name, '本厚木 テスト');
  assert.equal(r.customer.treatmentRequest, '');
});

test('20秒以内の読み直しは GAS を呼ばない（refresh=1 なら呼ぶ）', async () => {
  await counseling.counselingGet({ action: 'recent', storeId: 'store-hon' }, HON_STAFF);
  const n = calls.length;
  await counseling.counselingGet({ action: 'recent', storeId: 'store-hon' }, OWNER);
  assert.equal(calls.length, n);
  await counseling.counselingGet({ action: 'recent', storeId: 'store-hon', refresh: '1' }, HON_STAFF);
  assert.equal(calls.length, n + 1);
});

// ------------------------------------------------------------
// 設定・合言葉・接続テスト
// ------------------------------------------------------------
test('設定はオーナー・管理者だけ。URL は伏せて返し、保存できるのは GAS の /exec だけ', async () => {
  assert.equal((await counseling.counselingGet({ action: 'settings' }, HON_STAFF)).code, 'forbidden');
  assert.equal((await counseling.counselingPost({ action: 'saveSettings', gasUrl: GAS_URL }, HON_STAFF)).code, 'forbidden');
  assert.equal((await counseling.counselingGet({ action: 'test' }, SATO)).code, 'forbidden');

  let s = await counseling.counselingGet({ action: 'settings' }, OWNER);
  assert.equal(s.source, 'env');
  assert.equal(s.gasUrlMasked, 'https://script.google.com/macros/s/AKfycb…34TA/exec');
  assert.equal(JSON.stringify(s).includes(GAS_URL), false);
  assert.equal(s.stores.find((x) => x.id === 'store-hon').auto, 'honatsugi');
  assert.equal(s.gasStoresSource, 'gas');

  assert.ok((await counseling.counselingPost({ action: 'saveSettings', gasUrl: 'https://evil.example.com/exec' }, null)).error);
  const other = 'https://script.google.com/macros/s/AKfycbANOTHERDEPLOYMENT99/exec';
  assert.equal((await counseling.counselingPost({ action: 'saveSettings', gasUrl: other }, null)).success, true);
  s = await counseling.counselingGet({ action: 'settings' }, null);
  assert.equal(s.source, 'settings');
  assert.equal(s.gasUrlMasked, 'https://script.google.com/macros/s/AKfycb…NT99/exec');
  await counseling.counselingGet({ action: 'recent', storeId: 'store-hon' }, HON_STAFF);
  assert.equal(calls.at(-1).origin + calls.at(-1).pathname, other);
  // 空で保存すると設定を消して環境変数に戻る
  await counseling.counselingPost({ action: 'saveSettings', gasUrl: '' }, null);
  assert.equal((await counseling.counselingGet({ action: 'settings' }, null)).source, 'env');
});

test('GAS の URL・合言葉は一般の設定（dashConfig）からは読めず、書き換えもできない', async () => {
  await counseling.counselingPost({ action: 'saveSettings', gasUrl: GAS_URL, token: 'secret-word' }, null);
  const call = async (method, query, body) => {
    const res = { code: 200, body: null, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
    await dbHandler({ method, query, headers: {}, body }, res);
    return res.body;
  };
  const all = await call('GET', { table: 'dashConfig' });
  assert.equal('counseling.config' in all.config, false);
  assert.ok((await call('GET', { table: 'dashConfig', key: 'counseling.config' })).error);
  assert.ok((await call('POST', { table: 'dashConfig' }, { action: 'set', key: 'counseling.config', value: { gasUrl: 'https://evil.example.com' } })).error);
  // スタッフの画面に返る値にも URL・合言葉は出ない
  const staffView = JSON.stringify(await counseling.counselingGet({ action: 'stores' }, HON_STAFF));
  assert.equal(staffView.includes('secret-word') || staffView.includes('AKfycb'), false);
});

test('合言葉: GAS 側で DASHBOARD_TOKEN を設定したら、同じ合言葉を保存するまで読めない', async () => {
  globalThis.fetch = fakeGasFetch(calls, { token: FAKE_GAS_TOKEN });
  const ng = await counseling.counselingGet({ action: 'recent', storeId: 'store-hon' }, HON_STAFF);
  assert.equal(ng.code, 'unauthorized');
  assert.match(ng.error, /合言葉/);
  await counseling.counselingPost({ action: 'saveSettings', token: FAKE_GAS_TOKEN }, OWNER);
  assert.equal((await counseling.counselingGet({ action: 'settings' }, OWNER)).tokenSet, true);
  const ok = await counseling.counselingGet({ action: 'recent', storeId: 'store-hon' }, HON_STAFF);
  assert.equal(ok.customers[0].name, '山本 さくら');
  assert.equal(calls.at(-1).searchParams.get('token'), FAKE_GAS_TOKEN);
});

test('接続テスト: 店舗ごとに読めるか・最新の回答日時だけを返す（お客様の名前は返さない）', async () => {
  const t = await counseling.counselingGet({ action: 'test' }, OWNER);
  assert.equal(t.ok, true);
  assert.deepEqual(t.results.map((r) => r.key), ['honatsugi', 'yamato', 'yokohama', 'machida', 'kawaguchi']);
  const hon = t.results.find((r) => r.key === 'honatsugi');
  assert.ok(hon.latestAt);
  assert.deepEqual(hon.linkedStores, ['本厚木店']);
  assert.equal(t.results.find((r) => r.key === 'machida').latestAt, null);
  assert.equal(JSON.stringify(t).includes('山本'), false);

  globalThis.fetch = async () => new Response('<html>Google ドライブ - ログイン</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
  const bad = await counseling.counselingGet({ action: 'test' }, OWNER);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /アクセスできるユーザー/);
});
