import { useEffect, useRef } from 'react';
import { dbGet } from '../../../lib/api.js';
import { useResource } from '../../../lib/hooks.js';

// ============================================================
// カウンセリングシート（Google フォームの回答）の取得
// ------------------------------------------------------------
// サーバー（/api/db?table=counseling）が GAS を呼ぶ。見える店舗の判定もサーバー側。
// 開いている間は 30秒ごとに読み直し、お客様がフォームを送ると一覧に出てくる。
// ============================================================

export const POLL_MS = 30 * 1000;

async function get(params) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const r = await dbGet('counseling', clean);
  if (!r || r.error) {
    const e = new Error((r && r.error) || '通信エラー');
    e.code = r && r.code;
    throw e;
  }
  return r;
}

/** 見られる店舗とフォームとの連携状態 */
export function useCounselingStores() {
  return useResource('counseling:stores', () => get({ action: 'stores' }), { maxAge: 5 * 60 * 1000 });
}

/**
 * 店舗の新しい回答（最大 50件）。active の間だけ 30秒ごとに読み直す（画面が裏にある時は止める）。
 * @param {string|null} storeId
 * @param {boolean} active
 */
export function useRecentSheets(storeId, active) {
  const forceRef = useRef(false);
  const res = useResource(storeId ? `counseling:recent:${storeId}` : null, () => {
    const refresh = forceRef.current ? '1' : undefined;
    forceRef.current = false;
    return get({ action: 'recent', storeId, refresh });
  }, { maxAge: POLL_MS - 5000 });
  const { reload } = res;
  const dataRef = useRef(null);
  dataRef.current = res.data;

  useEffect(() => {
    if (!storeId || !active) return undefined;
    const tick = () => { if (document.visibilityState === 'visible') reload(); };
    // 他のツールから戻ってきた時、前の取得から時間が経っていればすぐ読み直す
    const last = dataRef.current && Date.parse(dataRef.current.fetchedAt);
    if (last && Date.now() - last > POLL_MS - 5000) tick();
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [storeId, active, reload]);

  /** 画面右上の ⟳ など、すぐに取り直したい時（サーバーのキャッシュも使わない） */
  const refreshNow = () => {
    forceRef.current = true;
    return reload();
  };
  return { ...res, refreshNow };
}

export function fetchSheet(storeId, sheet) {
  return get({ action: 'detail', storeId, index: sheet.index, name: sheet.name });
}

export function searchSheets(storeId, q) {
  return get({ action: 'search', storeId, q });
}
