import { useCallback, useEffect, useRef, useState } from 'react';
import { dbGet, dbPost } from '../../lib/api.js';
import { invalidate } from '../../lib/hooks.js';
import { currentAccess, displayName } from '../../lib/access.js';
import { showToast } from '../../ui/feedback.jsx';
import { todayJst } from '../../../shared/dates.js';
import { CASHBOOK_CACHE_KEY, SYNC_INTERVAL_MS } from './constants.js';

// ============================================================
// 出納帳のデータ（Supabase が正。端末のキャッシュは表示を早くするためだけ）
// ------------------------------------------------------------
//   GET  /api/db?table=cashbook&includeLogs=true → { entries, dailyCloses, logs }
//   POST addEntry / updateEntry / deleteEntry / dailyClose
// 追加・編集・削除は画面へ先に反映し、失敗したら元に戻す。
// 成功したら静かに読み直して、操作ログと店舗IDの正規化（統合店舗）を反映する。
// ============================================================

// 同じ端末で管理者URLとスタッフURLを開くことがあるため、キャッシュは持ち主ごとに分ける。
// 持ち主が違う（または旧画面の形式の）キャッシュは使わない。
const cacheOwner = () => (currentAccess ? `staff:${currentAccess.staffId}` : 'admin');

function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(CASHBOOK_CACHE_KEY) || 'null');
    if (!c || c.owner !== cacheOwner() || !Array.isArray(c.entries)) return null;
    return { entries: c.entries, dailyCloses: Array.isArray(c.dailyCloses) ? c.dailyCloses : [] };
  } catch (_) {
    return null;
  }
}

function writeCache(entries, dailyCloses) {
  try {
    localStorage.setItem(CASHBOOK_CACHE_KEY, JSON.stringify({ owner: cacheOwner(), entries, dailyCloses, ts: Date.now() }));
  } catch (_) { /* 容量超過などは無視（次回はサーバーから読む） */ }
}

const newEntryId = () => 'cb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

const sameStore = (a, b) => String(a || '') === String(b || '');

export function useCashbook() {
  const [cached] = useState(readCache);
  const [entries, setEntries] = useState(() => (cached ? cached.entries : []));
  const [dailyCloses, setDailyCloses] = useState(() => (cached ? cached.dailyCloses : []));
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSynced, setLastSynced] = useState(null);
  const [syncError, setSyncError] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);

  // 保存処理の途中で一覧が同期で入れ替わっても、元に戻す対象を最新の一覧から探せるようにする
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const pending = useRef(0);
  const fetchSeq = useRef(0);
  const lastSyncedAt = useRef(0);

  const begin = () => { pending.current += 1; setPendingCount(pending.current); };
  const finish = () => { pending.current = Math.max(0, pending.current - 1); setPendingCount(pending.current); };

  const fetchFromDb = useCallback(async ({ quiet = false } = {}) => {
    const seq = ++fetchSeq.current;
    if (!quiet) setSyncing(true);
    const data = await dbGet('cashbook', { includeLogs: 'true' });
    // 後から始めた取得があればそちらに任せる
    if (seq !== fetchSeq.current) return;
    if (data && Array.isArray(data.entries)) {
      // 保存中に古い一覧で上書きすると、反映したばかりの記録が一瞬消えるので待つ
      if (pending.current === 0) {
        const list = data.entries.filter((e) => !e.deleted);
        const closes = Array.isArray(data.dailyCloses) ? data.dailyCloses : [];
        setEntries(list);
        setDailyCloses(closes);
        setLogs(Array.isArray(data.logs) ? data.logs : []);
        writeCache(list, closes);
      }
      lastSyncedAt.current = Date.now();
      setLastSynced(new Date());
      setSyncError(null);
    } else {
      setSyncError((data && data.error) || '出納帳を同期できませんでした');
    }
    setLoading(false);
    setSyncing(false);
  }, []);

  useEffect(() => {
    fetchFromDb();
    const timer = setInterval(() => fetchFromDb({ quiet: true }), SYNC_INTERVAL_MS);
    // スマホでアプリへ戻ってきた時は、次の定期同期を待たずに読み直す
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastSyncedAt.current > SYNC_INTERVAL_MS) fetchFromDb({ quiet: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    // 画面上部の更新ボタン
    const onRefresh = () => fetchFromDb();
    window.addEventListener('sise:refresh', onRefresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('sise:refresh', onRefresh);
    };
  }, [fetchFromDb]);

  const closeOf = useCallback((date, storeId) => (
    dailyCloses.find((c) => c.date === date && sameStore(c.storeId, storeId) && c.locked) || null
  ), [dailyCloses]);
  const isDayClosed = useCallback((date, storeId) => !!closeOf(date, storeId), [closeOf]);

  /** @returns {Promise<object|null>} 追加した記録（失敗時 null） */
  const addEntry = useCallback(async (input) => {
    const entry = {
      id: newEntryId(),
      date: input.date || todayJst(),
      type: input.type || 'income',
      category: input.category || '施術売上',
      description: input.description || '',
      amount: parseInt(input.amount, 10) || 0,
      customerName: input.customerName || '',
      treatmentCount: parseInt(input.treatmentCount, 10) || 0,
      paymentMethod: input.paymentMethod || 'CASH',
      cashType: input.cashType || 'register',
      memberId: input.memberId || '',
      store: input.store || '',
      recorder: input.recorder || displayName(),
      notes: input.notes || '',
      createdAt: new Date().toISOString(),
    };
    if (!entry.store) {
      showToast('店舗を選択してください', 'error');
      return null;
    }
    if (isDayClosed(entry.date, entry.store)) {
      showToast('この日は締め済みのため記帳できません', 'error');
      return null;
    }
    begin();
    setEntries((prev) => [entry, ...prev]);
    const r = await dbPost('cashbook', { action: 'addEntry', entry, operator: displayName() });
    finish();
    if (!r || r.error) {
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      showToast((r && r.error) || '保存に失敗しました', 'error');
      if (r && r.closed) fetchFromDb({ quiet: true });
      return null;
    }
    fetchFromDb({ quiet: true });
    return entry;
  }, [isDayClosed, fetchFromDb]);

  /** @returns {Promise<boolean>} */
  const updateEntry = useCallback(async (entryId, updates) => {
    const target = entriesRef.current.find((e) => e.id === entryId);
    if (!target) {
      showToast('記録が見つかりません。最新の状態を読み込みます', 'error');
      fetchFromDb();
      return false;
    }
    if (isDayClosed(target.date, target.store)) {
      showToast('この日は締め済みのため編集できません', 'error');
      return false;
    }
    // 締め済みの日へ移す編集も止める（サーバーは移動元の日しか確認しない）
    const nextDate = updates.date !== undefined ? updates.date : target.date;
    const nextStore = updates.store !== undefined ? updates.store : target.store;
    if (isDayClosed(nextDate, nextStore)) {
      showToast('移動先の日は締め済みのため変更できません', 'error');
      return false;
    }
    begin();
    setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, ...updates, updatedAt: new Date().toISOString(), updatedBy: displayName() } : e)));
    const r = await dbPost('cashbook', { action: 'updateEntry', entryId, updates, operator: displayName() });
    finish();
    if (!r || r.error) {
      setEntries((prev) => prev.map((e) => (e.id === entryId ? target : e)));
      showToast((r && r.error) || '更新に失敗しました', 'error');
      if (r && r.closed) fetchFromDb({ quiet: true });
      return false;
    }
    fetchFromDb({ quiet: true });
    return true;
  }, [isDayClosed, fetchFromDb]);

  /** @returns {Promise<boolean>} */
  const deleteEntry = useCallback(async (entryId) => {
    const index = entriesRef.current.findIndex((e) => e.id === entryId);
    const target = index >= 0 ? entriesRef.current[index] : null;
    if (target && isDayClosed(target.date, target.store)) {
      showToast('この日は締め済みのため削除できません', 'error');
      return false;
    }
    begin();
    setEntries((prev) => prev.filter((e) => e.id !== entryId));
    const r = await dbPost('cashbook', { action: 'deleteEntry', entryId, operator: displayName() });
    finish();
    if (!r || r.error) {
      if (target) {
        setEntries((prev) => {
          if (prev.some((e) => e.id === entryId)) return prev;
          const next = [...prev];
          next.splice(Math.min(index, next.length), 0, target);
          return next;
        });
      }
      showToast((r && r.error) || '削除に失敗しました', 'error');
      if (r && r.closed) fetchFromDb({ quiet: true });
      return false;
    }
    fetchFromDb({ quiet: true });
    return true;
  }, [isDayClosed, fetchFromDb]);

  /**
   * 日次締め。締めた日の記録はサーバー側でも編集・削除できなくなる。
   * @param {{ safe:number, pettyCash:number, register:number }} balances 実残高
   */
  const closeDay = useCallback(async (date, storeId, balances, notes) => {
    begin();
    const payload = {
      action: 'dailyClose',
      date,
      storeId,
      safeBalance: balances.safe || 0,
      pettyCashBalance: balances.pettyCash || 0,
      registerBalance: balances.register || 0,
      closedBy: displayName(),
      notes: notes || '',
    };
    const r = await dbPost('cashbook', payload);
    finish();
    if (!r || r.error) {
      showToast((r && r.error) || '日次締めに失敗しました', 'error');
      if (r && r.closed) fetchFromDb({ quiet: true });
      return false;
    }
    const close = {
      date,
      storeId,
      safeBalance: payload.safeBalance,
      pettyCashBalance: payload.pettyCashBalance,
      registerBalance: payload.registerBalance,
      closedBy: payload.closedBy,
      closedAt: new Date().toISOString(),
      notes: payload.notes,
      locked: true,
    };
    setDailyCloses((prev) => [close, ...prev.filter((c) => !(c.date === date && sameStore(c.storeId, storeId)))]);
    fetchFromDb({ quiet: true });
    return true;
  }, [fetchFromDb]);

  /**
   * SalonOne の現金売上を取り込む（店舗・日ごとに 1件。サーバーが SalonOne から金額を読む）。
   * @returns {Promise<{ results: Array<{date:string,status:string,amount?:number}> }|null>}
   */
  const importSalonOneCash = useCallback(async (storeId, dates) => {
    if (!storeId || !dates || dates.length === 0) return null;
    begin();
    const r = await dbPost('cashbook', { action: 'importSalonOneCash', storeId, dates, operator: displayName() });
    finish();
    if (!r || r.error) {
      showToast((r && r.error) || 'SalonOne の現金売上を取り込めませんでした', 'error');
      return null;
    }
    fetchFromDb({ quiet: true });
    // 取り込みはサーバーで SalonOne から読み直している。突合の SalonOne 側の金額も読み直す
    invalidate('cash:');
    return r;
  }, [fetchFromDb]);

  const refresh = useCallback(() => fetchFromDb(), [fetchFromDb]);

  return {
    entries,
    dailyCloses,
    logs,
    loading,
    syncing,
    saving: pendingCount > 0,
    lastSynced,
    syncError,
    addEntry,
    updateEntry,
    deleteEntry,
    closeDay,
    importSalonOneCash,
    closeOf,
    isDayClosed,
    refresh,
  };
}
