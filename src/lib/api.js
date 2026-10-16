// ============================================================
// API クライアント
// ------------------------------------------------------------
//   dbGet / dbPost   … /api/db（Supabase。店舗・スタッフ・出納帳・目標・設定）
//   salonOne         … /api/salonone（SalonOne の実績・インセンティブ）
//   postJson         … その他の API（/api/claude/advice など）
// スタッフURLで開いている場合は X-Staff-Token / X-Staff-Id を必ず付ける。
// 管理者セッションは HttpOnly cookie なので credentials: 'same-origin'。
// ============================================================

import { currentAccess } from './access.js';

export function authHeaders() {
  if (!currentAccess) return {};
  const h = { 'X-Staff-Token': currentAccess.token };
  if (currentAccess.staffId) h['X-Staff-Id'] = currentAccess.staffId;
  return h;
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

// 401（管理者ログイン切れ・トークン失効）を画面全体に知らせる
const authListeners = new Set();
export function onAuthError(fn) {
  authListeners.add(fn);
  return () => authListeners.delete(fn);
}
function notifyAuth(body) {
  authListeners.forEach((fn) => { try { fn(body); } catch (_) { /* noop */ } });
}

async function request(url, init = {}) {
  let resp;
  try {
    resp = await fetch(url, {
      credentials: 'same-origin',
      ...init,
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...authHeaders(), ...(init.headers || {}) },
    });
  } catch (e) {
    throw new ApiError('サーバーに接続できません。通信状況を確認してください。', 0);
  }
  let body = null;
  const text = await resp.text();
  try { body = text ? JSON.parse(text) : null; } catch (_) { body = { error: text.slice(0, 200) }; }
  if (resp.status === 401) notifyAuth(body);
  if (!resp.ok) {
    throw new ApiError((body && body.error) || `通信エラー (${resp.status})`, resp.status, body);
  }
  return body;
}

/** 失敗しても例外にせず { error } を返す版（旧画面のコードと同じ使い勝手） */
async function soft(promise) {
  try {
    return await promise;
  } catch (e) {
    return { error: e.message, status: e.status };
  }
}

export function dbGet(table, params = {}) {
  const qs = new URLSearchParams({ table, ...params }).toString();
  return soft(request(`/api/db?${qs}`));
}

export function dbPost(table, body) {
  return soft(request(`/api/db?table=${encodeURIComponent(table)}`, { method: 'POST', body: JSON.stringify(body || {}) }));
}

/** SalonOne 連携 API（失敗時は ApiError を投げる） */
export function salonOne(action, params = {}) {
  const qs = new URLSearchParams({ action });
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  return request(`/api/salonone?${qs.toString()}`);
}

export function salonOnePost(action, body = {}) {
  return request(`/api/salonone?action=${encodeURIComponent(action)}`, { method: 'POST', body: JSON.stringify(body) });
}

export function postJson(url, body) {
  return request(url, { method: 'POST', body: JSON.stringify(body || {}) });
}
