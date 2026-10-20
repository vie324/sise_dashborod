// ============================================================
// カウンセリング（新規のお客様）— サーバー / ブラウザ共通
// ------------------------------------------------------------
// お悩みと施術後のお身体の状態から 3つのプランを提案し、料金（1回あたり・おトク額）を計算する。
// お客様は SalonOne の当日の予約から選ぶ（api/_lib/salonone/visits.js）。
// 項目・判定・金額は以前のダッシュボードの「カウンセリング」画面と同じ。
// 金額を変える場合は下の料金表（PLAN_CARDS）を更新する（スタッフの画面とお客様向けのご説明がまとめて切り替わる）。
// 説明の文言（コンセプト・会員のポイント・本日の特典）は src/features/care/counseling/content.jsx。
// ============================================================

// ------------------------------------------------------------
// お悩み箇所
// ------------------------------------------------------------
export const CONCERN_CATEGORIES = [
  { key: 'face', label: '小顔', course: '小顔矯正', area: '顔・頭' },
  { key: 'posture', label: '姿勢', course: '姿勢矯正', area: '首・肩・背中' },
  { key: 'pelvis', label: '骨盤', course: '骨盤矯正', area: '腰・下半身' },
];

export const CONCERN_ITEMS = [
  { id: 'c1', label: '頭・はちの張り', cat: 'face' },
  { id: 'c2', label: '眼精疲労', cat: 'face' },
  { id: 'c3', label: '頬のたるみ', cat: 'face' },
  { id: 'c4', label: '食いしばり・エラの張り', cat: 'face' },
  { id: 'c5', label: '顔の左右差', cat: 'face' },
  { id: 'c6', label: '首・ストレートネック', cat: 'posture' },
  { id: 'c7', label: '肩こり', cat: 'posture' },
  { id: 'c8', label: '姿勢・猫背', cat: 'posture' },
  { id: 'c9', label: '反り腰', cat: 'posture' },
  { id: 'c10', label: '腰痛', cat: 'pelvis' },
  { id: 'c11', label: '股関節・膝の痛み', cat: 'pelvis' },
  { id: 'c12', label: '冷え・むくみ', cat: 'pelvis' },
  { id: 'c13', label: '生理痛・生理不順', cat: 'pelvis' },
  { id: 'c14', label: '下半身太り', cat: 'pelvis' },
  { id: 'c15', label: '骨盤の歪み', cat: 'pelvis' },
  { id: 'c16', label: 'X脚・O脚', cat: 'pelvis' },
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
