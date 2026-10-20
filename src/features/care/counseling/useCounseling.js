import { useEffect, useRef } from 'react';
import { salonOne } from '../../../lib/api.js';
import { useResource } from '../../../lib/hooks.js';

// ============================================================
// 本日のお客様（SalonOne の今日の予約）の取得
// ------------------------------------------------------------
// サーバー（/api/salonone?action=visits）が SalonOne の受付履歴を当日分だけ読む。見える店舗の判定もサーバー側。
// 開いている間は 1分ごとに読み直す（受付で入った予約・来店の状態が反映される）。
// ============================================================

export const POLL_MS = 60 * 1000;

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
  const { reload } = res;
  const dataRef = useRef(null);
  dataRef.current = res.data;

  useEffect(() => {
    if (!storeId || !active) return undefined;
    const tick = () => { if (document.visibilityState === 'visible') reload(); };
    // 他のツールから戻ってきた時、前の取得から時間が経っていればすぐ読み直す
    const last = dataRef.current && dataRef.current.fetchedAt ? Date.parse(dataRef.current.fetchedAt) : 0;
    if (last && Date.now() - last > POLL_MS - 5000) tick();
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [storeId, active, reload]);

  /** ⟳ ボタンなど、すぐに取り直したい時（サーバーのキャッシュも使わない） */
  const refreshNow = () => {
    forceRef.current = true;
    return reload();
  };
  return { ...res, refreshNow };
}
