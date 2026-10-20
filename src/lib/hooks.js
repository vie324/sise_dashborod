import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { dbGet, dbPost, salonOne } from './api.js';

// ============================================================
// データ取得フック（キャッシュ付き・再取得中も前の表示を保つ）
// ============================================================

const cache = new Map(); // key → { data, error, loadedAt, promise }
const listeners = new Map(); // key → Set<fn>

function notify(key) {
  const set = listeners.get(key);
  if (set) set.forEach((fn) => fn());
}

function subscribe(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  return () => listeners.get(key).delete(fn);
}

async function load(key, fetcher) {
  const entry = cache.get(key) || {};
  if (entry.promise) return entry.promise;
  const promise = (async () => {
    try {
      const data = await fetcher();
      cache.set(key, { data, error: null, loadedAt: Date.now(), promise: null });
    } catch (e) {
      cache.set(key, { ...(cache.get(key) || {}), error: e, promise: null });
    }
    notify(key);
  })();
  cache.set(key, { ...entry, promise });
  notify(key);
  return promise;
}

/** キャッシュを無効化して読み直す（prefix 一致） */
export function invalidate(prefix) {
  for (const key of [...cache.keys()]) if (key.startsWith(prefix)) {
    const e = cache.get(key);
    cache.set(key, { ...e, loadedAt: 0 });
    notify(key);
  }
}

/**
 * @param {string|null} key     キャッシュキー（null なら取得しない）
 * @param {() => Promise<any>} fetcher
 * @param {{ maxAge?: number }} [opts]
 */
export function useResource(key, fetcher, { maxAge = 60 * 1000 } = {}) {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const snapshot = useSyncExternalStore(
    useCallback((fn) => (key ? subscribe(key, fn) : () => {}), [key]),
    () => (key ? cache.get(key) : undefined),
  );
  // 最後に表示できたデータ（キーが変わっても読み込み中は前の表示を保つ）
  const lastData = useRef(null);
  if (snapshot && snapshot.data !== undefined) lastData.current = snapshot.data;

  useEffect(() => {
    if (!key) return;
    const e = cache.get(key);
    if (!e || (!e.promise && (!e.loadedAt || Date.now() - e.loadedAt > maxAge))) {
      load(key, () => fetcherRef.current());
    }
  }, [key, maxAge, snapshot && snapshot.loadedAt]);

  const reload = useCallback(() => (key ? load(key, () => fetcherRef.current()) : Promise.resolve()), [key]);
  const current = snapshot && snapshot.data !== undefined ? snapshot.data : null;
  return {
    data: current,
    shown: current || lastData.current,
    stale: !current && !!lastData.current,
    error: snapshot ? snapshot.error : null,
    loading: !!(snapshot && snapshot.promise) || (!!key && !snapshot),
    reload,
  };
}

// ------------------------------------------------------------
// SalonOne
// ------------------------------------------------------------
// 「更新」ボタンの直後だけ refresh=1 を付け、サーバー側のキャッシュも読み直させる
let forceRefreshUntil = 0;
const refreshFlag = () => (Date.now() < forceRefreshUntil ? 1 : undefined);

export function useSummary(month, storeId) {
  const key = month ? `summary:${month}:${storeId || 'all'}` : null;
  return useResource(key, () => salonOne('summary', { month, storeId, refresh: refreshFlag() }), { maxAge: 3 * 60 * 1000 });
}

export function useTrend(month, storeId, months = 12) {
  const key = month ? `trend:${month}:${storeId || 'all'}:${months}` : null;
  return useResource(key, () => salonOne('trend', { month, storeId, months, refresh: refreshFlag() }), { maxAge: 10 * 60 * 1000 });
}

export function refreshSalonOne() {
  forceRefreshUntil = Date.now() + 8000;
  invalidate('summary:');
  invalidate('trend:');
}

// ------------------------------------------------------------
// Supabase（/api/db）
// ------------------------------------------------------------
async function unwrap(promise, field) {
  const r = await promise;
  if (!r || r.error) throw new Error((r && r.error) || '通信エラー');
  return field ? r[field] : r;
}

export function useStores(includeInactive = false) {
  return useResource(`stores:${includeInactive ? 'all' : 'active'}`, () => unwrap(dbGet('stores', includeInactive ? { includeInactive: 'true' } : {}), 'stores'), { maxAge: 5 * 60 * 1000 });
}

export function useStaffList(includeInactive = false) {
  return useResource(`staff:${includeInactive ? 'all' : 'active'}`, () => unwrap(dbGet('staff', includeInactive ? { includeInactive: 'true' } : {}), 'staff'), { maxAge: 5 * 60 * 1000 });
}

export function useGoals(month) {
  const res = useResource(month ? `goals:${month}` : null, () => unwrap(dbGet('goals', { month })), { maxAge: 60 * 1000 });
  const save = useCallback(async (scope, targetId, values) => {
    const r = await dbPost('goals', { action: 'set', month, scope, targetId, values });
    if (!r || r.error) throw new Error((r && r.error) || '保存に失敗しました');
    invalidate(`goals:${month}`);
    return r;
  }, [month]);
  const copyFrom = useCallback(async (fromMonth) => {
    const r = await dbPost('goals', { action: 'copyFrom', month, fromMonth });
    if (!r || r.error) throw new Error((r && r.error) || 'コピーに失敗しました');
    invalidate(`goals:${month}`);
    return r;
  }, [month]);
  return { ...res, save, copyFrom };
}

/** 3ヶ月の目標（start = 期の最初の月） */
export function useQuarterGoals(start) {
  const res = useResource(start ? `goals:q:${start}` : null, () => unwrap(dbGet('goals', { period: 'quarter', month: start })), { maxAge: 60 * 1000 });
  const save = useCallback(async (scope, targetId, values) => {
    const r = await dbPost('goals', { action: 'set', period: 'quarter', month: start, scope, targetId, values });
    if (!r || r.error) throw new Error((r && r.error) || '保存に失敗しました');
    invalidate(`goals:q:${start}`);
    return r;
  }, [start]);
  const copyFrom = useCallback(async (fromStart) => {
    const r = await dbPost('goals', { action: 'copyFrom', period: 'quarter', month: start, fromMonth: fromStart });
    if (!r || r.error) throw new Error((r && r.error) || 'コピーに失敗しました');
    invalidate(`goals:q:${start}`);
    return r;
  }, [start]);
  // 3ヶ月の目標を、まだ決めていない単月の目標に振り分ける
  const splitToMonths = useCallback(async () => {
    const r = await dbPost('goals', { action: 'splitQuarter', period: 'quarter', month: start });
    if (!r || r.error) throw new Error((r && r.error) || '振り分けに失敗しました');
    invalidate('goals:');
    return r;
  }, [start]);
  return { ...res, save, copyFrom, splitToMonths };
}

/** 特別目標（店舗ごとの期限付きの目標。設定はオーナーのみ） */
export function useSpecialGoals() {
  const res = useResource('goals:special', () => unwrap(dbGet('goals', { period: 'special' }), 'items'), { maxAge: 60 * 1000 });
  const save = useCallback(async (goal) => {
    const r = await dbPost('goals', { action: 'specialSet', goal });
    if (!r || r.error) throw new Error((r && r.error) || '保存に失敗しました');
    invalidate('goals:special');
    return r;
  }, []);
  const remove = useCallback(async (id) => {
    const r = await dbPost('goals', { action: 'specialDelete', id });
    if (!r || r.error) throw new Error((r && r.error) || '削除に失敗しました');
    invalidate('goals:special');
    return r;
  }, []);
  return { ...res, save, remove };
}

export function useDashConfig() {
  return useResource('dashConfig', () => unwrap(dbGet('dashConfig'), 'config'), { maxAge: 5 * 60 * 1000 });
}

export async function saveDashConfig(key, value) {
  const r = await dbPost('dashConfig', { action: 'set', key, value });
  if (!r || r.error) throw new Error((r && r.error) || '保存に失敗しました');
  invalidate('dashConfig');
  return r;
}

// ------------------------------------------------------------
// 画面幅
// ------------------------------------------------------------
export function useMediaQuery(query) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mql = window.matchMedia(query);
    const on = () => setMatches(mql.matches);
    on();
    if (mql.addEventListener) mql.addEventListener('change', on);
    else mql.addListener(on);
    return () => (mql.removeEventListener ? mql.removeEventListener('change', on) : mql.removeListener(on));
  }, [query]);
  return matches;
}
