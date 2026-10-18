// ============================================================
// カウンセリング（新規のお客様）— サーバー / ブラウザ共通
// ------------------------------------------------------------
// お客様が来店時に答える Google フォームのカウンセリングシート（GAS 経由で読み取り）を
// チェック項目に反映し、お悩みと施術後の状態から 3つのプランを提案する。
// 項目・判定・金額は以前のダッシュボードの「カウンセリング」画面と同じ。
// プランの金額・特典を変える場合はこのファイルを更新する（画面がまとめて切り替わる）。
// ============================================================

// ------------------------------------------------------------
// お悩み箇所（Google フォームの選択肢 → チェック項目）
// ------------------------------------------------------------
export const CONCERN_CATEGORIES = [
  { key: 'face', label: '小顔', course: '小顔矯正' },
  { key: 'posture', label: '姿勢', course: '姿勢矯正' },
  { key: 'pelvis', label: '骨盤', course: '骨盤矯正' },
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
  { id: 'c10', label: '腰痛', cat: 'pelvis', formLabels: ['腰痛'] },
  { id: 'c11', label: '股関節・膝の痛み', cat: 'pelvis', formLabels: ['股関節', '膝の痛み', '股関節・膝の痛み', '股関節の痛み'] },
  { id: 'c12', label: '冷え・むくみ', cat: 'pelvis', formLabels: ['冷え', 'むくみ', '冷え・むくみ'] },
  { id: 'c13', label: '生理痛・生理不順', cat: 'pelvis', formLabels: ['生理痛', '生理不順', '生理痛・生理不順'] },
  { id: 'c14', label: '下半身太り', cat: 'pelvis', formLabels: ['下半身太り'] },
  { id: 'c15', label: '骨盤の歪み', cat: 'pelvis', formLabels: ['骨盤の歪み', '骨盤のゆがみ'] },
  { id: 'c16', label: 'X脚・O脚', cat: 'pelvis', formLabels: ['X脚', 'O脚', 'X脚・O脚'] },
];

// 施術後にセラピストが付けるお身体の評価（severity の合計で集中ケアを判定）
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
// プラン
// ------------------------------------------------------------
/** おすすめに出すプラン（id は下の料金表 PLAN_CARDS の id） */
export const PLAN_CATALOG = [
  { key: 'Premium-4', id: 'Premium', name: 'Premium', freq: 4, freqLabel: '月4回（週1回）', types: '全種類対応', desc: '全種類×週1回で最も効率的に改善', price: 32000 },
  { key: 'Standard-4', id: 'Standard', name: 'Standard', freq: 4, freqLabel: '月4回（週1回）', types: '2種類選択', desc: '2種類を選んで週1回の集中ケア', price: 28000 },
  { key: 'Premium-2', id: 'Premium', name: 'Premium', freq: 2, freqLabel: '月2回', types: '全種類対応', desc: '全種類を月2回でバランス良くケア', price: 18000 },
  { key: 'Standard-2', id: 'Standard', name: 'Standard', freq: 2, freqLabel: '月2回', types: '2種類選択', desc: '2種類×月2回で着実に改善', price: 15000 },
  { key: 'Monthly-1', id: 'Monthly', name: '月一フル', freq: 1, freqLabel: '月1回', types: '全種類対応', desc: '月1回で全種類を無理なくメンテナンス', price: 10000 },
];

/** 料金表（月額。regular は 1回の料金 × 回数） */
export const PLAN_CARDS = [
  { id: 'Standard', name: 'Standard', badge: '一番人気', unitPrice: 10000, types: ['小顔矯正・姿勢矯正・骨盤矯正から', '2種類'], prices: [{ freq: 2, regular: 20000, price: 15000 }, { freq: 4, regular: 40000, price: 28000 }] },
  { id: 'Premium', name: 'Premium', badge: 'オススメ', unitPrice: 11000, types: ['小顔矯正・姿勢矯正・骨盤矯正の', '全種類'], prices: [{ freq: 2, regular: 22000, price: 18000 }, { freq: 4, regular: 44000, price: 32000 }] },
  { id: 'Quick', name: 'Quick', unitPrice: 9000, types: ['小顔矯正・姿勢矯正・骨盤矯正から', '1種類'], prices: [{ freq: 4, regular: 36000, price: 24000 }, { freq: 8, regular: 72000, price: 44000 }] },
  { id: 'Monthly', name: '月一フル', unitPrice: 11000, types: ['小顔矯正・姿勢矯正・骨盤矯正の', '全種類'], prices: [{ freq: 1, regular: 11000, price: 10000 }] },
];

/** 初回入会費（サブスク会員の登録時に一律） */
export const ENTRY_FEE = 5000;

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

// ------------------------------------------------------------
// おすすめプラン（しっかり / おすすめ / お手軽）
// ------------------------------------------------------------
const planByKey = (key) => PLAN_CATALOG.find((p) => p.key === key) || null;

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

// ------------------------------------------------------------
// 回答の読み取り
// ------------------------------------------------------------
const NO_ANSWER = /^(いいえ|なし|無し|ない|無い|特になし|特に無し|特にない|該当なし|該当無し|該当しない|no|none|n\/a|-|ー|－|―)$/i;

/** 「いいえ」「なし」「該当なし」など、注意事項として出さなくてよい回答か */
export function isNoAnswer(value) {
  const s = String(value == null ? '' : value).normalize('NFKC').trim().replace(/[。.]+$/, '');
  return !s || NO_ANSWER.test(s);
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
