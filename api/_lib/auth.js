// ========================================
// スタッフ権限コンテキスト抽出
// ========================================
// クライアントは以下の2つのヘッダを送る:
//   X-Staff-Id    : staff テーブル主キー
//   X-Staff-Token : スタッフトークン
//                   新形式(signed): <base64url(JSON)>.<base64url(HMAC)>
//                   旧形式(legacy): <base64(JSON)>  （'.' を含まない）
//
// 優先順位:
//   1. signed token → 署名 HMAC を検証、exp 期限チェック、payload 信用
//   2. legacy token → ALLOW_LEGACY_TOKENS=true の時のみ受理（移行期間）
//
// いずれの場合でも DB の staff / staff_stores を照合して正規の storeIds を
// 使う（payload の sid は補助的情報として無視）。
//
// トークンが無い場合は admin モード（全店舗許可）として扱う（既存の管理者ログイン
// フローとの後方互換のため）。
// ========================================

import { supabase } from './supabase.js';
import { signToken, verifyToken, looksSigned } from './sign.js';

// 未署名トークンを受理するかどうか。本番運用で全スタッフの URL を再発行した
// あとは false に切り替えて、古い URL をハード無効化できる。
const ALLOW_LEGACY_TOKENS = String(process.env.ALLOW_LEGACY_TOKENS || 'true').toLowerCase() !== 'false';

// legacy 形式 (base64(JSON)) を decode する。失敗したら null。
// 新形式は sign.js の verifyToken を通すのでここには来ない。
function decodeLegacyToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const b = typeof atob === 'function' ? atob(token) : Buffer.from(token, 'base64').toString('binary');
    const bytes = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i);
    const decoder = new TextDecoder('utf-8');
    const json = decoder.decode(bytes);
    const obj = JSON.parse(json);
    return {
      staffId: String(obj.id || ''),
      name:    String(obj.n || ''),
      role:    String(obj.r || 'staff'),
      storeIds: Array.isArray(obj.sid) ? obj.sid.map(String) : [],
    };
  } catch (e) {
    return null;
  }
}

// 低レベルの「ヘッダを取り出す」ヘルパー（Vercel / Node 両対応）
function readHeader(req, name) {
  const key = name.toLowerCase();
  if (req.headers && typeof req.headers === 'object') {
    return req.headers[key] || req.headers[name] || '';
  }
  return '';
}

/**
 * リクエストからスタッフコンテキストを抽出する。
 * 返り値:
 *   - null : admin モード（token 無し = 全店舗許可）
 *   - { valid: true, staffId, role, storeIds, name, signed: bool }
 *   - { valid: false, reason } : token が不正 / staff 無効
 */
export async function extractStaffContext(req) {
  const tokenHeader = readHeader(req, 'x-staff-token');
  const staffIdHeader = readHeader(req, 'x-staff-id');

  if (!tokenHeader && !staffIdHeader) {
    // 管理者モード（旧来の運用と互換）
    return null;
  }

  // --- 形式判定 + payload 抽出 ---
  let decoded = null;
  let tokenSigned = false;
  if (tokenHeader && looksSigned(tokenHeader)) {
    const v = verifyToken(tokenHeader);
    if (!v.ok) {
      // expired / bad_signature / malformed / invalid_payload を区別して返す
      return { valid: false, reason: 'signed_' + v.reason };
    }
    const p = v.payload || {};
    decoded = {
      staffId: String(p.id || ''),
      name:    String(p.n || ''),
      role:    String(p.r || 'staff'),
      storeIds: Array.isArray(p.sid) ? p.sid.map(String) : [],
    };
    tokenSigned = true;
  } else if (tokenHeader) {
    // legacy 形式。移行期間中のみ受理。
    if (!ALLOW_LEGACY_TOKENS) {
      return { valid: false, reason: 'legacy_token_disabled' };
    }
    decoded = decodeLegacyToken(tokenHeader);
    if (!decoded) return { valid: false, reason: 'token_invalid' };
  } else {
    // staffId ヘッダのみで token 無し → 拒否
    return { valid: false, reason: 'token_missing' };
  }

  if (staffIdHeader && String(staffIdHeader) !== decoded.staffId) {
    return { valid: false, reason: 'staff_id_mismatch' };
  }
  if (!decoded.staffId) {
    return { valid: false, reason: 'staff_id_missing' };
  }

  // DB でスタッフの実在と active 状態を確認し、staff_stores から正規の storeIds を取得する
  // （トークンに埋め込まれた sid は補助情報、常に DB の値を権威とする）
  try {
    const { data: staffRow, error: staffErr } = await supabase
      .from('staff').select('id, name, role, status').eq('id', decoded.staffId).maybeSingle();
    if (staffErr) throw staffErr;
    if (!staffRow) return { valid: false, reason: 'staff_not_found' };
    if (staffRow.status === 'inactive') return { valid: false, reason: 'staff_inactive' };

    const { data: ssRows, error: ssErr } = await supabase
      .from('staff_stores').select('store_id').eq('staff_id', decoded.staffId);
    if (ssErr) throw ssErr;
    const storeIds = (ssRows || []).map(r => r.store_id).filter(Boolean);

    return {
      valid: true,
      signed: tokenSigned,
      staffId: staffRow.id,
      name: staffRow.name,
      role: staffRow.role || 'staff',
      storeIds,
    };
  } catch (e) {
    console.error('[auth] staff lookup failed:', e);
    return { valid: false, reason: 'db_error' };
  }
}

/**
 * staffCtx が対象の storeId にアクセス可能かを判定する。
 *   - staffCtx が null      : admin モード → 常に true
 *   - staffCtx.valid=false  : 常に false（認証エラー）
 *   - storeId が空          : ハンドラ側で別途「店舗必須」をチェックする前提。
 *                            ここでは true を返してはならず、false 扱いで防御的にする
 *                            （空 storeId でスルーされると cross-store 取得が漏れる）
 *   - admin/manager ロール  : 今は staff と同じくstoreIds で判定
 */
export function canAccessStore(staffCtx, storeId) {
  if (staffCtx === null) return true; // admin mode
  if (!staffCtx || staffCtx.valid === false) return false;
  if (!storeId) return false;
  return (staffCtx.storeIds || []).includes(storeId);
}

/**
 * 「現在のスタッフが見ていい店舗 IDs」を返す（null なら全店舗）。
 * attendanceGet / cashbookGet 等で自動フィルタ掛けに使う。
 */
export function allowedStoreIds(staffCtx) {
  if (staffCtx === null) return null; // admin: no filter
  if (!staffCtx || staffCtx.valid === false) return [];
  return Array.isArray(staffCtx.storeIds) ? staffCtx.storeIds : [];
}

// ============================================================
// 管理者セッション (HttpOnly cookie ベース)
// ============================================================
// sise_admin_session=<signed token by sign.js>  の cookie を発行・検証する。
// 登録済みパスワード (bcrypt ハッシュ) と照合してから token 発行。
//
// 環境変数:
//   SISE_ADMIN_PASSWORD_HASH : bcrypt ハッシュ（ログインの検証用）
//   REQUIRE_ADMIN_AUTH       : 'true' なら admin エンドポイントで session を必須化
// ============================================================

const ADMIN_SESSION_COOKIE = 'sise_admin_session';
const ADMIN_SESSION_TTL = 12 * 60 * 60; // 12 hours
export const REQUIRE_ADMIN_AUTH = String(process.env.REQUIRE_ADMIN_AUTH || 'false').toLowerCase() === 'true';

// ざっくり Cookie ヘッダを name→value マップに parse する
export function parseCookies(req) {
  const raw = readHeader(req, 'cookie');
  const out = {};
  if (!raw) return out;
  for (const part of String(raw).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(v); } catch (_) { out[k] = v; }
  }
  return out;
}

// res に admin セッション cookie をセット（HttpOnly + Secure in production）
export function setAdminSessionCookie(res, token) {
  const maxAge = ADMIN_SESSION_TTL;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const cookie = `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
  res.setHeader('Set-Cookie', cookie);
}

// ログアウト: cookie を即時失効させる
export function clearAdminSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const cookie = `${ADMIN_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`;
  res.setHeader('Set-Cookie', cookie);
}

// 新規 admin セッション token を発行する（sign.js で HMAC 署名）。
// payload: { sub: 'admin', iat, exp } だけを入れる。
export function signAdminSession(username = 'admin') {
  return signToken({ sub: 'admin', usr: username }, ADMIN_SESSION_TTL);
}

// cookie から admin セッションを検証する。
// 戻り値: { authenticated: true, username } | { authenticated: false, reason? }
export function verifyAdminSession(req) {
  const cookies = parseCookies(req);
  const token = cookies[ADMIN_SESSION_COOKIE];
  if (!token) return { authenticated: false, reason: 'no_cookie' };
  const v = verifyToken(token);
  if (!v.ok) return { authenticated: false, reason: v.reason || 'invalid' };
  const p = v.payload || {};
  if (p.sub !== 'admin') return { authenticated: false, reason: 'wrong_subject' };
  return { authenticated: true, username: p.usr || 'admin' };
}
