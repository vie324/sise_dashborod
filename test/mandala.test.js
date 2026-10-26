// マンダラチャート（週報・日報）のテスト。
// 純粋ロジック（shared/mandala.js・AI 出力の検証）と、疑似 DB を差し込んだ /api/mandala の処理を確かめる。
// 特に「仲間に見えるのはチャートと集計値だけ」「店長は担当店舗だけ」を重点的に見る。
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createMockClient } from '../scripts/dev/supabase-mock.mjs';
import { addDays, todayJst } from '../shared/dates.js';
import {
  weekStartOf, currentWeekStart, recentWeeks, isValidWeekStart, isDailyEditable, formatWeekRange, formatDay,
  canViewMember, canManageMember, canPeerView, canManageCheckItems, summarizeProgress, parseAmount, toMonthStart,
  trackableItems, focusCandidates, themeCheckRates, checkItemLink, shiftWeek,
} from '../shared/mandala.js';
import { validateWeeklyReview, validateMandalaAssist, toolChoiceFor, setAiCallerForTest } from '../api/_lib/mandala/ai.js';

let handle;
let db;

const ctx = (staffId, role, storeIds) => ({ valid: true, staffId, role, storeIds, name: staffId });
const SATO = ctx('st-sato', 'staff', ['store-1']);
const SUZUKI = ctx('st-suzuki', 'staff', ['store-1']);
const TAKAHASHI = ctx('st-takahashi', 'manager', ['store-1']);
const TANAKA = ctx('st-tanaka', 'staff', ['store-2']);
const ITO = ctx('st-ito', 'staff', ['store-2']);
const OWNER = ctx('st-yamada', 'owner', []);
const ADMIN = null;
const WEEK = currentWeekStart();
const TODAY = todayJst();

const get = (who, action, params = {}) => handle('GET', action, params, who);
const post = (who, action, body = {}) => handle('POST', action, body, who);
async function rejects(promise, status) {
  await assert.rejects(promise, (e) => { assert.equal(e.status, status, e.message); return true; });
}

before(async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sise-mandala-')), 'db.json');
  globalThis.__SISE_SUPABASE_MOCK__ = createMockClient(file);
  db = globalThis.__SISE_SUPABASE_MOCK__.__db;
  ({ handleMandala: handle } = await import('../api/_lib/mandala/handlers.js'));
});

// ------------------------------------------------------------
// 純粋ロジック
// ------------------------------------------------------------
test('週: 月曜はじまり・週の指定のチェック・表示', () => {
  assert.equal(weekStartOf('2026-10-26'), '2026-10-26'); // 月
  assert.equal(weekStartOf('2026-11-01'), '2026-10-26'); // 日
  assert.equal(weekStartOf('2026-10-31'), '2026-10-26'); // 土
  assert.equal(weekStartOf('2027-01-01'), '2026-12-28'); // 年をまたぐ
  assert.equal(isValidWeekStart('2026-10-26'), true);
  assert.equal(isValidWeekStart('2026-10-27'), false); // 火
  assert.equal(isValidWeekStart('2026-02-30'), false);
  assert.equal(isValidWeekStart('2026-10-26x'), false);
  assert.deepEqual(recentWeeks('2026-10-26', 3), ['2026-10-12', '2026-10-19', '2026-10-26']);
  assert.equal(formatWeekRange('2026-10-26'), '10/26(月)〜11/1(日)');
  assert.equal(formatDay('2026-10-31'), '10/31(土)');
  // 日本時間の深夜（UTC では前日）でも、日本の日付の週になる
  assert.equal(currentWeekStart(Date.parse('2026-10-25T16:30:00Z')), '2026-10-26');
});

test('日報: 書き直せるのは今日を含む 7日間だけ', () => {
  const now = Date.parse('2026-10-26T03:00:00Z');
  assert.equal(isDailyEditable('2026-10-26', now), true);
  assert.equal(isDailyEditable('2026-10-20', now), true);
  assert.equal(isDailyEditable('2026-10-19', now), false);
  assert.equal(isDailyEditable('2026-10-27', now), false);
});

test('見える範囲: 本人・オーナー・担当店舗の店長・相互公開の仲間', () => {
  const m = (id, storeIds, extra = {}) => ({ id, storeIds, active: true, shareChart: true, ...extra });
  const sato = m('a', ['s1']);
  const viewer = (staffId, role, storeIds) => ({ kind: 'staff', staffId, role, storeIds });
  assert.equal(canViewMember(viewer('a', 'staff', ['s1']), sato), true);
  assert.equal(canViewMember(viewer('b', 'staff', ['s1']), sato), false);
  assert.equal(canViewMember(viewer('c', 'manager', ['s1']), sato), true);
  assert.equal(canViewMember(viewer('c', 'manager', ['s2']), sato), false);
  assert.equal(canViewMember(viewer('d', 'area_manager', ['s2', 's1']), sato), true);
  assert.equal(canViewMember(viewer('e', 'owner', []), sato), true);
  assert.equal(canViewMember({ kind: 'admin', role: 'admin', storeIds: [] }, sato), true);
  assert.equal(canManageMember(viewer('b', 'staff', ['s1']), sato), false);
  assert.equal(canManageMember(viewer('c', 'manager', ['s1']), sato), true);

  const peer = m('b', ['s1']);
  const other = m('x', ['s2']);
  assert.equal(canPeerView(peer, sato, 'off'), false);
  assert.equal(canPeerView(peer, sato, 'store'), true);
  assert.equal(canPeerView(other, sato, 'store'), false);
  assert.equal(canPeerView(other, sato, 'all'), true);
  // 見せ合う機能なので、どちらかが非公開なら見えない
  assert.equal(canPeerView({ ...peer, shareChart: false }, sato, 'all'), false);
  assert.equal(canPeerView(peer, { ...sato, shareChart: false }, 'all'), false);
  assert.equal(canPeerView(peer, { ...sato, active: false }, 'all'), false);
  assert.equal(canPeerView(sato, sato, 'all'), false);

  assert.equal(canManageCheckItems(viewer('c', 'manager', ['s1']), 's1'), true);
  assert.equal(canManageCheckItems(viewer('c', 'manager', ['s1']), 's2'), false);
  assert.equal(canManageCheckItems(viewer('c', 'manager', ['s1']), null), false);
  assert.equal(canManageCheckItems(viewer('e', 'owner', []), null), true);
});

test('進捗: 連続提出・実行率・フォーカス達成率', () => {
  const weeks = ['2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'];
  const rows = new Map([
    ['2026-10-05', { status: 'submitted', checked: 2, checkTotal: 4, focusTotal: 3, focusDone: 1 }],
    ['2026-10-19', { status: 'submitted', checked: 3, checkTotal: 0 }],
    ['2026-10-26', { status: 'submitted', checked: 1, checkTotal: 2, focusTotal: 1, focusDone: 1 }],
  ]);
  const p = summarizeProgress({ weeks, rows, chart: { trackableCount: 6, updatedAt: '2026-10-01T00:00:00Z' } });
  assert.equal(p.streak, 2);
  assert.equal(p.submittedWeeks, 3);
  assert.equal(p.weeks[1].state, 'none');
  assert.equal(p.weeks[2].checkTotal, 6); // チェック行が無い週は今のチャートの対象数
  assert.equal(p.checkRate, (2 + 3 + 1) / (4 + 6 + 2));
  assert.equal(p.focusRate, 2 / 4);
});

test('チャート: 週次チェックの対象・フォーカスの候補・テーマ別の実行率', () => {
  const chart = { themes: [
    { position: 1, title: '集客', items: [
      { id: 'i1', content: '口コミを依頼する', itemType: 'action', weeklyTrackable: true },
      { id: 'i2', content: '口コミの件数', itemType: 'metric', weeklyTrackable: true },
      { id: 'i3', content: '', itemType: 'action', weeklyTrackable: true },
      { id: 'i4', content: 'SNSに投稿する', itemType: 'action', weeklyTrackable: false },
    ] },
  ] };
  assert.deepEqual(trackableItems(chart).map((t) => t.item.id), ['i1']);
  assert.deepEqual(focusCandidates(chart).map((c) => c.id), ['i1', 'i4']);
  const rates = themeCheckRates(trackableItems(chart), { i1: false });
  assert.deepEqual(rates, [{ theme: '集客', done: 0, total: 1, missed: ['口コミを依頼する'] }]);
});

test('入力の整形: 金額・月・画面へのリンク', () => {
  assert.equal(parseAmount('500,000円'), 500000);
  assert.equal(parseAmount('¥ 1,000,000'), 1000000);
  assert.equal(parseAmount('62万'), 620000);
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(toMonthStart('2027-03'), '2027-03-01');
  assert.equal(toMonthStart('2027-13'), null);
  assert.deepEqual(checkItemLink('【入出金】出納帳の入力'), { path: '/cashbook', label: '出納帳を開く' });
  assert.equal(checkItemLink('週報・マンダラチャート【該当日】').path, '/mandala/review');
  assert.equal(checkItemLink('戸締り'), null);
});

test('AI の出力の検証', () => {
  const ok = {
    summary: '良い週でした', wins: ['口コミを依頼できた'], concerns: ['セルフケア'], habit_insight: '続けよう',
    next_focus: [1, 2, 3].map((i) => ({ mandala_item_id: `id${i}`, title: `t${i}`, reason: 'r' })), message_to_staff: 'おつかれさま',
  };
  assert.equal(validateWeeklyReview(ok).ok, true);
  assert.equal(validateWeeklyReview({ ...ok, wins: [] }).ok, false);
  assert.equal(validateWeeklyReview({ ...ok, wins: ['a', 'b', 'c', 'd'] }).ok, false);
  assert.equal(validateWeeklyReview({ ...ok, next_focus: ok.next_focus.slice(0, 2) }).ok, false);
  assert.equal(validateWeeklyReview({ ...ok, summary: ' ' }).ok, false);
  assert.equal(validateWeeklyReview(null).ok, false);
  assert.equal(validateMandalaAssist({ items: [{ theme_position: 1, position: 2, suggested_type: 'action', weekly_trackable: true, rewrite: null }] }).ok, true);
  assert.equal(validateMandalaAssist({ items: [{ theme_position: 9, position: 2, suggested_type: 'action', weekly_trackable: true }] }).ok, false);
  assert.equal(validateMandalaAssist({ items: [{ theme_position: 1, position: 2, suggested_type: 'kpi', weekly_trackable: true }] }).ok, false);
  // tool_choice: tool を受け付けないモデルでは auto
  assert.deepEqual(toolChoiceFor('claude-sonnet-4-6', 'x'), { type: 'tool', name: 'x' });
  assert.deepEqual(toolChoiceFor('claude-opus-5-5', 'x'), { type: 'auto' });
});

// ------------------------------------------------------------
// /api/mandala
// ------------------------------------------------------------
test('me / home: スタッフは自分のチャートと今週の状況、管理者モードは自分のチャートを持たない', async () => {
  const me = await get(SATO, 'me');
  assert.equal(me.viewer.canHaveChart, true);
  assert.equal(me.self.dailyEnabled, true);
  assert.equal(me.scope, 'off');
  assert.equal(me.boardAvailable, false);
  const home = await get(SATO, 'home');
  assert.equal(home.me.chart.centerGoal, '施術消化売上 月100万！');
  assert.equal(home.me.review.status, 'draft');
  assert.equal(home.me.focus.length, 3);
  assert.ok(home.me.progress.streak >= 1);
  assert.equal(home.team, null);
  const admin = await get(ADMIN, 'me');
  assert.equal(admin.viewer.canHaveChart, false);
  assert.equal(admin.viewer.isOwner, true);
  const adminHome = await get(ADMIN, 'home');
  assert.equal(adminHome.me, null);
  assert.ok(adminHome.team.members >= 4);
  await rejects(get(ADMIN, 'review'), 400);
});

test('チャートの作成: 8テーマ × 8項目の枠ができ、行動以外は週次チェックにならない', async () => {
  await rejects(post(TANAKA, 'saveChart', { chart: { centerGoal: ' ' } }), 400);
  const r = await post(TANAKA, 'saveChart', { chart: { centerGoal: '指名 月30件', baselineAmount: '45万', targetAmount: '700,000', deadlineMonth: '2027-03' } });
  assert.equal(r.chart.themes.length, 8);
  assert.equal(r.chart.themes.flatMap((t) => t.items).length, 64);
  assert.equal(r.chart.baselineAmount, 450000);
  assert.equal(r.chart.deadlineMonth, '2027-03-01');
  const [a, b] = r.chart.themes[0].items;
  const r2 = await post(TANAKA, 'saveChart', {
    themes: [{ position: 1, title: '技術' }],
    items: [
      { id: a.id, content: '毎日ストレッチを練習する', itemType: 'action', weeklyTrackable: true },
      { id: b.id, content: 'お客様を大切に', itemType: 'mindset', weeklyTrackable: true },
      { id: 'someone-elses-item', content: 'x' },
    ],
  });
  assert.equal(r2.chart.themes[0].title, '技術');
  assert.equal(r2.chart.themes[0].items[0].weeklyTrackable, true);
  assert.equal(r2.chart.themes[0].items[1].weeklyTrackable, false);
  // 他人の項目は書き換えられない
  const sato = await get(SATO, 'chart');
  assert.ok(sato.chart.themes.flatMap((t) => t.items).every((i) => i.content !== 'x'));
});

test('週報: 保存・提出（チャートに無い項目は無視）。未来の週は入力できない', async () => {
  const view = await get(SATO, 'review');
  assert.equal(view.editable, true);
  assert.ok(view.trackables.length > 10);
  const first = view.trackables[0].itemId;
  const r = await post(SATO, 'saveReview', {
    week: WEEK, checks: { [first]: true, 'not-mine': true }, focusAchieved: { [view.focus[0].id]: true },
    goodThings: '口コミを3件もらえた', challenges: '', submit: true,
  });
  assert.equal(r.review.status, 'submitted');
  const again = await get(SATO, 'review');
  assert.equal(again.checks[first], true);
  assert.equal(again.focus[0].achieved, true);
  assert.equal(again.review.goodThings, '口コミを3件もらえた');
  assert.equal(Object.keys(again.checks).includes('not-mine'), false);
  // 下書きの保存では提出済みのまま
  await post(SATO, 'saveReview', { week: WEEK, checks: {}, goodThings: '追記', submit: false });
  assert.equal((await get(SATO, 'review')).review.status, 'submitted');
  await rejects(post(SATO, 'saveReview', { week: shiftWeek(WEEK, 1), checks: {} }), 400);
  await rejects(post(SATO, 'saveReview', { week: '2026-10-27', checks: {} }), 400);
});

test('フォーカス: 自分で選ぶ（最大3つ）・AI の提案を採用（重複・候補外は入れない）', async () => {
  const view = await get(SATO, 'review');
  const next = view.nextWeek;
  const [c1, c2, c3, c4] = view.candidates;
  let r = await post(SATO, 'adoptFocus', { week: next, items: [{ mandalaItemId: c1.id }, { mandalaItemId: c1.id }, { mandalaItemId: 'bogus' }] });
  assert.deepEqual(r.focus.map((f) => f.mandalaItemId), [c1.id]);
  assert.equal(r.focus[0].source, 'ai');
  r = await post(SATO, 'addFocus', { week: next, itemId: c2.id });
  r = await post(SATO, 'addFocus', { week: next, freeText: '毎朝ストレッチ' });
  assert.equal(r.focus.length, 3);
  assert.equal(r.focus[2].label, '毎朝ストレッチ');
  await rejects(post(SATO, 'addFocus', { week: next, itemId: c3.id }), 400);
  r = await post(SATO, 'removeFocus', { week: next, focusId: r.focus[2].id });
  r = await post(SATO, 'adoptFocus', { week: next, items: [{ mandalaItemId: c3.id }, { mandalaItemId: c4.id }] });
  assert.equal(r.focus.length, 3); // 3つに収まる分だけ
  // 2週先や過去の週には付けられない
  await rejects(post(SATO, 'addFocus', { week: shiftWeek(WEEK, 2), itemId: c1.id }), 400);
  await rejects(post(SATO, 'addFocus', { week: shiftWeek(WEEK, -1), itemId: c1.id }), 400);
});

test('仲間（共有）: チャートと集計値だけ。週報・日報・数字のメモは見えない', async () => {
  await rejects(get(SUZUKI, 'chart', { staffId: 'st-sato' }), 403); // 共有オフ
  await rejects(post(SUZUKI, 'setSharingScope', { scope: 'store' }), 403);
  await rejects(post(TAKAHASHI, 'setSharingScope', { scope: 'store' }), 403);
  assert.equal((await post(OWNER, 'setSharingScope', { scope: 'store' })).scope, 'store');

  const peer = await get(SUZUKI, 'chart', { staffId: 'st-sato' });
  assert.equal(peer.viaPeer, true);
  assert.equal(peer.chart.centerGoal, '施術消化売上 月100万！');
  assert.equal(peer.chart.baselineAmount, null);
  assert.equal(peer.chart.targetBreakdown, '');
  assert.equal(peer.canCheer, true);
  assert.ok(peer.progress.weeks.length === 8);
  await rejects(get(SUZUKI, 'review', { staffId: 'st-sato' }), 403);
  await rejects(get(SUZUKI, 'daily', { staffId: 'st-sato' }), 403);
  // 別の店舗の人は「同じ店舗内」では見えない
  await rejects(get(TANAKA, 'chart', { staffId: 'st-sato' }), 403);
  const peers = await get(SUZUKI, 'peers');
  assert.deepEqual(peers.members.map((m) => m.id).sort(), ['st-sato', 'st-takahashi']);
  assert.equal('goodThings' in peers.members[0], false);

  // 応援
  const cheer = await post(SUZUKI, 'addCheer', { chartId: peer.chart.id, body: 'ゴールが明確で素敵です！' });
  assert.equal(cheer.cheers[0].authorName, '鈴木 健太');
  await rejects(post(SATO, 'addCheer', { chartId: peer.chart.id, body: '自分' }), 400);
  await rejects(post(TANAKA, 'addCheer', { chartId: peer.chart.id, body: '見えない人' }), 403);
  await rejects(post(SATO, 'deleteCheer', { id: cheer.cheers[0].id }), 403);
  assert.equal((await post(SUZUKI, 'deleteCheer', { id: cheer.cheers[0].id })).success, true);

  // 全店舗にすると別の店舗の人も見られる
  await post(ADMIN, 'setSharingScope', { scope: 'all' });
  assert.equal((await get(TANAKA, 'chart', { staffId: 'st-sato' })).viaPeer, true);
  // 自分を非公開にすると、自分も仲間のチャートが見えない（相互）
  await post(TANAKA, 'setShare', { share: false });
  await rejects(get(TANAKA, 'chart', { staffId: 'st-sato' }), 403);
  assert.equal((await get(TANAKA, 'peers')).members.length, 0);
  await rejects(get(SUZUKI, 'chart', { staffId: 'st-tanaka' }), 403);
  await post(TANAKA, 'setShare', { share: true });
  await post(OWNER, 'setSharingScope', { scope: 'off' });
});

test('店長: 担当店舗のメンバーだけ。コメント・日報の対象の切り替え', async () => {
  const team = await get(TAKAHASHI, 'team');
  const ids = team.members.map((m) => m.id);
  assert.ok(ids.includes('st-sato') && ids.includes('st-suzuki') && ids.includes('st-takahashi'));
  assert.ok(!ids.includes('st-tanaka') && !ids.includes('st-ito'));
  assert.equal(team.weeks.length, 8);
  assert.equal(team.totals.members, ids.length);
  assert.deepEqual(team.daily.members.map((m) => m.id), ['st-sato']);
  await rejects(get(SATO, 'team'), 403);
  await rejects(get(TAKAHASHI, 'review', { staffId: 'st-tanaka' }), 403);

  const review = await get(TAKAHASHI, 'review', { staffId: 'st-sato' });
  assert.equal(review.isSelf, false);
  assert.equal(review.editable, false);
  assert.equal(review.candidates.length, 0);
  const c = await post(TAKAHASHI, 'addComment', { kind: 'review', targetId: review.review.id, body: '良い週でしたね！' });
  const mine = c.comments.find((x) => x.body === '良い週でしたね！');
  assert.equal(mine.mine, true);
  // 本人は自分の週報でコメントを読めて返信できる
  const own = await get(SATO, 'review');
  assert.ok(own.comments.some((x) => x.body === '良い週でしたね！' && !x.mine && !x.canDelete));
  const reply = await post(SATO, 'addComment', { kind: 'review', targetId: own.review.id, body: 'ありがとうございます' });
  assert.equal(reply.comments.find((x) => x.body === 'ありがとうございます').mine, true);
  await rejects(post(SUZUKI, 'addComment', { kind: 'review', targetId: own.review.id, body: 'のぞき見' }), 403);
  await rejects(post(SATO, 'deleteComment', { kind: 'review', id: mine.id }), 403);
  assert.equal((await post(OWNER, 'deleteComment', { kind: 'review', id: mine.id })).success, true);

  assert.equal((await post(TAKAHASHI, 'setDailyEnabled', { staffId: 'st-suzuki', enabled: true })).dailyEnabled, true);
  await rejects(post(TAKAHASHI, 'setDailyEnabled', { staffId: 'st-tanaka', enabled: true }), 403);
  await rejects(post(SATO, 'setDailyEnabled', { staffId: 'st-suzuki', enabled: false }), 403);
  await post(TAKAHASHI, 'setDailyEnabled', { staffId: 'st-suzuki', enabled: false });

  const owner = await get(ADMIN, 'team');
  assert.ok(owner.members.some((m) => m.id === 'st-tanaka'));
  assert.ok(!owner.members.some((m) => m.id === 'st-yamada')); // オーナーはチャートが無ければ出さない
  assert.ok(owner.stores.length >= 2);
  const store2 = await get(ADMIN, 'team', { storeId: 'store-2' });
  assert.ok(store2.members.every((m) => m.storeIds.includes('store-2')));
});

test('日報: 対象の本人だけ書ける・7日より前は書き直せない・店舗の項目', async () => {
  const view = await get(SATO, 'daily');
  assert.equal(view.editable, true);
  assert.ok(view.items.length >= 20);
  assert.ok(!view.items.some((i) => i.label.includes('駅前店')));
  assert.ok(view.items.some((i) => i.link && i.link.path === '/cashbook'));
  const ito = await get(ITO, 'daily');
  assert.ok(ito.items.some((i) => i.label.includes('駅前店')));

  const item = view.items[0].id;
  const saved = await post(SATO, 'saveDaily', { date: TODAY, checks: { [item]: true, nope: true }, learnings: '学び', submit: false });
  assert.equal(saved.report.status, 'draft');
  const sub = await post(SATO, 'saveDaily', { date: TODAY, checks: { [item]: true }, learnings: '学び', memo: '引き継ぎ', submit: true });
  assert.equal(sub.report.status, 'submitted');
  const firstAt = sub.report.submittedAt;
  const again = await post(SATO, 'saveDaily', { date: TODAY, checks: {}, learnings: '学び（追記）', memo: '引き継ぎ', submit: false });
  assert.equal(again.report.status, 'submitted'); // 下書きに戻らない
  assert.equal(again.report.submittedAt, firstAt);
  assert.equal((await get(SATO, 'daily')).checks[item], true);

  await rejects(post(SATO, 'saveDaily', { date: addDays(TODAY, -7), checks: {} }), 400);
  await rejects(post(SATO, 'saveDaily', { date: addDays(TODAY, 1), checks: {} }), 400);
  await rejects(post(SUZUKI, 'saveDaily', { date: TODAY, checks: {} }), 400); // 対象外
  const mgr = await get(TAKAHASHI, 'daily', { staffId: 'st-sato' });
  assert.equal(mgr.editable, false);
  assert.equal(mgr.report.memo, '引き継ぎ');
  assert.equal(mgr.days.length, 14);
  const c = await post(TAKAHASHI, 'addComment', { kind: 'daily', targetId: mgr.report.id, body: 'おつかれさま！' });
  assert.equal(c.comments.at(-1).body, 'おつかれさま！');
  await rejects(get(SUZUKI, 'daily', { staffId: 'st-sato' }), 403);
});

test('日報の項目: 全店舗共通はオーナーだけ、店舗の項目は担当の店長も', async () => {
  const s = await get(TAKAHASHI, 'settings');
  assert.equal(s.canEditScope, false);
  assert.equal(s.canManageCommon, false);
  assert.deepEqual(s.stores.map((x) => x.id), ['store-1']);
  assert.ok(s.checkItems.every((i) => i.storeId !== 'store-2'));
  const common = s.checkItems.find((i) => !i.storeId);
  assert.equal(common.canEdit, false);
  await rejects(post(TAKAHASHI, 'saveCheckItem', { id: common.id, storeId: null, label: '変更', section: 'start' }), 403);
  await rejects(post(TAKAHASHI, 'saveCheckItem', { storeId: 'store-2', label: '他店', section: 'start' }), 403);
  assert.equal((await post(TAKAHASHI, 'saveCheckItem', { storeId: 'store-1', label: '看板を出す', section: 'start', sortOrder: 5 })).success, true);
  assert.ok((await get(SATO, 'daily')).items.some((i) => i.label === '看板を出す'));
  await post(OWNER, 'saveCheckItem', { id: common.id, storeId: null, label: common.label, section: common.section, sortOrder: common.sortOrder, isActive: false });
  assert.ok(!(await get(SUZUKI, 'daily')).items.some((i) => i.id === common.id));
  await rejects(get(SATO, 'settings'), 403);
});

test('AI レビュー: 候補に無い ID は理由を添えて再試行・2回目以降は保存済みを返す', async () => {
  const review = (await get(SATO, 'review')).review;
  const view = await get(SATO, 'review');
  const ids = view.candidates.slice(0, 3).map((c) => c.id);
  const base = { summary: '総評', wins: ['よかった'], concerns: ['気になる'], habit_insight: 'ポイント', message_to_staff: 'ひとこと' };
  const calls = [];
  setAiCallerForTest(async (args) => {
    calls.push(args);
    const next = calls.length === 1 ? ['bogus', ids[1], ids[2]] : ids;
    return { raw: { ...base, next_focus: next.map((id) => ({ mandala_item_id: id, title: 't', reason: 'r' })) }, model: 'test-model', inputTokens: 10, outputTokens: 20 };
  });
  const r = await post(SATO, 'aiReview', { reviewId: review.id, force: true });
  assert.equal(calls.length, 2);
  assert.match(calls[1].userMessage, /候補リストに存在しません: bogus/);
  assert.match(calls[0].userMessage, /# 翌週フォーカスの候補リスト/);
  assert.deepEqual(r.aiReview.result.next_focus.map((f) => f.mandala_item_id), ids);
  assert.equal(r.aiReview.promptVersion, 'v2');
  const cached = await post(SATO, 'aiReview', { reviewId: review.id });
  assert.equal(cached.cached, true);
  assert.equal(calls.length, 2);

  // 2回とも ID が合わなければ、フォーカス提案を空にして保存する
  setAiCallerForTest(async () => ({ raw: { ...base, next_focus: [1, 2, 3].map((i) => ({ mandala_item_id: `x${i}`, title: 't', reason: 'r' })) }, model: 'test-model' }));
  const empty = await post(SATO, 'aiReview', { reviewId: review.id, force: true });
  assert.deepEqual(empty.aiReview.result.next_focus, []);
  // 出力がまったく合わなければエラー（保存しない）
  setAiCallerForTest(async () => ({ raw: { summary: '' }, model: 'test-model' }));
  await rejects(post(SATO, 'aiReview', { reviewId: review.id, force: true }), 502);
  // 他人は実行できない・店長はできる
  setAiCallerForTest(async () => ({ raw: { ...base, next_focus: ids.map((id) => ({ mandala_item_id: id, title: 't', reason: 'r' })) }, model: 'test-model' }));
  await rejects(post(SUZUKI, 'aiReview', { reviewId: review.id, force: true }), 403);
  assert.equal((await post(TAKAHASHI, 'aiReview', { reviewId: review.id, force: true })).cached, false);
  assert.equal((await get(SATO, 'review')).aiReview.result.summary, '総評');
  setAiCallerForTest(null);
});

test('AI の分類の提案: 自分のチャートの項目に結びつける', async () => {
  setAiCallerForTest(async () => ({ raw: { items: [
    { theme_position: 1, position: 1, suggested_type: 'action', weekly_trackable: true, rewrite: '毎回の施術で変化を1つ伝える' },
    { theme_position: 1, position: 2, suggested_type: 'mindset', weekly_trackable: true, rewrite: '短期・中期・長期の目標を一緒に決める' },
  ] }, model: 'test-model' }));
  const r = await post(SATO, 'aiAssist', { themePosition: 1 });
  assert.equal(r.suggestions.length, 2);
  assert.equal(r.suggestions[0].content, '変化を感じさせる');
  assert.equal(r.suggestions[0].currentType, 'mindset');
  assert.equal(r.suggestions[1].rewrite, null); // 今と同じ文の書き換えは出さない
  assert.equal(r.suggestions[1].weeklyTrackable, false); // 行動以外は週次チェックにしない
  // 範囲外の位置が混ざった出力は不合格（保存しない）
  setAiCallerForTest(async () => ({ raw: { items: [{ theme_position: 1, position: 9, suggested_type: 'action', weekly_trackable: true }] }, model: 'test-model' }));
  await rejects(post(SATO, 'aiAssist', { themePosition: 1 }), 502);
  await rejects(post(ADMIN, 'aiAssist', { themePosition: 1 }), 400);
  setAiCallerForTest(null);
  delete process.env.ANTHROPIC_API_KEY;
  await rejects(post(SATO, 'aiAssist', { themePosition: 1 }), 503);
  process.env.ANTHROPIC_API_KEY = 'test-key';
});

test('日々の動き・CSV', async () => {
  const a = await get(ADMIN, 'activity', { days: 14 });
  assert.ok(a.events.some((e) => e.kind === 'review_submitted' && e.actorName === '佐藤 美咲'));
  assert.ok(a.events.some((e) => e.kind === 'comment'));
  assert.ok(a.events.some((e) => e.kind === 'daily_submitted'));
  const one = await get(TAKAHASHI, 'activity', { staffId: 'st-sato', days: 30 });
  assert.ok(one.events.every((e) => e.subjectId === 'st-sato'));
  await rejects(get(SATO, 'activity'), 403);
  await rejects(get(TAKAHASHI, 'activity', { staffId: 'st-tanaka' }), 403);

  const csv = await get(TAKAHASHI, 'csv', { weeks: 4 });
  const lines = csv.csv.split('\n');
  assert.equal(lines[0].charCodeAt(0), 0xfeff);
  assert.match(lines[0], /週,店舗,スタッフ,状態/);
  assert.ok(lines.some((l) => l.includes('佐藤 美咲') && l.includes('提出済み')));
  assert.ok(!lines.some((l) => l.includes('田中')));
  await rejects(get(SATO, 'csv'), 403);
});

test('不明な action・別名の店舗', async () => {
  await rejects(get(SATO, 'nope'), 400);
  await rejects(post(SATO, 'nope'), 400);
  // 統合された別名の店舗でも同じ店舗として扱う
  db().stores.push({ id: 'store-1-old', name: '中央店（旧）', status: 'inactive', memo: '', merged_into: 'store-1', created_at: new Date().toISOString() });
  db().staff_stores.push({ staff_id: 'st-ito', store_id: 'store-1-old' });
  const team = await get(TAKAHASHI, 'team');
  assert.ok(team.members.some((m) => m.id === 'st-ito'));
});
