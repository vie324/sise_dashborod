// ============================================================
// アクセス情報（スタッフURL ?v=<token> の解析）
// ------------------------------------------------------------
// トークンの中身はサーバーで HMAC 検証される。ここでの解析は画面の出し分け
// （名前・ロール・所属店舗）にだけ使い、権限の最終判断は常にサーバーが行う。
// 起動時にサーバーから今の権限（DB の値）を受け取り applyServerAccess で上書きするので、
// 設定でロールや所属店舗を変えても URL を発行し直さずに反映される。
//   トークン無し        … 管理者モード
//   owner               … オーナー（全店舗）
//   area_manager        … マネージャー（管轄店舗の店長と同じ）
//   manager             … 店長（所属店舗の全体とスタッフ全員）
//   staff               … スタッフ（自分の数字と所属店舗の合計）
// ============================================================

import { ROLES, normalizeRole, isOwnerRole, isStoreManagerRole } from '../../shared/roles.js';

function decodeTokenPayload(token) {
  const part = token.includes('.') ? token.split('.')[0] : token;
  let b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return JSON.parse(new TextDecoder('utf-8').decode(bytes));
}

export function readStaffToken() {
  try {
    return new URLSearchParams(window.location.search).get('v') || '';
  } catch (_) {
    return '';
  }
}

function parseAccess() {
  const token = readStaffToken();
  if (!token) return null;
  try {
    const p = decodeTokenPayload(token);
    return {
      token,
      staffId: String(p.id || ''),
      name: p.n || 'スタッフ',
      role: normalizeRole(p.r),
      storeIds: Array.isArray(p.sid) ? p.sid.map(String) : [],
      hasPassword: !!p.pw,
    };
  } catch (e) {
    console.warn('Invalid access token:', e);
    // 解析できないトークンでもヘッダとしては送り、サーバー側で 401 にする
    return { token, staffId: '', name: '不明', role: 'staff', storeIds: [], hasPassword: false, invalid: true };
  }
}

export const currentAccess = parseAccess();
export const isStaffMode = !!currentAccess;

export const ROLE_LABELS = {
  admin: '管理者',
  ...Object.fromEntries(ROLES.map((r) => [r.value, r.label])),
};

/** 今のロール（管理者モードは 'admin'） */
export const currentRole = () => (currentAccess ? currentAccess.role : 'admin');

/**
 * サーバーが返した今の権限（GET /api/db?table=auth の staff）で上書きする。
 * トークンを発行した後にロール・所属店舗・名前が変わっていても、画面はサーバーの値に合わせる。
 */
export function applyServerAccess(info) {
  if (!currentAccess || !info) return;
  currentAccess.role = normalizeRole(info.role);
  if (info.name) currentAccess.name = info.name;
  if (Array.isArray(info.storeIds)) currentAccess.storeIds = info.storeIds.map(String);
}

/** 管理者（トークン無し）またはオーナー */
export const isAdminLike = () => !currentAccess || isOwnerRole(currentAccess.role);
/** 管理者モード（トークン無し）。スタッフURLの発行はこのモードだけ */
export const isAdmin = () => !currentAccess;
/** 店長以上（店長・マネージャー・オーナー・管理者）。スタッフ一覧・店舗の目標設定・売上分析 */
export const isManagerOrAbove = () => !currentAccess || isOwnerRole(currentAccess.role) || isStoreManagerRole(currentAccess.role);

export const hasFullStoreAccess = isAdminLike;

export function isStoreIdAllowed(storeId) {
  if (hasFullStoreAccess()) return true;
  return !!currentAccess && currentAccess.storeIds.includes(String(storeId));
}

export function displayName() {
  return currentAccess ? currentAccess.name : '管理者';
}
