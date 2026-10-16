// ============================================================
// 設定画面（店舗管理・スタッフ管理）のデータ取得と変更
// ============================================================

import { dbGet, dbPost } from '../../lib/api.js';
import { invalidate, useResource } from '../../lib/hooks.js';
import { showToast } from '../../ui/feedback.jsx';

// 他の画面（店舗の切り替え・スタッフ一覧など）が読むキャッシュと同じ接頭辞。
// 変更後にまとめて捨てて、画面全体を最新に揃える。
const CACHE_PREFIX = { staff: 'staff:', stores: 'stores:' };

/**
 * 無効・統合済み（別名）も含めた全店舗。
 * 設定画面では別名の行も表示・解除するため、通常の useStores とは別のキーで持つ
 * （'stores:' で始まるので invalidate('stores:') で一緒に読み直される）。
 */
export function useAllStores() {
  return useResource('stores:all+merged', async () => {
    const r = await dbGet('stores', { includeInactive: 'true', includeMerged: 'true' });
    if (!r || r.error) throw new Error((r && r.error) || '通信エラー');
    return r.stores || [];
  }, { maxAge: 60 * 1000 });
}

/** 変更後の再読み込み。reload（この画面の一覧）を待つので、閉じたモーダルの裏に古い一覧が残らない */
export async function refreshAfterChange(table, reload) {
  invalidate(CACHE_PREFIX[table] || `${table}:`);
  if (reload) await reload();
}

/**
 * 変更系の POST。失敗はトーストで知らせて null を返す。
 * 成功したら関連キャッシュを捨てて reload を待ってから結果を返す。
 */
export async function postChange(table, body, { reload, errorLabel = '保存できませんでした' } = {}) {
  const r = await dbPost(table, body);
  if (!r || r.error) {
    showToast(`${errorLabel}: ${(r && r.error) || '通信エラー'}`, 'error', 5000);
    return null;
  }
  await refreshAfterChange(table, reload);
  return r;
}

/**
 * スタッフURLの発行。トークンはサーバーが HMAC で署名する（管理者モードのときだけ発行できる）。
 * ハッシュ（#/settings など）は付けず、開いた人はホームから始まるようにする。
 */
export async function issueStaffUrl(staffId) {
  const r = await dbPost('auth', { action: 'issueToken', staffId });
  if (!r || r.error || !r.token) throw new Error((r && r.error) || 'URLを発行できませんでした');
  return `${window.location.origin}${window.location.pathname}?v=${encodeURIComponent(r.token)}`;
}
