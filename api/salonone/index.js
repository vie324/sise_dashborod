// ============================================================
// SalonOne 連携 API
// ------------------------------------------------------------
// GET /api/salonone?action=status                         接続状態
// GET /api/salonone?action=summary&month=YYYY-MM&storeId=  月次の実績・インセンティブ
// GET /api/salonone?action=trend&months=6&month=YYYY-MM&storeId=  月次推移
// GET /api/salonone?action=master                         対応付け用マスタ（管理者・本部）
// GET /api/salonone?action=probe                          接続テスト（管理者・本部）
// POST /api/salonone?action=clearCache                    キャッシュ破棄（管理者・本部）
//
// SalonOne の APIキーはサーバーの環境変数にだけ置き、ブラウザへは返さない。
// ============================================================

import { cors } from '../_lib/cors.js';
import { authorizeRequest, isAdminOrOwner } from '../_lib/auth.js';
import { buildSummary, buildTrend, buildMaster, AccessError } from '../_lib/salonone/summary.js';
import { salonOneConfig, probe } from '../_lib/salonone/client.js';
import { clearSalonOneCache } from '../_lib/salonone/provider.js';
import { isMonth, todayJst, monthOf, addMonths, monthRange } from '../../shared/dates.js';
import { INCENTIVE_RULES } from '../../shared/incentive-rules.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await authorizeRequest(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error, requiresAdminLogin: auth.requiresAdminLogin || undefined });
  }
  const { staffCtx } = auth;
  const q = req.query || {};
  const action = q.action || 'summary';
  const today = todayJst();
  const month = isMonth(q.month) ? q.month : monthOf(today);
  const storeId = q.storeId ? String(q.storeId) : 'all';
  const refresh = q.refresh === '1' || q.refresh === 'true';

  try {
    switch (action) {
      case 'status': {
        const cfg = salonOneConfig();
        return res.json({
          mode: cfg.configured ? 'live' : 'demo',
          configured: cfg.configured,
          // URL やキーの値そのものは管理者にだけ見せる
          baseUrl: isAdminOrOwner(staffCtx) ? cfg.baseUrl : undefined,
          endpoints: isAdminOrOwner(staffCtx) ? cfg.endpoints : undefined,
          today,
          rules: INCENTIVE_RULES,
        });
      }
      case 'summary':
        return res.json(await buildSummary(staffCtx, { month, storeId, refresh }));
      case 'trend': {
        const months = Math.min(Math.max(parseInt(q.months, 10) || 6, 1), 24);
        return res.json(await buildTrend(staffCtx, { months, endMonth: month, storeId, refresh }));
      }
      case 'master':
        return res.json(await buildMaster(staffCtx, { refresh }));
      case 'probe': {
        if (!isAdminOrOwner(staffCtx)) return res.status(403).json({ error: '管理者またはオーナーのみ利用できます' });
        const cfg = salonOneConfig();
        if (!cfg.configured) {
          return res.json({ configured: false, results: [], message: 'SALONONE_API_KEY が未設定です（デモデータで動作中）' });
        }
        const prev = addMonths(monthOf(today), -1);
        const results = await probe(cfg, { from: monthRange(prev).from, to: today });
        return res.json({ configured: true, baseUrl: cfg.baseUrl, results });
      }
      case 'clearCache': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST で呼び出してください' });
        if (!isAdminOrOwner(staffCtx)) return res.status(403).json({ error: '管理者またはオーナーのみ利用できます' });
        clearSalonOneCache();
        return res.json({ success: true });
      }
      default:
        return res.status(400).json({ error: '不明な action: ' + action });
    }
  } catch (e) {
    if (e instanceof AccessError) return res.status(e.status).json({ error: e.message });
    if (e && e.name === 'SalonOneError') {
      console.error('[salonone]', e.message, e.body || '');
      return res.status(502).json({ error: e.message, upstreamStatus: e.status || null, endpoint: e.endpoint || null });
    }
    console.error('[salonone] unexpected error:', e);
    return res.status(500).json({ error: e && e.message ? e.message : 'Internal error' });
  }
}
