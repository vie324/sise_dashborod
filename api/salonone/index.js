// ============================================================
// SalonOne 連携 API
// ------------------------------------------------------------
// GET /api/salonone?action=status                         接続状態
// GET /api/salonone?action=summary&month=YYYY-MM&storeId=  月次の実績・インセンティブ
// GET /api/salonone?action=trend&months=6&month=YYYY-MM&storeId=  月次推移
// GET /api/salonone?action=visits&storeId=                本日の予約（施術ツールのカウンセリング用）
// GET /api/salonone?action=cash&storeId=&month=YYYY-MM     1店舗の日別の現金売上（出納帳の突合・締め用。受付履歴だけを取る）
// GET /api/salonone?action=master                         対応付け用マスタ（管理者・本部）
// GET /api/salonone?action=probe                          接続テスト（管理者・本部）
// POST /api/salonone?action=clearCache                    キャッシュ破棄（管理者・本部）
// POST /api/salonone?action=closePeriod  { month, operator, note, force }  支給期間のインセンティブを確定（オーナー・管理者）
// POST /api/salonone?action=reopenPeriod { month, operator }               確定を取り消す（オーナー・管理者）
// GET /api/salonone?action=cron                           毎日の継続指標の記録（Vercel Cron。Authorization: Bearer <CRON_SECRET>）
// GET /api/salonone?action=cross&month=YYYY-MM&storeId=   系列店での契約の一覧（店長以上は登録の画面で選ぶ店舗・スタッフも）
// GET /api/salonone?action=crossCandidates&storeId=&date=YYYY-MM-DD  契約した店舗・日の SalonOne の契約（店長以上）
// POST /api/salonone?action=crossAdd { date, customerName, planName, contractStoreId, creditKey, receptionId?, memo? }  登録（店長以上）
// POST /api/salonone?action=crossDelete { id, month }      削除（店長以上）
//
// SalonOne の APIキーはサーバーの環境変数にだけ置き、ブラウザへは返さない。
// ============================================================

import { timingSafeEqual } from 'node:crypto';
import { cors } from '../_lib/cors.js';
import { authorizeRequest, isAdminOrOwner } from '../_lib/auth.js';
import {
  buildSummary, buildTrend, buildMaster, dailyCashSales, closePeriod, reopenPeriod, AccessError,
} from '../_lib/salonone/summary.js';
import { buildVisits } from '../_lib/salonone/visits.js';
import { listCrossStore, crossStoreCandidates, addCrossStore, deleteCrossStore } from '../_lib/salonone/cross-handlers.js';
import { salonOneConfig, probe } from '../_lib/salonone/client.js';
import { clearSalonOneCache, snapshotRetention, loadAppContext, planPatterns } from '../_lib/salonone/provider.js';
import { isMonth, todayJst, monthOf, addMonths, monthRange } from '../../shared/dates.js';
import { INCENTIVE_RULES } from '../../shared/incentive-rules.js';

/** Vercel Cron からの呼び出し（CRON_SECRET を設定すると Authorization: Bearer <CRON_SECRET> が付く） */
function isCronRequest(req) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!secret || !header) return false;
  const a = Buffer.from(String(header));
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** 継続指標を記録する。1店舗も記録できなかった時は 502（Vercel の Cron の記録・ログで気づけるように） */
async function runSnapshot() {
  const r = await snapshotRetention();
  if (r.mode === 'live' && r.saved === 0 && r.failed.length) {
    console.error('[salonone] retention snapshot failed:', r.failed);
    return { status: 502, body: { error: '継続管理（会員数・退会率）を 1店舗も記録できませんでした', ...r } };
  }
  if (r.failed.length) console.warn('[salonone] retention snapshot partially failed:', r.failed);
  return { status: 200, body: { success: true, ...r } };
}

// 管理者が手で記録を動かすのは 10分に 1回まで（SalonOne の呼び出し回数を抑える。インスタンスごと）
const MANUAL_SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000;
let lastManualSnapshot = 0;

const bodyOf = (req) => {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (_) { return {}; }
  }
  return req.body;
};

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const q = req.query || {};

  // 毎日の継続指標の記録（月の最後の日の記録がその月の会員数・退会率になる）
  if (isCronRequest(req) && (!q.action || q.action === 'cron')) {
    try {
      const out = await runSnapshot();
      return res.status(out.status).json(out.body);
    } catch (e) {
      console.error('[salonone] cron failed:', e);
      return res.status(500).json({ error: e && e.message ? e.message : 'cron failed' });
    }
  }

  const auth = await authorizeRequest(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error, requiresAdminLogin: auth.requiresAdminLogin || undefined });
  }
  const { staffCtx } = auth;
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
      case 'visits':
        // 日付は常に今日（JST）。店舗は 1つを指定する
        return res.json(await buildVisits(staffCtx, { storeId: q.storeId, refresh }));
      case 'cash': {
        const { unknown, ...cash } = await dailyCashSales(staffCtx, { storeId: q.storeId, months: [month], refresh });
        const byDate = ([a], [b]) => (a < b ? -1 : 1);
        return res.json({
          ...cash,
          month,
          days: Object.entries(cash.days).sort(byDate).map(([date, cashSales]) => ({ date, cashSales })),
          // 現金の分がわからない会計（複数の決済方法で内訳が無い。days には入れていない）
          cashUnknown: Object.entries(unknown || {}).sort(byDate).map(([date, v]) => ({ date, count: v.count, amount: v.amount })),
          fetchedAt: new Date(cash.fetchedAt).toISOString(),
        });
      }
      case 'closePeriod':
      case 'reopenPeriod': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST で呼び出してください' });
        if (!isAdminOrOwner(staffCtx)) return res.status(403).json({ error: 'インセンティブを確定できるのはオーナー・管理者のみです' });
        const body = bodyOf(req);
        const target = isMonth(body.month) ? body.month : month;
        const operator = String(body.operator || (staffCtx && staffCtx.name) || '管理者');
        const r = action === 'closePeriod'
          ? await closePeriod(staffCtx, { month: target, operator, note: body.note, force: body.force === true, accept: body.accept })
          : await reopenPeriod(staffCtx, { month: target, operator });
        return res.json(r);
      }
      case 'cron': {
        // 管理者が手で動かす時（Cron は上で処理済み）
        if (!isAdminOrOwner(staffCtx)) return res.status(403).json({ error: '管理者またはオーナーのみ利用できます' });
        const wait = lastManualSnapshot + MANUAL_SNAPSHOT_INTERVAL_MS - Date.now();
        if (wait > 0) return res.status(429).json({ error: `続けて記録できません。${Math.ceil(wait / 60000)}分ほどおいてから試してください` });
        lastManualSnapshot = Date.now();
        let out = null;
        try {
          out = await runSnapshot();
        } finally {
          // 記録できなかった時は、すぐにやり直せるようにする
          if (!out || out.status !== 200) lastManualSnapshot = 0;
        }
        return res.status(out.status).json(out.body);
      }
      case 'cross':
        return res.json(await listCrossStore(staffCtx, { month, storeId }));
      case 'crossCandidates':
        return res.json(await crossStoreCandidates(staffCtx, { storeId: q.storeId, date: q.date }));
      case 'crossAdd':
      case 'crossDelete': {
        if (req.method !== 'POST') return res.status(405).json({ error: 'POST で呼び出してください' });
        const body = bodyOf(req);
        const operator = String((staffCtx && staffCtx.name) || body.operator || '管理者');
        return res.json(action === 'crossAdd'
          ? await addCrossStore(staffCtx, body, operator)
          : await deleteCrossStore(staffCtx, { id: body.id, month: body.month }, operator));
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
        // 継続管理のプラン名が都度払いのキーワード（設定）に当たるかも出す
        const { payPerVisitPattern } = planPatterns(await loadAppContext());
        const results = await probe(cfg, { from: monthRange(prev).from, to: today, payPerVisitPattern });
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
