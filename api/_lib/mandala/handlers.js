// ============================================================
// マンダラ: /api/mandala の処理（GET / POST の action ごと）
// ------------------------------------------------------------
// 権限は必ずここで判定する（shared/mandala.js の canViewMember など。画面の出し分けは補助）。
// 仲間（共有）に返すのはチャートと進捗の集計値だけ。週報の自由記述・AI レビュー・コメント・
// 日報は、本人と担当の店長・オーナーにしか返さない。
// ============================================================

import { todayJst, isDate } from '../../../shared/dates.js';
import {
  TRACKING_WEEKS, DAILY_EDITABLE_DAYS, MAX_FOCUS, ITEM_TYPES, DAILY_SECTIONS,
  currentWeekStart, shiftWeek, recentWeeks, recentDays, isValidWeekStart, isFutureWeek, isDailyEditable,
  summarizeChart, trackableItems, focusCandidates, themeCheckRates, itemIndex, trackingTotals,
  canViewMember, canManageMember, canPeerView, canViewChart, canManageCheckItems, isOwnerViewer, isManagerViewer,
  normalizeScope, checkItemLink, parseAmount, toMonthStart, formatDateTimeJst, dayKeyJst,
} from '../../../shared/mandala.js';
import {
  must, selectIn, nowIso, newId, getActiveChart, getChartRow, createChart, updateChart, updateTheme, updateItem,
  getReview, getReviewById, ensureReview, updateReview, getChecks, saveChecks, getFocus, insertFocus, updateFocus, deleteFocus, labelFocus,
  latestAiReview, insertAiReview, listComments, insertComment, getComment, deleteComment as removeComment, listCheers,
  listCheckItems, getCheckItem, saveCheckItem as storeCheckItem, getDaily, getDailyById, upsertDaily, getDailyChecks, saveDailyChecks, dailyStatuses,
  loadProgress, trackableRows, readSettings, writeSettings, setMemberFlags,
} from './data.js';
import { loadDirectory, buildViewer, HttpError, forbidden, notFound, badRequest, authorOf } from './context.js';
import { supabase } from '../supabase.js';
import { runWeeklyReview, runMandalaAssist, buildWeeklyReviewPayload, buildMandalaAssistPayload, isAiConfigured, PROMPT_VERSION, AiError } from './ai.js';

const TEXT_MAX = 4000;
const byName = (a, b) => a.name.localeCompare(b.name, 'ja');
const trim = (v, max = TEXT_MAX) => String(v ?? '').trim().slice(0, max);

// ------------------------------------------------------------
// 文脈
// ------------------------------------------------------------
export async function createContext(staffCtx) {
  const dir = await loadDirectory();
  const viewer = buildViewer(staffCtx, dir);
  const settings = await readSettings();
  const self = viewer.kind === 'staff' ? dir.members.get(viewer.staffId) || null : null;
  return { dir, viewer, self, settings, scope: normalizeScope(settings.sharingScope) };
}

const canManageAny = (ctx) => isOwnerViewer(ctx.viewer) || isManagerViewer(ctx.viewer);
const isSelf = (ctx, m) => ctx.viewer.kind === 'staff' && ctx.viewer.staffId === m.id;
const publicMember = (m) => ({ id: m.id, name: m.name, role: m.role, storeNames: m.storeNames, active: m.active });

function memberOf(ctx, staffId) {
  const m = ctx.dir.members.get(String(staffId || ''));
  if (!m) throw notFound('メンバーが見つかりません');
  return m;
}

/** staffId が無ければ本人 */
function targetOf(ctx, staffId) {
  if (staffId) return memberOf(ctx, staffId);
  if (!ctx.self) throw badRequest('自分のチャートはスタッフ URL で開いてください');
  return ctx.self;
}

function requireSelf(ctx) {
  if (!ctx.self) throw badRequest('スタッフ URL で開いてください（管理者モードでは自分のチャートは持てません）');
  return ctx.self;
}

function boardAvailable(ctx) {
  const s = ctx.self;
  return !!s && ctx.scope !== 'off' && s.active && (ctx.scope === 'all' || s.storeIds.length > 0);
}

/** 追跡ボードに出すメンバー（オーナー = 全員、店長 = 担当店舗） */
function trackedMembers(ctx, storeId) {
  if (!canManageAny(ctx)) throw forbidden('チームの状況は店長・オーナーだけが見られます');
  let list = [...ctx.dir.members.values()].filter((m) => m.active && canViewMember(ctx.viewer, m));
  if (storeId && storeId !== 'all') {
    const sid = ctx.dir.canonical(storeId);
    list = list.filter((m) => m.storeIds.includes(sid));
  }
  return list;
}

function nameOf(ctx, authorId, fallback) {
  const m = authorId ? ctx.dir.members.get(authorId) : null;
  return m ? m.name : fallback || (authorId ? '（不明）' : '管理者');
}

function commentView(ctx, row, ownerId) {
  const mine = ctx.viewer.kind === 'staff' ? row.author_id === ctx.viewer.staffId : !row.author_id;
  return {
    id: row.id,
    authorName: nameOf(ctx, row.author_id, row.author_name),
    body: row.body,
    createdAt: row.created_at,
    mine,
    isOwner: !!ownerId && row.author_id === ownerId,
    canDelete: mine || isOwnerViewer(ctx.viewer),
  };
}

const commentViews = async (ctx, kind, targetId, ownerId) => (await listComments(kind, targetId)).map((r) => commentView(ctx, r, ownerId));

function cheerView(ctx, row) {
  const mine = ctx.viewer.kind === 'staff' && row.author_id === ctx.viewer.staffId;
  return { id: row.id, authorName: nameOf(ctx, row.author_id, row.author_name), body: row.body, createdAt: row.created_at, mine, canDelete: mine || isOwnerViewer(ctx.viewer) };
}

function weekParam(v) {
  return v && isValidWeekStart(v) ? v : currentWeekStart();
}

function requireWeek(v) {
  if (!isValidWeekStart(v)) throw badRequest('週の指定が正しくありません');
  return v;
}

// ------------------------------------------------------------
// GET
// ------------------------------------------------------------
async function getMe(ctx) {
  const { viewer, self } = ctx;
  return {
    viewer: {
      kind: viewer.kind,
      staffId: viewer.staffId,
      name: self ? self.name : viewer.name,
      role: viewer.role,
      isOwner: isOwnerViewer(viewer),
      isManager: isManagerViewer(viewer),
      canManage: canManageAny(ctx),
      canHaveChart: !!self,
    },
    self: self ? { shareChart: self.shareChart, dailyEnabled: self.dailyEnabled, storeNames: self.storeNames } : null,
    scope: ctx.scope,
    boardAvailable: boardAvailable(ctx),
    week: currentWeekStart(),
    today: todayJst(),
    aiConfigured: isAiConfigured(),
  };
}

async function getHome(ctx) {
  const week = currentWeekStart();
  const today = todayJst();
  const out = { week, today, me: null, team: null };
  if (ctx.self) {
    const id = ctx.self.id;
    const { progress, charts } = await loadProgress([id], week, TRACKING_WEEKS);
    const chart = charts.get(id) || null;
    const lastWeek = shiftWeek(week, -1);
    const [review, focusRows, lastReview, daily] = await Promise.all([
      getReview(id, week), getFocus(id, week), getReview(id, lastWeek), ctx.self.dailyEnabled ? getDaily(id, today) : null,
    ]);
    const lastChecks = lastReview ? Object.fromEntries((await getChecks(lastReview.id)).map((c) => [c.mandala_item_id, !!c.checked])) : {};
    const rates = chart && lastReview ? themeCheckRates(trackableItems(chart), lastChecks) : [];
    out.me = {
      chart: chart ? { ...summarizeChart(chart), title: chart.title, baselineAmount: chart.baselineAmount } : null,
      review: review ? { id: review.id, status: review.status, updatedAt: review.updatedAt } : null,
      focus: labelFocus(focusRows, chart),
      lastWeek: { week: lastWeek, rates, done: rates.reduce((s, r) => s + r.done, 0), total: rates.reduce((s, r) => s + r.total, 0), status: lastReview ? lastReview.status : null },
      progress: progress.get(id),
      daily: { enabled: ctx.self.dailyEnabled, status: daily ? daily.status : null },
    };
  }
  if (canManageAny(ctx)) {
    const list = trackedMembers(ctx, null).filter((m) => m.role !== 'owner' && (!ctx.self || m.id !== ctx.self.id));
    const ids = list.map((m) => m.id);
    const reviews = ids.length ? await selectIn('mandala_weekly_reviews', 'id, staff_id, status', 'staff_id', ids, (q) => q.eq('week_start', week)) : [];
    const dailyMembers = list.filter((m) => m.dailyEnabled);
    const dailies = await dailyStatuses(dailyMembers.map((m) => m.id), [today]);
    out.team = {
      members: list.length,
      submitted: reviews.filter((r) => r.status === 'submitted').length,
      dailyMembers: dailyMembers.length,
      dailySubmitted: dailies.filter((d) => d.status === 'submitted').length,
    };
  }
  return out;
}

async function getChartView(ctx, params) {
  const m = targetOf(ctx, params.staffId);
  const self = isSelf(ctx, m);
  const manage = canViewMember(ctx.viewer, m);
  if (!manage && !canPeerView(ctx.self, m, ctx.scope)) throw forbidden('このメンバーのチャートは見られません');
  const { progress, charts } = await loadProgress([m.id], currentWeekStart(), TRACKING_WEEKS);
  let chart = charts.get(m.id) || null;
  // 仲間には今の売上・内訳のメモ（数字）は見せない
  if (chart && !manage) chart = { ...chart, baselineAmount: null, targetBreakdown: '' };
  const cheers = chart ? (await listCheers(chart.id)).map((c) => cheerView(ctx, c)) : [];
  // 今週のフォーカスの項目（盤面で金色の枠にする）。仲間には出さない
  const focusIds = chart && manage ? (await getFocus(m.id, currentWeekStart())).map((f) => f.mandalaItemId).filter(Boolean) : [];
  return {
    member: publicMember(m),
    isSelf: self,
    canEdit: self,
    viaPeer: !manage,
    chart,
    focusIds,
    progress: progress.get(m.id),
    cheers,
    canCheer: !!chart && !!ctx.self && !self,
    shareChart: self ? m.shareChart : undefined,
    dailyEnabled: manage ? m.dailyEnabled : undefined,
    canManage: canManageMember(ctx.viewer, m),
    scope: ctx.scope,
  };
}

async function getReviewView(ctx, params) {
  const m = targetOf(ctx, params.staffId);
  if (!canViewMember(ctx.viewer, m)) throw forbidden('このメンバーの週報は見られません');
  const self = isSelf(ctx, m);
  const week = weekParam(params.week);
  const next = shiftWeek(week, 1);
  const historyWeeks = recentWeeks(week, TRACKING_WEEKS);
  const [chart, review, focusRows, nextRows, historyRows] = await Promise.all([
    getActiveChart(m.id), getReview(m.id, week), getFocus(m.id, week), self ? getFocus(m.id, next) : [],
    selectIn('mandala_weekly_reviews', 'id, week_start, status', 'staff_id', [m.id], (q) => q.in('week_start', historyWeeks)),
  ]);
  const trackables = trackableRows(chart);
  const checks = Object.fromEntries(trackables.map((t) => [t.itemId, false]));
  if (review) for (const r of await getChecks(review.id)) if (r.mandala_item_id in checks) checks[r.mandala_item_id] = !!r.checked;
  const statusOf = new Map(historyRows.map((r) => [String(r.week_start).slice(0, 10), r.status]));
  return {
    member: publicMember(m),
    isSelf: self,
    week,
    currentWeek: currentWeekStart(),
    future: isFutureWeek(week),
    editable: self && !isFutureWeek(week),
    review,
    hasChart: !!chart,
    trackables,
    checks,
    focus: labelFocus(focusRows, chart),
    candidates: self ? focusCandidates(chart) : [],
    nextWeek: next,
    nextFocus: labelFocus(nextRows, chart),
    aiReview: review ? await latestAiReview(review.id) : null,
    aiConfigured: isAiConfigured(),
    comments: review ? await commentViews(ctx, 'review', review.id, m.id) : [],
    history: historyWeeks.map((w) => ({ week: w, status: statusOf.get(w) || null })),
    dailyEnabled: m.dailyEnabled,
    canManage: canManageMember(ctx.viewer, m),
  };
}

async function getDailyView(ctx, params) {
  const m = targetOf(ctx, params.staffId);
  if (!canViewMember(ctx.viewer, m)) throw forbidden('このメンバーの日報は見られません');
  const self = isSelf(ctx, m);
  const today = todayJst();
  const date = isDate(params.date) && params.date <= today ? params.date : today;
  const days = recentDays(today, self ? DAILY_EDITABLE_DAYS : 14);
  const [items, report, statusRows] = await Promise.all([listCheckItems(m.storeIds), getDaily(m.id, date), dailyStatuses([m.id], days)]);
  const checks = report ? Object.fromEntries((await getDailyChecks(report.id)).map((r) => [r.check_item_id, !!r.checked])) : {};
  return {
    member: publicMember(m),
    isSelf: self,
    date,
    today,
    days,
    statuses: Object.fromEntries(statusRows.map((r) => [r.date, r.status])),
    dailyEnabled: m.dailyEnabled,
    editable: self && m.dailyEnabled && isDailyEditable(date),
    // 使わなくなった項目は、その日に記録が残っている時だけ出す
    items: items.filter((i) => i.isActive || i.id in checks).map((i) => ({ id: i.id, label: i.label, section: i.section, link: checkItemLink(i.label) })),
    report,
    checks,
    comments: report ? await commentViews(ctx, 'daily', report.id, m.id) : [],
    canManage: canManageMember(ctx.viewer, m),
  };
}

async function getTeam(ctx, params) {
  const week = weekParam(params.week);
  let list = trackedMembers(ctx, params.storeId);
  const { weeks, progress } = await loadProgress(list.map((m) => m.id), week, TRACKING_WEEKS);
  // オーナーはチャートを作っている時だけ並べる
  list = list.filter((m) => m.role !== 'owner' || progress.get(m.id).chart);
  const members = list.map((m) => ({ ...publicMember(m), storeIds: m.storeIds, shareChart: m.shareChart, dailyEnabled: m.dailyEnabled, ...progress.get(m.id) })).sort(byName);

  const visibleStores = isOwnerViewer(ctx.viewer) ? ctx.dir.stores : ctx.dir.stores.filter((s) => ctx.viewer.storeIds.includes(s.id));
  const stores = (!params.storeId || params.storeId === 'all') && visibleStores.length > 1
    ? visibleStores.map((s) => {
      const ms = members.filter((m) => m.storeIds.includes(s.id));
      const rates = ms.map((m) => m.checkRate).filter((r) => r !== null);
      return { storeId: s.id, name: s.name, memberCount: ms.length, submittedCount: ms.filter((m) => m.current.state === 'submitted').length, chartCount: ms.filter((m) => m.chart).length, checkRate: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null };
    }).filter((s) => s.memberCount > 0)
    : [];

  const today = todayJst();
  const dailyMembers = list.filter((m) => m.dailyEnabled).sort(byName);
  const statusOf = new Map((await dailyStatuses(dailyMembers.map((m) => m.id), [today])).map((r) => [r.staffId, r.status]));
  return {
    week,
    weeks,
    currentWeek: currentWeekStart(),
    members,
    totals: trackingTotals(members),
    stores,
    daily: { today, members: dailyMembers.map((m) => ({ id: m.id, name: m.name, status: statusOf.get(m.id) || null })) },
  };
}

async function getPeers(ctx) {
  const self = requireSelf(ctx);
  const base = { scope: ctx.scope, shareChart: self.shareChart, available: boardAvailable(ctx) };
  if (!base.available) return { ...base, members: [] };
  const list = [...ctx.dir.members.values()].filter((m) => canPeerView(self, m, ctx.scope));
  const { progress } = await loadProgress(list.map((m) => m.id), currentWeekStart(), TRACKING_WEEKS);
  return { ...base, members: list.map((m) => ({ ...publicMember(m), ...progress.get(m.id) })).sort(byName) };
}

const ACTIVITY_RANGES = [7, 14, 30];
const UPDATE_THRESHOLD_MS = 2 * 60 * 1000;
const meaningfullyLater = (later, base) => !!later && new Date(later).getTime() - new Date(base).getTime() > UPDATE_THRESHOLD_MS;

/** 日々の動き（専用の履歴テーブルは持たず、作成・更新・提出の日時から組み立てる） */
async function getActivity(ctx, params) {
  let list;
  if (params.staffId) {
    const m = memberOf(ctx, params.staffId);
    if (!canViewMember(ctx.viewer, m) || (!canManageAny(ctx) && !isSelf(ctx, m))) throw forbidden();
    list = [m];
  } else {
    list = trackedMembers(ctx, params.storeId);
  }
  const days = ACTIVITY_RANGES.includes(Number(params.days)) ? Number(params.days) : 7;
  const limit = params.staffId ? 60 : 200;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const ids = list.map((m) => m.id);
  const idSet = new Set(ids);
  const name = (id) => nameOf(ctx, id, null);
  if (!ids.length) return { days, events: [] };

  const [reviews, charts, comments, cheers, dailies] = await Promise.all([
    selectIn('mandala_weekly_reviews', 'id, staff_id, week_start, status, created_at, updated_at, submitted_at', 'staff_id', ids, (q) => q.gte('updated_at', since)),
    selectIn('mandala_charts', 'id, staff_id, created_at, updated_at, center_goal', 'staff_id', ids, (q) => q.gte('updated_at', since)),
    must(supabase.from('mandala_review_comments').select('id, review_id, author_id, author_name, body, created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(500)),
    must(supabase.from('mandala_cheers').select('id, chart_id, author_id, author_name, body, created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(500)),
    selectIn('mandala_daily_reports', 'id, staff_id, report_date, status, submitted_at', 'staff_id', ids, (q) => q.gte('updated_at', since)),
  ]);
  // コメント・応援は、対象の週報・チャートが見える範囲のものだけ
  const commentReviews = await selectIn('mandala_weekly_reviews', 'id, staff_id, week_start', 'id', (comments || []).map((c) => c.review_id));
  const reviewOf = new Map([...reviews, ...commentReviews].map((r) => [r.id, r]));
  const cheerCharts = await selectIn('mandala_charts', 'id, staff_id', 'id', (cheers || []).map((c) => c.chart_id));
  const chartOwner = new Map(cheerCharts.map((c) => [c.id, c.staff_id]));

  const events = [];
  const push = (e) => events.push({ ...e, actorName: e.actorName || name(e.actorId), subjectName: name(e.subjectId) });
  for (const r of reviews) {
    const week = String(r.week_start).slice(0, 10);
    if (r.created_at >= since) push({ id: `rs-${r.id}`, kind: 'review_started', at: r.created_at, actorId: r.staff_id, subjectId: r.staff_id, week });
    if (r.submitted_at && r.submitted_at >= since) push({ id: `rb-${r.id}`, kind: 'review_submitted', at: r.submitted_at, actorId: r.staff_id, subjectId: r.staff_id, week });
    if (r.status !== 'submitted' && meaningfullyLater(r.updated_at, r.created_at)) push({ id: `ru-${r.id}`, kind: 'review_updated', at: r.updated_at, actorId: r.staff_id, subjectId: r.staff_id, week });
  }
  for (const c of charts) {
    if (c.created_at >= since) push({ id: `cc-${c.id}`, kind: 'chart_created', at: c.created_at, actorId: c.staff_id, subjectId: c.staff_id, note: c.center_goal });
    if (meaningfullyLater(c.updated_at, c.created_at)) push({ id: `cu-${c.id}`, kind: 'chart_updated', at: c.updated_at, actorId: c.staff_id, subjectId: c.staff_id, note: c.center_goal });
  }
  for (const c of comments || []) {
    const r = reviewOf.get(c.review_id);
    if (!r || !idSet.has(r.staff_id)) continue;
    push({ id: `cm-${c.id}`, kind: 'comment', at: c.created_at, actorId: c.author_id, actorName: nameOf(ctx, c.author_id, c.author_name), subjectId: r.staff_id, week: String(r.week_start).slice(0, 10), note: c.body });
  }
  for (const c of cheers || []) {
    const owner = chartOwner.get(c.chart_id);
    if (!owner || !idSet.has(owner)) continue;
    push({ id: `ch-${c.id}`, kind: 'cheer', at: c.created_at, actorId: c.author_id, actorName: nameOf(ctx, c.author_id, c.author_name), subjectId: owner, note: c.body });
  }
  for (const d of dailies) {
    if (d.submitted_at && d.submitted_at >= since) push({ id: `dy-${d.id}`, kind: 'daily_submitted', at: d.submitted_at, actorId: d.staff_id, subjectId: d.staff_id, date: String(d.report_date).slice(0, 10) });
  }
  const reviewIds = reviews.map((r) => r.id);
  if (reviewIds.length) {
    const ai = await selectIn('mandala_ai_reviews', 'id, review_id, created_at', 'review_id', reviewIds, (q) => q.gte('created_at', since));
    for (const a of ai) {
      const r = reviewOf.get(a.review_id);
      if (r) push({ id: `ai-${a.id}`, kind: 'ai_review', at: a.created_at, actorId: r.staff_id, subjectId: r.staff_id, week: String(r.week_start).slice(0, 10) });
    }
  }
  const sorted = events.filter((e) => e.at >= since).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
  return { days, events: sorted.map((e) => ({ ...e, day: dayKeyJst(e.at) })) };
}

async function getSettings(ctx) {
  if (!canManageAny(ctx)) throw forbidden('設定は店長・オーナーだけが変えられます');
  const owner = isOwnerViewer(ctx.viewer);
  const members = [...ctx.dir.members.values()].filter((m) => m.active && m.role !== 'owner' && canManageMember(ctx.viewer, m)).sort(byName);
  const stores = owner ? ctx.dir.stores : ctx.dir.stores.filter((s) => ctx.viewer.storeIds.includes(s.id));
  const items = (await listCheckItems(null)).filter((i) => !i.storeId || stores.some((s) => s.id === i.storeId));
  return {
    scope: ctx.scope,
    canEditScope: owner,
    settingsUpdatedAt: ctx.settings.updatedAt || null,
    members: members.map((m) => ({ ...publicMember(m), shareChart: m.shareChart, dailyEnabled: m.dailyEnabled })),
    stores,
    canManageCommon: owner,
    checkItems: items.map((i) => ({ ...i, storeName: i.storeId ? ctx.dir.storeName(i.storeId) : '全店舗共通', canEdit: canManageCheckItems(ctx.viewer, i.storeId) })),
  };
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 提出状況・行動チェック・フォーカスの CSV（店長・オーナー） */
async function getCsv(ctx, params) {
  const end = weekParam(params.to);
  const count = Math.min(Math.max(Math.trunc(Number(params.weeks) || 12), 1), 52);
  const list = trackedMembers(ctx, params.storeId).filter((m) => m.role !== 'owner').sort(byName);
  const { weeks, progress } = await loadProgress(list.map((m) => m.id), end, count);
  const lines = [['週', '店舗', 'スタッフ', '状態', '提出日時', '行動チェック(実施)', '行動チェック(対象)', '行動実行率', 'フォーカス(達成)', 'フォーカス(設定)'].map(csvCell).join(',')];
  weeks.forEach((week, wi) => {
    for (const m of list) {
      const w = progress.get(m.id).weeks[wi];
      const rate = w.state !== 'none' && w.checkTotal > 0 ? Math.round((w.checked / w.checkTotal) * 100) / 100 : '';
      lines.push([
        week, m.storeNames.join('・'), m.name,
        w.state === 'submitted' ? '提出済み' : w.state === 'draft' ? '下書き' : '未作成',
        w.submittedAt ? formatDateTimeJst(w.submittedAt) : '',
        w.state === 'none' ? '' : w.checked, w.state === 'none' ? '' : w.checkTotal, rate,
        w.focusTotal ? w.focusDone : '', w.focusTotal || '',
      ].map(csvCell).join(','));
    }
  });
  // Excel で文字化けしないよう BOM を付ける
  return { filename: `mandala-weekly-${weeks[0]}_${end}.csv`, csv: `﻿${lines.join('\n')}` };
}

// ------------------------------------------------------------
// POST
// ------------------------------------------------------------
async function postSaveChart(ctx, body) {
  const self = requireSelf(ctx);
  let chart = await getActiveChart(self.id);
  let touched = false;
  if (body.chart && typeof body.chart === 'object') {
    const c = body.chart;
    const values = {};
    if ('centerGoal' in c) {
      const goal = trim(c.centerGoal, 200);
      if (!goal) throw badRequest('センターゴールを入力してください');
      values.center_goal = goal;
    }
    if ('title' in c) values.title = trim(c.title, 100);
    if ('baselineAmount' in c) values.baseline_amount = parseAmount(c.baselineAmount);
    if ('targetAmount' in c) values.target_amount = parseAmount(c.targetAmount);
    if ('targetBreakdown' in c) values.target_breakdown = trim(c.targetBreakdown, 2000) || null;
    if ('deadlineMonth' in c) values.deadline_month = c.deadlineMonth ? toMonthStart(String(c.deadlineMonth).slice(0, 7)) : null;
    if (!chart) {
      if (!values.center_goal) throw badRequest('センターゴールを入力してください');
      await createChart(self.id, values);
      chart = await getActiveChart(self.id);
    } else if (Object.keys(values).length) {
      await updateChart(chart.id, values);
    }
  }
  if (!chart) throw badRequest('先にセンターゴールを保存してください');
  if (Array.isArray(body.themes)) {
    for (const t of body.themes) {
      const theme = chart.themes.find((x) => x.position === Number(t.position));
      const title = trim(t.title, 60);
      if (theme && theme.title !== title) { await updateTheme(theme.id, title); touched = true; }
    }
  }
  if (Array.isArray(body.items)) {
    const idx = itemIndex(chart);
    for (const it of body.items) {
      const entry = idx.get(it.id);
      if (!entry) continue; // 自分のチャートの項目だけ
      const cur = entry.item;
      const content = 'content' in it ? trim(it.content, 200) : cur.content;
      const itemType = ITEM_TYPES.includes(it.itemType) ? it.itemType : cur.itemType;
      // 週次チェックは「行動」だけ
      const weeklyTrackable = itemType === 'action' && ('weeklyTrackable' in it ? !!it.weeklyTrackable : cur.weeklyTrackable);
      if (content !== cur.content || itemType !== cur.itemType || weeklyTrackable !== cur.weeklyTrackable) {
        await updateItem(cur.id, { content, item_type: itemType, weekly_trackable: weeklyTrackable });
        touched = true;
      }
    }
  }
  if (touched) await updateChart(chart.id, {});
  return { chart: await getActiveChart(self.id) };
}

async function postSaveReview(ctx, body) {
  const self = requireSelf(ctx);
  const week = requireWeek(body.week);
  if (isFutureWeek(week)) throw badRequest('未来の週はまだ入力できません');
  const review = await ensureReview(self.id, week);
  const chart = await getActiveChart(self.id);
  const valid = new Set(trackableRows(chart).map((t) => t.itemId));
  const checks = {};
  for (const [id, v] of Object.entries(body.checks || {})) if (valid.has(id)) checks[id] = !!v;
  await saveChecks(review.id, checks);
  const focus = await getFocus(self.id, week);
  for (const f of focus) {
    if (!body.focusAchieved || !(f.id in body.focusAchieved)) continue;
    const v = body.focusAchieved[f.id];
    const achieved = v === true ? true : v === false ? false : null;
    if (achieved !== f.achieved) await updateFocus(f.id, self.id, { achieved });
  }
  const values = { good_things: trim(body.goodThings) || null, challenges: trim(body.challenges) || null };
  if (body.submit) Object.assign(values, { status: 'submitted', submitted_at: nowIso() });
  await updateReview(review.id, values);
  return { review: await getReview(self.id, week) };
}

/** フォーカスを付けられるのは今週と来週だけ */
function focusWeek(body) {
  const week = requireWeek(body.week);
  if (week < currentWeekStart() || week > shiftWeek(currentWeekStart(), 1)) throw badRequest('フォーカスを決められるのは今週と来週です');
  return week;
}

async function focusResponse(selfId, week, chart) {
  return { week, focus: labelFocus(await getFocus(selfId, week), chart || await getActiveChart(selfId)) };
}

async function postAddFocus(ctx, body) {
  const self = requireSelf(ctx);
  const week = focusWeek(body);
  const chart = await getActiveChart(self.id);
  const existing = await getFocus(self.id, week);
  if (existing.length >= MAX_FOCUS) throw badRequest(`フォーカスは${MAX_FOCUS}つまでです。外してから選んでください`);
  const itemId = body.itemId ? String(body.itemId) : null;
  const freeText = trim(body.freeText, 200);
  if (itemId) {
    if (!focusCandidates(chart).some((c) => c.id === itemId)) throw badRequest('チャートの「行動」の項目から選んでください');
    if (existing.some((f) => f.mandalaItemId === itemId)) return focusResponse(self.id, week, chart);
  } else if (!freeText) {
    throw badRequest('項目を選ぶか、内容を入力してください');
  }
  await insertFocus([{ staff_id: self.id, week_start: week, mandala_item_id: itemId, free_text: itemId ? null : freeText, source: 'self', sort_order: existing.length }]);
  return focusResponse(self.id, week, chart);
}

async function postRemoveFocus(ctx, body) {
  const self = requireSelf(ctx);
  const week = requireWeek(body.week);
  await deleteFocus(String(body.focusId || ''), self.id);
  return focusResponse(self.id, week);
}

/** AI が提案した翌週のフォーカスを採用（3つに収まる分だけ・重複は入れない） */
async function postAdoptFocus(ctx, body) {
  const self = requireSelf(ctx);
  const week = focusWeek(body);
  const chart = await getActiveChart(self.id);
  const candidates = new Set(focusCandidates(chart).map((c) => c.id));
  const existing = await getFocus(self.id, week);
  const have = new Set(existing.map((f) => f.mandalaItemId));
  const capacity = Math.max(0, MAX_FOCUS - existing.length);
  const fresh = [...new Set((body.items || []).map((i) => String(i.mandalaItemId || '')))].filter((id) => candidates.has(id) && !have.has(id));
  if (fresh.length && capacity === 0) throw badRequest(`フォーカスは${MAX_FOCUS}つまでです。外してから採用してください`);
  await insertFocus(fresh.slice(0, capacity).map((id, i) => ({ staff_id: self.id, week_start: week, mandala_item_id: id, free_text: null, source: 'ai', sort_order: existing.length + i })));
  return focusResponse(self.id, week, chart);
}

async function commentTarget(kind, targetId) {
  if (kind === 'review') {
    const r = await getReviewById(targetId);
    return r ? { ownerId: r.staffId } : null;
  }
  if (kind === 'daily') {
    const d = await getDailyById(targetId);
    return d ? { ownerId: d.staffId } : null;
  }
  throw badRequest('kind が正しくありません');
}

async function postAddComment(ctx, body) {
  const kind = body.kind;
  const targetId = String(body.targetId || '');
  const text = trim(body.body, 2001);
  if (!text) throw badRequest('メッセージを入力してください');
  if (text.length > 2000) throw badRequest('メッセージが長すぎます（2,000文字まで）');
  const target = await commentTarget(kind, targetId);
  if (!target) throw notFound('週報・日報が見つかりません');
  const owner = memberOf(ctx, target.ownerId);
  if (!canViewMember(ctx.viewer, owner)) throw forbidden();
  await insertComment(kind, targetId, authorOf(ctx.viewer), text);
  return { comments: await commentViews(ctx, kind, targetId, owner.id) };
}

async function postDeleteComment(ctx, body) {
  const kind = body.kind;
  if (kind !== 'review' && kind !== 'daily') throw badRequest('kind が正しくありません');
  const row = await getComment(kind, String(body.id || ''));
  if (!row) throw notFound('コメントが見つかりません');
  const mine = ctx.viewer.kind === 'staff' ? row.author_id === ctx.viewer.staffId : !row.author_id;
  if (!mine && !isOwnerViewer(ctx.viewer)) throw forbidden('削除できるのは書いた本人とオーナーだけです');
  await removeComment(kind, row.id);
  return { success: true };
}

async function postSaveDaily(ctx, body) {
  const self = requireSelf(ctx);
  if (!self.dailyEnabled) throw badRequest('日報の対象ではありません（店長・オーナーが指定します）');
  const date = String(body.date || '');
  if (!isDailyEditable(date)) throw badRequest('この日の日報は書き直せません（今日を含む7日間だけ）');
  const existing = await getDaily(self.id, date);
  // 一度出した日報は下書きに戻さない
  const submitted = !!body.submit || (existing && existing.status === 'submitted');
  const reportId = await upsertDaily(self.id, date, {
    learnings: trim(body.learnings) || null,
    challenges: trim(body.challenges) || null,
    tomorrow: trim(body.tomorrow) || null,
    memo: trim(body.memo) || null,
    status: submitted ? 'submitted' : 'draft',
    submitted_at: submitted ? (existing && existing.submittedAt) || nowIso() : null,
  });
  const valid = new Set((await listCheckItems(self.storeIds)).map((i) => i.id));
  const checks = {};
  for (const [id, v] of Object.entries(body.checks || {})) if (valid.has(id)) checks[id] = !!v;
  await saveDailyChecks(reportId, checks);
  return { report: await getDaily(self.id, date) };
}

async function postSetShare(ctx, body) {
  const self = requireSelf(ctx);
  await setMemberFlags(self.id, { share_chart: !!body.share });
  return { shareChart: !!body.share };
}

async function postSetDailyEnabled(ctx, body) {
  const m = memberOf(ctx, body.staffId);
  if (!canManageMember(ctx.viewer, m)) throw forbidden('日報の対象を決められるのは店長・オーナーです');
  await setMemberFlags(m.id, { daily_report_enabled: !!body.enabled });
  return { staffId: m.id, dailyEnabled: !!body.enabled };
}

async function postSetSharingScope(ctx, body) {
  if (!isOwnerViewer(ctx.viewer)) throw forbidden('共有の範囲を変えられるのはオーナーだけです');
  const scope = normalizeScope(body.scope);
  if (scope !== body.scope) throw badRequest('共有の範囲が正しくありません');
  await writeSettings({ ...ctx.settings, sharingScope: scope, updatedAt: nowIso(), updatedBy: authorOf(ctx.viewer).name });
  return { scope };
}

async function postSaveCheckItem(ctx, body) {
  const storeId = body.storeId ? ctx.dir.canonical(String(body.storeId)) : null;
  if (storeId && !ctx.dir.stores.some((s) => s.id === storeId)) throw badRequest('店舗が見つかりません');
  if (!canManageCheckItems(ctx.viewer, storeId)) throw forbidden(storeId ? 'この店舗の項目は変えられません' : '全店舗共通の項目はオーナーだけが変えられます');
  const id = body.id ? String(body.id) : null;
  if (id) {
    const existing = await getCheckItem(id);
    if (!existing) throw notFound('項目が見つかりません');
    if (!canManageCheckItems(ctx.viewer, existing.storeId)) throw forbidden('この項目は変えられません');
  }
  const label = trim(body.label, 200);
  if (!label) throw badRequest('項目名を入力してください');
  const section = DAILY_SECTIONS.some((s) => s.key === body.section) ? body.section : 'during';
  const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Math.round(Number(body.sortOrder)) : 0;
  await storeCheckItem(id, { store_id: storeId, section, label, sort_order: sortOrder, ...(id ? { is_active: body.isActive !== false } : {}) });
  return { success: true };
}

async function postAddCheer(ctx, body) {
  const self = requireSelf(ctx);
  const chart = await getChartRow(String(body.chartId || ''));
  if (!chart) throw notFound('チャートが見つかりません');
  if (chart.staff_id === self.id) throw badRequest('自分のチャートには応援を送れません');
  const owner = memberOf(ctx, chart.staff_id);
  if (!canViewChart(ctx.viewer, self, owner, ctx.scope)) throw forbidden();
  const text = trim(body.body, 501);
  if (!text) throw badRequest('ひとことを入力してください');
  if (text.length > 500) throw badRequest('500文字以内で入力してください');
  await must(supabase.from('mandala_cheers').insert({ id: newId(), chart_id: chart.id, author_id: self.id, author_name: self.name, body: text, created_at: nowIso() }));
  return { cheers: (await listCheers(chart.id)).map((c) => cheerView(ctx, c)) };
}

async function postDeleteCheer(ctx, body) {
  const row = await must(supabase.from('mandala_cheers').select('*').eq('id', String(body.id || '')).maybeSingle());
  if (!row) throw notFound('応援が見つかりません');
  const mine = ctx.viewer.kind === 'staff' && row.author_id === ctx.viewer.staffId;
  if (!mine && !isOwnerViewer(ctx.viewer)) throw forbidden();
  await must(supabase.from('mandala_cheers').delete().eq('id', row.id));
  return { success: true };
}

async function postAiReview(ctx, body) {
  if (!isAiConfigured()) throw new HttpError(503, 'ANTHROPIC_API_KEY が未設定のため、AI レビューを実行できません');
  const review = await getReviewById(String(body.reviewId || ''));
  if (!review) throw notFound('週報が見つかりません');
  const m = memberOf(ctx, review.staffId);
  if (!canViewMember(ctx.viewer, m)) throw forbidden();
  if (!body.force) {
    const cached = await latestAiReview(review.id);
    if (cached) return { aiReview: cached, cached: true };
  }
  const chart = await getActiveChart(m.id);
  if (!chart) throw badRequest('マンダラチャートが未作成のため、AI レビューを実行できません');
  const candidates = focusCandidates(chart);
  if (candidates.length < 3) throw badRequest('翌週のフォーカスの候補（「行動」の項目）が3つ未満です。チャートに行動を書き足してください');
  const checks = Object.fromEntries((await getChecks(review.id)).map((c) => [c.mandala_item_id, !!c.checked]));
  const [focus, { progress }] = await Promise.all([getFocus(m.id, review.week), loadProgress([m.id], review.week, 4, new Map([[m.id, chart]]))]);
  const payload = buildWeeklyReviewPayload({
    week: review.week, review, chart, trackables: trackableItems(chart), checks, focus,
    storeLabel: m.storeNames.join('・'), displayName: m.name, history: progress.get(m.id).weeks, candidates,
  });
  let out;
  try {
    out = await runWeeklyReview({ payload, candidateIds: new Set(candidates.map((c) => c.id)) });
  } catch (e) {
    if (e instanceof AiError) throw new HttpError(502, e.message);
    throw e;
  }
  const saved = await insertAiReview({ review_id: review.id, model: out.model, prompt_version: PROMPT_VERSION, result: out.result, input_tokens: out.inputTokens, output_tokens: out.outputTokens });
  return { aiReview: saved, cached: false };
}

async function postAiAssist(ctx, body) {
  if (!isAiConfigured()) throw new HttpError(503, 'ANTHROPIC_API_KEY が未設定のため、AI の提案を使えません');
  const self = requireSelf(ctx);
  // 対象は常に自分のチャート（画面からの指定はテーマの番号だけ）
  const chart = await getActiveChart(self.id);
  if (!chart) throw notFound('チャートが見つかりません');
  const pos = Number(body.themePosition);
  const themes = (pos >= 1 && pos <= 8 ? chart.themes.filter((t) => t.position === pos) : chart.themes)
    .map((t) => ({ position: t.position, title: t.title, items: t.items.filter((i) => i.content.trim()).map((i) => ({ position: i.position, content: i.content })) }))
    .filter((t) => t.items.length > 0);
  if (!themes.length) throw badRequest('分類する項目がありません。先に項目を入力してください');
  let out;
  try {
    out = await runMandalaAssist(buildMandalaAssistPayload({ centerGoal: chart.centerGoal, themes }));
  } catch (e) {
    if (e instanceof AiError) throw new HttpError(502, e.message);
    throw e;
  }
  const suggestions = [];
  for (const s of out.items) {
    const theme = chart.themes.find((t) => t.position === s.theme_position);
    const item = theme && theme.items.find((i) => i.position === s.position);
    if (!item || !item.content.trim()) continue;
    suggestions.push({
      itemId: item.id, themePosition: theme.position, content: item.content, currentType: item.itemType, currentTrackable: item.weeklyTrackable,
      suggestedType: s.suggested_type, weeklyTrackable: s.suggested_type === 'action' && s.weekly_trackable,
      rewrite: s.rewrite && s.rewrite !== item.content ? s.rewrite : null,
    });
  }
  return { suggestions, model: out.model };
}

// ------------------------------------------------------------
const GET = {
  me: getMe, home: getHome, chart: getChartView, review: getReviewView, daily: getDailyView,
  team: getTeam, peers: getPeers, activity: getActivity, settings: getSettings, csv: getCsv,
};
const POST = {
  saveChart: postSaveChart, saveReview: postSaveReview, addFocus: postAddFocus, removeFocus: postRemoveFocus, adoptFocus: postAdoptFocus,
  addComment: postAddComment, deleteComment: postDeleteComment, saveDaily: postSaveDaily,
  setShare: postSetShare, setDailyEnabled: postSetDailyEnabled, setSharingScope: postSetSharingScope, saveCheckItem: postSaveCheckItem,
  addCheer: postAddCheer, deleteCheer: postDeleteCheer, aiReview: postAiReview, aiAssist: postAiAssist,
};

export const ACTIONS = { GET: Object.keys(GET), POST: Object.keys(POST) };

/** staffCtx: null = 管理者モード / { valid: true, staffId, role, storeIds, name } */
export async function handleMandala(method, action, input, staffCtx) {
  const table = method === 'POST' ? POST : GET;
  const fn = table[action];
  if (!fn) throw badRequest(`不明な action: ${action}`);
  const ctx = await createContext(staffCtx);
  return fn(ctx, input || {});
}

export { HttpError };
