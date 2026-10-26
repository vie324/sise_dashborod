// ============================================================
// マンダラ: DB の読み書き（権限の判定はしない。handlers.js が先に判定する）
// ------------------------------------------------------------
// テーブルは supabase/migrations/00006_mandala.sql。
// 画面へ返す形は camelCase にそろえる。ID はサーバーで発行する（疑似 DB でも同じに動くように）。
// Supabase の 1回の取得は 1,000 行までなので、項目（1人 64行）などはページを分けて読む。
// ============================================================

import crypto from 'node:crypto';
import { supabase } from '../supabase.js';
import { sortChart, summarizeChart, summarizeProgress, recentWeeks, trackableItems, itemIndex } from '../../../shared/mandala.js';

export const newId = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

const PAGE = 1000;
const CHUNK = 100;

export async function must(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

const unique = (ids) => [...new Set((ids || []).filter((v) => v !== null && v !== undefined && v !== ''))];

/** column IN (ids) を 100件ずつ・1,000行ずつに分けて全部読む */
export async function selectIn(table, cols, column, ids, apply = (q) => q) {
  const out = [];
  const list = unique(ids);
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    for (let from = 0; ; from += PAGE) {
      const data = await must(apply(supabase.from(table).select(cols).in(column, chunk)).order('id').range(from, from + PAGE - 1));
      out.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
  }
  return out;
}

// ------------------------------------------------------------
// チャート
// ------------------------------------------------------------
const toItem = (r) => ({ id: r.id, position: r.position, content: r.content || '', itemType: r.item_type || 'action', weeklyTrackable: !!r.weekly_trackable });

function toChart(row, themeRows, itemRows) {
  const itemsByTheme = new Map();
  for (const it of itemRows) {
    if (!itemsByTheme.has(it.theme_id)) itemsByTheme.set(it.theme_id, []);
    itemsByTheme.get(it.theme_id).push(toItem(it));
  }
  return sortChart({
    id: row.id,
    staffId: row.staff_id,
    title: row.title || '',
    centerGoal: row.center_goal || '',
    baselineAmount: row.baseline_amount ?? null,
    targetAmount: row.target_amount ?? null,
    targetBreakdown: row.target_breakdown || '',
    deadlineMonth: row.deadline_month ? String(row.deadline_month).slice(0, 10) : null,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    themes: themeRows.map((t) => ({ id: t.id, position: t.position, title: t.title || '', items: itemsByTheme.get(t.id) || [] })),
  });
}

/** スタッフごとの今のチャート（active / draft のうち新しい 1つ） */
export async function loadCharts(staffIds) {
  const rows = await selectIn('mandala_charts', '*', 'staff_id', staffIds, (q) => q.in('status', ['active', 'draft']));
  rows.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const latest = new Map();
  for (const r of rows) if (!latest.has(r.staff_id)) latest.set(r.staff_id, r);
  const chartRows = [...latest.values()];
  if (chartRows.length === 0) return new Map();
  const themes = await selectIn('mandala_themes', '*', 'chart_id', chartRows.map((c) => c.id));
  const items = await selectIn('mandala_items', '*', 'theme_id', themes.map((t) => t.id));
  const out = new Map();
  for (const c of chartRows) {
    const ts = themes.filter((t) => t.chart_id === c.id);
    const ids = new Set(ts.map((t) => t.id));
    out.set(c.staff_id, toChart(c, ts, items.filter((i) => ids.has(i.theme_id))));
  }
  return out;
}

export async function getActiveChart(staffId) {
  return (await loadCharts([staffId])).get(staffId) || null;
}

export async function getChartRow(chartId) {
  return must(supabase.from('mandala_charts').select('id, staff_id, status').eq('id', chartId).maybeSingle());
}

/** 新しいチャート（8テーマ × 8項目の枠も先に作る） */
export async function createChart(staffId, values) {
  const id = newId();
  const now = nowIso();
  await must(supabase.from('mandala_charts').insert({ id, staff_id: staffId, status: 'active', created_at: now, updated_at: now, ...values }));
  const themes = Array.from({ length: 8 }, (_, i) => ({ id: newId(), chart_id: id, position: i + 1, title: '' }));
  await must(supabase.from('mandala_themes').insert(themes));
  const items = themes.flatMap((t) => Array.from({ length: 8 }, (_, i) => ({
    id: newId(), theme_id: t.id, position: i + 1, content: '', item_type: 'action', weekly_trackable: false,
  })));
  await must(supabase.from('mandala_items').insert(items));
  return id;
}

export async function updateChart(chartId, values) {
  await must(supabase.from('mandala_charts').update({ ...values, updated_at: nowIso() }).eq('id', chartId));
}

export async function updateTheme(themeId, title) {
  await must(supabase.from('mandala_themes').update({ title }).eq('id', themeId));
}

export async function updateItem(itemId, values) {
  await must(supabase.from('mandala_items').update(values).eq('id', itemId));
}

// ------------------------------------------------------------
// 週報
// ------------------------------------------------------------
const toReview = (r) => r && ({
  id: r.id,
  staffId: r.staff_id,
  week: String(r.week_start).slice(0, 10),
  goodThings: r.good_things || '',
  challenges: r.challenges || '',
  status: r.status,
  submittedAt: r.submitted_at || null,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

export async function getReview(staffId, week) {
  return toReview(await must(supabase.from('mandala_weekly_reviews').select('*').eq('staff_id', staffId).eq('week_start', week).maybeSingle()));
}

export async function getReviewById(id) {
  return toReview(await must(supabase.from('mandala_weekly_reviews').select('*').eq('id', id).maybeSingle()));
}

/** その週の週報（無ければ下書きを作る） */
export async function ensureReview(staffId, week) {
  const existing = await getReview(staffId, week);
  if (existing) return existing;
  const now = nowIso();
  const { error } = await supabase.from('mandala_weekly_reviews').insert({
    id: newId(), staff_id: staffId, week_start: week, status: 'draft', created_at: now, updated_at: now,
  });
  // 同時に作られた（unique 違反）なら、できた方を使う
  if (error && error.code !== '23505') throw error;
  return getReview(staffId, week);
}

export async function updateReview(id, values) {
  await must(supabase.from('mandala_weekly_reviews').update({ ...values, updated_at: nowIso() }).eq('id', id));
}

export async function getChecks(reviewId) {
  const rows = await must(supabase.from('mandala_habit_checks').select('id, mandala_item_id, checked').eq('review_id', reviewId));
  return rows || [];
}

/** 行動チェックを保存（無い行は作り、ある行は書き換える） */
export async function saveChecks(reviewId, checks) {
  const existing = new Map((await getChecks(reviewId)).map((r) => [r.mandala_item_id, r]));
  const inserts = [];
  for (const [itemId, checked] of Object.entries(checks)) {
    const row = existing.get(itemId);
    if (!row) inserts.push({ id: newId(), review_id: reviewId, mandala_item_id: itemId, checked: !!checked });
    else if (!!row.checked !== !!checked) await must(supabase.from('mandala_habit_checks').update({ checked: !!checked }).eq('id', row.id));
  }
  if (inserts.length) await must(supabase.from('mandala_habit_checks').insert(inserts));
}

const toFocus = (r) => ({
  id: r.id, week: String(r.week_start).slice(0, 10), mandalaItemId: r.mandala_item_id || null, freeText: r.free_text || null,
  source: r.source, achieved: r.achieved === null || r.achieved === undefined ? null : !!r.achieved, sortOrder: r.sort_order || 0,
});

export async function getFocus(staffId, week) {
  const rows = await must(supabase.from('mandala_focus_items').select('*').eq('staff_id', staffId).eq('week_start', week).order('sort_order'));
  return (rows || []).map(toFocus);
}

export async function insertFocus(rows) {
  if (rows.length) await must(supabase.from('mandala_focus_items').insert(rows.map((r) => ({ id: newId(), created_at: nowIso(), ...r }))));
}

export async function updateFocus(id, staffId, values) {
  await must(supabase.from('mandala_focus_items').update(values).eq('id', id).eq('staff_id', staffId));
}

export async function deleteFocus(id, staffId) {
  await must(supabase.from('mandala_focus_items').delete().eq('id', id).eq('staff_id', staffId));
}

/** フォーカスに表示名を付ける（項目が消えていたら「削除された項目」） */
export function labelFocus(focus, chart) {
  const idx = itemIndex(chart);
  return focus.map((f) => ({
    ...f,
    label: f.freeText || (f.mandalaItemId ? (idx.get(f.mandalaItemId) ? idx.get(f.mandalaItemId).item.content : '（削除された項目）') : ''),
  }));
}

export async function latestAiReview(reviewId) {
  const rows = await must(supabase.from('mandala_ai_reviews').select('*').eq('review_id', reviewId).order('created_at', { ascending: false }).limit(1));
  const r = rows && rows[0];
  return r ? { id: r.id, model: r.model, promptVersion: r.prompt_version, result: r.result, createdAt: r.created_at } : null;
}

export async function insertAiReview(row) {
  const out = { id: newId(), kind: 'weekly', created_at: nowIso(), ...row };
  await must(supabase.from('mandala_ai_reviews').insert(out));
  return { id: out.id, model: out.model, promptVersion: out.prompt_version, result: out.result, createdAt: out.created_at };
}

// ------------------------------------------------------------
// コメント（週報・日報）・応援
// ------------------------------------------------------------
export const COMMENT_TABLES = {
  review: { table: 'mandala_review_comments', fk: 'review_id' },
  daily: { table: 'mandala_daily_report_comments', fk: 'report_id' },
};

export async function listComments(kind, targetId) {
  const { table, fk } = COMMENT_TABLES[kind];
  return (await must(supabase.from(table).select('*').eq(fk, targetId).order('created_at'))) || [];
}

export async function insertComment(kind, targetId, author, body) {
  const { table, fk } = COMMENT_TABLES[kind];
  await must(supabase.from(table).insert({ id: newId(), [fk]: targetId, author_id: author.id, author_name: author.name, body, created_at: nowIso() }));
}

export async function getComment(kind, id) {
  const { table } = COMMENT_TABLES[kind];
  return must(supabase.from(table).select('*').eq('id', id).maybeSingle());
}

export async function deleteComment(kind, id) {
  const { table } = COMMENT_TABLES[kind];
  await must(supabase.from(table).delete().eq('id', id));
}

export async function listCheers(chartId) {
  const rows = await must(supabase.from('mandala_cheers').select('*').eq('chart_id', chartId).order('created_at', { ascending: false }).limit(50));
  return rows || [];
}

// ------------------------------------------------------------
// 日報
// ------------------------------------------------------------
const toCheckItem = (r) => ({ id: r.id, storeId: r.store_id || null, section: r.section || 'during', label: r.label, sortOrder: r.sort_order || 0, isActive: r.is_active !== false, createdAt: r.created_at });

/** 店舗のチェック項目（全店舗共通 + 指定の店舗） */
export async function listCheckItems(storeIds = null) {
  const rows = (await must(supabase.from('mandala_daily_check_items').select('*'))) || [];
  const items = rows.map(toCheckItem).filter((r) => storeIds === null || !r.storeId || storeIds.includes(r.storeId));
  return items.sort((a, b) => a.sortOrder - b.sortOrder || String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function getCheckItem(id) {
  const r = await must(supabase.from('mandala_daily_check_items').select('*').eq('id', id).maybeSingle());
  return r ? toCheckItem(r) : null;
}

export async function saveCheckItem(id, values) {
  if (id) await must(supabase.from('mandala_daily_check_items').update(values).eq('id', id));
  else await must(supabase.from('mandala_daily_check_items').insert({ id: newId(), created_at: nowIso(), is_active: true, ...values }));
}

const toDaily = (r) => r && ({
  id: r.id, staffId: r.staff_id, date: String(r.report_date).slice(0, 10),
  learnings: r.learnings || '', challenges: r.challenges || '', tomorrow: r.tomorrow || '', memo: r.memo || '',
  status: r.status, submittedAt: r.submitted_at || null, createdAt: r.created_at, updatedAt: r.updated_at,
});

export async function getDaily(staffId, date) {
  return toDaily(await must(supabase.from('mandala_daily_reports').select('*').eq('staff_id', staffId).eq('report_date', date).maybeSingle()));
}

export async function getDailyById(id) {
  return toDaily(await must(supabase.from('mandala_daily_reports').select('*').eq('id', id).maybeSingle()));
}

export async function upsertDaily(staffId, date, values) {
  const existing = await getDaily(staffId, date);
  const now = nowIso();
  if (existing) {
    await must(supabase.from('mandala_daily_reports').update({ ...values, updated_at: now }).eq('id', existing.id));
    return existing.id;
  }
  const id = newId();
  const { error } = await supabase.from('mandala_daily_reports').insert({ id, staff_id: staffId, report_date: date, created_at: now, updated_at: now, ...values });
  if (error && error.code === '23505') return upsertDaily(staffId, date, values);
  if (error) throw error;
  return id;
}

export async function getDailyChecks(reportId) {
  return (await must(supabase.from('mandala_daily_report_checks').select('id, check_item_id, checked').eq('report_id', reportId))) || [];
}

export async function saveDailyChecks(reportId, checks) {
  const existing = new Map((await getDailyChecks(reportId)).map((r) => [r.check_item_id, r]));
  const inserts = [];
  for (const [itemId, checked] of Object.entries(checks)) {
    const row = existing.get(itemId);
    if (!row) inserts.push({ id: newId(), report_id: reportId, check_item_id: itemId, checked: !!checked });
    else if (!!row.checked !== !!checked) await must(supabase.from('mandala_daily_report_checks').update({ checked: !!checked }).eq('id', row.id));
  }
  if (inserts.length) await must(supabase.from('mandala_daily_report_checks').insert(inserts));
}

/** 日付ごとの提出状況 { 'YYYY-MM-DD': 'draft'|'submitted' } */
export async function dailyStatuses(staffIds, days) {
  if (!staffIds.length || !days.length) return [];
  const rows = await selectIn('mandala_daily_reports', 'id, staff_id, report_date, status, submitted_at, created_at, updated_at', 'staff_id', staffIds, (q) => q.in('report_date', days));
  return rows.map((r) => ({ staffId: r.staff_id, date: String(r.report_date).slice(0, 10), status: r.status, submittedAt: r.submitted_at, createdAt: r.created_at, updatedAt: r.updated_at, id: r.id }));
}

// ------------------------------------------------------------
// 追跡（集計値だけを作る。自由記述は読まない）
// ------------------------------------------------------------
/**
 * スタッフ × 週の進捗をまとめる。
 * @returns Map<staffId, ReturnType<summarizeProgress> & { chart }>
 */
export async function loadProgress(staffIds, endWeek, weekCount, charts = null) {
  const weeks = recentWeeks(endWeek, weekCount);
  const chartMap = charts || await loadCharts(staffIds);
  const reviews = await selectIn('mandala_weekly_reviews', 'id, staff_id, week_start, status, submitted_at, updated_at', 'staff_id', staffIds, (q) => q.in('week_start', weeks));
  const reviewIds = reviews.map((r) => r.id);
  const [checks, focus, comments] = await Promise.all([
    selectIn('mandala_habit_checks', 'id, review_id, checked', 'review_id', reviewIds),
    selectIn('mandala_focus_items', 'id, staff_id, week_start, achieved', 'staff_id', staffIds, (q) => q.in('week_start', weeks)),
    selectIn('mandala_review_comments', 'id, review_id', 'review_id', reviewIds),
  ]);
  const checkAgg = new Map();
  for (const c of checks) {
    const a = checkAgg.get(c.review_id) || { checked: 0, total: 0 };
    a.total += 1;
    if (c.checked) a.checked += 1;
    checkAgg.set(c.review_id, a);
  }
  const focusAgg = new Map();
  for (const f of focus) {
    const key = `${f.staff_id}|${String(f.week_start).slice(0, 10)}`;
    const a = focusAgg.get(key) || { done: 0, total: 0 };
    a.total += 1;
    if (f.achieved) a.done += 1;
    focusAgg.set(key, a);
  }
  const commentAgg = new Map();
  for (const c of comments) commentAgg.set(c.review_id, (commentAgg.get(c.review_id) || 0) + 1);

  const rowsByStaff = new Map();
  for (const r of reviews) {
    const week = String(r.week_start).slice(0, 10);
    const ck = checkAgg.get(r.id) || { checked: 0, total: 0 };
    const fk = focusAgg.get(`${r.staff_id}|${week}`) || { done: 0, total: 0 };
    if (!rowsByStaff.has(r.staff_id)) rowsByStaff.set(r.staff_id, new Map());
    rowsByStaff.get(r.staff_id).set(week, {
      status: r.status, submittedAt: r.submitted_at, updatedAt: r.updated_at,
      checked: ck.checked, checkTotal: ck.total, focusTotal: fk.total, focusDone: fk.done, commentCount: commentAgg.get(r.id) || 0,
    });
  }
  const out = new Map();
  for (const id of staffIds) {
    const full = chartMap.get(id) || null;
    const chart = full ? summarizeChart(full) : null;
    out.set(id, { chart, ...summarizeProgress({ weeks, rows: rowsByStaff.get(id), chart }) });
  }
  return { weeks, progress: out, charts: chartMap };
}

/** 週報の画面の「できた行動」の一覧 */
export function trackableRows(chart) {
  return chart ? trackableItems(chart).map(({ theme, item }) => ({ itemId: item.id, themeTitle: theme.title || `テーマ${theme.position}`, content: item.content })) : [];
}

// ------------------------------------------------------------
// 設定（dash_config の 'mandala.settings'。/api/db の dashConfig からは触れない）
// ------------------------------------------------------------
const SETTINGS_KEY = 'mandala.settings';

export async function readSettings() {
  const row = await must(supabase.from('dash_config').select('value').eq('key', SETTINGS_KEY).maybeSingle());
  return (row && row.value) || {};
}

export async function writeSettings(value) {
  await must(supabase.from('dash_config').upsert({ key: SETTINGS_KEY, value }, { onConflict: 'key' }));
}

export async function setMemberFlags(staffId, values) {
  const existing = await must(supabase.from('mandala_members').select('staff_id').eq('staff_id', staffId).maybeSingle());
  if (existing) await must(supabase.from('mandala_members').update({ ...values, updated_at: nowIso() }).eq('staff_id', staffId));
  else await must(supabase.from('mandala_members').insert({ staff_id: staffId, share_chart: true, daily_report_enabled: false, updated_at: nowIso(), ...values }));
}
