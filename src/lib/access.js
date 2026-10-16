// ============================================================
// アクセス情報（スタッフURL ?v=<token> の解析）
// ------------------------------------------------------------
// トークンの中身はサーバーで HMAC 検証される。ここでの解析は画面の出し分け
// （名前・ロール・所属店舗）にだけ使い、権限の最終判断は常にサーバーが行う。
//   トークン無し          … 管理者モード
//   role = headquarter    … 本部（全店舗）
//   role = manager        … 店舗責任者（所属店舗のスタッフ全員）
//   role = staff          … スタッフ（自分の実績）
// ============================================================

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
      role: p.r || 'staff',
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
  headquarter: '本部',
  manager: '店舗責任者',
  staff: 'スタッフ',
};

export const role = currentAccess ? currentAccess.role : 'admin';

/** 管理者（トークン無し）または本部 */
export const isAdminLike = () => !currentAccess || currentAccess.role === 'headquarter';
/** 管理者モード（トークン無し）。スタッフURLの発行はこのモードだけ */
export const isAdmin = () => !currentAccess;
/** 店舗責任者以上（スタッフ一覧・店舗の目標設定ができる） */
export const isManagerOrAbove = () => !currentAccess || currentAccess.role === 'headquarter' || currentAccess.role === 'manager';

export const hasFullStoreAccess = isAdminLike;

export function isStoreIdAllowed(storeId) {
  if (hasFullStoreAccess()) return true;
  return !!currentAccess && currentAccess.storeIds.includes(String(storeId));
}

export function displayName() {
  return currentAccess ? currentAccess.name : '管理者';
}
