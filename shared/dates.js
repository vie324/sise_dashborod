// ============================================================
// 日付ヘルパー（サーバー / ブラウザ共通）
// ------------------------------------------------------------
// 月は 'YYYY-MM'、日付は 'YYYY-MM-DD' の文字列で扱う。
// Date オブジェクトの toISOString() は UTC になり、JST の深夜帯に
// 日付が前日へずれるため、文字列演算だけで完結させる。
// サーバー (Vercel = UTC) で「今日」を求めるときは todayJst() を使う。
// ============================================================

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const pad2 = (n) => String(n).padStart(2, '0');

/** 現在時刻の JST 日付 'YYYY-MM-DD'（実行環境のタイムゾーンに依存しない） */
export function todayJst(now = Date.now()) {
  return new Date(now + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' → 'YYYY-MM' */
export function monthOf(date) {
  return String(date || '').slice(0, 7);
}

export function isMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''));
}

export function isDate(value) {
  return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(value || ''));
}

/** 'YYYY-MM' を n ヶ月ずらす */
export function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad2((idx % 12 + 12) % 12 + 1)}`;
}

/** b - a の月数（a, b は 'YYYY-MM'） */
export function monthsBetween(a, b) {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb * 12 + mb) - (ya * 12 + ma);
}

export function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  // Date.UTC の day=0 は前月末日
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 月の初日・末日 */
export function monthRange(ym) {
  return { from: `${ym}-01`, to: `${ym}-${pad2(daysInMonth(ym))}` };
}

/** from〜to（両端含む）の月リスト */
export function listMonths(from, to) {
  const out = [];
  for (let ym = from; monthsBetween(ym, to) >= 0; ym = addMonths(ym, 1)) out.push(ym);
  return out;
}

/** 'YYYY-MM-DD' を n 日ずらす */
export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** b - a の日数 */
export function daysBetween(a, b) {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
}

/** 0=日 … 6=土 */
export function weekdayOf(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function dayOfMonth(date) {
  return Number(String(date).slice(8, 10));
}

/**
 * 日時文字列を JST の日付へ正規化する。
 *   '2026-11-03'                 → '2026-11-03'
 *   '2026-11-03 10:00:00'        → '2026-11-03'（タイムゾーン無し = JST とみなす）
 *   '2026-11-03T10:00:00+09:00'  → '2026-11-03'
 *   '2026-11-02T16:00:00Z'       → '2026-11-03'（UTC → JST）
 */
export function toJstDate(value) {
  if (!value) return '';
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(s);
  if (!hasZone) return s.slice(0, 10).replace(/\//g, '-');
  const t = Date.parse(s);
  if (Number.isNaN(t)) return s.slice(0, 10);
  return new Date(t + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** '2026-11' → '2026年11月' */
export function formatMonthJa(ym) {
  if (!isMonth(ym)) return ym || '';
  const [y, m] = ym.split('-').map(Number);
  return `${y}年${m}月`;
}

/** '2026-11-03' → '11/3' */
export function formatShortDate(date) {
  if (!date) return '';
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
}

/**
 * 月の進捗（ペース計算用）。
 *   today がその月より前なら elapsed=0、後なら全日経過。
 */
export function monthProgress(ym, today) {
  const total = daysInMonth(ym);
  const cur = monthOf(today);
  let elapsed;
  if (monthsBetween(ym, cur) > 0) elapsed = total;
  else if (monthsBetween(ym, cur) < 0) elapsed = 0;
  else elapsed = dayOfMonth(today);
  return { total, elapsed, remaining: total - elapsed, ratio: total ? elapsed / total : 0 };
}
