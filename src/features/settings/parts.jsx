import Icon from '../../ui/Icon.jsx';
import { Banner, Button, Skeleton, cx } from '../../ui/primitives.jsx';

// ============================================================
// 店舗管理・スタッフ管理で共通の小さな部品
// ============================================================

/** 折りたたみ見出し（無効なスタッフ・無効な店舗など、普段は見ない一覧用） */
export function FoldHeader({ open, onToggle, label, note, controls }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      className="flex w-full items-center gap-2 px-4 py-3 text-left text-xs font-semibold text-ink-2 transition-colors hover:bg-surface-2 sm:px-5"
    >
      <Icon name={open ? 'chevron-down' : 'chevron-right'} size={15} className="text-muted" />
      <span className="shrink-0 whitespace-nowrap">{label}</span>
      {note ? <span className="ml-auto min-w-0 truncate pl-2 font-normal text-muted">{note}</span> : null}
    </button>
  );
}

/** 一覧の読み込み中 */
export function RowsSkeleton({ rows = 3 }) {
  return (
    <div className="space-y-3 py-1" aria-busy="true" aria-label="読み込み中">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 !rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** 読み込み失敗（前回の一覧があればその上に出す） */
export function LoadError({ error, onRetry, className = '' }) {
  return (
    <Banner
      tone="bad"
      title="読み込めませんでした"
      className={cx('mb-3', className)}
      action={<Button size="sm" variant="secondary" icon="refresh-cw" onClick={onRetry}>再読み込み</Button>}
    >
      {error && error.message ? error.message : '通信状況を確認してください。'}
    </Banner>
  );
}

/** 一覧の行に付けるイニシャルの丸 */
export function Initial({ name, muted = false }) {
  const first = Array.from(String(name || '').trim())[0] || '?';
  return (
    <div
      aria-hidden="true"
      className={cx(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold',
        muted ? 'bg-surface-3 text-muted' : 'bg-brand-100 text-brand-800 dark:bg-brand-500/20 dark:text-brand-100',
      )}
    >
      {first}
    </div>
  );
}
