// ============================================================
// 表示用フォーマット
// ============================================================

const yenFmt = new Intl.NumberFormat('ja-JP');

const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));

/** 1234567 → '¥1,234,567' */
export function yen(v) {
  if (!isNum(v)) return '—';
  const n = Math.round(Number(v));
  return (n < 0 ? '-¥' : '¥') + yenFmt.format(Math.abs(n));
}

/** 1234567 → '1,234,567'（単位なし） */
export function num(v, digits = 0) {
  if (!isNum(v)) return '—';
  return new Intl.NumberFormat('ja-JP', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number(v));
}

/** 金額を「万」単位で短く（軸・狭い場所用）: 1048000 → '104.8万' / 5000 → '5,000' */
export function yenShort(v) {
  if (!isNum(v)) return '—';
  const n = Number(v);
  const abs = Math.abs(n);
  if (abs >= 100000000) return `${(n / 100000000).toFixed(abs >= 1000000000 ? 0 : 1).replace(/\.0$/, '')}億`;
  if (abs >= 10000) return `${(n / 10000).toFixed(abs >= 1000000 ? 0 : 1).replace(/\.0$/, '')}万`;
  return yenFmt.format(Math.round(n));
}

/** 61.111 → '61.1%' */
export function pct(v, digits = 1) {
  if (!isNum(v)) return '—';
  return `${Number(v).toFixed(digits)}%`;
}

/** 前月比など: +12.3% / -4.0% */
export function signedPct(v, digits = 1) {
  if (!isNum(v)) return '—';
  const n = Number(v);
  return `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(digits)}%`;
}

export function signedYen(v) {
  if (!isNum(v)) return '—';
  const n = Math.round(Number(v));
  return `${n > 0 ? '+' : n < 0 ? '−' : '±'}¥${yenFmt.format(Math.abs(n))}`;
}

/** 変化率（%）。基準が 0 / 無い時は null */
export function changeRate(current, previous) {
  if (!isNum(current) || !isNum(previous) || Number(previous) === 0) return null;
  return ((Number(current) - Number(previous)) / Math.abs(Number(previous))) * 100;
}

/** '2026-11-03' → '11月3日(火)' */
export function dateJa(date, { weekday = true } = {}) {
  if (!date) return '';
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number);
  const wd = ['日', '月', '火', '水', '木', '金', '土'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}月${d}日${weekday ? `(${wd})` : ''}`;
}

export function dateTimeJa(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return String(iso);
  }
}
