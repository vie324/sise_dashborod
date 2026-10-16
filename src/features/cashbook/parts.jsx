import Icon from '../../ui/Icon.jsx';
import { Badge, IconButton, Spinner, cx } from '../../ui/primitives.jsx';
import { yen } from '../../lib/format.js';

// ============================================================
// 出納帳の画面で共通に使う小さな部品
// ============================================================

/** 入金は＋、出金は−を付ける（色だけで区別しない）。0 円は符号も色も付けない */
export function SignedAmount({ type, amount, className = '' }) {
  const income = type === 'income';
  const value = Math.abs(Number(amount) || 0);
  if (value === 0) return <span className={cx('num whitespace-nowrap font-bold text-ink-2', className)}>{yen(0)}</span>;
  return (
    <span className={cx('num whitespace-nowrap font-bold', income ? 'text-[var(--text-good)]' : 'text-[var(--text-bad)]', className)}>
      {income ? '+' : '−'}{yen(value)}
    </span>
  );
}

export function StoreTag({ name }) {
  if (!name) return null;
  return <Badge tone="neutral" icon="store">{name}</Badge>;
}

export function ClosedBadge({ label = '締め済み' }) {
  return <Badge tone="good" icon="lock">{label}</Badge>;
}

const timeFmt = (d) => d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

/** 同期の状態（最終同期・保存中・オフライン）と手動更新ボタン */
export function SyncStatus({ lastSynced, syncing, saving, syncError, onRefresh, className = '' }) {
  return (
    <div className={cx('flex items-center gap-2 text-xs text-muted', className)}>
      {syncError ? (
        <span title={syncError}><Badge tone="bad" icon="wifi-off">同期できません</Badge></span>
      ) : null}
      {saving ? (
        <span className="inline-flex items-center gap-1 font-semibold text-ink-2" aria-live="polite">
          <Spinner size={12} />保存中
        </span>
      ) : null}
      {lastSynced ? (
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <Icon name="circle-check" size={13} className="text-[var(--text-good)]" />
          <span className="num">{timeFmt(lastSynced)}</span>
          <span className="hidden sm:inline">同期・60秒ごとに自動更新</span>
        </span>
      ) : null}
      <IconButton icon="refresh-cw" label="最新の出納帳を取得" size="sm" onClick={onRefresh} className={syncing ? 'animate-spin' : ''} disabled={syncing} />
    </div>
  );
}
