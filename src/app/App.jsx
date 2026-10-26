import { Suspense, lazy, useEffect, useState } from 'react';
import Shell from './Shell.jsx';
import { useRoute, basePath } from './router.js';
import { AppProvider } from './state.jsx';
import { NAV } from './nav.js';
import { Toaster, ConfirmHost, showToast } from '../ui/feedback.jsx';
import { Button, Input, Banner, Skeleton } from '../ui/primitives.jsx';
import Icon from '../ui/Icon.jsx';
import { currentAccess, applyServerAccess } from '../lib/access.js';
import { dbGet, dbPost, onAuthError } from '../lib/api.js';
import { refreshSalonOne, invalidate } from '../lib/hooks.js';

import HomePage from '../features/home/HomePage.jsx';
import IncentivesPage from '../features/incentives/IncentivesPage.jsx';
import GoalsPage from '../features/goals/GoalsPage.jsx';
import SalesPage from '../features/sales/SalesPage.jsx';

// 出納帳・施術ツール・設定は開いた時に読み込む（最初の表示を軽くする）
const CashbookPage = lazy(() => import('../features/cashbook/CashbookPage.jsx'));
const CarePage = lazy(() => import('../features/care/CarePage.jsx'));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage.jsx'));
const MandalaPage = lazy(() => import('../features/mandala/MandalaPage.jsx'));

function PageLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="読み込み中">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-[160px] rounded-2xl" />
      <Skeleton className="h-[260px] rounded-2xl" />
    </div>
  );
}

const PAGES = {
  '/': HomePage,
  '/incentives': IncentivesPage,
  '/goals': GoalsPage,
  '/sales': SalesPage,
  '/cashbook': CashbookPage,
  '/care': CarePage,
  '/settings': SettingsPage,
  '/mandala': MandalaPage,
};

// ------------------------------------------------------------
// ログイン系の画面
// ------------------------------------------------------------
function GateLayout({ icon, title, subtitle, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-5">
      <div className="card w-full max-w-sm p-7">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white"><Icon name={icon} size={24} /></div>
          <h1 className="text-lg font-bold text-ink">{title}</h1>
          {subtitle ? <p className="mt-1 text-[13px] text-muted">{subtitle}</p> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

function PasswordForm({ submitLabel, onSubmit }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    const err = await onSubmit(password);
    setBusy(false);
    if (err) { setError(err); setPassword(''); }
  };
  return (
    <form onSubmit={submit}>
      <label className="field-label" htmlFor="gate-pw">パスワード</label>
      <Input id="gate-pw" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={error ? 'true' : undefined} />
      {error ? <p className="mt-2 flex items-center gap-1 text-xs font-medium text-[#b42323] dark:text-[#f08a8a]"><Icon name="circle-alert" size={13} />{error}</p> : null}
      <Button type="submit" variant="primary" className="mt-4 w-full" loading={busy} disabled={!password}>{submitLabel}</Button>
    </form>
  );
}

function AdminLogin({ onSuccess }) {
  return (
    <GateLayout icon="shield-check" title="管理者ログイン" subtitle="si'se ダッシュボード">
      <PasswordForm submitLabel="ログイン" onSubmit={async (password) => {
        const r = await dbPost('auth', { action: 'login', password });
        if (r && r.success) { onSuccess(); return null; }
        return (r && r.error) || 'ログインに失敗しました';
      }} />
    </GateLayout>
  );
}

function StaffPasswordLock({ onUnlock }) {
  return (
    <GateLayout icon="lock" title="パスワード入力" subtitle={`${currentAccess.name} さんのページです`}>
      <PasswordForm submitLabel="開く" onSubmit={async (password) => {
        const r = await dbPost('auth', { action: 'verifyPassword', password });
        if (r && r.success) {
          try { sessionStorage.setItem('sise_pw_verified', currentAccess.staffId); } catch (_) { /* noop */ }
          onUnlock();
          return null;
        }
        return (r && r.error) || 'パスワードが正しくありません';
      }} />
    </GateLayout>
  );
}

// サーバーが返す理由（api/_lib/auth.js）→ 画面の説明
const INVALID_REASONS = {
  staff_id_missing: '以前のダッシュボードで発行されたURLです。今のダッシュボードでは使えません。',
  legacy_token_disabled: '以前の形式のURLです。今は使えなくなっています。',
  token_invalid: 'URLが正しくありません。途中で切れていないか確認してください。',
  signed_bad_signature: 'URLが正しくありません。途中で切れていないか確認してください。',
  signed_malformed: 'URLが正しくありません。途中で切れていないか確認してください。',
  signed_invalid_payload: 'URLが正しくありません。',
  staff_id_mismatch: 'URLが正しくありません。',
  signed_expired: 'URLの有効期限（発行から1年）が切れています。',
  staff_not_found: 'このURLのスタッフが登録されていません（削除された可能性があります）。',
  staff_inactive: 'このスタッフは無効になっています。',
};

function InvalidAccess({ reason }) {
  if (reason === 'db_error') {
    return (
      <GateLayout icon="wifi-off" title="開けませんでした" subtitle="サーバーに接続できませんでした">
        <Banner tone="warn">時間をおいて、もう一度開いてください。</Banner>
      </GateLayout>
    );
  }
  return (
    <GateLayout icon="link-2-off" title="このURLは使えません" subtitle={INVALID_REASONS[reason] || 'スタッフURLが無効か、期限切れです'}>
      <Banner tone="warn">
        オーナー（管理者）に新しいURLの発行を依頼してください。
        <span className="mt-1 block text-xs opacity-80">発行は 設定 → スタッフ →「URLをコピー」でできます。</span>
        {reason ? <span className="mt-1 block text-[11px] opacity-60">理由: {reason}</span> : null}
      </Banner>
    </GateLayout>
  );
}

function NoAccess() {
  return (
    <div className="card card-pad">
      <p className="text-sm text-ink-2">このページを表示する権限がありません。</p>
    </div>
  );
}

// ------------------------------------------------------------
// アプリ本体
// ------------------------------------------------------------
function Main({ adminSession }) {
  const path = useRoute();
  const base = basePath(path);
  const Page = PAGES[base] || HomePage;
  const navItem = NAV.find((n) => n.path === base) || NAV[0];
  const allowed = !navItem.show || navItem.show();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = () => {
    setRefreshing(true);
    refreshSalonOne();
    invalidate('stores:');
    invalidate('staff:');
    invalidate('goals:');
    invalidate('mandala:');
    // 出納帳など独自に同期している画面にも知らせる
    window.dispatchEvent(new Event('sise:refresh'));
    showToast('最新のデータを取得しています', 'info', 1800);
    setTimeout(() => setRefreshing(false), 1200);
  };

  useEffect(() => {
    document.title = `${navItem.label} | si'se ダッシュボード`;
  }, [navItem.label]);

  return (
    <Shell path={path} title={navItem.label} onRefresh={onRefresh} refreshing={refreshing} adminSession={adminSession}>
      {/* 画面を切り替えた時だけ、ふわっと出す（画面の中の階層の移動は各画面に任せる） */}
      <div key={base} className="animate-page-in">
        <Suspense fallback={<PageLoading />}>
          {allowed ? <Page path={path} /> : <NoAccess />}
        </Suspense>
      </div>
    </Shell>
  );
}

export default function App() {
  const [auth, setAuth] = useState(() => ({ loading: !currentAccess, requiresAuth: false, authenticated: false }));
  const [unlocked, setUnlocked] = useState(() => {
    if (!currentAccess || !currentAccess.hasPassword) return true;
    try { return sessionStorage.getItem('sise_pw_verified') === currentAccess.staffId; } catch (_) { return false; }
  });
  const [invalidReason, setInvalidReason] = useState(currentAccess && currentAccess.invalid ? 'token_invalid' : '');
  // スタッフURL: サーバーに今の権限を聞いてから表示する（無効な URL はここで 401 になり案内を出す）
  const [checkingStaff, setCheckingStaff] = useState(() => !!currentAccess && !currentAccess.invalid);

  useEffect(() => {
    if (!currentAccess || currentAccess.invalid) return undefined;
    let cancelled = false;
    dbGet('auth').then((r) => {
      if (cancelled) return;
      if (r && r.staff) applyServerAccess(r.staff);
      setCheckingStaff(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (currentAccess) return undefined;
    let cancelled = false;
    dbGet('auth').then((r) => {
      if (cancelled) return;
      setAuth({ loading: false, requiresAuth: !!(r && r.requiresAuth), authenticated: !!(r && r.authenticated) });
    });
    return () => { cancelled = true; };
  }, []);

  // API が 401 を返したら（セッション切れ・URL失効）ログイン画面へ
  useEffect(() => onAuthError((body) => {
    if (body && body.requiresAdminLogin) setAuth((a) => ({ ...a, requiresAuth: true, authenticated: false }));
    else if (currentAccess && body && typeof body.error === 'string' && body.error.startsWith('認証エラー')) setInvalidReason(body.error.replace('認証エラー: ', ''));
  }), []);

  let content;
  if (invalidReason) content = <InvalidAccess reason={invalidReason} />;
  else if (checkingStaff) content = <div className="flex min-h-screen items-center justify-center text-sm text-muted">読み込み中…</div>;
  else if (currentAccess && !unlocked) content = <StaffPasswordLock onUnlock={() => setUnlocked(true)} />;
  else if (!currentAccess && auth.loading) content = <div className="flex min-h-screen items-center justify-center text-sm text-muted">読み込み中…</div>;
  else if (!currentAccess && auth.requiresAuth && !auth.authenticated) content = <AdminLogin onSuccess={() => setAuth((a) => ({ ...a, authenticated: true }))} />;
  else content = (
    <AppProvider>
      <Main adminSession={auth} />
    </AppProvider>
  );

  return (
    <>
      {content}
      <Toaster />
      <ConfirmHost />
    </>
  );
}

