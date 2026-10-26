import { useEffect, useRef, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { Badge, Button, Card, EmptyState, Skeleton, Textarea, cx } from '../../ui/primitives.jsx';
import { Meter } from '../../ui/stats.jsx';
import { showToast, confirmDialog } from '../../ui/feedback.jsx';
import { navigate } from '../../app/router.js';
import {
  ITEM_TYPE_LABEL, formatWeekRange, formatMd, formatDateTimeJst, formatRelative, isFutureWeek, shiftWeek,
  weekdayLabel, chartFillRate, formatRate,
} from '../../../shared/mandala.js';

// ============================================================
// マンダラの画面で共通に使う部品
// ============================================================

export const STATE_LABEL = { submitted: '提出済み', draft: '下書き', none: '未着手' };
const STATE_TONE = { submitted: 'good', draft: 'warn', none: 'neutral' };
const STATE_ICON = { submitted: 'circle-check', draft: 'pencil-line', none: 'circle-dashed' };

export function StateBadge({ state, prefix = '', className = '' }) {
  const s = state || 'none';
  return <Badge tone={STATE_TONE[s]} icon={STATE_ICON[s]} className={className}>{prefix}{STATE_LABEL[s]}</Badge>;
}

const TYPE_CLS = {
  action: 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200',
  metric: 'bg-gold-50 text-gold-800 dark:bg-gold-500/15 dark:text-gold-200',
  mindset: 'bg-surface-3 text-ink-2',
};

export function TypeBadge({ type }) {
  return <span className={cx('inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold', TYPE_CLS[type] || TYPE_CLS.action)}>{ITEM_TYPE_LABEL[type] || type}</span>;
}

export function Legend({ showFocus = false }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted">
      <span className="flex items-center gap-1.5"><TypeBadge type="action" />やったかどうかで毎週チェック</span>
      <span className="flex items-center gap-1.5"><TypeBadge type="metric" />数字は SalonOne で見る</span>
      <span className="flex items-center gap-1.5"><TypeBadge type="mindset" />心構え</span>
      <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-500" />週次チェック</span>
      {showFocus ? <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-[4px] ring-2 ring-inset ring-gold-400" />今週のフォーカス</span> : null}
    </div>
  );
}

/** マンダラの中のタブ（横にスクロールする） */
export function SubNav({ items, active }) {
  return (
    <nav className="no-print -mx-4 mb-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="マンダラのメニュー">
      <ul className="flex gap-1.5 whitespace-nowrap pb-1">
        {items.map((it) => {
          const on = it.key === active;
          return (
            <li key={it.key}>
              <a href={`#${it.path}`} aria-current={on ? 'page' : undefined}
                className={cx('inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-colors sm:h-9',
                  on ? 'bg-brand-600 text-white shadow-sm' : 'border border-line bg-surface text-ink-2 hover:bg-surface-2')}>
                <Icon name={it.icon} size={15} />
                {it.label}
                {it.badge ? <span className={cx('ml-0.5 rounded-full px-1.5 text-[10px] leading-4', on ? 'bg-white/25' : 'bg-gold-100 text-gold-800 dark:bg-gold-500/20 dark:text-gold-200')}>{it.badge}</span> : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** 前の週 / 今週へ / 次の週（未来の週には進めない） */
export function WeekNav({ week, currentWeek, hrefFor, className = '' }) {
  const next = shiftWeek(week, 1);
  const canNext = !isFutureWeek(next);
  return (
    <div className={cx('mb-4 flex items-center justify-between gap-2', className)}>
      <Button size="sm" icon="chevron-left" onClick={() => navigate(hrefFor(shiftWeek(week, -1)))}>前の週</Button>
      <div className="min-w-0 flex-1 text-center">
        <div className="truncate text-[13px] font-bold text-ink num">{formatWeekRange(week)}</div>
        {week !== currentWeek ? (
          <button type="button" className="text-[11px] font-semibold text-brand-700 hover:underline dark:text-brand-300" onClick={() => navigate(hrefFor(currentWeek))}>今週へ戻る</button>
        ) : <div className="text-[11px] text-muted">今週</div>}
      </div>
      <Button size="sm" iconRight="chevron-right" disabled={!canNext} onClick={() => canNext && navigate(hrefFor(next))}>次の週</Button>
    </div>
  );
}

/** 直近の週の行動チェック率（緑=提出済み / 黄=下書き / 空=未作成） */
export function WeekBars({ weeks, hrefFor, height = 64 }) {
  if (!weeks || !weeks.length) return null;
  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height: height + 18 }}>
        {weeks.map((w) => {
          const rate = w.state !== 'none' && w.checkTotal > 0 ? w.checked / w.checkTotal : null;
          const h = rate === null ? 0 : Math.max(rate * 100, 6);
          const label = `${formatMd(w.week)}の週 ${w.state === 'none' ? '未作成' : rate === null ? STATE_LABEL[w.state] : `${STATE_LABEL[w.state]} ${Math.round(rate * 100)}%`}`;
          const Tag = hrefFor ? 'a' : 'div';
          return (
            <Tag key={w.week} href={hrefFor ? `#${hrefFor(w.week)}` : undefined} title={label} aria-label={label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div className="flex w-full items-end overflow-hidden rounded-md bg-surface-3" style={{ height }}>
                <div className={cx('w-full rounded-md transition-[height] duration-500', w.state === 'submitted' ? 'bg-[var(--chart-sales)]' : 'bg-[var(--status-warn)]')} style={{ height: `${h}%` }} />
              </div>
              <span className="text-[10px] leading-none text-muted num">{formatMd(w.week)}</span>
            </Tag>
          );
        })}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-muted">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[var(--chart-sales)]" />提出済み</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[var(--status-warn)]" />下書き</span>
        <span>棒の高さ = できた行動の割合</span>
      </p>
    </div>
  );
}

/** 週の実施状況のチップ（タップでその週へ） */
export function WeekChips({ weeks, selected, hrefFor }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {weeks.map((w) => {
        const st = w.state || (w.status === 'submitted' ? 'submitted' : w.status ? 'draft' : 'none');
        const on = w.week === selected;
        const cls = on ? 'border-2 border-brand-600 text-ink' : st === 'submitted' ? 'border border-[#9fd7a4] bg-[#e7f6e7] text-[#0f5f12] dark:border-[#0ca30c]/40 dark:bg-[#0ca30c]/15 dark:text-[#7fe08a]'
          : st === 'draft' ? 'border border-[#f1d79a] bg-[#fffaeb] text-[#6d4a00] dark:border-[#fab219]/40 dark:bg-[#fab219]/10 dark:text-[#f6d68f]' : 'border border-dashed border-line-strong text-muted';
        const label = `${formatMd(w.week)}の週・${STATE_LABEL[st]}`;
        return (
          <li key={w.week}>
            {hrefFor ? (
              <a href={`#${hrefFor(w.week)}`} title={label} aria-label={label} aria-current={on ? 'true' : undefined} className={cx('inline-flex h-10 min-w-[52px] items-center justify-center rounded-lg px-2 text-[11px] font-semibold num sm:h-8', cls)}>{formatMd(w.week)}</a>
            ) : (
              <span title={label} className={cx('inline-flex h-8 min-w-[52px] items-center justify-center rounded-lg px-2 text-[11px] font-semibold num', cls)}>{formatMd(w.week)}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** チャートの記入（テーマ 8 + 項目 64） */
export function FillMeter({ summary, className = '' }) {
  if (!summary) return null;
  return (
    <div className={className}>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px] text-muted">
        <span>チャートの記入</span>
        <span className="num">テーマ {summary.themeCount}/8・項目 {summary.itemCount}/64・週次チェック {summary.trackableCount}件</span>
      </div>
      <Meter value={chartFillRate(summary) * 72} max={72} height={6} label="チャートの記入" />
    </div>
  );
}

export function MiniStats({ items, className = '' }) {
  return (
    <dl className={cx('grid gap-2', items.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3', className)}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0 rounded-xl bg-surface-2 px-2.5 py-2">
          <dt className="truncate text-[10px] font-semibold text-muted">{it.label}</dt>
          <dd className={cx('mt-0.5 truncate text-[15px] font-bold num', it.tone === 'warn' ? 'text-[#9a6700] dark:text-[#f6c75a]' : 'text-ink')}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function progressStats(p) {
  return [
    { label: '行動の実行率', value: p && p.checkRate !== null ? formatRate(p.checkRate) : '—' },
    { label: 'フォーカス達成', value: p && p.focusRate !== null ? formatRate(p.focusRate) : '—' },
    { label: '連続提出', value: p && p.streak > 0 ? `${p.streak}週` : '—' },
    { label: '最終更新', value: p && p.lastActiveAt ? formatRelative(p.lastActiveAt) : '—' },
  ];
}

/** オン/オフの切り替え（スイッチ） */
export function Toggle({ checked, onChange, disabled, label, className = '' }) {
  return (
    <button type="button" role="switch" aria-checked={!!checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      className={cx('relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors disabled:opacity-50', checked ? 'bg-brand-600' : 'bg-line-strong', className)}>
      <span className={cx('inline-block h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  );
}

/** 日付の横並び（日報の日付の切り替え）。提出済み=緑・下書き=点線 */
export function DayStrip({ days, selected, statuses, hrefFor }) {
  const ref = useRef(null);
  // 今日（選んだ日）は右端にあるので、開いた時に見える位置までスクロールする
  useEffect(() => {
    const el = ref.current && ref.current.querySelector('[aria-current="date"]');
    if (el && ref.current.scrollWidth > ref.current.clientWidth) ref.current.scrollLeft = el.offsetLeft - ref.current.clientWidth / 2 + el.offsetWidth / 2;
  }, [selected]);
  return (
    <ul ref={ref} className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
      {days.map((day) => {
        const st = statuses[day];
        const on = day === selected;
        return (
          <li key={day} className="shrink-0">
            <a href={`#${hrefFor(day)}`} aria-current={on ? 'date' : undefined} aria-label={`${formatMd(day)}（${st === 'submitted' ? '提出済み' : st === 'draft' ? '下書き' : '未提出'}）`}
              className={cx('flex h-14 w-12 flex-col items-center justify-center rounded-2xl text-xs transition-colors',
                on ? 'bg-brand-600 text-white shadow-sm'
                  : st === 'submitted' ? 'bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-100'
                    : st === 'draft' ? 'border border-dashed border-line-strong bg-surface text-ink' : 'border border-line bg-surface text-muted')}>
              <span className="text-[10px] opacity-80">{weekdayLabel(day)}</span>
              <span className="text-[15px] font-bold num">{Number(day.slice(8, 10))}</span>
              {st === 'submitted' && !on ? <Icon name="check" size={11} strokeWidth={2.6} /> : null}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

/** コメント（週報・日報）・応援のやりとり */
export function Thread({ title, icon = 'message-circle', items, onPost, onDelete, placeholder, emptyText = 'まだメッセージはありません。', disabledNote, ownerTag = '本人', maxLength = 2000, postLabel = '送信', className = '' }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await onPost(body.trim());
      setBody('');
    } catch (e) {
      showToast(e.message || '送信に失敗しました', 'error');
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id) => {
    if (!(await confirmDialog({ title: '削除', message: 'このメッセージを削除しますか？', confirmLabel: '削除', variant: 'danger' }))) return;
    try { await onDelete(id); } catch (e) { showToast(e.message || '削除に失敗しました', 'error'); }
  };
  return (
    <Card title={title} icon={icon} className={className} actions={items.length ? <span className="text-xs text-muted num">{items.length}件</span> : null}>
      {items.length === 0 ? <p className="text-[13px] text-muted">{emptyText}</p> : (
        <ul className="space-y-3">
          {items.map((m) => (
            <li key={m.id} className={cx('flex flex-col', m.mine ? 'items-end' : 'items-start')}>
              <div className="mb-0.5 flex items-baseline gap-1.5 px-1 text-[11px] text-muted">
                <span className="font-semibold text-ink-2">{m.authorName}</span>
                {m.isOwner && !m.mine ? <span className="rounded-full bg-brand-50 px-1.5 text-[10px] text-brand-700 dark:bg-brand-500/15 dark:text-brand-200">{ownerTag}</span> : null}
                <span className="num">{formatDateTimeJst(m.createdAt)}</span>
              </div>
              <p className={cx('max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed',
                m.mine ? 'rounded-tr-md bg-brand-600 text-white' : 'rounded-tl-md bg-surface-3 text-ink')}>{m.body}</p>
              {m.canDelete && onDelete ? (
                <button type="button" className="mt-0.5 px-1 text-[11px] text-muted underline" onClick={() => remove(m.id)}>削除</button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {disabledNote ? <p className="mt-3 text-xs text-muted">{disabledNote}</p> : onPost ? (
        <div className="mt-4 space-y-2">
          <Textarea rows={2} value={body} maxLength={maxLength} onChange={(e) => setBody(e.target.value)} placeholder={placeholder} aria-label={title} className="min-h-[72px]" />
          <div className="flex justify-end">
            <Button variant="primary" icon="send" loading={busy} disabled={!body.trim()} onClick={submit}>{postLabel}</Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

export function LoadingState() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="読み込み中">
      <Skeleton className="h-[120px] rounded-2xl" />
      <Skeleton className="h-[220px] rounded-2xl" />
    </div>
  );
}

export function ErrorState({ error, onRetry }) {
  const forbidden = error && error.status === 403;
  return (
    <div className="card">
      <EmptyState icon={forbidden ? 'lock' : 'circle-alert'} title={forbidden ? '見る権限がありません' : '読み込めませんでした'}
        message={error ? error.message : ''}
        action={!forbidden && onRetry ? <Button icon="refresh-cw" onClick={onRetry}>もう一度読み込む</Button> : null} />
    </div>
  );
}

/** 自動保存の状態（保存中… / 保存しました 21:05 / 保存できませんでした） */
export function SaveStatus({ autosave, className = '' }) {
  const { status, savedAt } = autosave;
  if (status === 'saving') return <span className={cx('inline-flex items-center gap-1 text-xs text-muted', className)}><Icon name="loader-circle" size={13} className="animate-spin" />保存中…</span>;
  if (status === 'dirty') return <span className={cx('inline-flex items-center gap-1 text-xs text-muted', className)}><Icon name="pencil-line" size={13} />入力中（自動で保存します）</span>;
  if (status === 'error') {
    return (
      <button type="button" onClick={() => autosave.flush()} className={cx('inline-flex items-center gap-1 text-xs font-semibold text-[#b42323] dark:text-[#f08a8a]', className)}>
        <Icon name="circle-alert" size={13} />保存できませんでした・タップで再試行
      </button>
    );
  }
  if (status === 'saved' && savedAt) {
    const t = `${String(savedAt.getHours()).padStart(2, '0')}:${String(savedAt.getMinutes()).padStart(2, '0')}`;
    return <span className={cx('inline-flex items-center gap-1 text-xs text-[var(--text-good)]', className)}><Icon name="circle-check" size={13} />自動保存しました {t}</span>;
  }
  return <span className={cx('inline-flex items-center gap-1 text-xs text-muted', className)}><Icon name="cloud" size={13} />入力は自動で保存されます</span>;
}

/** 画面の見出しの横に出す、メンバーの名前・店舗 */
export function MemberLine({ member }) {
  if (!member) return null;
  return <span className="text-[13px] text-muted">{member.storeNames && member.storeNames.length ? member.storeNames.join('・') : '店舗未設定'}</span>;
}

export const go = (path) => () => navigate(path);
