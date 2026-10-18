import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { currentAccess, hasFullStoreAccess } from '../lib/access.js';
import { useStores } from '../lib/hooks.js';
import { todayJst, monthOf } from '../../shared/dates.js';

// ============================================================
// 画面全体の状態: 表示中の月・店舗・テーマ
// ============================================================

const AppContext = createContext(null);

const STORE_KEY = 'sise_selected_store';
const THEME_KEY = 'sise_theme';

// 担当店舗が 2つ以上（マネージャーなど）なら「担当の全店舗」をまとめて見られる
const hasManyStores = () => !!currentAccess && currentAccess.storeIds.length > 1;

function initialStore() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) {
      if (saved === 'all' && (hasFullStoreAccess() || hasManyStores())) return 'all';
      if (saved !== 'all' && (hasFullStoreAccess() || (currentAccess && currentAccess.storeIds.includes(saved)))) return saved;
    }
  } catch (_) { /* noop */ }
  if (currentAccess && !hasFullStoreAccess() && currentAccess.storeIds.length > 0) {
    return hasManyStores() ? 'all' : currentAccess.storeIds[0];
  }
  return 'all';
}

export function AppProvider({ children }) {
  const today = todayJst();
  const [month, setMonth] = useState(monthOf(today));
  const [storeId, setStoreIdState] = useState(initialStore);
  const [theme, setThemeState] = useState(() => {
    try { return localStorage.getItem(THEME_KEY) || 'system'; } catch (_) { return 'system'; }
  });
  const storesRes = useStores();

  // 見られる店舗（スタッフ・店長・マネージャーは所属・管轄店舗だけ）
  const stores = useMemo(() => {
    const all = storesRes.shown || [];
    if (hasFullStoreAccess()) return all;
    const mine = new Set((currentAccess && currentAccess.storeIds) || []);
    return all.filter((s) => mine.has(String(s.id)));
  }, [storesRes.shown]);

  const canSelectAll = hasFullStoreAccess() || stores.length > 1;

  // 保存されていた店舗が無くなっていたら先頭に戻す（担当が 1店舗なら「全店舗」もその店舗にする）
  useEffect(() => {
    if (!storesRes.data) return;
    if (storeId === 'all' ? canSelectAll : stores.some((s) => String(s.id) === storeId)) return;
    setStoreIdState(canSelectAll ? 'all' : (stores[0] ? String(stores[0].id) : 'all'));
  }, [storesRes.data, stores, storeId, canSelectAll]);

  const setStoreId = useCallback((id) => {
    setStoreIdState(id);
    try { localStorage.setItem(STORE_KEY, id); } catch (_) { /* noop */ }
  }, []);

  const setTheme = useCallback((t) => {
    setThemeState(t);
    try { localStorage.setItem(THEME_KEY, t); } catch (_) { /* noop */ }
    if (window.__siseApplyTheme) window.__siseApplyTheme();
  }, []);

  const storeName = useCallback((id) => {
    if (!id || id === 'all') return hasFullStoreAccess() ? '全店舗' : '担当の全店舗';
    const s = (storesRes.shown || []).find((x) => String(x.id) === String(id));
    return s ? s.name : id;
  }, [storesRes.shown]);

  const value = useMemo(() => ({
    today,
    month,
    setMonth,
    storeId,
    setStoreId,
    stores,
    storesLoading: storesRes.loading && !storesRes.shown,
    storeName,
    canSelectAll,
    // オーナー・管理者は「全店舗」、それ以外は担当店舗をまとめた「担当の全店舗」
    allStoresLabel: hasFullStoreAccess() ? '全店舗' : '担当の全店舗',
    theme,
    setTheme,
  }), [today, month, storeId, setStoreId, stores, storesRes.loading, storesRes.shown, storeName, canSelectAll, theme, setTheme]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}
