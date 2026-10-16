import { useState } from 'react';
import Icon from '../ui/Icon.jsx';
import { cx, IconButton } from '../ui/primitives.jsx';
import { confirmDialog } from '../ui/feedback.jsx';
import { visibleNav } from './nav.js';
import { navigate } from './router.js';
import { useApp } from './state.jsx';
import { currentAccess, ROLE_LABELS, role, displayName } from '../lib/access.js';
import { dbPost } from '../lib/api.js';

// ロゴ画像は正方形の中央にワードマークがあるので、上下を切り取って横長に見せる。
// ダーク時は文字が黒のため反転＋色相を戻して緑を保つ。
function Logo({ compact = false }) {
  return (
    <div className="flex items-center gap-2">
      <div className={cx('overflow-hidden', compact ? 'h-7 w-[72px]' : 'h-9 w-[92px]')} aria-label="si'se">
        <img src="/images/logo.png" alt="si'se" className={cx('max-w-none dark:[filter:invert(1)_hue-rotate(180deg)]', compact ? '-mt-[22px] w-[72px]' : '-mt-[28px] w-[92px]')} />
      </div>
      {!compact ? <span className="mt-1 text-[10px] font-semibold tracking-[0.14em] text-muted">DASHBOARD</span> : null}
    </div>
  );
}

function UserChip() {
  const r = role;
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[13px] font-bold text-brand-800 dark:bg-brand-500/20 dark:text-brand-100">
        {displayName().slice(0, 1)}
      </div>
      <div className="min-w-0 leading-tight">
        <div className="truncate text-[13px] font-semibold text-ink">{displayName()}</div>
        <div className="text-[11px] text-muted">{ROLE_LABELS[r] || r}</div>
      </div>
    </div>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useApp();
  const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
  const icon = theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'monitor';
  const label = theme === 'dark' ? 'ダーク' : theme === 'light' ? 'ライト' : '端末に合わせる';
  return <IconButton icon={icon} label={`表示: ${label}（クリックで切り替え）`} size="sm" onClick={() => setTheme(next)} />;
}

function useAdminLogout(adminSession) {
  if (currentAccess || !adminSession || !adminSession.authenticated) return null;
  return async () => {
    const ok = await confirmDialog({ title: 'ログアウト', message: '管理者としてログアウトしますか？', confirmLabel: 'ログアウト', variant: 'danger' });
    if (!ok) return;
    await dbPost('auth', { action: 'logout' });
    window.location.reload();
  };
}

export default function Shell({ path, title, onRefresh, refreshing, adminSession, children }) {
  const nav = visibleNav();
  const [moreOpen, setMoreOpen] = useState(false);
  const logout = useAdminLogout(adminSession);
  const isActive = (p) => (p === '/' ? path === '/' : path.startsWith(p));
  const mobileItems = nav.filter((n) => n.mobile);
  const moreItems = nav.filter((n) => !n.mobile);
  const moreActive = moreItems.some((n) => isActive(n.path));

  return (
    <div className="min-h-screen lg:pl-60">
      {/* サイドバー（デスクトップ） */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-line bg-surface lg:flex">
        <div className="px-5 pb-4 pt-5"><Logo /></div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="メインメニュー">
          {nav.map((n) => (
            <a
              key={n.path}
              href={`#${n.path}`}
              aria-current={isActive(n.path) ? 'page' : undefined}
              className={cx(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-semibold transition-colors',
                isActive(n.path) ? 'bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-100' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
              )}
            >
              <Icon name={n.icon} size={18} className={isActive(n.path) ? 'text-brand-600 dark:text-brand-300' : 'text-muted'} />
              {n.label}
            </a>
          ))}
        </nav>
        <div className="border-t border-line p-4">
          <UserChip />
          <div className="mt-3 flex items-center gap-1">
            <ThemeToggle />
            <IconButton icon="refresh-cw" label="最新のデータに更新" size="sm" onClick={onRefresh} className={refreshing ? 'animate-spin' : ''} />
            {logout ? <IconButton icon="log-out" label="ログアウト" size="sm" onClick={logout} /> : null}
          </div>
        </div>
      </aside>

      {/* 上部バー（モバイル） */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur safe-top lg:hidden">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2.5">
            <Logo compact />
            <span className="truncate text-[15px] font-bold text-ink">{title}</span>
          </div>
          <div className="flex items-center gap-1">
            <IconButton icon="refresh-cw" label="最新のデータに更新" onClick={onRefresh} className={refreshing ? 'animate-spin' : ''} />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1200px] px-4 pb-28 pt-4 sm:px-6 sm:pt-6 lg:px-8 lg:pb-12 lg:pt-8">
        {children}
      </main>

      {/* 下部タブ（モバイル） */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur safe-bottom lg:hidden" aria-label="メインメニュー">
        <div className="mx-auto grid max-w-lg" style={{ gridTemplateColumns: `repeat(${mobileItems.length + 1}, minmax(0, 1fr))` }}>
          {mobileItems.map((n) => (
            <a key={n.path} href={`#${n.path}`} aria-current={isActive(n.path) ? 'page' : undefined}
              className={cx('flex h-16 flex-col items-center justify-center gap-1 text-[10.5px] font-semibold', isActive(n.path) ? 'text-brand-700 dark:text-brand-200' : 'text-muted')}>
              <Icon name={n.icon} size={21} strokeWidth={isActive(n.path) ? 2.1 : 1.75} />
              {n.short || n.label}
            </a>
          ))}
          <button type="button" onClick={() => setMoreOpen(true)}
            className={cx('flex h-16 flex-col items-center justify-center gap-1 text-[10.5px] font-semibold', moreActive ? 'text-brand-700 dark:text-brand-200' : 'text-muted')}>
            <Icon name="ellipsis" size={21} />
            その他
          </button>
        </div>
      </nav>

      {moreOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="その他のメニュー">
          <div className="absolute inset-0 animate-fade-in bg-black/40" onClick={() => setMoreOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 animate-sheet-up rounded-t-2xl bg-surface p-4 shadow-pop safe-bottom">
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line-strong" />
            <div className="mb-4 flex items-center justify-between">
              <UserChip />
              <div className="flex items-center gap-1">
                <ThemeToggle />
                {logout ? <IconButton icon="log-out" label="ログアウト" size="sm" onClick={logout} /> : null}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 pb-2">
              {moreItems.map((n) => (
                <button key={n.path} type="button" onClick={() => { setMoreOpen(false); navigate(n.path); }}
                  className={cx('flex flex-col items-center gap-2 rounded-xl border px-2 py-3.5 text-xs font-semibold',
                    isActive(n.path) ? 'border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-500/40 dark:bg-brand-500/15 dark:text-brand-100' : 'border-line text-ink-2')}>
                  <Icon name={n.icon} size={22} />
                  {n.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
