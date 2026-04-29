import { supabase } from '../_lib/supabase.js';
import { cors } from '../_lib/cors.js';
import {
  extractStaffContext,
  verifyAdminSession,
  signAdminSession,
  setAdminSessionCookie,
  clearAdminSessionCookie,
  REQUIRE_ADMIN_AUTH,
} from '../_lib/auth.js';
import { signToken } from '../_lib/sign.js';
import bcrypt from 'bcryptjs';
import { staffGet, staffPost, menuItemsGet, menuItemsPost, hpbGet, hpbPost } from '../_lib/db-handlers-master.js';
import { cashbookGet, cashbookPost } from '../_lib/db-handlers-cashbook.js';
import {
  lineMessagesGet, lineMessagesPost, lineProfilesGet, lineProfilesPost,
  lineBroadcastsGet, lineBroadcastsPost, lineTemplatesGet, lineTemplatesPost,
  lineAutoRepliesGet, lineAutoRepliesPost, lineTagsGet, lineTagsPost,
  lineUserTagsGet, lineUserTagsPost, lineAnalyticsGet
} from '../_lib/db-handlers-line.js';
import {
  usageGet, usagePost, ticketGet, ticketPost,
  membersGet, membersPost, attendanceGet, attendancePost,
  qrTokenGet, qrTokenPost
} from '../_lib/db-handlers-misc.js';

// ============================================================
// 統合DBエンドポイント
// Vercel Hobby プランの12ファンクション上限対策として1ファイルに集約
// 使い方: /api/db?table=stores
// ============================================================

const HANDLERS = {
  stores:          { get: storesGet,         post: storesPost },
  dashConfig:      { get: dashConfigGet,     post: dashConfigPost },
  reports:         { get: reportsGet,        post: reportsPost },
  staff:           { get: staffGet,          post: staffPost },
  menuItems:       { get: menuItemsGet,      post: menuItemsPost },
  hpb:             { get: hpbGet,            post: hpbPost },
  cashbook:        { get: cashbookGet,       post: cashbookPost },
  usage:           { get: usageGet,          post: usagePost },
  ticket:          { get: ticketGet,         post: ticketPost },
  members:         { get: membersGet,        post: membersPost },
  attendance:      { get: attendanceGet,     post: attendancePost },
  qrToken:         { get: qrTokenGet,        post: qrTokenPost },
  lineMessages:    { get: lineMessagesGet,   post: lineMessagesPost },
  lineProfiles:    { get: lineProfilesGet,   post: lineProfilesPost },
  lineBroadcasts:  { get: lineBroadcastsGet, post: lineBroadcastsPost },
  lineTemplates:   { get: lineTemplatesGet,  post: lineTemplatesPost },
  lineAutoReplies: { get: lineAutoRepliesGet, post: lineAutoRepliesPost },
  lineTags:        { get: lineTagsGet,       post: lineTagsPost },
  lineUserTags:    { get: lineUserTagsGet,   post: lineUserTagsPost },
  lineAnalytics:   { get: lineAnalyticsGet,  post: async () => ({ error: 'lineAnalyticsはGET専用です' }) },
  // 認証（スタッフトークン発行 + 管理者ログイン）
  // Vercel Hobby の 12 ファンクション上限対策で /api/db に相乗り
  auth:            { get: authGet, post: authPost },
};

export default async function handler(req, res) {
  if (cors(req, res)) return;

  const table = req.query.table || '';
  const params = { ...req.query };
  delete params.table;

  const h = HANDLERS[table];
  if (!h) {
    return res.status(400).json({
      error: '不明なtable: ' + table,
      available: Object.keys(HANDLERS)
    });
  }

  // ---- スタッフ権限コンテキスト抽出 ----
  // 返り値:
  //   null        : token 無し（admin モード）→ 既存挙動と同等の全店舗許可
  //   { valid:false, reason } : token 不正 / staff 無効 → 401 で拒否
  //   { valid:true, staffId, role, storeIds } : 通常のスタッフアクセス
  const staffCtx = await extractStaffContext(req);
  if (staffCtx && staffCtx.valid === false) {
    return res.status(401).json({ error: '認証エラー: ' + (staffCtx.reason || 'invalid') });
  }

  // ---- 管理者セッション判定 + REQUIRE_ADMIN_AUTH 強制 ----
  // admin モード (staffCtx === null) かつ REQUIRE_ADMIN_AUTH=true の場合、
  // HttpOnly cookie 経由の管理者セッションを必須化する。
  // ただし auth テーブル (login/logout/session) は認証フロー自体のため例外。
  const adminSession = (staffCtx === null) ? verifyAdminSession(req) : null;
  if (staffCtx === null && REQUIRE_ADMIN_AUTH && table !== 'auth') {
    if (!adminSession || !adminSession.authenticated) {
      return res.status(401).json({
        error: '管理者ログインが必要です',
        requiresAdminLogin: true,
      });
    }
  }

  try {
    const body = req.method === 'POST'
      ? (typeof req.body === 'string' ? JSON.parse(req.body) : req.body)
      : null;

    // auth テーブルのみ特殊扱い: cookie 操作のため req/res を渡す
    if (table === 'auth') {
      const result = req.method === 'GET'
        ? await authGet(params, { req, res, staffCtx, adminSession })
        : await authPost(body, { req, res, staffCtx, adminSession });
      if (res.writableEnded || res.headersSent) return;
      return res.json(result);
    }

    // 各ハンドラには第2引数として staffCtx を渡す。
    // 第2引数を受け取らない既存ハンドラは単に無視するため後方互換。
    const result = req.method === 'GET' ? await h.get(params, staffCtx) : await h.post(body, staffCtx);
    return res.json(result);
  } catch (e) {
    console.error(`db/${table} error:`, e);
    res.status(500).json({ error: e.message });
  }
}

// ============================================================
// 店舗管理 (stores) - インラインで保持
// ============================================================

async function storesGet(params) {
  const includeInactive = params.includeInactive === 'true' || params.includeInactive === '1';
  let query = supabase.from('stores').select('*').order('created_at');
  if (!includeInactive) query = query.eq('status', 'active');
  const { data, error } = await query;
  if (error) throw error;
  return {
    stores: (data || []).map(r => ({
      id: r.id, name: r.name, status: r.status,
      createdAt: r.created_at, memo: r.memo || '',
      lat: r.lat, lng: r.lng
    }))
  };
}

async function storesPost(body, staffCtx) {
  const action = body.action || '';
  // スタッフモードでは店舗マスタ (作成/更新/削除/復元/座標変更/一括保存) を
  // 一切変更できないようにする。UI でも admin/manager/headquarter のみに
  // ボタンを出しているが、devtools 経由でも守るため server 側でも遮断する。
  // role === 'manager' / 'headquarter' はスタッフモードでも店舗管理可にしたい
  // 場合、ここを緩めればよい。現行は「role='staff' は全アクション拒否」。
  if (staffCtx !== null) {
    const role = String(staffCtx.role || '').toLowerCase();
    if (role === 'staff') {
      return { error: 'スタッフは店舗管理を変更できません' };
    }
  }
  switch (action) {
    case 'addStore': {
      const store = body.store || {};
      if (!store.id || !store.name) return { error: 'IDと店舗名が必要です' };
      const { error } = await supabase.from('stores').insert({
        id: store.id, name: store.name, status: 'active', memo: store.memo || ''
      });
      if (error) throw error;
      return { success: true, store: { id: store.id, name: store.name, status: 'active' } };
    }
    case 'updateStore': {
      const store = body.store || {};
      if (!store.id) return { error: 'storeIdが必要です' };
      const updates = {};
      if (store.name !== undefined) updates.name = store.name;
      if (store.memo !== undefined) updates.memo = store.memo;
      if (store.lat !== undefined) updates.lat = store.lat;
      if (store.lng !== undefined) updates.lng = store.lng;
      const { error } = await supabase.from('stores').update(updates).eq('id', store.id);
      if (error) throw error;
      return { success: true, storeId: store.id };
    }
    case 'updateCoordinates': {
      if (!body.storeId) return { error: 'storeIdが必要です' };
      // .select() を付けて影響行を取り、0 件なら明示エラー。
      // 付けない update は対象 0 行でも error=null が返り、UI が成功と
      // 誤認するため。設定画面で店舗を Supabase に登録していないケース
      // (Square config だけで運用されている場合) を検知する。
      const { data, error } = await supabase.from('stores')
        .update({ lat: body.lat, lng: body.lng })
        .eq('id', body.storeId)
        .select('id, lat, lng');
      if (error) throw error;
      if (!data || data.length === 0) {
        return { error: `店舗が Supabase に登録されていません (storeId=${body.storeId})。設定 → 店舗管理から先に追加してください` };
      }
      return { success: true, storeId: body.storeId, lat: data[0].lat, lng: data[0].lng };
    }
    case 'deleteStore':  return setStoreStatus(body.storeId, 'inactive');
    case 'restoreStore': return setStoreStatus(body.storeId, 'active');
    case 'saveStores': {
      const rows = (body.stores || []).map(s => ({
        id: s.id || '', name: s.name || '', status: s.status || 'active',
        created_at: s.createdAt || new Date().toISOString(), memo: s.memo || ''
      }));
      if (rows.length > 0) {
        const { error } = await supabase.from('stores').upsert(rows, { onConflict: 'id' });
        if (error) throw error;
      }
      return { success: true, count: rows.length };
    }
    default: return { error: '不明なaction: ' + action };
  }
}

async function setStoreStatus(storeId, status) {
  if (!storeId) return { error: 'storeIdが必要です' };
  const { error } = await supabase.from('stores').update({ status }).eq('id', storeId);
  if (error) throw error;
  return { success: true, storeId };
}

// ============================================================
// ダッシュボード設定 (dashConfig) - インラインで保持
// ============================================================

async function dashConfigGet(params) {
  if (params.key) {
    const { data, error } = await supabase
      .from('dash_config').select('*').eq('key', params.key).maybeSingle();
    if (error) throw error;
    return { key: params.key, value: data ? data.value : null };
  }
  const { data, error } = await supabase.from('dash_config').select('*');
  if (error) throw error;
  const config = {};
  for (const row of data || []) config[row.key] = row.value;
  return { config };
}

async function dashConfigPost(body) {
  const action = body.action || '';
  switch (action) {
    case 'set': {
      if (!body.key) return { error: 'keyが必要です' };
      const { error } = await supabase.from('dash_config')
        .upsert({ key: body.key, value: body.value }, { onConflict: 'key' });
      if (error) throw error;
      return { success: true, key: body.key };
    }
    case 'setBulk': {
      const rows = Object.entries(body.entries || {}).map(([k, v]) => ({ key: k, value: v }));
      if (rows.length > 0) {
        const { error } = await supabase.from('dash_config').upsert(rows, { onConflict: 'key' });
        if (error) throw error;
      }
      return { success: true, count: rows.length };
    }
    default: return { error: '不明なaction: ' + action };
  }
}

// ============================================================
// 日報 (reports) - インラインで保持
// ============================================================

async function reportsGet(params) {
  let query = supabase.from('daily_reports').select('*')
    .order('timestamp', { ascending: false });

  if (params.all === 'true') {
    // 全データ
  } else if (params.month) {
    const [y, m] = params.month.split('-').map(Number);
    query = query.gte('timestamp', new Date(y, m - 1, 1).toISOString())
                 .lte('timestamp', new Date(y, m, 0, 23, 59, 59).toISOString());
  } else if (params.months) {
    const n = parseInt(params.months) || 1;
    const now = new Date();
    query = query.gte('timestamp', new Date(now.getFullYear(), now.getMonth() - (n - 1), 1).toISOString());
  } else {
    const now = new Date();
    query = query.gte('timestamp', new Date(now.getFullYear(), now.getMonth(), 1).toISOString());
  }

  const { data, error } = await query;
  if (error) throw error;

  return {
    reports: (data || []).map(r => ({
      id: r.id, timestamp: r.timestamp, store: r.store,
      hpbNew: r.hpb_new, metaNew: r.meta_new,
      referralNew: r.referral_new, discountNew: r.discount_new,
      hpbContract: r.hpb_contract, metaContract: r.meta_contract,
      referralContract: r.referral_contract, discountContract: r.discount_contract,
      existingTreatments: r.existing_treatments,
      taskComplete: r.task_complete, prepComplete: r.prep_complete
    })),
    total: (data || []).length,
    lastUpdated: new Date().toISOString()
  };
}

async function reportsPost(body) {
  const action = body.action || 'create';
  switch (action) {
    case 'create': {
      const r = body.report || body;
      if (!r.store) return { error: '店舗が必要です' };
      const row = {
        timestamp: r.timestamp || new Date().toISOString(), store: r.store,
        hpb_new: parseInt(r.hpbNew) || 0, meta_new: parseInt(r.metaNew) || 0,
        referral_new: parseInt(r.referralNew) || 0, discount_new: parseInt(r.discountNew) || 0,
        hpb_contract: parseInt(r.hpbContract) || 0, meta_contract: parseInt(r.metaContract) || 0,
        referral_contract: parseInt(r.referralContract) || 0, discount_contract: parseInt(r.discountContract) || 0,
        existing_treatments: parseInt(r.existingTreatments) || 0,
        task_complete: !!r.taskComplete, prep_complete: !!r.prepComplete
      };
      const { data, error } = await supabase.from('daily_reports').insert(row).select().single();
      if (error) throw error;
      return { success: true, report: data };
    }
    case 'update': {
      const r = body.report || body;
      if (!r.id) return { error: 'idが必要です' };
      const updates = {};
      if (r.store !== undefined) updates.store = r.store;
      if (r.hpbNew !== undefined) updates.hpb_new = parseInt(r.hpbNew) || 0;
      if (r.metaNew !== undefined) updates.meta_new = parseInt(r.metaNew) || 0;
      if (r.referralNew !== undefined) updates.referral_new = parseInt(r.referralNew) || 0;
      if (r.discountNew !== undefined) updates.discount_new = parseInt(r.discountNew) || 0;
      if (r.hpbContract !== undefined) updates.hpb_contract = parseInt(r.hpbContract) || 0;
      if (r.metaContract !== undefined) updates.meta_contract = parseInt(r.metaContract) || 0;
      if (r.referralContract !== undefined) updates.referral_contract = parseInt(r.referralContract) || 0;
      if (r.discountContract !== undefined) updates.discount_contract = parseInt(r.discountContract) || 0;
      if (r.existingTreatments !== undefined) updates.existing_treatments = parseInt(r.existingTreatments) || 0;
      if (r.taskComplete !== undefined) updates.task_complete = !!r.taskComplete;
      if (r.prepComplete !== undefined) updates.prep_complete = !!r.prepComplete;
      const { error } = await supabase.from('daily_reports').update(updates).eq('id', r.id);
      if (error) throw error;
      return { success: true, id: r.id };
    }
    case 'delete': {
      if (!body.id) return { error: 'idが必要です' };
      const { error } = await supabase.from('daily_reports').delete().eq('id', body.id);
      if (error) throw error;
      return { success: true, id: body.id };
    }
    case 'saveAll': {
      const reports = body.reports || [];
      const rows = reports.map(r => ({
        timestamp: r.timestamp || new Date().toISOString(),
        store: r.store || '',
        hpb_new: parseInt(r.hpbNew) || 0,
        meta_new: parseInt(r.metaNew) || 0,
        referral_new: parseInt(r.referralNew) || 0,
        discount_new: parseInt(r.discountNew) || 0,
        hpb_contract: parseInt(r.hpbContract) || 0,
        meta_contract: parseInt(r.metaContract) || 0,
        referral_contract: parseInt(r.referralContract) || 0,
        discount_contract: parseInt(r.discountContract) || 0,
        existing_treatments: parseInt(r.existingTreatments) || 0,
        task_complete: !!r.taskComplete,
        prep_complete: !!r.prepComplete
      }));
      if (body.replace) {
        await supabase.from('daily_reports').delete().neq('id', 0);
      }
      if (rows.length > 0) {
        const { error } = await supabase.from('daily_reports').insert(rows);
        if (error) throw error;
      }
      return { success: true, count: rows.length };
    }
    default: return { error: '不明なaction: ' + action };
  }
}

// ============================================================
// 認証 (auth) — スタッフURL発行 + 管理者ログイン/ログアウト/セッション取得
// ============================================================
// POST /api/db?table=auth
//   action: 'issueToken'  { staffId, ttlSeconds? }  → 署名付きURLトークン
//           'login'       { password }              → HttpOnly cookie 発行
//           'logout'                                → cookie 失効
//           'session'                               → (GET 相当) 現在の認証状態
//           'changePassword' { currentPassword, newPassword } → 将来用
//
// GET /api/db?table=auth
//   → { requiresAuth: bool, authenticated: bool, username? }
//
// 独立エンドポイントにせずここに相乗りしているのは Vercel Hobby の
// 12 ファンクション上限対策。
// ============================================================

const AUTH_TOKEN_DEFAULT_TTL = 365 * 24 * 60 * 60; // 1 year

// 失敗カウンタ（in-memory）: admin パスワード総当たり対策。
// serverless インスタンス毎なので完全ではないが、UX 品質レベルのガード。
// key = 'admin' 固定（将来ユーザー多様化時に拡張）
const _loginFailures = new Map(); // key → { count, blockedUntil }
function loginRateLimit() {
  const key = 'admin';
  const now = Date.now();
  const entry = _loginFailures.get(key);
  if (entry && entry.blockedUntil > now) {
    return { blocked: true, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
  }
  return { blocked: false };
}
function loginRecordFailure() {
  const key = 'admin';
  const now = Date.now();
  const entry = _loginFailures.get(key) || { count: 0, blockedUntil: 0 };
  entry.count = (entry.blockedUntil > now ? entry.count : 0) + 1;
  if (entry.count >= 5) { entry.blockedUntil = now + 60 * 1000; entry.count = 0; }
  _loginFailures.set(key, entry);
}
function loginResetFailure() { _loginFailures.delete('admin'); }

async function authGet(params, { adminSession }) {
  // セッション状態を返す。クライアントが boot 時に叩いて
  // ログイン画面を出すべきかを判定する。
  return {
    requiresAuth: !!REQUIRE_ADMIN_AUTH,
    authenticated: !!(adminSession && adminSession.authenticated),
    username: adminSession && adminSession.authenticated ? adminSession.username : undefined,
  };
}

async function authPost(body, ctx) {
  const { req, res, staffCtx, adminSession } = ctx;
  const action = body.action || '';
  switch (action) {
    // ------------------------------------------------------------
    // スタッフURL発行（既存機能）
    // ------------------------------------------------------------
    case 'issueToken': {
      // 管理者モード必須
      if (staffCtx !== null) {
        return { error: 'このアクションは管理者のみ呼び出せます' };
      }
      // REQUIRE_ADMIN_AUTH=true の場合はセッションも必須
      // （router で一般ケースは弾いているが、防御的に再チェック）
      if (REQUIRE_ADMIN_AUTH && (!adminSession || !adminSession.authenticated)) {
        return { error: '管理者ログインが必要です', requiresAdminLogin: true };
      }
      const staffId = body.staffId ? String(body.staffId) : '';
      if (!staffId) return { error: 'staffIdが必要です' };

      const { data: staffRow, error: staffErr } = await supabase
        .from('staff').select('id, name, role, status').eq('id', staffId).maybeSingle();
      if (staffErr) throw staffErr;
      if (!staffRow) return { error: 'スタッフが見つかりません' };
      if (staffRow.status === 'inactive') return { error: 'このスタッフは無効化されています' };

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
      const ttl = Math.min(Number(body.ttlSeconds) || AUTH_TOKEN_DEFAULT_TTL, AUTH_TOKEN_DEFAULT_TTL);
      const token = signToken(payload, ttl);
      const expiresAt = new Date((Math.floor(Date.now() / 1000) + ttl) * 1000).toISOString();

      return {
        success: true,
        token,
        expiresAt,
        relativeUrl: `?v=${encodeURIComponent(token)}`,
      };
    }

    // ------------------------------------------------------------
    // 管理者ログイン: bcrypt + env var 照合 → HttpOnly cookie 発行
    // ------------------------------------------------------------
    case 'login': {
      const hash = process.env.SISE_ADMIN_PASSWORD_HASH || '';
      if (!hash) {
        return { error: '管理者パスワードが未設定です（環境変数 SISE_ADMIN_PASSWORD_HASH を設定してください）' };
      }
      const rl = loginRateLimit();
      if (rl.blocked) {
        return { error: `試行回数の上限を超えました。${rl.retryAfter}秒後に再試行してください` };
      }
      const password = body.password || '';
      if (!password || typeof password !== 'string') {
        loginRecordFailure();
        return { error: 'パスワードを入力してください' };
      }
      let ok = false;
      try { ok = await bcrypt.compare(password, hash); }
      catch (e) { console.error('[auth/login] bcrypt error:', e); }
      if (!ok) {
        loginRecordFailure();
        return { error: 'パスワードが正しくありません' };
      }
      loginResetFailure();
      const token = signAdminSession('admin');
      setAdminSessionCookie(res, token);
      return { success: true, authenticated: true, username: 'admin' };
    }

    // ------------------------------------------------------------
    // 管理者ログアウト: cookie 失効
    // ------------------------------------------------------------
    case 'logout': {
      clearAdminSessionCookie(res);
      return { success: true, authenticated: false };
    }

    // ------------------------------------------------------------
    // セッション状態確認（GET と同じ）
    // ------------------------------------------------------------
    case 'session': {
      return {
        requiresAuth: !!REQUIRE_ADMIN_AUTH,
        authenticated: !!(adminSession && adminSession.authenticated),
        username: adminSession && adminSession.authenticated ? adminSession.username : undefined,
      };
    }

    default: return { error: '不明なaction: ' + action };
  }
}
