// ============================================================
// SalonOne 分析API クライアント（読み取り専用）
// ------------------------------------------------------------
// SalonOne 管理画面 > ブランド管理 > 「API連携」で発行したアクセスキーを
// サーバー側の環境変数にだけ置き、ブラウザには出さない。
//
//   SALONONE_API_KEY        分析API アクセスキー（必須。未設定ならデモデータ）
//   SALONONE_API_BASE_URL   API のベース URL（既定: https://salonone.net）
//   SALONONE_API_ENDPOINTS  エンドポイントの上書き（JSON。下の DEFAULT_ENDPOINTS 参照）
//
// ⚠ エンドポイントのパスとクエリ名は仕様書（ログイン必須）を確認できて
//   いないため暫定値。設定画面の「接続テスト」で実レスポンスを確認し、
//   必要なら SALONONE_API_ENDPOINTS で上書きするか DEFAULT_ENDPOINTS を直す。
// ============================================================

import { extractList } from './normalize.js';

export const DEFAULT_ENDPOINTS = {
  shops: '/api/analytics/shops',
  staff: '/api/analytics/staffs',
  visitSources: '/api/analytics/visit-sources',
  // 受付（来店）明細。期間と店舗で絞り込む
  receptions: '/api/analytics/receptions',
  // 回数券・サブスク等の契約
  contracts: '/api/analytics/contracts',
  // 店舗別の継続指標（集計済みで提供されていれば使う。無ければ契約から計算）
  retention: '',
};

const DEFAULT_QUERY = { from: 'from', to: 'to', shop: 'shop_id', page: 'page', perPage: 'per_page' };
const PER_PAGE = 500;
const MAX_PAGES = 40;
const TIMEOUT_MS = 20000;

export function salonOneConfig() {
  const apiKey = (process.env.SALONONE_API_KEY || '').trim();
  const baseUrl = (process.env.SALONONE_API_BASE_URL || 'https://salonone.net').replace(/\/+$/, '');
  let endpoints = { ...DEFAULT_ENDPOINTS };
  let query = { ...DEFAULT_QUERY };
  const raw = process.env.SALONONE_API_ENDPOINTS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const { query: q, ...rest } = parsed;
        endpoints = { ...endpoints, ...rest };
        if (q && typeof q === 'object') query = { ...query, ...q };
      }
    } catch (e) {
      console.warn('[salonone] SALONONE_API_ENDPOINTS の JSON が不正です:', e.message);
    }
  }
  return { apiKey, baseUrl, endpoints, query, configured: !!apiKey };
}

export class SalonOneError extends Error {
  constructor(message, { status, endpoint, body } = {}) {
    super(message);
    this.name = 'SalonOneError';
    this.status = status;
    this.endpoint = endpoint;
    this.body = body;
  }
}

async function request(cfg, path, params = {}) {
  const url = new URL(cfg.baseUrl + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
        'X-API-Key': cfg.apiKey,
      },
      signal: controller.signal,
    });
  } catch (e) {
    throw new SalonOneError(e.name === 'AbortError' ? 'SalonOne API がタイムアウトしました' : `SalonOne API に接続できません: ${e.message}`, { endpoint: path });
  } finally {
    clearTimeout(timer);
  }
  const text = await resp.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { /* 非 JSON */ }
  if (!resp.ok) {
    const msg = (json && (json.message || json.error)) || `HTTP ${resp.status}`;
    throw new SalonOneError(`SalonOne API エラー (${path}): ${msg}`, { status: resp.status, endpoint: path, body: text.slice(0, 500) });
  }
  if (json === null) {
    throw new SalonOneError(`SalonOne API が JSON 以外を返しました (${path})`, { status: resp.status, endpoint: path, body: text.slice(0, 500) });
  }
  return json;
}

function nextPageInfo(json, page, received) {
  const meta = (json && (json.meta || json.pagination)) || {};
  const last = Number(meta.last_page || meta.lastPage || meta.total_pages || meta.totalPages || 0);
  if (last) return page < last;
  if (json && json.links && 'next' in json.links) return !!json.links.next;
  if (json && json.next_page_url !== undefined) return !!json.next_page_url;
  return received >= PER_PAGE;
}

/** ページングを辿って全件を取得する */
export async function fetchAll(cfg, path, params = {}) {
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const json = await request(cfg, path, { ...params, [cfg.query.page]: page, [cfg.query.perPage]: PER_PAGE });
    const list = extractList(json);
    out.push(...list);
    if (list.length === 0 || !nextPageInfo(json, page, list.length)) break;
  }
  return out;
}

export async function fetchShops(cfg) {
  return fetchAll(cfg, cfg.endpoints.shops);
}

export async function fetchStaff(cfg) {
  return fetchAll(cfg, cfg.endpoints.staff);
}

export async function fetchVisitSources(cfg) {
  if (!cfg.endpoints.visitSources) return [];
  return fetchAll(cfg, cfg.endpoints.visitSources);
}

export async function fetchReceptions(cfg, { from, to, shopId }) {
  return fetchAll(cfg, cfg.endpoints.receptions, { [cfg.query.from]: from, [cfg.query.to]: to, [cfg.query.shop]: shopId });
}

export async function fetchContracts(cfg, { shopId, to }) {
  return fetchAll(cfg, cfg.endpoints.contracts, { [cfg.query.shop]: shopId, [cfg.query.to]: to });
}

export async function fetchRetention(cfg, { month, shopId }) {
  if (!cfg.endpoints.retention) return [];
  return fetchAll(cfg, cfg.endpoints.retention, { month, [cfg.query.shop]: shopId });
}

/**
 * 接続テスト（設定画面用）。各エンドポイントを 1 ページだけ叩き、
 * HTTP ステータス・件数・先頭レコードのキーを返す（値は返さない）。
 */
export async function probe(cfg, { from, to }) {
  const results = [];
  for (const [name, path] of Object.entries(cfg.endpoints)) {
    if (!path) { results.push({ name, path, skipped: true }); continue; }
    const params = name === 'receptions'
      ? { [cfg.query.from]: from, [cfg.query.to]: to }
      : name === 'contracts' ? { [cfg.query.to]: to } : {};
    try {
      const json = await request(cfg, path, { ...params, [cfg.query.page]: 1, [cfg.query.perPage]: 5 });
      const list = extractList(json);
      results.push({
        name,
        path,
        ok: true,
        count: list.length,
        topLevelKeys: json && typeof json === 'object' && !Array.isArray(json) ? Object.keys(json).slice(0, 20) : [],
        sampleKeys: list[0] && typeof list[0] === 'object' ? Object.keys(list[0]).slice(0, 60) : [],
      });
    } catch (e) {
      results.push({ name, path, ok: false, status: e.status || null, error: e.message });
    }
  }
  return results;
}
