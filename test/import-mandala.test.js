// 旧マンダラツール → ダッシュボードの移行スクリプト（scripts/import-mandala-tool.mjs）のテスト。
// 移す元・移す先とも疑似 DB で動かす。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { createMockClient } from '../scripts/dev/supabase-mock.mjs';
import { importMandala, mapProfiles } from '../scripts/import-mandala-tool.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sise-import-'));
const T = '2026-10-01T00:00:00.000Z';

function sourceDb() {
  const file = path.join(tmp(), 'source.json');
  const theme = (id, chart, pos, title) => ({ id, chart_id: chart, position: pos, title });
  const item = (id, themeId, pos, content, type = 'action', trackable = true) => ({ id, theme_id: themeId, position: pos, content, item_type: type, weekly_trackable: trackable, kpi_definition_id: null });
  fs.writeFileSync(file, JSON.stringify({
    profiles: [
      { id: 'u-owner', display_name: '酒井', role: 'owner', brand_id: null, is_active: true, share_chart: true, daily_report_enabled: false },
      { id: 'u-sato', display_name: '佐藤', role: 'staff', brand_id: 'b1', is_active: true, share_chart: false, daily_report_enabled: true },
      { id: 'u-miura', display_name: '三浦', role: 'manager', brand_id: 'b1', is_active: true, share_chart: true, daily_report_enabled: false },
      { id: 'u-suzuki', display_name: '鈴木', role: 'staff', brand_id: 'b1', is_active: true, share_chart: true, daily_report_enabled: false },
    ],
    app_settings: [{ id: true, chart_sharing_scope: 'brand' }],
    mandala_charts: [{ id: 'c-sato', user_id: 'u-sato', brand_id: 'b1', title: '', center_goal: '売上100万', baseline_amount: null, target_amount: 1000000, target_breakdown: null, deadline_month: null, status: 'active', created_at: T, updated_at: T }],
    mandala_themes: [theme('t1', 'c-sato', 1, '集客')],
    mandala_items: [item('i1', 't1', 1, '口コミ依頼'), item('i2', 't1', 2, '心を込める', 'mindset', false)],
    weekly_reviews: [
      { id: 'r1', user_id: 'u-sato', week_start: '2026-10-12', good_things: 'よかった', challenges: null, status: 'submitted', submitted_at: T, created_at: T, updated_at: T },
      { id: 'r2', user_id: 'u-sato', week_start: '2026-10-19', good_things: '旧ツールの分', challenges: null, status: 'draft', submitted_at: null, created_at: T, updated_at: T },
    ],
    habit_checks: [{ id: 'h1', review_id: 'r1', mandala_item_id: 'i1', checked: true }],
    weekly_focus_items: [{ id: 'f1', user_id: 'u-sato', week_start: '2026-10-19', mandala_item_id: 'i1', free_text: null, source: 'ai', achieved: null, sort_order: 0, created_at: T }],
    ai_reviews: [{ id: 'a1', review_id: 'r1', kind: 'weekly', model: 'claude-sonnet-4-6', prompt_version: 'v2', result: { summary: 's' }, input_tokens: 1, output_tokens: 2, created_at: T }],
    review_comments: [{ id: 'cm1', review_id: 'r1', author_id: 'u-owner', body: 'いいね', created_at: T }],
    chart_cheers: [{ id: 'ch1', chart_id: 'c-sato', author_id: 'u-suzuki', body: '応援', created_at: T }],
    daily_check_items: [
      { id: 'dci-1', brand_id: 'b1', section: 'start', label: '当日の予約確認', sort_order: 20, is_active: true, created_at: T },
      { id: 'dci-2', brand_id: 'b1', section: 'end', label: '看板をしまう', sort_order: 200, is_active: true, created_at: T },
    ],
    daily_reports: [{ id: 'd1', user_id: 'u-sato', report_date: '2026-10-20', condition: null, learnings: '学び', challenges: null, tomorrow: null, memo: 'メモ', status: 'submitted', submitted_at: T, created_at: T, updated_at: T }],
    daily_report_checks: [{ id: 'dc1', report_id: 'd1', check_item_id: 'dci-1', checked: true }, { id: 'dc2', report_id: 'd1', check_item_id: 'dci-2', checked: false }],
    daily_report_comments: [],
  }));
  return createMockClient(file);
}

function targetDb() {
  const client = createMockClient(path.join(tmp(), 'target.json'));
  const db = client.__db();
  // デモの週報・チャートは消して、移行だけを見る（佐藤さんはダッシュボードで 10/19 の週報を先に書いた想定）
  for (const t of ['mandala_charts', 'mandala_themes', 'mandala_items', 'mandala_weekly_reviews', 'mandala_habit_checks', 'mandala_focus_items', 'mandala_review_comments', 'mandala_daily_reports', 'mandala_daily_report_checks', 'mandala_members']) db[t].length = 0;
  db.mandala_weekly_reviews.push({ id: 'dash-r', staff_id: 'st-sato', week_start: '2026-10-19', good_things: 'ダッシュボードで書いた', challenges: null, status: 'draft', submitted_at: null, created_at: T, updated_at: T });
  db.staff.push({ id: 'st-miura', name: '三浦 和也', role: 'manager', password: '', status: 'active', created_at: T });
  return client;
}

test('名前の対応付け: 同じ名前・名前で始まる人が 1人・--map の指定', () => {
  const staff = [{ id: 'a', name: '佐藤 美咲' }, { id: 'b', name: '鈴木 健太' }, { id: 'c', name: '鈴木 花子' }, { id: 'd', name: '高橋' }];
  const profiles = [{ id: 'p1', display_name: '佐藤' }, { id: 'p2', display_name: '鈴木' }, { id: 'p3', display_name: '高橋' }, { id: 'p4', display_name: '山田' }];
  const { map, unmatched } = mapProfiles(profiles, staff);
  assert.equal(map.get('p1').id, 'a');
  assert.equal(map.get('p3').id, 'd');
  assert.deepEqual(unmatched.map((u) => u.profile.id), ['p2', 'p4']);
  const forced = mapProfiles(profiles, staff, { 鈴木: 'c' });
  assert.equal(forced.map.get('p2').id, 'c');
});

test('確認だけ（--apply なし）では書き込まない', async () => {
  const target = targetDb();
  const logs = [];
  const r = await importMandala({ source: sourceDb(), target, log: (s) => logs.push(s) });
  assert.equal(r.applied, false);
  assert.equal(target.__db().mandala_charts.length, 0);
  assert.ok(logs.some((l) => l.includes('佐藤 → 佐藤 美咲')));
  assert.ok(logs.some((l) => l.includes('✕ 酒井')));
});

test('移行: チャート・週報・日報・コメント・設定を移し、先に書いた週報は残す。再実行しても同じ', async () => {
  const source = sourceDb();
  const target = targetDb();
  const run = () => importMandala({ source, target, apply: true, explicit: { 三浦: 'st-miura' }, log: () => {} });
  const r = await run();
  assert.equal(r.applied, true);
  const db = target.__db();
  assert.equal(db.mandala_charts.length, 1);
  assert.equal(db.mandala_charts[0].staff_id, 'st-sato');
  assert.equal(db.mandala_items.length, 2);
  // 10/19 はダッシュボードで書いた方を残す
  assert.deepEqual(db.mandala_weekly_reviews.map((x) => x.id).sort(), ['dash-r', 'r1']);
  assert.equal(db.mandala_habit_checks.length, 1);
  assert.equal(db.mandala_ai_reviews.find((a) => a.id === 'a1').prompt_version, 'v2');
  // 対応付けられないオーナーのコメントは名前だけ残す
  const c = db.mandala_review_comments.find((x) => x.id === 'cm1');
  assert.equal(c.author_id, null);
  assert.equal(c.author_name, '酒井');
  assert.equal(db.mandala_cheers.find((x) => x.id === 'ch1').author_id, 'st-suzuki');
  // 日報: 同じ名前の項目に結びつけ、無い項目は全店舗共通として足す
  const reportChecks = db.mandala_daily_report_checks;
  const common = db.mandala_daily_check_items.find((i) => i.label === '当日の予約確認' && i.id !== 'dci-1');
  assert.ok(reportChecks.some((x) => x.check_item_id === common.id && x.checked));
  assert.ok(db.mandala_daily_check_items.some((i) => i.id === 'dci-2' && i.store_id === null));
  assert.equal(db.mandala_daily_reports[0].memo, 'メモ');
  // メンバーの設定と共有の範囲（ブランド内 → 同じ店舗内）
  const sato = db.mandala_members.find((m) => m.staff_id === 'st-sato');
  assert.equal(sato.share_chart, false);
  assert.equal(sato.daily_report_enabled, true);
  assert.ok(db.mandala_members.some((m) => m.staff_id === 'st-miura'));
  assert.equal(db.dash_config.find((x) => x.key === 'mandala.settings').value.sharingScope, 'store');

  const counts = Object.fromEntries(Object.keys(db).filter((k) => k.startsWith('mandala_')).map((k) => [k, db[k].length]));
  await run();
  const again = Object.fromEntries(Object.keys(db).filter((k) => k.startsWith('mandala_')).map((k) => [k, db[k].length]));
  assert.deepEqual(again, counts);
});
