// ============================================================
// カウンセリングシート（Google フォームの回答）の読み取り
// ------------------------------------------------------------
// Google フォームでカウンセリングシートを取っている店舗だけが使う（SalonOne の問診票の店舗は不要）。
// 回答は店舗ごとの回答シートに入る。そのスプレッドシートの GAS（gas/counseling.gs）をウェブアプリとして公開し、
// ここからだけ呼ぶ。画面では SalonOne の今日の予約とお名前で結びつけ、お悩みのチェックに反映する。
// GAS の URL と合言葉はサーバーにだけ置き、ブラウザには返さない（URL を知っていれば誰でも読めるため）。
//
//   GET  /api/db?table=counseling&action=stores                見られる店舗と連携状態
//   GET  /api/db?table=counseling&action=recent&storeId=       新しい順の回答（最大 50件）
//   GET  /api/db?table=counseling&action=search&storeId=&q=    お名前で検索
//   GET  /api/db?table=counseling&action=detail&storeId=&index=&name=  1件の内容
//   GET  /api/db?table=counseling&action=settings              設定の確認（オーナー・管理者）
//   GET  /api/db?table=counseling&action=test                  接続テスト（オーナー・管理者）
//   POST /api/db?table=counseling { action:'saveSettings', gasUrl?, token?, storeMap? }（オーナー・管理者）
//
// 設定は dash_config の 'counseling.config'（一般の dashConfig からは読み書きできない）。
// 未設定なら環境変数 COUNSELING_GAS_URL / COUNSELING_GAS_TOKEN を使う。
// 見える範囲: スタッフ・店長・マネージャーは所属・管轄の店舗、オーナー・管理者は全店舗。
// 電話番号・メールアドレスは画面で使わないので返さない。
// ============================================================

import { supabase } from './supabase.js';
import { canAccessStore, isAdminOrOwner } from './auth.js';
import { GAS_STORES, guessGasStore, resolveGasStore, isNoAnswer, nameSearch } from '../../shared/counseling.js';

export const CONFIG_KEY = 'counseling.config';

const RECENT_LIMIT = 50;
const TIMEOUT_MS = 20000;
// 画面は 30秒ごとに読み直す。同じ店舗を複数の端末で開いていても GAS を呼ぶのは 20秒に 1回
const TTL_LIST = 20 * 1000;
const TTL_DETAIL = 60 * 1000;
const TTL_STORES = 30 * 60 * 1000;

export class CounselingError extends Error {
  constructor(message, code = 'gas_error') {
    super(message);
    this.name = 'CounselingError';
    this.code = code;
  }
}

// ------------------------------------------------------------
// インスタンス内キャッシュ（同じ取得が重なったら 1回にまとめる）
// ------------------------------------------------------------
const cache = new Map();
const MAX_ENTRIES = 300;

function cached(key, ttlMs, loader, refresh) {
  const hit = cache.get(key);
  if (!refresh && hit && hit.expires > Date.now()) return hit.pending;
  const pending = loader().catch((e) => {
    cache.delete(key);
    throw e;
  });
  cache.set(key, { pending, expires: Date.now() + ttlMs });
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
  return pending;
}

export function clearCounselingCache() {
  cache.clear();
}

// ------------------------------------------------------------
// 設定
// ------------------------------------------------------------
async function readSavedConfig() {
  const { data, error } = await supabase.from('dash_config').select('value').eq('key', CONFIG_KEY).maybeSingle();
  if (error) throw error;
  const v = data && data.value;
  return v && typeof v === 'object' ? v : {};
}

export async function loadCounselingConfig() {
  const saved = await readSavedConfig();
  const envUrl = String(process.env.COUNSELING_GAS_URL || '').trim();
  const gasUrl = String(saved.gasUrl || '').trim() || envUrl;
  return {
    gasUrl,
    token: String(saved.token || '').trim() || String(process.env.COUNSELING_GAS_TOKEN || '').trim(),
    storeMap: saved.storeMap && typeof saved.storeMap === 'object' ? saved.storeMap : {},
    source: saved.gasUrl ? 'settings' : envUrl ? 'env' : 'none',
    configured: !!gasUrl,
  };
}

/** 設定画面から保存できる URL（Google Apps Script のウェブアプリの /exec だけ） */
export function validateGasUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch (_) {
    return { ok: false, error: 'URL の形式が正しくありません' };
  }
  if (u.protocol !== 'https:' || u.hostname !== 'script.google.com') {
    return { ok: false, error: 'Google Apps Script のウェブアプリの URL（https://script.google.com/macros/s/…/exec）を入力してください' };
  }
  if (!/^\/(?:a\/macros\/[^/]+\/s|macros\/s)\/[A-Za-z0-9_-]{10,}\/exec$/.test(u.pathname)) {
    return { ok: false, error: 'URL の最後が /exec になっているか確認してください（デプロイ → ウェブアプリの URL）' };
  }
  return { ok: true, url: `${u.origin}${u.pathname}` };
}

/** 画面に出すときは途中を伏せる */
export function maskGasUrl(url) {
  const m = String(url || '').match(/^(https:\/\/[^/]+\/.*?\/s\/)([A-Za-z0-9_-]+)(\/exec)$/);
  if (!m) return url ? '（設定済み）' : '';
  const id = m[2];
  return `${m[1]}${id.slice(0, 6)}…${id.slice(-4)}${m[3]}`;
}

// ------------------------------------------------------------
// GAS の呼び出し
// ------------------------------------------------------------
async function callGas(cfg, params) {
  const url = new URL(cfg.gasUrl);
  url.searchParams.set('type', 'counseling');
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  if (cfg.token) url.searchParams.set('token', cfg.token);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new CounselingError(e && e.name === 'AbortError'
      ? 'Google フォームの回答の読み取りが時間切れになりました。少し待ってからもう一度お試しください'
      : 'Google フォームの回答（GAS）に接続できませんでした');
  } finally {
    clearTimeout(timer);
  }
  const text = await resp.text();
  if (!resp.ok) throw new CounselingError(`GAS がエラーを返しました（HTTP ${resp.status}）。URL が正しいか確認してください`);
  let body;
  try { body = JSON.parse(text); } catch (_) {
    throw new CounselingError('GAS の応答を読み取れませんでした。デプロイの「アクセスできるユーザー」が「全員」になっているか確認してください');
  }
  if (body && body.error) {
    const msg = String(body.error);
    if (body.code === 'unauthorized' || /^unauthorized$/i.test(msg)) {
      throw new CounselingError('GAS の合言葉が一致しません（設定 → カウンセリングフォーム の合言葉と、GAS の DASHBOARD_TOKEN を確認してください）', 'unauthorized');
    }
    throw new CounselingError(`GAS: ${msg.slice(0, 200)}`);
  }
  return body || {};
}

/** GAS 側の店舗（回答シート）。取れなければ控えの一覧 */
async function loadGasStores(cfg) {
  if (!cfg.configured) return { list: GAS_STORES, source: 'default' };
  try {
    const r = await cached(`stores|${cfg.gasUrl}|${cfg.token}`, TTL_STORES, () => callGas(cfg, { action: 'stores' }));
    const list = (Array.isArray(r.stores) ? r.stores : [])
      .map((s) => ({ key: String((s && s.id) || ''), name: String((s && s.name) || '') }))
      .filter((s) => s.key);
    return list.length ? { list, source: 'gas' } : { list: GAS_STORES, source: 'default' };
  } catch (e) {
    return { list: GAS_STORES, source: 'default', error: e.message };
  }
}

async function loadStores() {
  const { data, error } = await supabase.from('stores').select('id, name, status, merged_into').order('created_at');
  if (error) throw error;
  return (data || [])
    .filter((s) => s.status !== 'inactive' && !s.merged_into)
    .map((s) => ({ id: String(s.id), name: s.name }));
}

// ------------------------------------------------------------
// 回答の整形
// ------------------------------------------------------------
const text = (v, max = 500) => String(v == null ? '' : v).trim().slice(0, max);

function list(v, max = 40) {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,;、\n\r]+/) : [];
  return arr.map((s) => text(s, 200)).filter(Boolean).slice(0, max);
}

function isoOrNull(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function normListRow(c) {
  if (!c || typeof c !== 'object') return null;
  const index = Number(c.index);
  const name = text(c.name, 100);
  if (!Number.isInteger(index) || index < 0 || !name) return null;
  return { index, name, submittedAt: isoOrNull(c.timestamp), concerns: list(c.concerns) };
}

// フォームの同意文が「施術経験」に紛れ込むことがある（以前の画面と同じ除外）
const DISCLAIMER = /異議を申し立て|上記の内容を理解|同意します|施術をうけ|確認いたしました/;

// 美容整形 / 妊娠・特定疾患。GAS の列の名前と中身が入れ替わって届くため、以前の画面と同じく
// pregnancyCheck を「美容整形」、cosmeticSurgery を「妊娠・特定疾患」として出す。
// 回答の言葉ではっきり分かる場合はそちらを優先する。
const PREGNANCY_WORDS = /妊娠|授乳|特定疾患|産後/;
const COSMETIC_WORDS = /整形|ヒアルロン|ボトックス|美容医療|美容外科|糸リフト/;
function medicalLabel(value, fallback) {
  if (PREGNANCY_WORDS.test(value) && !COSMETIC_WORDS.test(value)) return { label: '妊娠・特定疾患', warn: true };
  if (COSMETIC_WORDS.test(value) && !PREGNANCY_WORDS.test(value)) return { label: '美容整形', warn: false };
  return fallback;
}

/** 施術の前に確認すること（「いいえ」「なし」は出さない） */
export function cautionsOf(c) {
  const out = [];
  const add = (key, value, label, warn) => {
    const v = text(value, 300);
    if (!isNoAnswer(v)) out.push({ key, label, value: v, warn });
  };
  add('surgeryHistory', c.surgeryHistory, '手術歴', true);
  add('currentTreatment', c.currentTreatment, '治療中', true);
  add('allergy', c.allergy, 'アレルギー', true);
  for (const [key, fallback] of [['pregnancyCheck', { label: '美容整形', warn: false }], ['cosmeticSurgery', { label: '妊娠・特定疾患', warn: true }]]) {
    const v = text(c[key], 300);
    if (isNoAnswer(v)) continue;
    const { label, warn } = medicalLabel(v, fallback);
    out.push({ key, label, value: v, warn });
  }
  return out;
}

// フォームによって質問の並びが違い（川口店は「改善したい時期」が無く「接客へのご要望」がある）、
// 以前の GAS は見出しで見つからない項目を本厚木店の列の位置で読むため、別の質問の回答が入ることがある。
// GAS が返す列の見出し（_debug）で確かめ、項目に合わない見出しの列から読んだ回答は出さない
// （gas/counseling.gs を更新すると正しい列から読む）。
const FIELD_HEADERS = [
  ['VISIT_PURPOSE', 'visitPurpose', /該当|きっかけ|来店|知った/],
  ['IMPROVEMENT_TIMELINE', 'improvementTimeline', /いつまで|いつ頃|時期|目標|期間/],
  ['TREATMENT_REQUEST', 'treatmentRequest', /要望|希望|リクエスト/],
  ['TREATMENT_EXPERIENCE', 'treatmentExperience', /利用|経験|受けたこと/],
];

/** GAS が読んだ列の見出しが項目に合わない回答を空にする（見出しが返らない GAS ではそのまま） */
export function dropMisreadFields(c, debug) {
  const colMap = debug && debug.colMap;
  const headers = debug && Array.isArray(debug.headers) ? debug.headers.map(String) : null;
  if (!c || !colMap || typeof colMap !== 'object' || !headers) return c;
  const headerAt = (i) => {
    const h = headers.find((x) => x.startsWith(`${i}:`));
    return h === undefined ? null : h.slice(String(i).length + 1);
  };
  const out = { ...c };
  for (const [col, field, re] of FIELD_HEADERS) {
    const i = colMap[col];
    if (!Number.isInteger(i) || i < 0) continue;
    const h = headerAt(i);
    if (h !== null && !re.test(h)) out[field] = Array.isArray(c[field]) ? [] : '';
  }
  return out;
}

export function normDetail(raw, debug) {
  const base = normListRow(raw);
  if (!base) return null;
  const c = dropMisreadFields(raw, debug);
  return {
    ...base,
    birthday: text(c.birthday, 40),
    occupation: text(c.occupation, 100),
    address: text(c.address, 100),
    visitPurpose: list(c.visitPurpose),
    improvementTimeline: text(c.improvementTimeline, 100),
    treatmentRequest: text(c.treatmentRequest),
    treatmentExperience: list(c.treatmentExperience).filter((v) => !DISCLAIMER.test(v) && v.length < 30),
    cautions: cautionsOf(c),
  };
}

// ------------------------------------------------------------
// 店舗の確認（権限 → 対応するフォームの店舗）
// ------------------------------------------------------------
async function resolveStore(cfg, staffCtx, storeId) {
  if (!cfg.configured) return { error: 'カウンセリングフォームの連携が未設定です', code: 'not_configured' };
  const id = String(storeId || '');
  if (!id) return { error: '店舗を指定してください', code: 'bad_request' };
  if (!canAccessStore(staffCtx, id)) return { error: 'この店舗のカウンセリングシートを見る権限がありません', code: 'forbidden' };
  const stores = await loadStores();
  const store = stores.find((s) => s.id === id);
  if (!store) return { error: '店舗が見つかりません', code: 'bad_request' };
  const gas = await loadGasStores(cfg);
  const gasKey = resolveGasStore(store, cfg.storeMap, gas.list);
  if (!gasKey) return { error: `${store.name}はカウンセリングフォームと対応付けられていません（設定 → カウンセリングフォーム）`, code: 'not_linked' };
  return { store, gasKey };
}

const gasFailure = (e) => {
  if (e instanceof CounselingError) return { error: e.message, code: e.code };
  throw e;
};

// ------------------------------------------------------------
// GET
// ------------------------------------------------------------
async function storesAction(cfg, staffCtx) {
  const stores = (await loadStores()).filter((s) => canAccessStore(staffCtx, s.id));
  const gas = cfg.configured ? await loadGasStores(cfg) : { list: GAS_STORES };
  return {
    configured: cfg.configured,
    canConfigure: isAdminOrOwner(staffCtx),
    stores: stores.map((s) => {
      const key = cfg.configured ? resolveGasStore(s, cfg.storeMap, gas.list) : '';
      const g = gas.list.find((x) => x.key === key);
      return { id: s.id, name: s.name, linked: !!key, formName: g ? g.name : null };
    }),
  };
}

async function listAction(cfg, staffCtx, storeId, gasParams, refresh) {
  const sc = await resolveStore(cfg, staffCtx, storeId);
  if (sc.error) return sc;
  const params = { ...gasParams, store: sc.gasKey };
  try {
    const r = await cached(`list|${cfg.gasUrl}|${JSON.stringify(params)}`, TTL_LIST, async () => ({ body: await callGas(cfg, params), at: new Date().toISOString() }), refresh);
    const customers = (Array.isArray(r.body.customers) ? r.body.customers : []).map(normListRow).filter(Boolean)
      .sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || '')));
    return { storeId: sc.store.id, customers, fetchedAt: r.at };
  } catch (e) {
    return gasFailure(e);
  }
}

async function detailAction(cfg, staffCtx, params) {
  const sc = await resolveStore(cfg, staffCtx, params.storeId);
  if (sc.error) return sc;
  const index = /^\d+$/.test(String(params.index || '')) ? Number(params.index) : null;
  const name = text(params.name, 100);
  if (index === null && !name) return { error: 'お客様を指定してください', code: 'bad_request' };
  const fetchBy = (by) => {
    const p = { action: 'detail', store: sc.gasKey, ...by };
    return cached(`detail|${cfg.gasUrl}|${JSON.stringify(p)}`, TTL_DETAIL, () => callGas(cfg, p));
  };
  try {
    let body = null;
    if (index !== null) {
      try { body = await fetchBy({ index }); } catch (e) { if (!name) throw e; }
    }
    // 回答の削除などで行がずれた時は名前で取り直す
    if (name && (!body || !body.customer || text(body.customer.name, 100) !== name)) body = await fetchBy({ name });
    const customer = body && body.customer ? normDetail(body.customer, body._debug) : null;
    if (!customer) return { error: 'カウンセリングシートが見つかりません', code: 'not_found' };
    return { storeId: sc.store.id, customer };
  } catch (e) {
    return gasFailure(e);
  }
}

async function settingsAction(cfg) {
  const stores = await loadStores();
  const gas = await loadGasStores(cfg);
  return {
    configured: cfg.configured,
    source: cfg.source,
    gasUrlMasked: maskGasUrl(cfg.gasUrl),
    tokenSet: !!cfg.token,
    storeMap: cfg.storeMap,
    gasStores: gas.list,
    gasStoresSource: gas.source,
    gasStoresError: gas.error || null,
    stores: stores.map((s) => ({ id: s.id, name: s.name, auto: guessGasStore(s.name, gas.list) })),
  };
}

/** 各店舗の回答シートが読めるか（お客様の名前は返さず、最新の回答日時だけ） */
async function testAction(cfg) {
  if (!cfg.configured) return { configured: false, ok: false, error: 'GAS の URL が未設定です' };
  const started = Date.now();
  let gasList;
  try {
    const r = await callGas(cfg, { action: 'stores' });
    gasList = (Array.isArray(r.stores) ? r.stores : []).map((s) => ({ key: String(s.id || ''), name: String(s.name || '') })).filter((s) => s.key);
  } catch (e) {
    if (e instanceof CounselingError) return { configured: true, ok: false, error: e.message };
    throw e;
  }
  const stores = await loadStores();
  const results = await Promise.all(gasList.map(async (g) => {
    const linkedStores = stores.filter((s) => resolveGasStore(s, cfg.storeMap, gasList) === g.key).map((s) => s.name);
    try {
      const r = await callGas(cfg, { action: 'recent', store: g.key, limit: 1 });
      const latest = Array.isArray(r.customers) && r.customers[0] ? isoOrNull(r.customers[0].timestamp) : null;
      return { key: g.key, name: g.name, ok: true, latestAt: latest, linkedStores };
    } catch (e) {
      if (!(e instanceof CounselingError)) throw e;
      return { key: g.key, name: g.name, ok: false, error: e.message, linkedStores };
    }
  }));
  clearCounselingCache();
  return { configured: true, ok: results.every((r) => r.ok), ms: Date.now() - started, results };
}

export async function counselingGet(params, staffCtx) {
  const action = params.action || 'stores';
  const cfg = await loadCounselingConfig();
  const refresh = params.refresh === '1' || params.refresh === 'true';
  switch (action) {
    case 'stores':
      return storesAction(cfg, staffCtx);
    case 'recent':
      return listAction(cfg, staffCtx, params.storeId, { action: 'recent', limit: RECENT_LIMIT }, refresh);
    case 'search': {
      const search = nameSearch(text(params.q, 50));
      if (!search) return { error: '検索するお名前を入力してください', code: 'bad_request' };
      const r = await listAction(cfg, staffCtx, params.storeId, { action: 'search', q: search.gasQuery }, refresh);
      return r.error ? r : { ...r, customers: r.customers.filter((c) => search.matches(c.name)) };
    }
    case 'detail':
      return detailAction(cfg, staffCtx, params);
    case 'settings':
      if (!isAdminOrOwner(staffCtx)) return { error: 'カウンセリングの設定はオーナー・管理者のみ確認できます', code: 'forbidden' };
      return settingsAction(cfg);
    case 'test':
      if (!isAdminOrOwner(staffCtx)) return { error: '接続テストはオーナー・管理者のみ利用できます', code: 'forbidden' };
      return testAction(cfg);
    default:
      return { error: '不明な action: ' + action, code: 'bad_request' };
  }
}

// ------------------------------------------------------------
// POST（設定の保存）
// ------------------------------------------------------------
export async function counselingPost(body, staffCtx) {
  const action = (body && body.action) || '';
  if (action !== 'saveSettings') return { error: '不明な action: ' + action, code: 'bad_request' };
  if (!isAdminOrOwner(staffCtx)) return { error: 'カウンセリングの設定を変更できるのはオーナー・管理者のみです', code: 'forbidden' };

  const next = { ...(await readSavedConfig()) };
  if (body.gasUrl !== undefined) {
    const raw = String(body.gasUrl || '').trim();
    if (raw) {
      const v = validateGasUrl(raw);
      if (!v.ok) return { error: v.error, code: 'bad_request' };
      next.gasUrl = v.url;
    } else {
      delete next.gasUrl; // 空にすると設定を消す（環境変数があればそちらを使う）
    }
  }
  if (body.token !== undefined) {
    const t = String(body.token || '').trim();
    if (t.length > 200) return { error: '合言葉が長すぎます（200文字まで）', code: 'bad_request' };
    if (t) next.token = t;
    else delete next.token;
  }
  if (body.storeMap !== undefined) {
    const map = {};
    for (const [k, v] of Object.entries(body.storeMap || {})) {
      const id = String(k).slice(0, 64);
      const val = String(v || '').trim().slice(0, 64);
      if (id && val && /^[A-Za-z0-9_-]+$/.test(val)) map[id] = val;
    }
    next.storeMap = map;
  }
  const { error } = await supabase.from('dash_config').upsert({ key: CONFIG_KEY, value: next }, { onConflict: 'key' });
  if (error) throw error;
  clearCounselingCache();
  return { success: true };
}
