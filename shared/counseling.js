// ============================================================
// カウンセリング（新規のお客様）— サーバー / ブラウザ共通
// ------------------------------------------------------------
// お悩みと施術後のお身体の状態から 3つのプランを提案し、料金（1回あたり・おトク額）を計算する。
// お客様は SalonOne の当日の予約から選ぶ（api/_lib/salonone/visits.js）。
// Google フォームでカウンセリングシートを取っている店舗は、その回答（GAS 経由。api/_lib/counseling.js）から
// お悩みのチェックを入れ、予約とはお名前で結びつける。
// 項目・判定・金額は以前のダッシュボードの「カウンセリング」画面と同じ。
// 金額を変える場合は下の料金表（PLAN_CARDS）を更新する（スタッフの画面とお客様向けのご説明がまとめて切り替わる）。
// 説明の文言（コンセプト・会員のポイント・本日の特典）は src/features/care/counseling/content.jsx。
// ============================================================

import { addDays, toJstDate } from './dates.js';

// ------------------------------------------------------------
// お悩み箇所（formLabels: Google フォームの選択肢の言葉 → このチェック項目）
// ------------------------------------------------------------
export const CONCERN_CATEGORIES = [
  { key: 'face', label: '小顔', course: '小顔矯正', area: '顔・頭' },
  { key: 'posture', label: '姿勢', course: '姿勢矯正', area: '首・肩・背中' },
  { key: 'pelvis', label: '骨盤', course: '骨盤矯正', area: '腰・下半身' },
];

export const CONCERN_ITEMS = [
  { id: 'c1', label: '頭・はちの張り', cat: 'face', formLabels: ['頭・はちの張り', '頭の張り', 'はちの張り'] },
  { id: 'c2', label: '眼精疲労', cat: 'face', formLabels: ['眼精疲労'] },
  { id: 'c3', label: '頬のたるみ', cat: 'face', formLabels: ['頬のたるみ', '頬たるみ'] },
  { id: 'c4', label: '食いしばり・エラの張り', cat: 'face', formLabels: ['食いしばり', 'エラの張り', '食いしばり・エラの張り'] },
  { id: 'c5', label: '顔の左右差', cat: 'face', formLabels: ['顔の左右差'] },
  { id: 'c6', label: '首・ストレートネック', cat: 'posture', formLabels: ['ストレートネック', '首・ストレートネック', '首の痛み'] },
  { id: 'c7', label: '肩こり', cat: 'posture', formLabels: ['肩こり', '肩凝り'] },
  { id: 'c8', label: '姿勢・猫背', cat: 'posture', formLabels: ['猫背', '姿勢', '姿勢・猫背', '姿勢の悪さ'] },
  { id: 'c9', label: '反り腰', cat: 'posture', formLabels: ['反り腰'] },
  { id: 'c17', label: '二の腕のたるみ', cat: 'posture', formLabels: ['二の腕のたるみ', '二の腕'] },
  { id: 'c10', label: '腰痛', cat: 'pelvis', formLabels: ['腰痛'] },
  { id: 'c11', label: '股関節・膝の痛み', cat: 'pelvis', formLabels: ['股関節', '膝の痛み', '股関節・膝の痛み', '股関節の痛み'] },
  { id: 'c12', label: '冷え・むくみ', cat: 'pelvis', formLabels: ['冷え', 'むくみ', '冷え・むくみ'] },
  { id: 'c13', label: '生理痛・生理不順', cat: 'pelvis', formLabels: ['生理痛', '生理不順', '生理痛・生理不順'] },
  { id: 'c14', label: '下半身太り', cat: 'pelvis', formLabels: ['下半身太り'] },
  { id: 'c15', label: '骨盤の歪み', cat: 'pelvis', formLabels: ['骨盤の歪み', '骨盤のゆがみ'] },
  { id: 'c16', label: 'X脚・O脚', cat: 'pelvis', formLabels: ['X脚', 'O脚', 'X脚・O脚'] },
];

// 施術後にセラピストが付けるお身体の評価（severity の合計で集中ケアを判定）。お客様向けの画面には出さない
export const FEEDBACK_ITEMS = [
  { id: 'f1', label: 'Before/Afterで変化を確認', severity: 1 },
  { id: 'f2', label: '施術直後にお客様が改善を実感', severity: 1 },
  { id: 'f3', label: '筋肉の緊張・硬さが強い', severity: 2 },
  { id: 'f4', label: '骨格の歪み・ズレが大きい', severity: 2 },
  { id: 'f5', label: '左右差・アンバランスが顕著', severity: 2 },
  { id: 'f6', label: '施術後すぐに戻りやすい状態', severity: 3 },
  { id: 'f7', label: '複数箇所への同時アプローチが必要', severity: 2 },
  { id: 'f8', label: '症状が慢性化している', severity: 3 },
  { id: 'f9', label: '可動域の制限がある', severity: 1 },
  { id: 'f10', label: '日常習慣の影響が大きい', severity: 2 },
];

// ------------------------------------------------------------
// 料金表（月額。regular は 1回の料金 × 回数）
// ------------------------------------------------------------
export const PLAN_CARDS = [
  { id: 'Standard', name: 'Standard', badge: '一番人気', unitPrice: 10000, types: ['小顔矯正・姿勢矯正・骨盤矯正から', '2種類'], prices: [{ freq: 2, regular: 20000, price: 15000 }, { freq: 4, regular: 40000, price: 28000 }] },
  { id: 'Premium', name: 'Premium', badge: 'オススメ', unitPrice: 11000, types: ['小顔矯正・姿勢矯正・骨盤矯正の', '全種類'], prices: [{ freq: 2, regular: 22000, price: 18000 }, { freq: 4, regular: 44000, price: 32000 }] },
  { id: 'Quick', name: 'Quick', unitPrice: 9000, types: ['小顔矯正・姿勢矯正・骨盤矯正から', '1種類'], prices: [{ freq: 4, regular: 36000, price: 24000 }, { freq: 8, regular: 72000, price: 44000 }] },
  { id: 'Monthly', name: '月一フル', unitPrice: 11000, types: ['小顔矯正・姿勢矯正・骨盤矯正の', '全種類'], prices: [{ freq: 1, regular: 11000, price: 10000 }] },
];

/** 初回入会費（サブスク会員の登録時に一律） */
export const ENTRY_FEE = 5000;

const FREQ_LABELS = { 1: '月1回', 2: '月2回', 4: '月4回（週1回）', 8: '月8回（週2回）' };

/**
 * 選べるプラン（料金表の 1行 = 1プラン。key は「料金表の id-回数」）。
 * おすすめに出すのは Premium・Standard・月一フル（recommendPlans）。Quick はセラピストが選び直す時だけ。
 */
export const PLAN_CATALOG = [
  { id: 'Premium', freq: 4, types: '全種類対応', desc: '全種類×週1回で最も効率的に改善' },
  { id: 'Standard', freq: 4, types: '2種類選択', desc: '2種類を選んで週1回の集中ケア' },
  { id: 'Premium', freq: 2, types: '全種類対応', desc: '全種類を月2回でバランス良くケア' },
  { id: 'Standard', freq: 2, types: '2種類選択', desc: '2種類×月2回で着実に改善' },
  { id: 'Monthly', freq: 1, types: '全種類対応', desc: '月1回で全種類を無理なくメンテナンス' },
  { id: 'Quick', freq: 4, types: '1種類選択', desc: '1種類にしぼって週1回のケア' },
  { id: 'Quick', freq: 8, types: '1種類選択', desc: '1種類にしぼって週2回のケア' },
].map((p) => {
  const card = PLAN_CARDS.find((c) => c.id === p.id);
  const row = card.prices.find((r) => r.freq === p.freq);
  return { ...p, key: `${p.id}-${p.freq}`, name: card.name, freqLabel: FREQ_LABELS[p.freq] || `月${p.freq}回`, price: row.price, regular: row.regular };
});

export const planByKey = (key) => PLAN_CATALOG.find((p) => p.key === key) || null;

/**
 * 料金の見せ方: 1回あたり（月額 ÷ 回数）と、通常料金（1回の料金 × 回数）との差額
 * @param {{ price:number, regular:number, freq:number }} plan PLAN_CATALOG の 1件
 */
export function planPricing(plan) {
  if (!plan) return null;
  return {
    price: plan.price,
    regular: plan.regular,
    perVisit: Math.round(plan.price / plan.freq),
    savings: Math.max(0, plan.regular - plan.price),
  };
}

/** 次回のご来店の目安（月の回数から） */
export function visitInterval(freq) {
  if (freq >= 8) return { next: '3〜4日後', pace: '週2回' };
  if (freq >= 4) return { next: '1週間後', pace: '週1回' };
  if (freq >= 2) return { next: '2週間後', pace: '2週間に1回' };
  return { next: '1ヶ月後', pace: '月1回' };
}

/** チェックしたお悩みを部位（コース）ごとにまとめる。お悩みの無い部位は items が空 */
export function concernsByCategory(concerns = {}) {
  return CONCERN_CATEGORIES.map((cat) => ({
    ...cat,
    items: CONCERN_ITEMS.filter((c) => c.cat === cat.key && concerns[c.id]),
  }));
}

// ------------------------------------------------------------
// フォームの回答 → チェック項目
// ------------------------------------------------------------
/** 1つの回答が当てはまるお悩みの ID（部分一致。「首」→ 首・ストレートネック など） */
export function matchConcern(answer) {
  const a = String(answer || '').trim();
  if (!a) return [];
  return CONCERN_ITEMS
    .filter((item) => item.formLabels.some((fl) => a.includes(fl) || fl.includes(a)))
    .map((item) => item.id);
}

/**
 * フォームで選ばれたお悩み → { checked: { [id]: true }, unmatched: [チェック項目に無い回答] }
 * unmatched（「頭痛」「その他」など）は画面にそのまま見せる。
 */
export function mapFormConcerns(answers) {
  const checked = {};
  const unmatched = [];
  for (const raw of answers || []) {
    const a = String(raw || '').trim();
    if (!a) continue;
    const ids = matchConcern(a);
    if (ids.length === 0) unmatched.push(a);
    for (const id of ids) checked[id] = true;
  }
  return { checked, unmatched };
}

/** 「いいえ」「なし」「該当なし」など、注意事項として出さなくてよい回答か */
const NO_ANSWER = /^(いいえ|なし|無し|ない|無い|特になし|特に無し|特にない|該当なし|該当無し|該当しない|no|none|n\/a|-|ー|－|―)$/i;
export function isNoAnswer(value) {
  const s = String(value == null ? '' : value).normalize('NFKC').trim().replace(/[。.]+$/, '');
  return !s || NO_ANSWER.test(s);
}

// ------------------------------------------------------------
// 今日の予約（SalonOne）とフォームの回答をお名前で結びつける
// ------------------------------------------------------------
// お名前によく出る異体字（SalonOne の登録とフォームで書き方が分かれやすいもの）
const NAME_VARIANTS = {
  髙: '高', 﨑: '崎', 嵜: '崎', 邉: '辺', 邊: '辺', 濵: '浜', 濱: '浜', 澤: '沢', 齋: '斎', 齊: '斎', 斉: '斎',
  德: '徳', 櫻: '桜', 廣: '広', 國: '国', 眞: '真', 惠: '恵', 冨: '富', '𠮷': '吉',
};
const NAME_VARIANT_RE = new RegExp(`[${Object.keys(NAME_VARIANTS).join('')}]`, 'gu');

/** お名前を空白で区切った部分（全角・半角、読みのかっこ書き、末尾の敬称、異体字をそろえる） */
function nameParts(name) {
  let s = String(name || '').normalize('NFKC');
  const bare = s.replace(/\([^)]*\)|【[^】]*】/g, ' ');
  s = bare.trim() ? bare : s.replace(/[()【】]/g, ' ');
  s = s.replace(NAME_VARIANT_RE, (c) => NAME_VARIANTS[c]).replace(/[・.]/g, '').trim().replace(/\s*(様|さま|さん)$/, '');
  return s.split(/\s+/).filter(Boolean);
}

/**
 * お名前の比較用のキー。1つめが基本で、2つめからは SalonOne でよくある登録の重なりを外したもの
 *   「山田 山田　花子」「山田 山田花子」（名の欄にも姓）→ 山田山田花子 / 山田花子
 *   「山田花子 花子」（姓の欄にもお名前）              → 山田花子花子 / 山田花子
 * 1文字の姓は「林 林太郎」のような名と見分けられないので、空白で分かれている時（「林 林　太郎」）だけ外す。
 */
export function personKeys(name) {
  const parts = nameParts(name);
  const base = parts.join('');
  if (!base) return [];
  const keys = [base];
  if (parts.length >= 2) {
    const [first, second] = parts;
    const [prev, last] = parts.slice(-2);
    const repeats = (a, b, has) => a === b || (a.length >= 2 && b.length > a.length && has(b, a));
    if (repeats(first, second, (b, a) => b.startsWith(a))) keys.push(parts.slice(1).join(''));
    if (repeats(last, prev, (b, a) => b.endsWith(a))) keys.push(parts.slice(0, -1).join(''));
  }
  return [...new Set(keys)].filter((k, i) => i === 0 || k.length >= 2);
}

/** お名前の比較用（全角・半角と空白をそろえ、末尾の敬称を外す） */
export const personKey = (name) => personKeys(name)[0] || '';

/**
 * 予約ごとに、同じお名前のいちばん新しい回答（days 日前までに回答したものだけ）。
 * SalonOne のキーがお名前を返さない設定（顧客番号だけ）の時は結びつかない（スタッフが回答を選ぶ）。
 * @param {Array<{ id:string, customerName:string|null }>} visits
 * @param {Array<{ index:number, name:string, submittedAt:string|null }>} sheets
 * @param {{ today:string, days?:number }} opts today は 'YYYY-MM-DD'（JST）
 * @returns {Object<string, Object>} { [予約ID]: 回答 }
 */
export function linkSheetsToVisits(visits, sheets, { today, days = 3 }) {
  const since = addDays(today, -days);
  const latest = new Map();
  for (const s of sheets || []) {
    const day = toJstDate(s && s.submittedAt);
    if (!day || day < since) continue;
    for (const key of personKeys(s && s.name)) {
      const prev = latest.get(key);
      if (!prev || String(s.submittedAt) > String(prev.submittedAt)) latest.set(key, s);
    }
  }
  const out = {};
  for (const v of visits || []) {
    const key = personKeys(v && v.customerName).find((k) => latest.has(k));
    if (key) out[v.id] = latest.get(key);
  }
  return out;
}

/** 回答と同じお名前の今日の予約（無ければ null。書き方まで同じ予約を先に） */
export function visitForSheet(visits, sheet) {
  const keys = personKeys(sheet && sheet.name);
  if (keys.length === 0) return null;
  const list = visits || [];
  return list.find((v) => personKey(v.customerName) === keys[0])
    || list.find((v) => personKeys(v.customerName).some((k) => keys.includes(k)))
    || null;
}

/** 2つのお名前が近いか（姓が同じ・一方の名前の部分がもう一方に入っている） */
function similarName(a, b) {
  const pa = nameParts(a);
  const pb = nameParts(b);
  const ka = pa.join('');
  const kb = pb.join('');
  if (!ka || !kb) return false;
  if (ka.slice(0, 2) === kb.slice(0, 2) && ka.length >= 2) return true;
  return pa.some((p) => p.length >= 2 && kb.includes(p)) || pb.some((p) => p.length >= 2 && ka.includes(p));
}

/**
 * 予約に付けるカウンセリングシートを選ぶ時の並び。
 * days 日以内の回答を先に（その中ではお名前が近い回答を先に）、あとは新しい順
 * @param {string} name 予約のお名前
 * @param {Array<{ name:string, submittedAt:string|null }>} sheets
 * @param {{ today:string, days?:number }} opts
 */
export function rankSheetsFor(name, sheets, { today, days = 3 }) {
  const since = addDays(today, -days);
  const score = (s) => ((toJstDate(s.submittedAt) || '') >= since ? 2 : 0) + (name && similarName(name, s.name) ? 1 : 0);
  return (sheets || [])
    .map((s) => ({ s, k: score(s) }))
    .sort((x, y) => y.k - x.k || String(y.s.submittedAt || '').localeCompare(String(x.s.submittedAt || '')))
    .map((x) => x.s);
}

/**
 * お名前の検索（GAS は「お名前にその文字を含む」でしか探せないので、空白の位置や全角・半角で漏れないよう
 * GAS には最初の 2文字で聞き、返ってきた回答をここで絞る）
 * @returns {{ gasQuery:string, matches:(name:string)=>boolean } | null} 検索できる文字が無ければ null
 */
export function nameSearch(q) {
  const words = nameParts(q);
  const first = String(q || '').normalize('NFKC').replace(/[()【】]/g, ' ').trim().split(/\s+/)[0].replace(/(様|さま|さん)$/, '');
  const gasQuery = Array.from(first).slice(0, 2).join('');
  if (words.length === 0 || !gasQuery) return null;
  return { gasQuery, matches: (n) => { const k = personKey(n); return words.every((w) => k.includes(w)); } };
}

// ------------------------------------------------------------
// フォームの店舗（GAS の回答シート）とダッシュボードの店舗
// ------------------------------------------------------------
/** GAS（gas/counseling.gs）にある店舗。GAS から一覧を取れない時の控え */
export const GAS_STORES = [
  { key: 'honatsugi', name: '本厚木店' },
  { key: 'yamato', name: '大和店' },
  { key: 'yokohama', name: '横浜店' },
  { key: 'machida', name: '町田店' },
  { key: 'kawaguchi', name: '川口店' },
];

/** 店舗名の比較用（空白・「si'se」・末尾の「店」を除く） */
export const storeNameKey = (name) => String(name || '')
  .normalize('NFKC')
  .replace(/si'?se/gi, '')
  .replace(/[\s'’]/g, '')
  .replace(/店$/, '')
  .toLowerCase();

/**
 * 店舗名が同じフォームの店舗（無ければ ''）。
 * 「新横浜店」が「横浜店」の回答を見てしまわないよう、部分一致では対応付けない。
 */
export function guessGasStore(storeName, gasStores = GAS_STORES) {
  const k = storeNameKey(storeName);
  if (!k) return '';
  const hit = gasStores.find((g) => storeNameKey(g.name) === k);
  return hit ? hit.key : '';
}

/**
 * 店舗の対応先。設定（storeMap）があればそれ、'none' は「連携しない」、無ければ名前で自動。
 * @param {{ id:string, name:string }} store
 * @param {Object<string,string>} storeMap { [ダッシュボード店舗ID]: GAS の店舗キー | 'none' }
 */
export function resolveGasStore(store, storeMap, gasStores = GAS_STORES) {
  const explicit = storeMap && storeMap[store.id];
  if (explicit === 'none') return '';
  if (explicit && gasStores.some((g) => g.key === explicit)) return explicit;
  return guessGasStore(store.name, gasStores);
}

// ------------------------------------------------------------
// おすすめプラン（しっかり / おすすめ / お手軽）
// ------------------------------------------------------------
/**
 * @param {Object<string, boolean>} concerns  チェックしたお悩み { c1: true, ... }
 * @param {Object<string, boolean>} feedbacks チェックした施術後の評価 { f3: true, ... }
 * @returns {null | { matsu, take, ume, reasons: string[], categories: string[], needIntensive: boolean }}
 *   何もチェックされていなければ null
 */
export function recommendPlans(concerns = {}, feedbacks = {}) {
  const checkedConcerns = CONCERN_ITEMS.filter((c) => concerns[c.id]);
  const checkedFeedbacks = FEEDBACK_ITEMS.filter((f) => feedbacks[f.id]);
  if (checkedConcerns.length === 0 && checkedFeedbacks.length === 0) return null;

  const categories = CONCERN_CATEGORIES.map((c) => c.key).filter((k) => checkedConcerns.some((c) => c.cat === k));
  const nCats = categories.length;
  const nC = checkedConcerns.length;
  const severity = checkedFeedbacks.reduce((s, f) => s + f.severity, 0);
  const needIntensive = severity >= 3 || nC >= 4 || checkedFeedbacks.length >= 2;

  let keys;
  if (nCats >= 3) keys = needIntensive ? ['Premium-4', 'Premium-2', 'Standard-2'] : ['Premium-4', 'Premium-2', 'Monthly-1'];
  else if (nCats === 2) keys = needIntensive ? ['Premium-4', 'Standard-4', 'Standard-2'] : ['Standard-4', 'Standard-2', 'Monthly-1'];
  else keys = needIntensive ? ['Premium-4', 'Standard-4', 'Standard-2'] : ['Premium-2', 'Standard-2', 'Monthly-1'];

  const reasons = [];
  if (nC >= 4) reasons.push(`お悩みが${nC}箇所`);
  if (severity >= 5) reasons.push('身体の状態から集中ケアを推奨');
  else if (severity >= 3) reasons.push('施術後の評価から定期的なケアが重要');
  if (nCats >= 3) reasons.push('3種類の矯正が対象');
  else if (nCats === 2) reasons.push('2種類の矯正が対象');
  if (reasons.length === 0) reasons.push('お悩みの状態に合わせて');

  const [matsu, take, ume] = keys.map(planByKey);
  return { matsu, take, ume, reasons, categories, needIntensive };
}
