import Icon from './Icon.jsx';
import { cx, Skeleton } from './primitives.jsx';
import { Sparkline, useMeasure } from './charts.jsx';
import { signedPct } from '../lib/format.js';

// ============================================================
// 数値表示のコンポーネント
//   StatTile  : ラベル・値・前期比・補足（KPI 1つ分）
//   HeroFigure: 画面の主役になる 1つの数字
//   Meter     : 目標に対する進捗バー
//   TierMeter : インセンティブの段階（閾値）付き進捗バー
//   StatusPill: 達成 / 順調 / 要注意 などの状態（色 + アイコン + 文字）
// ============================================================

export function Delta({ value, goodWhenUp = true, suffix = '前月比', className = '' }) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const v = Number(value);
  const up = v > 0.05;
  const down = v < -0.05;
  const good = goodWhenUp ? up : down;
  const bad = goodWhenUp ? down : up;
  return (
    <span className={cx('inline-flex items-center gap-0.5 text-xs font-semibold', good ? 'text-[var(--text-good)]' : bad ? 'text-[var(--text-bad)]' : 'text-muted', className)}>
      <Icon name={up ? 'trending-up' : down ? 'trending-down' : 'minus'} size={13} strokeWidth={2.2} />
      {signedPct(v)}
      {suffix ? <span className="ml-0.5 font-medium text-muted">{suffix}</span> : null}
    </span>
  );
}

export function StatTile({ label, value, sub, delta, deltaSuffix = '前月比', goodWhenUp = true, icon, trend, loading, className = '', children, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cx('card card-pad flex min-w-0 flex-col text-left', onClick ? 'transition-colors hover:border-line-strong' : '', className)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-ink-2">
          {icon ? <Icon name={icon} size={14} className="text-muted" /> : null}
          <span className="truncate">{label}</span>
        </span>
        {trend && trend.length > 1 ? <Sparkline values={trend} width={64} height={22} /> : null}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-7 w-28" />
      ) : (
        <div className="mt-2 text-[22px] font-bold leading-tight tracking-tight text-ink sm:text-2xl">{value}</div>
      )}
      <div className="mt-1 flex min-h-[18px] flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
        {delta !== undefined ? <Delta value={delta} goodWhenUp={goodWhenUp} suffix={deltaSuffix} /> : null}
        {sub ? <span className="truncate">{sub}</span> : null}
      </div>
      {children}
    </Tag>
  );
}

export function HeroFigure({ label, value, sub, badge, className = '' }) {
  return (
    <div className={cx('min-w-0', className)}>
      <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-ink-2">
        {label}
        {badge}
      </div>
      <div className="mt-1 text-[44px] font-bold leading-none tracking-tight text-ink sm:text-[52px]">{value}</div>
      {sub ? <div className="mt-2 text-[13px] text-ink-2">{sub}</div> : null}
    </div>
  );
}

const STATUS = {
  achieved: { label: '達成', icon: 'circle-check', cls: 'bg-[#e7f6e7] text-[#0f5f12] dark:bg-[#0ca30c]/15 dark:text-[#7fe08a]' },
  onTrack: { label: '順調', icon: 'trending-up', cls: 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200' },
  close: { label: 'あと少し', icon: 'flag', cls: 'bg-gold-50 text-gold-800 dark:bg-gold-500/15 dark:text-gold-200' },
  behind: { label: '要ペースアップ', icon: 'triangle-alert', cls: 'bg-[#fff4d6] text-[#7a5300] dark:bg-[#fab219]/15 dark:text-[#f9d27a]' },
  unmet: { label: '条件未達', icon: 'circle-x', cls: 'bg-[#fbe9e9] text-[#9b2525] dark:bg-[#d03b3b]/18 dark:text-[#f3a3a3]' },
  pending: { label: '集計中', icon: 'clock', cls: 'bg-surface-3 text-ink-2' },
  none: { label: '未設定', icon: 'circle-dashed', cls: 'bg-surface-3 text-muted' },
};

export function StatusPill({ status, label, className = '' }) {
  const s = STATUS[status] || STATUS.pending;
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-5 whitespace-nowrap', s.cls, className)}>
      <Icon name={s.icon} size={12} strokeWidth={2.2} />
      {label || s.label}
    </span>
  );
}

/** 目標に対する進捗。marker = 今日時点で本来あるべき位置（ペース） */
export function Meter({ value, max, marker, tone = 'brand', height = 8, className = '', label }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const markerRatio = marker != null && max > 0 ? Math.max(0, Math.min(1, marker / max)) : null;
  const fill = tone === 'gold' ? 'bg-gold-500' : tone === 'warn' ? 'bg-[var(--status-warn)]' : tone === 'good' ? 'bg-[var(--status-good)]' : 'bg-[var(--chart-sales)]';
  const track = tone === 'gold' ? 'bg-gold-100 dark:bg-gold-500/15' : 'bg-brand-100 dark:bg-brand-500/15';
  return (
    <div className={cx('relative w-full', className)} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <div className={cx('w-full overflow-hidden rounded-full', track)} style={{ height }}>
        <div className={cx('h-full rounded-full transition-[width] duration-500', fill)} style={{ width: `${ratio * 100}%` }} />
      </div>
      {markerRatio != null ? (
        <span className="absolute top-1/2 h-[calc(100%+6px)] w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink/60" style={{ left: `${markerRatio * 100}%` }} title="今日時点のペース" />
      ) : null}
    </div>
  );
}

/**
 * インセンティブの段階付き進捗バー。
 * @param {number} current           現在値
 * @param {Array<{at:number,label:string,sub?:string}>} steps  閾値（昇順）
 * @param {number} [forecast]        月末予測（薄い延長で表示）
 * @param {number} [max]             右端の値（既定: 最後の閾値 × 1.08）
 * @param {(v:number)=>string} formatTick 目盛りの表示
 */
export function TierMeter({ current, steps, forecast, max, formatTick, currentPrefix = '現在', className = '' }) {
  const [ref, width] = useMeasure();
  const top = max || (steps.length ? steps[steps.length - 1].at * 1.08 : 1);
  const pos = (v) => `${Math.max(0, Math.min(1, v / top)) * 100}%`;
  const reached = steps.filter((s) => current >= s.at).length;
  const showForecast = forecast != null && forecast > current;
  const tick = (v) => (formatTick ? formatTick(v) : v);
  // 隣り合う目盛りの間隔が狭くラベルが重なる幅では、目盛りラベルの代わりに
  // 「現在 → 次」の 1行表示にする
  const minGapPx = steps.slice(1).reduce((m, s, i) => Math.min(m, ((s.at - steps[i].at) / top) * width), Infinity);
  const compact = width > 0 && minGapPx < 58;
  return (
    <div ref={ref} className={cx('w-full', className)}>
      <div className="relative h-3">
        <div className="absolute inset-0 rounded-full bg-surface-3" />
        {showForecast ? <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--chart-sales-wash)] ring-1 ring-inset ring-[var(--chart-sales)]/25" style={{ width: pos(forecast) }} /> : null}
        <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--chart-sales)] transition-[width] duration-500" style={{ width: pos(current) }} />
        {steps.map((s, i) => (
          <span
            key={s.at}
            className={cx('absolute top-1/2 h-5 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--chart-surface)]',
              i < reached ? 'bg-brand-700 dark:bg-brand-200' : i === reached ? 'bg-gold-500' : 'bg-line-strong')}
            style={{ left: pos(s.at) }}
            aria-hidden="true"
          />
        ))}
      </div>
      {compact ? (
        <div className="mt-2 flex items-start justify-between gap-3 text-[11px] leading-tight">
          <span className="text-ink-2">
            {reached > 0 ? <>{currentPrefix} <span className="font-semibold text-ink num">{steps[reached - 1].label}</span>（{tick(steps[reached - 1].at)}〜）</> : 'まだランク外'}
          </span>
          <span className="text-right text-ink-2">
            {reached < steps.length
              ? <>次 <span className="font-semibold text-ink num">{steps[reached].label}</span>（{tick(steps[reached].at)}〜）</>
              : '最上位に到達'}
          </span>
        </div>
      ) : (
        <div className="relative mt-2 h-8 text-[11px] leading-tight">
          {steps.map((s, i) => (
            <div
              key={s.at}
              className={cx('absolute -translate-x-1/2 whitespace-nowrap text-center num',
                i === reached ? 'font-bold text-ink' : i < reached ? 'font-semibold text-ink-2' : 'text-muted')}
              style={{ left: pos(s.at) }}
            >
              <div>{tick(s.at)}</div>
              <div>{s.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
