import { cx } from '../../../ui/primitives.jsx';
import { SCORE_LEGEND, scoreColor, scoreLabel } from './scoring.js';

// ============================================================
// 画面内のスコア表示（ライト/ダーク両対応）
// ------------------------------------------------------------
// レポート画像や写真の上ではスコア色（scoreColor）をそのまま使うが、画面の
// カード上ではダーク時に暗い緑が読めないため、明るめの文字色に切り替える。
// クラス名は Tailwind が拾えるよう文字列のまま書く。
// ============================================================

const TONES = {
  good: {
    text: 'text-[#0F6E56] dark:text-[#5fd3a8]',
    soft: 'bg-[#E1F5EE] dark:bg-[#0F6E56]/20',
    fill: 'fill-[#0F6E56] dark:fill-[#5fd3a8]',
  },
  fair: {
    text: 'text-[#4f7c1b] dark:text-[#a8d26b]',
    soft: 'bg-[#EAF3DE] dark:bg-[#639922]/20',
    fill: 'fill-[#4f7c1b] dark:fill-[#a8d26b]',
  },
  warn: {
    text: 'text-[#a8650c] dark:text-[#f5c36b]',
    soft: 'bg-[#FAEEDA] dark:bg-[#EF9F27]/20',
    fill: 'fill-[#a8650c] dark:fill-[#f5c36b]',
  },
  bad: {
    text: 'text-[#c23b3a] dark:text-[#f29a99]',
    soft: 'bg-[#FCEBEB] dark:bg-[#E24B4A]/20',
    fill: 'fill-[#c23b3a] dark:fill-[#f29a99]',
  },
  none: {
    text: 'text-muted',
    soft: 'bg-surface-3',
    fill: 'fill-[rgb(var(--muted))]',
  },
};

export function scoreTone(score) {
  if (score == null) return TONES.none;
  return score >= 80 ? TONES.good : score >= 60 ? TONES.fair : score >= 40 ? TONES.warn : TONES.bad;
}

/** 白文字の丸いスコア（低信頼は灰色の —） */
export function ScorePill({ score, low = false, className = '' }) {
  const dim = low || score == null;
  return (
    <span
      className={cx('inline-flex h-7 min-w-[44px] items-center justify-center rounded-full px-2 text-sm font-bold text-white num', className)}
      style={{ background: dim ? '#a3a3a3' : scoreColor(score) }}
    >
      {dim ? '—' : score}
    </span>
  );
}

export function ScoreRing({ score, size = 88 }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const tone = scoreTone(score);
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className="shrink-0" role="img" aria-label={`総合スコア ${score}点（${scoreLabel(score)}）`}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="8" />
      <circle
        cx="50" cy="50" r={r} fill="none" stroke={scoreColor(score)} strokeWidth="8" strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)}
        style={{ transform: 'rotate(-90deg)', transformOrigin: 'center', transition: 'stroke-dashoffset .6s ease' }}
      />
      <text x="50" y="45" textAnchor="middle" dominantBaseline="central" fontSize="30" fontWeight="700" className={tone.fill}>{score}</text>
      <text x="50" y="69" textAnchor="middle" dominantBaseline="central" fontSize="11" fontWeight="600" className={tone.fill}>{scoreLabel(score)}</text>
    </svg>
  );
}

export function ScoreLegend({ className = '' }) {
  return (
    <div className={cx('flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted', className)}>
      {SCORE_LEGEND.map((x) => (
        <span key={x.label} className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: x.color }} />
          {x.label}
        </span>
      ))}
    </div>
  );
}

/** Before → After の差分（+n 改善 / -n 低下） */
export function DiffText({ diff, className = '', withLabel = false }) {
  if (diff == null) return <span className={cx('text-muted', className)}>–</span>;
  const up = diff >= 0;
  return (
    <span className={cx('font-bold num', up ? 'text-[#0F6E56] dark:text-[#5fd3a8]' : 'text-[#c23b3a] dark:text-[#f29a99]', className)}>
      {up ? '+' : ''}{diff}{withLabel ? <span className="ml-1 text-[10px]">{up ? '改善' : '低下'}</span> : null}
    </span>
  );
}
