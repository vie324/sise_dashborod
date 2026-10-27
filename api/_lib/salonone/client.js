// ============================================================
// SalonOne 分析API クライアント（読み取り専用）
// ------------------------------------------------------------
// 仕様: https://salonone.net/api-docs （サロンワンにログインして閲覧）
//   ベースURL  https://salonone.net/api/analytics/v1
//   認証       ヘッダ X-SalonOne-Api-Key: <キー>（ブランド管理 >「API連携」で発行）
//   制限       1分 60回 / 1日 20,000回 / 1回の取得 200件（最大 1,000件）
//   明細の続き  meta.has_more と meta.next_cursor（cursor パラメータ）
//   エラー     { "error": { "code": "unauthorized", "error_id": "..." } }
//
// キーはサーバーの環境変数にだけ置き、ブラウザには出さない。
//   SALONONE_API_KEY        アクセスキー（必須。未設定ならデモデータ）
//   SALONONE_API_BASE_URL   ベースURL の上書き（通常は不要）
//   SALONONE_API_ENDPOINTS  エンドポイントのパスの上書き（JSON。通常は不要）
//   SALONONE_RATE_LIMIT_PER_MINUTE  1分あたりの呼び出しの上限（既定 55。SalonOne でキーの上限を
//                                   上げてもらった場合だけ、その値より少し小さい値に変える）
// ============================================================

import { extractList, retentionCounts, normalizeStatus, normalizeCustomerClass, cashPortion } from './normalize.js';

export const DEFAULT_BASE_URL = 'https://salonone.net/api/analytics/v1';

export const DEFAULT_ENDPOINTS = {
  meta: '/meta',
  shops: '/shops',
  staff: '/staffs',
  visitSources: '/visit-sources',
  // 売上サマリ（管理画面の「売上分析」と同じ計算。店舗を指定すると日別・スタッフ別も返る）
  salesSummary: '/sales/summary',
  // 受付履歴の明細（予約 1件 1行。会計金額・消化額・支払方法・担当・媒体・区分・購入プラン）
  receptions: '/marketing/reception-history',
  // 継続管理（回数券・サブスク・プリペイドを持つ顧客の状態。取得時点の値）
  retentionSummary: '/marketing/retention-summary',
  retentionCustomers: '/marketing/retention-customers',
};

const RECORD_LIMIT = 1000;
const MAX_PAGES = 50;
const TIMEOUT_MS = 25000;

/** 「https://salonone.net」だけが設定されていても分析API のパスを補う */
function resolveBaseUrl(raw) {
  const base = String(raw || '').trim().replace(/\/+$/, '');
  if (!base) return DEFAULT_BASE_URL;
  try {
    const u = new URL(base);
    if (u.pathname === '' || u.pathname === '/') return `${u.origin}/api/analytics/v1`;
  } catch (_) { /* そのまま使う */ }
  return base;
}

export function salonOneConfig() {
  const apiKey = (process.env.SALONONE_API_KEY || '').trim();
  const baseUrl = resolveBaseUrl(process.env.SALONONE_API_BASE_URL);
  let endpoints = { ...DEFAULT_ENDPOINTS };
  const raw = process.env.SALONONE_API_ENDPOINTS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) if (k in DEFAULT_ENDPOINTS && typeof v === 'string') endpoints[k] = v;
      }
    } catch (e) {
      console.warn('[salonone] SALONONE_API_ENDPOINTS の JSON が不正です:', e.message);
    }
  }
  return { apiKey, baseUrl, endpoints, configured: !!apiKey };
}

// 分析API のエラーコード → 画面に出す説明
const ERROR_MESSAGES = {
  unauthorized: 'APIキーが無効です（入力ミス・失効・期限切れ）。SalonOne で発行したキーと Vercel の SALONONE_API_KEY を確認してください',
  user_auth_required: 'このキーは「サロンワンのログインを必須にする」で発行されています。オフにしたキーを発行し直してください',
  invalid_token: 'ログインの有効期限が切れています',
  forbidden: 'このキーでは取得できない範囲です（他ブランドの店舗・閲覧権限のない機能）',
  shop_forbidden: 'アクセス権のない店舗を指定しました',
  feature_disabled: 'ブランドでこの機能が無効になっています（SalonOne の機能設定を確認してください）',
  invalid_request: 'パラメータが正しくありません',
  rate_limited: 'SalonOne API の利用上限（1分 60回）に達しました。1分ほど待ってから更新してください',
  exchange_rate_not_set: '外貨の店舗の為替レートが未登録です（SalonOne の為替レート設定で登録してください）',
  method_not_allowed: '許可されていない呼び出し方です',
  not_found: 'API の URL が見つかりません（SALONONE_API_BASE_URL・SALONONE_API_ENDPOINTS を設定している場合は外してください）',
  internal_error: 'SalonOne 側でエラーが発生しました',
};
// error.code が無い応答（ルートが無い 404 など）は HTTP ステータスから判断する
const STATUS_CODES = { 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 405: 'method_not_allowed', 429: 'rate_limited' };

export class SalonOneError extends Error {
  constructor(message, { status, endpoint, code, errorId, fields, body } = {}) {
    super(message);
    this.name = 'SalonOneError';
    this.status = status;
    this.endpoint = endpoint;
    this.code = code;
    this.errorId = errorId;
    this.fields = fields;
    this.body = body;
  }
}

// ------------------------------------------------------------
// 呼び出し回数の調整（1分 60回の制限に当たらないように）
// ------------------------------------------------------------
// 同時に投げるのは 4本まで。直近 1分の呼び出しが上限（既定 55回）に達したら、空くまで待つ。
// 20秒以上待つことになる場合は待たずに「上限」として返す（関数の実行時間切れを避ける）。
// サーバーレスのインスタンスごとの目安で、別インスタンスとは共有しない。
const MAX_CONCURRENCY = 4;
const perMinute = () => Math.max(1, Math.floor(Number(process.env.SALONONE_RATE_LIMIT_PER_MINUTE)) || 55);
const MAX_WAIT_MS = 20000;
let active = 0;
const waiting = [];
const recent = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function acquire(path) {
  if (active >= MAX_CONCURRENCY) await new Promise((r) => waiting.push(r));
  active += 1;
  const started = Date.now();
  for (;;) {
    const now = Date.now();
    while (recent.length && now - recent[0] > 60000) recent.shift();
    if (recent.length < perMinute()) { recent.push(now); return; }
    const wait = 60000 - (now - recent[0]) + 50;
    if (now - started + wait > MAX_WAIT_MS) {
      release();
      throw new SalonOneError(`SalonOne API エラー (${path}): ${ERROR_MESSAGES.rate_limited}`, { status: 429, endpoint: path, code: 'rate_limited' });
    }
    await sleep(Math.min(5000, wait));
  }
}

function release() {
  active -= 1;
  const next = waiting.shift();
  if (next) next();
}

async function request(cfg, path, params = {}, { retried = false } = {}) {
  const url = new URL(cfg.baseUrl + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  await acquire(path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let resp;
  let text = '';
  try {
    resp = await fetch(url, {
      headers: { Accept: 'application/json', 'X-SalonOne-Api-Key': cfg.apiKey },
      signal: controller.signal,
    });
    text = await resp.text();
  } catch (e) {
    throw new SalonOneError(e.name === 'AbortError' ? `SalonOne API がタイムアウトしました (${path})` : `SalonOne API に接続できません (${path}): ${e.message}`, { endpoint: path });
  } finally {
    clearTimeout(timer);
    release();
  }
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { /* 非 JSON */ }

  if (!resp.ok) {
    const err = json && typeof json.error === 'object' && json.error ? json.error : {};
    const code = err.code || STATUS_CODES[resp.status] || (resp.status >= 500 ? 'internal_error' : '');
    // 上限に当たった時は 1回だけ待って取り直す
    if (resp.status === 429 && !retried) {
      const after = Number(resp.headers.get('retry-after'));
      await sleep(Math.min(10000, Number.isFinite(after) && after > 0 ? after * 1000 : 3000));
      return request(cfg, path, params, { retried: true });
    }
    const fields = Array.isArray(err.fields) ? err.fields : null;
    const upstream = json && typeof json.message === 'string' ? json.message : (json && typeof json.error === 'string' ? json.error : '');
    const base = ERROR_MESSAGES[code] || upstream || `HTTP ${resp.status}`;
    const detail = [
      fields ? `項目: ${fields.join(', ')}` : '',
      !err.code && upstream && ERROR_MESSAGES[code] ? upstream : '',
      err.error_id ? `error_id: ${err.error_id}` : '',
    ].filter(Boolean).join(' / ');
    throw new SalonOneError(`SalonOne API エラー (${path}): ${base}${detail ? `（${detail}）` : ''}`, {
      status: resp.status, endpoint: path, code, errorId: err.error_id, fields, body: text.slice(0, 500),
    });
  }
  if (json === null) {
    throw new SalonOneError(`SalonOne API が JSON 以外を返しました (${path})`, { status: resp.status, endpoint: path, body: text.slice(0, 500) });
  }
  return json;
}

const nextCursor = (json) => {
  const meta = json && json.meta;
  if (!meta || !meta.has_more) return null;
  return meta.next_cursor || null;
};

/** 明細（/shops・/staffs など）を cursor で最後まで取得する */
export async function fetchRecords(cfg, path, params = {}) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const json = await request(cfg, path, { ...params, limit: RECORD_LIMIT, cursor: cursor || undefined });
    out.push(...extractList(json));
    cursor = nextCursor(json);
    if (!cursor) break;
  }
  return out;
}

// limit を受け付けないマーケ集計のパス（invalid_request で fields に limit が返ったもの）
const noLimitPaths = new Set();
const rejectsLimit = (e) => e && e.code === 'invalid_request' && Array.isArray(e.fields) && e.fields.includes('limit');

/** マーケ集計の一覧。続きがあれば cursor で辿る（limit を受け付けなければ外して取り直す） */
export async function fetchList(cfg, path, params = {}) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const withLimit = !noLimitPaths.has(path);
    let json;
    try {
      json = await request(cfg, path, { ...params, limit: withLimit ? RECORD_LIMIT : undefined, cursor: cursor || undefined });
    } catch (e) {
      if (!withLimit || !rejectsLimit(e)) throw e;
      noLimitPaths.add(path);
      json = await request(cfg, path, { ...params, cursor: cursor || undefined });
    }
    out.push(...extractList(json));
    cursor = nextCursor(json);
    if (!cursor) break;
  }
  return out;
}

/** 1件のオブジェクトを返すエンドポイント（data の中身） */
export async function fetchObject(cfg, path, params = {}) {
  const json = await request(cfg, path, params);
  return json && typeof json === 'object' && json.data && typeof json.data === 'object' ? json.data : json;
}

export const fetchShops = (cfg) => fetchRecords(cfg, cfg.endpoints.shops);
export const fetchStaff = (cfg) => fetchRecords(cfg, cfg.endpoints.staff);
export const fetchVisitSources = (cfg) => fetchRecords(cfg, cfg.endpoints.visitSources);

/** 売上サマリ（店舗ごと。by_day・by_staff を含む） */
export function fetchSalesSummary(cfg, { from, to, shopId }) {
  return fetchObject(cfg, cfg.endpoints.salesSummary, { from, to, shop_id: shopId });
}

/** 受付履歴の明細（店舗ごと・期間は店舗の暦日） */
export function fetchReceptions(cfg, { from, to, shopId }) {
  return fetchList(cfg, cfg.endpoints.receptions, { from, to, shop_id: shopId });
}

/** 継続管理のサマリー（サブスクのみ。状態は取得時点） */
export function fetchRetentionSummary(cfg, { from, to, shopId }) {
  return fetchObject(cfg, cfg.endpoints.retentionSummary, { from, to, shop_id: shopId, plan_kind: 'subscription' });
}

/** 継続管理の顧客一覧（サブスクのみ。支払日が期間内の顧客） */
export function fetchRetentionCustomers(cfg, { from, to, shopId }) {
  return fetchList(cfg, cfg.endpoints.retentionCustomers, { from, to, shop_id: shopId, plan_kind: 'subscription' });
}

// ------------------------------------------------------------
// 接続テスト（設定画面用）
// ------------------------------------------------------------
const PROBE_LABELS = {
  meta: 'キーの情報',
  shops: '店舗',
  staff: 'スタッフ',
  visitSources: '来店経由（媒体）',
  salesSummary: '売上サマリ（売上分析）',
  receptions: '受付履歴の明細',
  retentionSummary: '継続管理のサマリー',
  retentionCustomers: '継続管理の顧客一覧',
};

const keysOf = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o).slice(0, 60) : []);

/** レコードの中の配列・オブジェクト項目のキー（plans・payment_splits など）。空の配列が多いので先頭 50件から探す */
function nestedKeys(records) {
  const out = {};
  for (const record of records.slice(0, 50)) {
    if (!record || typeof record !== 'object') continue;
    for (const [k, v] of Object.entries(record)) {
      if (out[k]) continue;
      if (Array.isArray(v) && v[0] && typeof v[0] === 'object') out[k] = keysOf(v[0]);
      else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = keysOf(v);
    }
  }
  return out;
}

/** キーの情報から、画面に出してよい短い値だけ（キーやトークンらしいものは出さない） */
function safeInfo(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (/key|token|secret|password/i.test(k)) continue;
    if (['string', 'number', 'boolean'].includes(typeof v) && String(v).length <= 80) out[k] = v;
  }
  return out;
}

/**
 * 受付履歴に出てくる値の種類と、ダッシュボードでの扱い（状態・区分・プラン種別・決済方法。顧客の情報は含まない）。
 * 集計の前提（どの状態を会計完了として数えるか・どの決済を現金とするか）が実際のデータと合っているかを確かめる用。
 */
function receptionValues(list) {
  const distinct = (fn) => [...new Set(list.flatMap((r) => [].concat(fn(r) ?? []).filter((v) => v != null && v !== '').map(String)))].slice(0, 20);
  const STATUS_LABEL = { completed: '会計完了（集計する）', reserved: '予約', checked_in: '来店中', cancelled: 'キャンセル', no_show: '無断キャンセル' };
  const CLASS_LABEL = { new: '新規（初回の判定に使う）', repeat: '継続', existing: '既存' };
  return {
    status: distinct((r) => r.status).map((v) => ({ value: v, as: STATUS_LABEL[normalizeStatus(v)] || '不明（集計しない）' })),
    cancelType: distinct((r) => r.cancel_type).map((v) => ({ value: v, as: v === 'no_show' ? '無断キャンセル' : 'キャンセル' })),
    classification: distinct((r) => r.classification).map((v) => ({ value: v, as: CLASS_LABEL[normalizeCustomerClass({ classification: v })] })),
    planKind: distinct((r) => (Array.isArray(r.plans) ? r.plans.map((p) => p && p.plan_kind) : [])).map((v) => ({
      value: v, as: v === 'subscription' ? 'サブスク（契約）' : v === 'ticket' ? '回数券（契約）' : '契約に数えない',
    })),
    paymentMethod: distinct((r) => [r.payment_method_name, ...(Array.isArray(r.payment_splits) ? r.payment_splits.map((sp) => sp && sp.payment_method_name) : [])])
      .map((v) => ({
        value: v,
        // 「現金 / クレジットカード」のような分割決済は、内訳（payment_splits）の現金の分だけを数える
        as: /[/／・、,，+＋]/.test(v) && /現金|cash/i.test(v) ? '分割決済（内訳の現金の分だけ）' : cashPortion({ payment_method_name: v }, 1) === 1 ? '現金' : '現金以外',
      })),
  };
}

/**
 * 各エンドポイントを 1回ずつ呼び、HTTP ステータス・件数・項目名を返す（値は返さない）。
 * 受付履歴・継続管理は店舗の指定が必須なので、店舗一覧の先頭の店舗で試す。
 */
export async function probe(cfg, { from, to }) {
  const results = [];
  const step = async (name, run) => {
    const path = cfg.endpoints[name];
    try {
      const r = await run(path);
      results.push({ name, label: PROBE_LABELS[name], path, ok: true, ...r });
      return r;
    } catch (e) {
      results.push({ name, label: PROBE_LABELS[name], path, ok: false, status: e.status || null, code: e.code || null, error: e.message });
      return null;
    }
  };
  const listResult = (list, json) => ({
    count: list.length,
    more: !!(json && json.meta && json.meta.has_more),
    topLevelKeys: keysOf(json),
    sampleKeys: keysOf(list[0]),
    nested: nestedKeys(list),
  });

  await step('meta', async (path) => {
    const json = await request(cfg, path);
    const data = json && json.data && typeof json.data === 'object' ? json.data : json;
    return { count: 1, topLevelKeys: keysOf(json), sampleKeys: keysOf(data), info: safeInfo(data) };
  });
  const shops = await step('shops', async (path) => {
    const json = await request(cfg, path, { limit: 5 });
    const list = extractList(json);
    return { ...listResult(list, json), firstId: list[0] ? list[0].id ?? list[0].shop_id : null };
  });
  await step('staff', async (path) => {
    const json = await request(cfg, path, { limit: 5 });
    return listResult(extractList(json), json);
  });
  await step('visitSources', async (path) => {
    const json = await request(cfg, path, { limit: 5 });
    return listResult(extractList(json), json);
  });
  const shopId = shops && shops.firstId != null ? shops.firstId : null;
  if (shopId == null) return results;
  await step('salesSummary', async (path) => {
    const json = await request(cfg, path, { from, to, shop_id: shopId });
    const data = json && json.data && typeof json.data === 'object' ? json.data : json;
    // by_day・by_staff は先頭の行の項目名を出す（スタッフ別に購入数などがあるかの確認用）
    const nested = nestedKeys([data]);
    for (const k of ['by_day', 'by_staff']) if (Array.isArray(data && data[k])) nested[k] = keysOf(data[k][0]);
    return { count: 1, topLevelKeys: keysOf(json), sampleKeys: keysOf(data), nested, shopId };
  });
  await step('receptions', async (path) => {
    const json = await request(cfg, path, { from, to, shop_id: shopId });
    const list = extractList(json);
    return { ...listResult(list, json), shopId, values: receptionValues(list) };
  });
  await step('retentionSummary', async (path) => {
    const json = await request(cfg, path, { from, to, shop_id: shopId, plan_kind: 'subscription' });
    const data = json && json.data && typeof json.data === 'object' ? json.data : json;
    // 人数（集計値。顧客の情報ではない）は SalonOne の継続管理の画面と見比べられるように出す
    return { count: 1, topLevelKeys: keysOf(json), sampleKeys: keysOf(data), nested: nestedKeys([data]), shopId, counts: retentionCounts(data) };
  });
  await step('retentionCustomers', async (path) => {
    const json = await request(cfg, path, { from, to, shop_id: shopId, plan_kind: 'subscription' });
    return { ...listResult(extractList(json), json), shopId };
  });
  return results;
}
