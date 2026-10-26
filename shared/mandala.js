// ============================================================
// マンダラチャート（週報・日報）— サーバー / ブラウザ共通の純粋ロジック
// ------------------------------------------------------------
// 週は月曜はじまり・日本時間。週は週の月曜 'YYYY-MM-DD' で表す。
// 追跡するのは「チャートが書けているか」「週報・日報が回っているか」だけ。
// 売上などの数値は SalonOne（このダッシュボードの他の画面）で見る。
//
// 見える範囲（サーバーの api/_lib/mandala が必ず判定する。画面は出し分けにだけ使う）
//   本人             … 自分のチャート・週報・日報を書く
//   店長・マネージャー … 担当店舗のメンバーのチャート・週報・日報を見る・コメントする
//   オーナー・管理者   … 全員
//   仲間（共有がオン） … チャートと進捗の集計値だけ。振り返りの自由記述・AI レビュー・コメントは見えない
// ============================================================

import { addDays, todayJst, weekdayOf, isDate } from './dates.js';

// ------------------------------------------------------------
// 週・日
// ------------------------------------------------------------
const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土'];

/** 日報を本人が書き直せる日数（今日を含む）。それより前は見るだけ */
export const DAILY_EDITABLE_DAYS = 7;
/** 追跡ボード・推移で見る週数 */
export const TRACKING_WEEKS = 8;
/** 週のフォーカスの上限 */
export const MAX_FOCUS = 3;

/** その日を含む週の月曜 */
export function weekStartOf(date) {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

/** 日本時間の今週の月曜 */
export function currentWeekStart(now = Date.now()) {
  return weekStartOf(todayJst(now));
}

export const shiftWeek = (week, n) => addDays(week, n * 7);

/** endWeek を最後に count 週（古い順） */
export function recentWeeks(endWeek, count) {
  return Array.from({ length: count }, (_, i) => shiftWeek(endWeek, i - (count - 1)));
}

/** 直近 count 日（古い順・endDay を含む） */
export function recentDays(endDay, count) {
  return Array.from({ length: count }, (_, i) => addDays(endDay, i - (count - 1)));
}

/** 'YYYY-MM-DD' の月曜か（URL・API の入力チェック用） */
export function isValidWeekStart(value) {
  return isDate(value) && weekdayOf(value) === 1 && addDays(value, 0) === value;
}

export const isFutureWeek = (week, now = Date.now()) => week > currentWeekStart(now);
export const isCurrentWeek = (week, now = Date.now()) => week === currentWeekStart(now);

/** 日報を本人が書けるか（未来日と 7日より前は不可） */
export function isDailyEditable(date, now = Date.now()) {
  const today = todayJst(now);
  return isDate(date) && date <= today && date > addDays(today, -DAILY_EDITABLE_DAYS);
}

const md = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/** '2026-10-26' → '10/26(月)' */
export function formatDay(date) {
  return `${md(date)}(${WEEKDAY[weekdayOf(date)]})`;
}

/** 週の範囲 '10/26(月)〜11/1(日)' */
export function formatWeekRange(week) {
  return `${formatDay(week)}〜${formatDay(addDays(week, 6))}`;
}

/** '10/26の週' */
export function formatWeekShort(week) {
  return `${md(week)}の週`;
}

/** 軸用の短い表記 '10/26' */
export const formatMd = md;

export const weekdayLabel = (date) => WEEKDAY[weekdayOf(date)];

/** ISO 日時を日本時間の 'YYYY-MM-DD' に */
export function dayKeyJst(iso) {
  return todayJst(new Date(iso).getTime());
}

/** ISO 日時 → '10/26 21:05'（日本時間） */
export function formatDateTimeJst(iso) {
  if (!iso) return '';
  const t = new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString();
  return `${Number(t.slice(5, 7))}/${Number(t.slice(8, 10))} ${t.slice(11, 16)}`;
}

/** 「3日前」。7日以上前は日付 */
export function formatRelative(iso, now = Date.now()) {
  if (!iso) return '';
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'たった今';
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}日前`;
  const d = dayKeyJst(iso);
  return `${Number(d.slice(0, 4))}/${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
}

// ------------------------------------------------------------
// チャート
// ------------------------------------------------------------
export const ITEM_TYPES = ['action', 'metric', 'mindset'];
export const ITEM_TYPE_LABEL = { action: '行動', metric: '数値', mindset: '心構え' };
export const ITEM_TYPE_HINT = {
  action: 'やったかどうかで毎週チェックできる',
  metric: '数字で測るもの（SalonOne で見る・ここでは追跡しない）',
  mindset: '心構え・状態（追跡しない）',
};

/** テーマ③の入力例（旧ツールと同じ） */
export const THEME_PLACEHOLDERS = ['技術向上', '口コミ高評価', '接客・対応力', 'リピート獲得', '自己理解', '予約管理カルテ', '売上管理UP', '空間づくり'];

/**
 * 3×3 の並び（1..8 が中央を囲む）
 *   1 2 3
 *   4 C 5
 *   6 7 8
 */
export const GRID_ORDER = [1, 2, 3, 4, 'center', 5, 6, 7, 8];

/** チャート = { ..., themes: [{ id, position, title, items: [{ id, position, content, itemType, weeklyTrackable }] }] } */
export function sortChart(chart) {
  if (!chart) return chart;
  const themes = [...(chart.themes || [])]
    .sort((a, b) => a.position - b.position)
    .map((t) => ({ ...t, items: [...(t.items || [])].sort((a, b) => a.position - b.position) }));
  return { ...chart, themes };
}

const filled = (s) => !!String(s || '').trim();
const themeLabel = (theme) => theme.title || `テーマ${theme.position}`;

/** 週次チェックの対象（行動 かつ 毎週チェック かつ 内容あり） */
export function trackableItems(chart) {
  const out = [];
  for (const theme of (chart && chart.themes) || []) {
    for (const item of theme.items || []) {
      if (item.itemType === 'action' && item.weeklyTrackable && filled(item.content)) out.push({ theme, item });
    }
  }
  return out;
}

/** フォーカスの候補（内容のある行動の項目すべて） */
export function focusCandidates(chart) {
  const out = [];
  for (const theme of (chart && chart.themes) || []) {
    for (const item of theme.items || []) {
      if (item.itemType === 'action' && filled(item.content)) out.push({ id: item.id, themeTitle: themeLabel(theme), content: item.content.trim() });
    }
  }
  return out;
}

export function itemIndex(chart) {
  const map = new Map();
  for (const theme of (chart && chart.themes) || []) {
    for (const item of theme.items || []) map.set(item.id, { theme, item });
  }
  return map;
}

/** 一覧・追跡用の要約（項目の中身は持たない） */
export function summarizeChart(chart) {
  const themes = [...(chart.themes || [])].sort((a, b) => a.position - b.position).map((t) => ({
    position: t.position,
    title: t.title || '',
    filled: (t.items || []).filter((i) => filled(i.content)).length,
    trackable: (t.items || []).filter((i) => i.itemType === 'action' && i.weeklyTrackable && filled(i.content)).length,
  }));
  return {
    id: chart.id,
    status: chart.status,
    centerGoal: chart.centerGoal || '',
    targetAmount: chart.targetAmount ?? null,
    deadlineMonth: chart.deadlineMonth || null,
    themes,
    themeCount: themes.filter((t) => filled(t.title)).length,
    itemCount: themes.reduce((s, t) => s + t.filled, 0),
    trackableCount: themes.reduce((s, t) => s + t.trackable, 0),
    createdAt: chart.createdAt,
    updatedAt: chart.updatedAt,
  };
}

/** チャートの記入率（0〜1）。テーマ 8 + 項目 64 を満点とする */
export function chartFillRate(summary) {
  if (!summary) return 0;
  return (summary.themeCount + summary.itemCount) / 72;
}

/** テーマ別の行動チェック（checks = Map/オブジェクト itemId → boolean） */
export function themeCheckRates(trackables, checks) {
  const get = (id) => (checks instanceof Map ? checks.get(id) : checks && checks[id]);
  const byTheme = new Map();
  for (const { theme, item } of trackables) {
    const key = themeLabel(theme);
    if (!byTheme.has(key)) byTheme.set(key, { theme: key, done: 0, total: 0, missed: [] });
    const e = byTheme.get(key);
    e.total += 1;
    if (get(item.id)) e.done += 1;
    else e.missed.push(item.content);
  }
  return [...byTheme.values()];
}

// ------------------------------------------------------------
// 追跡（集計値だけ。自由記述は含めない）
// ------------------------------------------------------------
export function emptyProgress(week) {
  return { week, state: 'none', checked: 0, checkTotal: 0, focusTotal: 0, focusDone: 0, commentCount: 0, submittedAt: null, updatedAt: null };
}

const laterOf = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

/**
 * 1人分の週ごとの進捗をまとめる。
 * @param {object} p
 * @param {string[]} p.weeks       古い順の週
 * @param {Map<string,object>} p.rows 週 → { status, submittedAt, updatedAt, checked, checkTotal, focusTotal, focusDone, commentCount }
 * @param {object|null} p.chart    summarizeChart の結果
 */
export function summarizeProgress({ weeks, rows, chart }) {
  const list = weeks.map((w) => {
    const r = rows && rows.get(w);
    if (!r) return emptyProgress(w);
    return {
      week: w,
      state: r.status === 'submitted' ? 'submitted' : 'draft',
      checked: r.checked || 0,
      // その週にチェックの行が無ければ、今のチャートの対象数で代用する
      checkTotal: r.checkTotal > 0 ? r.checkTotal : (chart ? chart.trackableCount : 0),
      focusTotal: r.focusTotal || 0,
      focusDone: r.focusDone || 0,
      commentCount: r.commentCount || 0,
      submittedAt: r.submittedAt || null,
      updatedAt: r.updatedAt || null,
    };
  });
  // 連続提出: 対象の週から遡って数える。対象が進行中の今週でまだ出していなければ、先週から数える
  let streak = 0;
  let i = list.length - 1;
  if (i >= 0 && list[i].state !== 'submitted' && list[i].week >= currentWeekStart()) i -= 1;
  for (; i >= 0 && list[i].state === 'submitted'; i--) streak += 1;
  const checked = list.reduce((s, w) => s + w.checked, 0);
  const checkTotal = list.reduce((s, w) => s + (w.state === 'none' ? 0 : w.checkTotal), 0);
  const focusDone = list.reduce((s, w) => s + w.focusDone, 0);
  const focusTotal = list.reduce((s, w) => s + w.focusTotal, 0);
  const lastReviewAt = list.reduce((acc, w) => laterOf(acc, laterOf(w.submittedAt, w.updatedAt)), null);
  return {
    weeks: list,
    current: list[list.length - 1] || emptyProgress(weeks[weeks.length - 1]),
    submittedWeeks: list.filter((w) => w.state === 'submitted').length,
    streak,
    checkRate: checkTotal > 0 ? checked / checkTotal : null,
    focusRate: focusTotal > 0 ? focusDone / focusTotal : null,
    lastActiveAt: laterOf(lastReviewAt, chart ? chart.updatedAt : null),
  };
}

/** 追跡ボードの全体の数 */
export function trackingTotals(members) {
  return {
    members: members.length,
    submitted: members.filter((m) => m.current.state === 'submitted').length,
    withChart: members.filter((m) => m.chart).length,
    inactive: members.filter((m) => m.submittedWeeks === 0).length,
  };
}

// ------------------------------------------------------------
// 見える範囲
// ------------------------------------------------------------
export const SHARING_SCOPES = ['off', 'store', 'all'];
export const SHARING_SCOPE_LABEL = { off: '共有しない', store: '同じ店舗内', all: '全店舗' };
export const SHARING_SCOPE_DESCRIPTION = {
  off: '本人・店長・オーナーだけが見られます（既定）。',
  store: '同じ店舗のメンバー同士で、お互いのチャートと進捗を見られます。',
  all: '店舗を越えて、全員がお互いのチャートと進捗を見られます。',
};
export const normalizeScope = (v) => (SHARING_SCOPES.includes(v) ? v : 'off');

/**
 * viewer = { kind: 'staff'|'admin', staffId, role, storeIds }
 * member = { id, role, active, storeIds, shareChart, dailyEnabled }
 */
export const isOwnerViewer = (v) => !!v && (v.kind === 'admin' || v.role === 'owner');
export const isManagerViewer = (v) => !!v && v.kind === 'staff' && (v.role === 'manager' || v.role === 'area_manager');
const sharesStore = (a, b) => (a || []).some((id) => (b || []).includes(id));

/** 管理の権限で見られるか（本人・オーナー・担当店舗の店長） */
export function canViewMember(viewer, member) {
  if (!viewer || !member) return false;
  if (viewer.kind === 'staff' && viewer.staffId === member.id) return true;
  if (isOwnerViewer(viewer)) return true;
  return isManagerViewer(viewer) && sharesStore(viewer.storeIds, member.storeIds);
}

/** 日報の対象の切り替え・コメントの管理ができるか（オーナー・担当店舗の店長） */
export function canManageMember(viewer, member) {
  if (!viewer || !member) return false;
  if (isOwnerViewer(viewer)) return true;
  return isManagerViewer(viewer) && sharesStore(viewer.storeIds, member.storeIds);
}

/**
 * 仲間として見られるか（共有がオンで、お互いが公開している）。
 * 見せ合う機能なので、自分を非公開にしている間は仲間のチャートも見えない。
 * self = 見る人のメンバー情報
 */
export function canPeerView(self, member, scope) {
  if (!self || !member || self.id === member.id) return false;
  if (normalizeScope(scope) === 'off') return false;
  if (!self.active || !member.active || !self.shareChart || !member.shareChart) return false;
  return scope === 'all' || sharesStore(self.storeIds, member.storeIds);
}

/** チャートと進捗の集計値を見られるか（管理の権限 or 仲間） */
export function canViewChart(viewer, self, member, scope) {
  return canViewMember(viewer, member) || canPeerView(self, member, scope);
}

/** 日報のチェック項目を変えられるか（storeId=null は全店舗共通 = オーナーのみ） */
export function canManageCheckItems(viewer, storeId) {
  if (isOwnerViewer(viewer)) return true;
  return !!storeId && isManagerViewer(viewer) && (viewer.storeIds || []).includes(storeId);
}

// ------------------------------------------------------------
// 日報
// ------------------------------------------------------------
export const DAILY_SECTIONS = [
  { key: 'start', label: '出勤時' },
  { key: 'during', label: '勤務中' },
  { key: 'end', label: '退勤前' },
];
export const sectionOf = (item) => (DAILY_SECTIONS.some((s) => s.key === item.section) ? item.section : 'during');

/** チェック項目のうち、このダッシュボードの画面を開けるもの（ラベルの言葉で判定） */
export function checkItemLink(label) {
  const s = String(label || '');
  if (s.includes('出納帳')) return { path: '/cashbook', label: '出納帳を開く' };
  if (s.includes('カウンセリング')) return { path: '/care', label: '施術ツールを開く' };
  if (s.includes('週報') || s.includes('マンダラ')) return { path: '/mandala/review', label: '週報を開く' };
  return null;
}

// ------------------------------------------------------------
// 入力の整形
// ------------------------------------------------------------
/** '500,000円' → 500000。空・不正は null */
export function parseAmount(value) {
  const raw = String(value ?? '').replace(/[,，\s円¥￥]/g, '');
  if (!raw) return null;
  const man = raw.match(/^(\d+(?:\.\d+)?)万$/);
  const n = man ? Number(man[1]) * 10000 : Number(raw);
  return Number.isFinite(n) && n >= 0 && n < 1e10 ? Math.round(n) : null;
}

/** 'YYYY-MM' → 'YYYY-MM-01'。不正は null */
export function toMonthStart(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || '')) ? `${value}-01` : null;
}

/** 金額を「万円」で（目標の表示用） */
export function formatManYen(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const man = Math.round((Number(value) / 10000) * 10) / 10;
  return `${man.toLocaleString('ja-JP')}万円`;
}

/** 0〜1 の割合を整数 % に */
export function formatRate(value) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : `${Math.round(value * 100)}%`;
}
