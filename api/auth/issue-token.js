// ========================================
// スタッフトークン発行エンドポイント
// ========================================
// POST /api/auth/issue-token
//   body: { staffId: string }
//   response: { token, url, expiresAt }
//
// 誰が呼べるか:
//   - admin モード（?v= 無しでアクセス中の管理者）のみ
//   - スタッフモード（signed または legacy token を保持している = X-Staff-Token
//     を送っている）からの呼び出しは 403 で拒否する。
// ========================================

import { cors } from '../_lib/cors.js';
import { supabase } from '../_lib/supabase.js';
import { signToken } from '../_lib/sign.js';
import { extractStaffContext } from '../_lib/auth.js';

const DEFAULT_TTL_SECONDS = 365 * 24 * 60 * 60; // 1 year

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POSTのみ対応' });
  }

  try {
    // admin のみ許可。既にスタッフトークン付きで来ている場合は拒否する
    // （権限昇格を防ぐ）。extractStaffContext が null を返すのが admin モード。
    const ctx = await extractStaffContext(req);
    if (ctx !== null) {
      return res.status(403).json({ error: 'このエンドポイントは管理者のみ呼び出せます' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const staffId = body.staffId ? String(body.staffId) : '';
    if (!staffId) return res.status(400).json({ error: 'staffIdが必要です' });

    // staff テーブル + staff_stores を参照して正しい payload を構築する
    const { data: staffRow, error: staffErr } = await supabase
      .from('staff').select('id, name, role, status').eq('id', staffId).maybeSingle();
    if (staffErr) throw staffErr;
    if (!staffRow) return res.status(404).json({ error: 'スタッフが見つかりません' });
    if (staffRow.status === 'inactive') {
      return res.status(400).json({ error: 'このスタッフは無効化されています' });
    }

    const { data: ssRows, error: ssErr } = await supabase
      .from('staff_stores').select('store_id').eq('staff_id', staffId);
    if (ssErr) throw ssErr;
    const storeIds = (ssRows || []).map(r => r.store_id).filter(Boolean);

    const payload = {
      id: staffRow.id,
      n:  staffRow.name,
      r:  staffRow.role || 'staff',
      sid: storeIds,
    };
    // クライアントが希望する TTL を渡せる（最大 1 年）
    const ttl = Math.min(Number(body.ttlSeconds) || DEFAULT_TTL_SECONDS, DEFAULT_TTL_SECONDS);
    const token = signToken(payload, ttl);
    const expiresAt = new Date((Math.floor(Date.now() / 1000) + ttl) * 1000).toISOString();

    return res.status(200).json({
      success: true,
      token,
      expiresAt,
      // 便利のため完全な URL も組み立てて返す（クライアント側でも生成可能）
      // ここでは origin を返さず、相対 path のみとする（サーバが host を知らない環境考慮）
      relativeUrl: `?v=${encodeURIComponent(token)}`,
    });
  } catch (e) {
    console.error('[auth/issue-token] error:', e);
    return res.status(500).json({ error: e.message || 'サーバーエラー' });
  }
}
