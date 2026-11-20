#!/usr/bin/env node
// ============================================================
// 旧「マンダラチャート週次進捗管理ツール」（別の Supabase）のデータを、このダッシュボードへ移す
// ------------------------------------------------------------
//   node scripts/import-mandala-tool.mjs                       確認だけ（何も書き込まない）
//   node scripts/import-mandala-tool.mjs --apply               書き込む
//   node scripts/import-mandala-tool.mjs --map "三浦=st-miura,佐藤=st-sato"   名前で合わない人を指定
//
// 環境変数（.env.local でもよい）
//   MANDALA_SUPABASE_URL / MANDALA_SUPABASE_SERVICE_ROLE_KEY   移す元（旧ツール）
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY                   移す先（このダッシュボード）
//
// 旧ツールのメンバー（profiles.display_name）を、ダッシュボードのスタッフ（staff.name）に対応付ける:
//   1. --map の指定（表示名 or 旧ツールのユーザーID → staff.id）
//   2. 名前が同じ（空白は無視）
//   3. ダッシュボードの名前が旧ツールの名前で始まる人が 1人だけ（「佐藤」→「佐藤 美咲」）
//   （2・3 で候補が複数いても、在籍中が 1人だけならその人）
// 対応付けられない人のデータは移さない（一覧に出す）。
// 何度実行してもよい（ID をそのまま使って上書きする）。ダッシュボードで先に書いた週報・日報と
// 同じ週・日の分は、ダッシュボードの方を残して旧ツールの分は飛ばす。
// 移す前に supabase/migrations/00006_mandala.sql を適用しておくこと。
// ============================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PAGE = 1000;
const CHUNK = 100;
const SCOPE = { off: 'off', brand: 'store', group: 'all' };

// 全角・半角の違い（「（」と「(」など）と空白は無視して比べる
const norm = (s) => String(s || '').normalize('NFKC').replace(/\s/g, '');
const day = (v) => (v ? String(v).slice(0, 10) : v);

/** テーブルが無い（旧ツールで日報のマイグレーションを当てていない等）なら空として扱う */
function missingTable(error) {
  return error && (error.code === '42P01' || error.code === 'PGRST205' || /does not exist|Could not find the table/.test(String(error.message)));
}

async function readAll(client, table, { column, ids } = {}) {
  const out = [];
  const lists = ids ? Array.from({ length: Math.ceil(ids.length / CHUNK) }, (_, i) => ids.slice(i * CHUNK, i * CHUNK + CHUNK)) : [null];
  for (const chunk of lists) {
    if (chunk && chunk.length === 0) continue;
    for (let from = 0; ; from += PAGE) {
      let q = client.from(table).select('*');
      if (chunk) q = q.in(column, chunk);
      const { data, error } = await q.order('id').range(from, from + PAGE - 1);
      if (error) {
        if (missingTable(error)) return [];
        throw new Error(`${table}: ${error.message}`);
      }
      out.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
  }
  return out;
}

async function upsert(client, table, rows, onConflict = 'id') {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await client.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

/** 旧ツールのメンバー → ダッシュボードのスタッフ */
export function mapProfiles(profiles, staff, explicit = {}) {
  const map = new Map();
  const unmatched = [];
  for (const p of profiles) {
    const forced = explicit[p.id] || explicit[p.display_name] || explicit[norm(p.display_name)];
    if (forced) {
      const s = staff.find((x) => x.id === forced);
      if (s) { map.set(p.id, s); continue; }
      unmatched.push({ profile: p, reason: `--map の ${forced} がスタッフにいません` });
      continue;
    }
    const exact = staff.filter((s) => norm(s.name) === norm(p.display_name));
    const prefix = staff.filter((s) => norm(s.name).startsWith(norm(p.display_name)));
    const cands = exact.length ? exact : prefix;
    const active = cands.filter((s) => s.status !== 'inactive');
    const hit = cands.length === 1 ? cands[0] : active.length === 1 ? active[0] : null;
    if (hit) map.set(p.id, hit);
    else unmatched.push({ profile: p, reason: cands.length > 1 ? '同じ名前のスタッフが複数います' : '名前の合うスタッフがいません' });
  }
  return { map, unmatched };
}

export async function importMandala({ source, target, apply = false, explicit = {}, log = console.log }) {
  const profiles = await readAll(source, 'profiles');
  const staff = (await readAll(target, 'staff')).map((s) => ({ id: String(s.id), name: s.name, status: s.status }));
  const { map, unmatched } = mapProfiles(profiles, staff, explicit);
  const staffOf = (userId) => (map.get(userId) ? map.get(userId).id : null);
  const nameOf = new Map(profiles.map((p) => [p.id, p.display_name]));
  const userIds = [...map.keys()];

  log('■ メンバーの対応付け');
  for (const [pid, s] of map) log(`  ${nameOf.get(pid)} → ${s.name}（${s.id}）`);
  for (const u of unmatched) log(`  ✕ ${u.profile.display_name}（${u.profile.id}）: ${u.reason}`);

  // ---- 読み込み（対応付けられた人の分だけ） ----
  const charts = await readAll(source, 'mandala_charts', { column: 'user_id', ids: userIds });
  const themes = await readAll(source, 'mandala_themes', { column: 'chart_id', ids: charts.map((c) => c.id) });
  const items = await readAll(source, 'mandala_items', { column: 'theme_id', ids: themes.map((t) => t.id) });
  const reviews = await readAll(source, 'weekly_reviews', { column: 'user_id', ids: userIds });
  const focus = await readAll(source, 'weekly_focus_items', { column: 'user_id', ids: userIds });
  const dailies = await readAll(source, 'daily_reports', { column: 'user_id', ids: userIds });
  const checkItems = await readAll(source, 'daily_check_items');
  const settings = await readAll(source, 'app_settings').catch(() => []);

  // ダッシュボードで先に書いた週報・日報（同じ週・日）は残す
  const mappedStaffIds = [...new Set([...map.values()].map((s) => s.id))];
  const tReviews = await readAll(target, 'mandala_weekly_reviews', { column: 'staff_id', ids: mappedStaffIds });
  const tDailies = await readAll(target, 'mandala_daily_reports', { column: 'staff_id', ids: mappedStaffIds });
  const tCharts = await readAll(target, 'mandala_charts', { column: 'staff_id', ids: mappedStaffIds });
  const takenWeek = new Map(tReviews.map((r) => [`${r.staff_id}|${day(r.week_start)}`, r.id]));
  const takenDay = new Map(tDailies.map((r) => [`${r.staff_id}|${day(r.report_date)}`, r.id]));
  const skippedReviews = reviews.filter((r) => { const t = takenWeek.get(`${staffOf(r.user_id)}|${day(r.week_start)}`); return t && t !== r.id; });
  const skippedDailies = dailies.filter((r) => { const t = takenDay.get(`${staffOf(r.user_id)}|${day(r.report_date)}`); return t && t !== r.id; });
  const okReviews = reviews.filter((r) => !skippedReviews.includes(r));
  const okDailies = dailies.filter((r) => !skippedDailies.includes(r));
  const reviewIds = okReviews.map((r) => r.id);
  const dailyIds = okDailies.map((r) => r.id);
  const checks = await readAll(source, 'habit_checks', { column: 'review_id', ids: reviewIds });
  const aiReviews = await readAll(source, 'ai_reviews', { column: 'review_id', ids: reviewIds });
  const comments = await readAll(source, 'review_comments', { column: 'review_id', ids: reviewIds });
  const cheers = await readAll(source, 'chart_cheers', { column: 'chart_id', ids: charts.map((c) => c.id) });
  const dailyChecks = await readAll(source, 'daily_report_checks', { column: 'report_id', ids: dailyIds });
  const dailyComments = await readAll(source, 'daily_report_comments', { column: 'report_id', ids: dailyIds });

  // ダッシュボードで先にチャートを作っていた人は、旧ツールのチャートを「過去のチャート」として入れる
  const sourceChartIds = new Set(charts.map((c) => c.id));
  const hasOwnChart = new Set(tCharts.filter((c) => !sourceChartIds.has(c.id) && c.status !== 'archived').map((c) => c.staff_id));

  // 日報のチェック項目: 同じ区分・同じ名前の項目があればそれに結びつけ、無ければ全店舗共通として足す
  // （旧ツールはブランドごとに項目を持っていたので、移す日報で使っている項目だけを見る）
  const usedItemIds = new Set(dailyChecks.map((c) => c.check_item_id));
  const tItems = await readAll(target, 'mandala_daily_check_items');
  const itemKey = (section, label) => `${section || 'during'}|${norm(label)}`;
  const byKey = new Map(tItems.map((i) => [itemKey(i.section, i.label), i.id]));
  const newItems = [];
  const itemMap = new Map();
  for (const ci of checkItems.filter((x) => usedItemIds.has(x.id))) {
    const k = itemKey(ci.section, ci.label);
    if (byKey.has(k)) itemMap.set(ci.id, byKey.get(k));
    else {
      byKey.set(k, ci.id);
      itemMap.set(ci.id, ci.id);
      newItems.push({ id: ci.id, store_id: null, section: ci.section || 'during', label: ci.label, sort_order: ci.sort_order || 0, is_active: ci.is_active !== false, created_at: ci.created_at });
    }
  }

  const author = (id) => ({ author_id: staffOf(id), author_name: nameOf.get(id) || '' });
  const rows = {
    mandala_charts: charts.map((c) => ({
      id: c.id, staff_id: staffOf(c.user_id), title: c.title || '', center_goal: c.center_goal, baseline_amount: c.baseline_amount, target_amount: c.target_amount,
      target_breakdown: c.target_breakdown, deadline_month: c.deadline_month, status: hasOwnChart.has(staffOf(c.user_id)) ? 'archived' : c.status, created_at: c.created_at, updated_at: c.updated_at,
    })),
    mandala_themes: themes.map((t) => ({ id: t.id, chart_id: t.chart_id, position: t.position, title: t.title || '' })),
    mandala_items: items.map((i) => ({ id: i.id, theme_id: i.theme_id, position: i.position, content: i.content || '', item_type: i.item_type, weekly_trackable: !!i.weekly_trackable })),
    mandala_weekly_reviews: okReviews.map((r) => ({
      id: r.id, staff_id: staffOf(r.user_id), week_start: day(r.week_start), good_things: r.good_things, challenges: r.challenges, status: r.status,
      submitted_at: r.submitted_at, created_at: r.created_at, updated_at: r.updated_at,
    })),
    mandala_habit_checks: checks.map((h) => ({ id: h.id, review_id: h.review_id, mandala_item_id: h.mandala_item_id, checked: !!h.checked })),
    mandala_focus_items: focus.map((f) => ({
      id: f.id, staff_id: staffOf(f.user_id), week_start: day(f.week_start), mandala_item_id: f.mandala_item_id, free_text: f.free_text,
      source: f.source, achieved: f.achieved, sort_order: f.sort_order || 0, created_at: f.created_at,
    })),
    mandala_ai_reviews: aiReviews.map((a) => ({ id: a.id, review_id: a.review_id, kind: a.kind || 'weekly', model: a.model, prompt_version: a.prompt_version, result: a.result, input_tokens: a.input_tokens, output_tokens: a.output_tokens, created_at: a.created_at })),
    mandala_review_comments: comments.map((c) => ({ id: c.id, review_id: c.review_id, ...author(c.author_id), body: c.body, created_at: c.created_at })),
    mandala_cheers: cheers.map((c) => ({ id: c.id, chart_id: c.chart_id, ...author(c.author_id), body: c.body, created_at: c.created_at })),
    mandala_daily_check_items: newItems,
    mandala_daily_reports: okDailies.map((d) => ({
      id: d.id, staff_id: staffOf(d.user_id), report_date: day(d.report_date), condition: d.condition, learnings: d.learnings, challenges: d.challenges,
      tomorrow: d.tomorrow, memo: d.memo ?? null, status: d.status, submitted_at: d.submitted_at, created_at: d.created_at, updated_at: d.updated_at,
    })),
    mandala_daily_report_checks: dailyChecks.filter((c) => itemMap.has(c.check_item_id)).map((c) => ({ id: c.id, report_id: c.report_id, check_item_id: itemMap.get(c.check_item_id), checked: !!c.checked })),
    mandala_daily_report_comments: dailyComments.map((c) => ({ id: c.id, report_id: c.report_id, ...author(c.author_id), body: c.body, created_at: c.created_at })),
  };
  // 同じスタッフに複数の旧メンバーが当たった時は、後の方の設定を使う
  const members = new Map();
  for (const p of profiles) {
    const sid = staffOf(p.id);
    if (sid) members.set(sid, { staff_id: sid, share_chart: p.share_chart !== false, daily_report_enabled: !!p.daily_report_enabled, updated_at: new Date().toISOString() });
  }
  const scope = settings[0] ? SCOPE[settings[0].chart_sharing_scope] || 'off' : null;

  log('■ 移すデータ');
  for (const [table, list] of Object.entries(rows)) log(`  ${table}: ${list.length}件`);
  log(`  mandala_members: ${members.size}件${scope ? ` / 共有の範囲: ${scope}` : ''}`);
  if (skippedReviews.length || skippedDailies.length) log(`  （ダッシュボードで先に書いた分を残すため、週報 ${skippedReviews.length}件・日報 ${skippedDailies.length}件 を飛ばします）`);
  if (hasOwnChart.size) log(`  （ダッシュボードで先にチャートを作っていた ${hasOwnChart.size}名 は、旧ツールのチャートを過去のチャートとして入れます）`);

  if (!apply) {
    log('\n確認だけしました。書き込むには --apply を付けて実行してください。');
    return { applied: false, rows, members: [...members.values()], unmatched, scope };
  }
  // 親 → 子の順に入れる
  for (const table of ['mandala_charts', 'mandala_themes', 'mandala_items', 'mandala_weekly_reviews', 'mandala_habit_checks', 'mandala_focus_items',
    'mandala_ai_reviews', 'mandala_review_comments', 'mandala_cheers', 'mandala_daily_check_items', 'mandala_daily_reports', 'mandala_daily_report_checks', 'mandala_daily_report_comments']) {
    await upsert(target, table, rows[table]);
  }
  await upsert(target, 'mandala_members', [...members.values()], 'staff_id');
  if (scope) {
    const { data } = await target.from('dash_config').select('value').eq('key', 'mandala.settings').maybeSingle();
    await upsert(target, 'dash_config', [{ key: 'mandala.settings', value: { ...((data && data.value) || {}), sharingScope: scope, updatedAt: new Date().toISOString(), updatedBy: '旧ツールから移行' } }], 'key');
  }
  log('\n書き込みました。');
  return { applied: true, rows, members: [...members.values()], unmatched, scope };
}

// ------------------------------------------------------------
// コマンドとして実行した時
// ------------------------------------------------------------
function loadEnv(root) {
  for (const name of ['.env.local', '.env']) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

function parseMap(value) {
  const out = {};
  for (const pair of String(value || '').split(',')) {
    const [k, v] = pair.split('=').map((s) => (s || '').trim());
    if (k && v) { out[k] = v; out[norm(k)] = v; }
  }
  return out;
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  loadEnv(root);
  const args = process.argv.slice(2);
  const mapArg = args.includes('--map') ? args[args.indexOf('--map') + 1] : '';
  const need = ['MANDALA_SUPABASE_URL', 'MANDALA_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !process.env[k]);
  if (need.length) {
    console.error(`環境変数が足りません: ${need.join(', ')}`);
    process.exit(1);
  }
  const { createClient } = await import('@supabase/supabase-js');
  const opts = { auth: { persistSession: false } };
  const source = createClient(process.env.MANDALA_SUPABASE_URL, process.env.MANDALA_SUPABASE_SERVICE_ROLE_KEY, opts);
  const target = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, opts);
  await importMandala({ source, target, apply: args.includes('--apply'), explicit: parseMap(mapArg) });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
