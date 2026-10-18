import { supabase } from '../_lib/supabase.js';
import { cors } from '../_lib/cors.js';
import {
  extractStaffContext,
  verifyAdminSession,
  signAdminSession,
  setAdminSessionCookie,
  clearAdminSessionCookie,
  isAdminOrOwner,
  REQUIRE_ADMIN_AUTH,
} from '../_lib/auth.js';
import { signToken } from '../_lib/sign.js';
import bcrypt from 'bcryptjs';
import { staffGet, staffPost, menuItemsGet, menuItemsPost, verifyStaffPassword } from '../_lib/db-handlers-master.js';
import { cashbookGet, cashbookPost } from '../_lib/db-handlers-cashbook.js';
import { goalsGet, goalsPost } from '../_lib/db-handlers-goals.js';

// ============================================================
// 統合DBエンドポイント
// 使い方: /api/db?table=stores
// SalonOne の実績データは /api/salonone（読み取り専用）から取得する。
// ============================================================

const HANDLERS = {
  stores:     { get: storesGet,     post: storesPost },
  dashConfig: { get: dashConfigGet, post: dashConfigPost },
  staff:      { get: staffGet,      post: staffPost },
  menuItems:  { get: menuItemsGet,  post: menuItemsPost },
  cashbook:   { get: cashbookGet,   post: cashbookPost },
  goals:      { get: goalsGet,      post: goalsPost },
  // 認証（スタッフURL発行 + 管理者ログイン + スタッフパスワード照合）
  auth:       { get: authGet,       post: authPost },
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
  //   null        : token 無し（admin モード）
  //   { valid:false, reason } : token 不正 / staff 無効 → 401
  //   { valid:true, staffId, role, storeIds } : スタッフアクセス
  const staffCtx = await extractStaffContext(req);
  if (staffCtx && staffCtx.valid === false) {
    return res.status(401).json({ error: '認証エラー: ' + (staffCtx.reason || 'invalid') });
  }

  // ---- 管理者セッション判定 + REQUIRE_ADMIN_AUTH 強制 ----
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
      ? (typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}))
      : null;

    // auth テーブルのみ特殊扱い: cookie 操作のため req/res を渡す
    if (table === 'auth') {
      const result = req.method === 'GET'
        ? await authGet(params, { req, res, staffCtx, adminSession })
        : await authPost(body, { req, res, staffCtx, adminSession });
      if (res.writableEnded || res.headersSent) return;
      return res.json(result);
    }

    const result = req.method === 'GET' ? await h.get(params, staffCtx) : await h.post(body, staffCtx);
    return res.json(result);
  } catch (e) {
    console.error(`db/${table} error:`, e);
    res.status(500).json({ error: e.message });
  }
}

// ============================================================
// 店舗管理 (stores)
// ============================================================

async function storesGet(params) {
  const includeInactive = params.includeInactive === 'true' || params.includeInactive === '1';
  // includeMerged=true で別名行 (merged_into NOT NULL) も含める。
  const includeMerged = params.includeMerged === 'true' || params.includeMerged === '1';
  let query = supabase.from('stores').select('*').order('created_at');
  if (!includeInactive) query = query.eq('status', 'active');
  const { data, error } = await query;
  if (error) throw error;

  const rows = (data || []).map(r => ({
    id: r.id, name: r.name, status: r.status,
    createdAt: r.created_at, memo: r.memo || '',
    mergedInto: r.merged_into || null,
  }));
  return { stores: includeMerged ? rows : rows.filter(r => !r.mergedInto) };
}

async function storesPost(body, staffCtx) {
  if (!isAdminOrOwner(staffCtx)) {
    return { error: '店舗マスタを変更できるのは管理者・オーナーのみです' };
  }
  const action = body.action || '';
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
      const { error } = await supabase.from('stores').update(updates).eq('id', store.id);
      if (error) throw error;
      return { success: true, storeId: store.id };
    }
    case 'deleteStore':  return setStoreStatus(body.storeId, 'inactive');
    case 'restoreStore': return setStoreStatus(body.storeId, 'active');
    case 'mergeStore': {
      // duplicate を canonical へ「別名」として統合する。
      // duplicate 行は status=inactive + merged_into=canonical となり、
      // FK 参照は壊れない。今後の書き込みはサーバ側で canonical へ寄る。
      const dup = String(body.duplicateId || '').trim();
      const canonical = String(body.canonicalId || '').trim();
      if (!dup || !canonical) return { error: 'duplicateId と canonicalId が必要です' };
      if (dup === canonical) return { error: '同じIDをマージできません' };
      const { data: rows, error: selErr } = await supabase
        .from('stores').select('id, merged_into').in('id', [dup, canonical]);
      if (selErr) throw selErr;
      const map = new Map((rows || []).map(r => [String(r.id), r]));
      if (!map.has(dup) || !map.has(canonical)) {
        return { error: '指定された店舗IDが見つかりません' };
      }
      // canonical 側が既に別名なら、その先 (チェーン回避) を採用する
      const canonicalRow = map.get(canonical);
      const finalCanonical = canonicalRow.merged_into ? String(canonicalRow.merged_into) : canonical;
      if (dup === finalCanonical) return { error: '循環参照になります' };

      const { error: updErr } = await supabase
        .from('stores')
        .update({ merged_into: finalCanonical, status: 'inactive' })
        .eq('id', dup);
      if (updErr) throw updErr;
      // dup を merged_into に持つ別名行は新しい canonical へ付け替えてチェーンを 1 段に保つ
      await supabase.from('stores').update({ merged_into: finalCanonical }).eq('merged_into', dup);
      return { success: true, duplicateId: dup, canonicalId: finalCanonical };
    }
    case 'unmergeStore': {
      const id = String(body.storeId || '').trim();
      if (!id) return { error: 'storeIdが必要です' };
      const update = { merged_into: null };
      if (body.restoreActive !== false) update.status = 'active';
      const { error } = await supabase.from('stores').update(update).eq('id', id);
      if (error) throw error;
      return { success: true, storeId: id };
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
// ダッシュボード設定 (dashConfig) — KV ストア
// ------------------------------------------------------------
// 'goals.*' は目標データ（goals テーブル扱い）なので、ここからは読み書きしない。
// 書き込みは管理者・本部のみ（SalonOne 連携の対応付けなど）。
// ============================================================

const isReservedKey = (key) => String(key || '').startsWith('goals.');

async function dashConfigGet(params) {
  if (params.key) {
    if (isReservedKey(params.key)) return { error: 'このキーは goals から取得してください' };
    const { data, error } = await supabase
      .from('dash_config').select('*').eq('key', params.key).maybeSingle();
    if (error) throw error;
    return { key: params.key, value: data ? data.value : null };
  }
  const { data, error } = await supabase.from('dash_config').select('*');
  if (error) throw error;
  const config = {};
  for (const row of data || []) if (!isReservedKey(row.key)) config[row.key] = row.value;
  return { config };
}

async function dashConfigPost(body, staffCtx) {
  if (!isAdminOrOwner(staffCtx)) {
    return { error: '設定を変更できるのは管理者・オーナーのみです' };
  }
  const action = body.action || '';
  switch (action) {
    case 'set': {
      if (!body.key) return { error: 'keyが必要です' };
      if (isReservedKey(body.key)) return { error: 'このキーは goals から設定してください' };
      const { error } = await supabase.from('dash_config')
        .upsert({ key: body.key, value: body.value }, { onConflict: 'key' });
      if (error) throw error;
      return { success: true, key: body.key };
    }
    case 'setBulk': {
      const rows = Object.entries(body.entries || {})
        .filter(([k]) => !isReservedKey(k))
        .map(([k, v]) => ({ key: k, value: v }));
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
// 認証 (auth) — スタッフURL発行 + 管理者ログイン/ログアウト/セッション取得
// ============================================================
// POST /api/db?table=auth
//   action: 'issueToken'     { staffId, ttlSeconds? }  → 署名付きURLトークン（管理者のみ）
//           'login'          { password }              → HttpOnly cookie 発行
//           'logout'                                   → cookie 失効
//           'session'                                  → 現在の認証状態
//           'verifyPassword' { password }              → スタッフURLのパスワード照合
//
// GET /api/db?table=auth
//   → { requiresAuth: bool, authenticated: bool, username? }
//   スタッフURL（X-Staff-Token）のとき → { staff: { id, name, role, storeIds } }（今の DB の権限）
//   画面はトークンの中身ではなくこの値で出し分けるので、ロールを変えても URL の再発行は不要
// ============================================================

const AUTH_TOKEN_DEFAULT_TTL = 365 * 24 * 60 * 60; // 1 year

// 失敗カウンタ（in-memory）: admin パスワード総当たり対策。
const _loginFailures = new Map(); // key → { count, blockedUntil }
function loginRateLimit() {
  const now = Date.now();
  const entry = _loginFailures.get('admin');
  if (entry && entry.blockedUntil > now) {
    return { blocked: true, retryAfter: Math.ceil((entry.blockedUntil - now) / 1000) };
  }
  return { blocked: false };
}
function loginRecordFailure() {
  const now = Date.now();
  const entry = _loginFailures.get('admin') || { count: 0, blockedUntil: 0 };
  entry.count = (entry.blockedUntil > now ? entry.count : 0) + 1;
  if (entry.count >= 5) { entry.blockedUntil = now + 60 * 1000; entry.count = 0; }
  _loginFailures.set('admin', entry);
}
function loginResetFailure() { _loginFailures.delete('admin'); }

function sessionState(adminSession) {
  return {
    requiresAuth: !!REQUIRE_ADMIN_AUTH,
    authenticated: !!(adminSession && adminSession.authenticated),
    username: adminSession && adminSession.authenticated ? adminSession.username : undefined,
  };
}

async function authGet(params, { staffCtx, adminSession }) {
  if (staffCtx && staffCtx.valid) {
    return { staff: { id: staffCtx.staffId, name: staffCtx.name, role: staffCtx.role, storeIds: staffCtx.storeIds || [] } };
  }
  return sessionState(adminSession);
}

async function authPost(body, ctx) {
  const { res, staffCtx, adminSession } = ctx;
  const action = body.action || '';
  switch (action) {
    case 'issueToken': {
      if (staffCtx !== null) {
        return { error: 'このアクションは管理者のみ呼び出せます' };
      }
      if (REQUIRE_ADMIN_AUTH && (!adminSession || !adminSession.authenticated)) {
        return { error: '管理者ログインが必要です', requiresAdminLogin: true };
      }
      const staffId = body.staffId ? String(body.staffId) : '';
      if (!staffId) return { error: 'staffIdが必要です' };

      const { data: staffRow, error: staffErr } = await supabase
        .from('staff').select('id, name, role, status, password').eq('id', staffId).maybeSingle();
      if (staffErr) throw staffErr;
      if (!staffRow) return { error: 'スタッフが見つかりません' };
      if (staffRow.status === 'inactive') return { error: 'このスタッフは無効化されています' };

      const { data: ssRows, error: ssErr } = await supabase
        .from('staff_stores').select('store_id').eq('staff_id', staffId);
      if (ssErr) throw ssErr;
      const storeIds = (ssRows || []).map(r => r.store_id).filter(Boolean);

      const payload = { id: staffRow.id, n: staffRow.name, r: staffRow.role || 'staff', sid: storeIds };
      // パスワード設定済みなら pw フラグを立てる（平文はトークンに含めない）
      if (staffRow.password && String(staffRow.password).length > 0) payload.pw = 1;
      const ttl = Math.min(Number(body.ttlSeconds) || AUTH_TOKEN_DEFAULT_TTL, AUTH_TOKEN_DEFAULT_TTL);
      const token = signToken(payload, ttl);
      const expiresAt = new Date((Math.floor(Date.now() / 1000) + ttl) * 1000).toISOString();
      return { success: true, token, expiresAt, relativeUrl: `?v=${encodeURIComponent(token)}` };
    }

    case 'verifyPassword': {
      // スタッフURL + パスワード設定済みのロック解除。照合はサーバー側だけで行う。
      if (!staffCtx || staffCtx.valid === false) return { error: 'スタッフURLからのみ利用できます' };
      const result = await verifyStaffPassword(staffCtx.staffId, body.password || '');
      return result.ok ? { success: true } : { error: result.error };
    }

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
      setAdminSessionCookie(res, signAdminSession('admin'));
      return { success: true, authenticated: true, username: 'admin' };
    }

    case 'logout': {
      clearAdminSessionCookie(res);
      return { success: true, authenticated: false };
    }

    case 'session':
      return sessionState(adminSession);

    default: return { error: '不明なaction: ' + action };
  }
}
