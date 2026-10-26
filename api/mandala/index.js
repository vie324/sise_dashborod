// ============================================================
// マンダラチャート（週報・日報・AI レビュー）API
// 使い方: GET /api/mandala?action=home / POST /api/mandala?action=saveReview
// 認証は /api/db と同じ（スタッフ URL の X-Staff-Token か、管理者モード）。
// 権限の判定と処理は api/_lib/mandala/handlers.js。
// AI レビューは時間がかかるので、この関数だけ maxDuration を 60秒にしている（vercel.json）。
// ============================================================

import { cors } from '../_lib/cors.js';
import { authorizeRequest } from '../_lib/auth.js';
import { handleMandala, HttpError } from '../_lib/mandala/handlers.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await authorizeRequest(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error, requiresAdminLogin: auth.requiresAdminLogin || undefined });

  const action = String(req.query.action || '');
  try {
    let input;
    if (req.method === 'POST') {
      input = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    } else {
      input = { ...req.query };
      delete input.action;
    }
    const result = await handleMandala(req.method, action, input, auth.staffCtx);
    return res.json(result);
  } catch (e) {
    if (e instanceof HttpError) return res.status(e.status).json({ error: e.message });
    if (e instanceof SyntaxError) return res.status(400).json({ error: 'リクエストが正しくありません' });
    console.error(`mandala/${action} error:`, e);
    // テーブルが無い = マイグレーション未適用
    if (e && (e.code === '42P01' || e.code === 'PGRST205' || /mandala_\w+.*(does not exist|schema cache)|(does not exist|schema cache).*mandala_/.test(String(e.message)))) {
      return res.status(500).json({ error: 'マンダラのテーブルがありません。supabase/migrations/00006_mandala.sql を適用してください' });
    }
    return res.status(500).json({ error: e && e.message ? e.message : 'サーバーエラー' });
  }
}
