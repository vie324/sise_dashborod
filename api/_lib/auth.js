// ========================================
// スタッフ権限コンテキスト抽出
// ========================================
// クライアントは以下の2つのヘッダを送る:
//   X-Staff-Id    : staff テーブル主キー
//   X-Staff-Token : base64(JSON) 形式の staff token
//                   ( index.html の parseAccessFromUrl / generateStaffToken と同形式 )
//
// トークンは現時点では署名なし（base64 JSON のみ）。そのため tamper-proof では
// ないが、クライアントコードの devtools 経由での単純な権限逸脱を抑止するために
// DB 照合で store_ids を確定し、body/params に含まれる storeId と突き合わせる。
//
// トークンが無い場合は admin モード（全店舗許可）として扱う（既存の管理者ログイン
// フローとの後方互換のため）。
// ========================================

import { supabase } from './supabase.js';

// base64(utf-8 json) を安全に decode する。失敗したら null
function decodeStaffToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    // Node 環境では atob 利用可 (Node 16+) / fallback 含む
    const b = typeof atob === 'function' ? atob(token) : Buffer.from(token, 'base64').toString('binary');
    // URL safe chars: utf-8 byte 列を一度 Uint8Array 経由にしてから復元
    const bytes = new Uint8Array(b.length);
    for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i);
    const decoder = new TextDecoder('utf-8');
    const json = decoder.decode(bytes);
    const obj = JSON.parse(json);
    return {
      staffId: String(obj.id || ''),
      name:    String(obj.n || ''),
      role:    String(obj.r || 'staff'),
      // sid が無い/空配列の場合は storeIds=[] として扱う
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
 *   - { staffId, role, storeIds, name, isAdmin: false, valid: true }
 *   - { isAdmin: false, valid: false, reason } : token が不正 / staff 無効
 *
 * NOTE: isAdmin=true のケースは null で表現（呼び出し側で判定しやすくするため）。
 */
export async function extractStaffContext(req) {
  const tokenHeader = readHeader(req, 'x-staff-token');
  const staffIdHeader = readHeader(req, 'x-staff-id');

  if (!tokenHeader && !staffIdHeader) {
    // 管理者モード（旧来の運用と互換）
    return null;
  }

  const decoded = tokenHeader ? decodeStaffToken(tokenHeader) : null;
  if (!decoded) {
    return { valid: false, reason: 'token_invalid' };
  }
  // ヘッダ側の staff_id と token の id を突き合わせる（不一致は拒否）
  if (staffIdHeader && String(staffIdHeader) !== decoded.staffId) {
    return { valid: false, reason: 'staff_id_mismatch' };
  }
  if (!decoded.staffId) {
    return { valid: false, reason: 'staff_id_missing' };
  }

  // DB でスタッフの実在と active 状態を確認し、staff_stores から正規の storeIds を取得する
  // （トークンに埋め込まれた sid は信用せず、常に DB の値を権威とする）
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
      isAdmin: false,
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
