import { useEffect, useRef } from 'react';
import { dbGet, salonOne } from '../../../lib/api.js';
import { useResource } from '../../../lib/hooks.js';

// ============================================================
// カウンセリングで使うデータの取得
// ------------------------------------------------------------
// 本日のお客様: サーバー（/api/salonone?action=visits）が SalonOne の受付履歴を当日分だけ読む。
//   開いている間は 1分ごとに読み直す（受付で入った予約・来店の状態が反映される）。
// カウンセリングシート: Google フォームを使う店舗だけ、サーバー（/api/db?table=counseling）が GAS を読む。
//   開いている間は 30秒ごとに読み直し、お客様がフォームを送ると届く。
// 見える店舗の判定はどちらもサーバー側。
// ============================================================

export const POLL_MS = 60 * 1000;
export const SHEET_POLL_MS = 30 * 1000;

/** 開いている間だけ一定の間隔で読み直す（画面が裏にある時は止める） */
function usePolling(key, active, ms, reload, fetchedAt) {
  const lastRef = useRef(null);
  lastRef.current = fetchedAt;
  useEffect(() => {
    if (!key || !active) return undefined;
    const tick = () => { if (document.visibilityState === 'visible') reload(); };
    // 他のツールから戻ってきた時、前の取得から時間が経っていればすぐ読み直す
    const last = lastRef.current ? Date.parse(lastRef.current) : 0;
    if (last && Date.now() - last > ms - 5000) tick();
    const timer = setInterval(tick, ms);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [key, active, ms, reload]);
}

/**
 * @param {string|null} storeId ダッシュボードの店舗 ID（null なら取得しない）
 * @param {boolean} active 施術ツールでカウンセリングを開いているか（裏にある間は読み直さない）
 */
export function useTodayVisits(storeId, active) {
  const forceRef = useRef(false);
  const res = useResource(storeId ? `counseling:visits:${storeId}` : null, () => {
    const refresh = forceRef.current ? '1' : undefined;
    forceRef.current = false;
    return salonOne('visits', { storeId, refresh });
  }, { maxAge: POLL_MS - 5000 });
  usePolling(storeId, active, POLL_MS, res.reload, res.data && res.data.fetchedAt);

  /** ⟳ ボタンなど、すぐに取り直したい時（サーバーのキャッシュも使わない） */
  const refreshNow = () => {
    forceRef.current = true;
    return res.reload();
  };
  return { ...res, refreshNow };
}

// ------------------------------------------------------------
// カウンセリングシート（Google フォームの回答）
// ------------------------------------------------------------
async function sheetGet(params) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const r = await dbGet('counseling', clean);
  if (!r || r.error) {
    const e = new Error((r && r.error) || '通信エラー');
    e.code = r && r.code;
    throw e;
  }
  return r;
}

/** フォームとつないでいる店舗（{ configured, canConfigure, stores: [{ id, name, linked, formName }] }） */
export function useSheetStores() {
  return useResource('counseling:stores', () => sheetGet({ action: 'stores' }), { maxAge: 5 * 60 * 1000 });
}

/**
 * 店舗の新しい回答（最大 50件）。active の間だけ 30秒ごとに読み直す。
 * @param {string|null} storeId フォームとつないでいない店舗は null
 */
export function useRecentSheets(storeId, active) {
  const forceRef = useRef(false);
  const res = useResource(storeId ? `counseling:recent:${storeId}` : null, () => {
    const refresh = forceRef.current ? '1' : undefined;
    forceRef.current = false;
    return sheetGet({ action: 'recent', storeId, refresh });
  }, { maxAge: SHEET_POLL_MS - 5000 });
  usePolling(storeId, active, SHEET_POLL_MS, res.reload, res.data && res.data.fetchedAt);
  const refreshNow = () => {
    forceRef.current = true;
    return res.reload();
  };
  return { ...res, refreshNow };
}

/** 1件の内容（施術前の確認・お悩み・ご要望・目標時期など。電話・メールは返らない） */
export function fetchSheet(storeId, sheet) {
  return sheetGet({ action: 'detail', storeId, index: sheet.index, name: sheet.name });
}

/** お名前で過去の回答を探す */
export function searchSheets(storeId, q) {
  return sheetGet({ action: 'search', storeId, q });
}
