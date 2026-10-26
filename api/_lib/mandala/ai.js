// ============================================================
// マンダラ: Claude API（週次レビュー・チャート作成の支援）
// ------------------------------------------------------------
// 旧ツールの docs/02_ai_review_spec.md と同じプロンプト・出力スキーマ（PROMPT_VERSION v2）。
// 構造化出力はツールで受け取り、必ずここで検証してから保存する（検証に失敗したら 1回だけ再試行）。
// 売上などの数値は AI に渡さない（行動が回っているかと本人の記述だけ）。
//
// 環境変数: ANTHROPIC_API_KEY（必須・サーバー専用）/ MANDALA_AI_MODEL（任意。既定 claude-sonnet-4-6）
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import { formatManYen, formatRate, themeCheckRates, itemIndex } from '../../../shared/mandala.js';
import { formatMonthJa } from '../../../shared/dates.js';

export const DEFAULT_MODEL = 'claude-sonnet-4-6';
/** v2: 売上・施術人数などの数値を扱わない版（旧ツールと同じ） */
export const PROMPT_VERSION = 'v2';

// Vercel の関数は 60秒まで。1回 25秒・SDK の自動再試行なしにして、検証の再試行と合わせても収まるようにする
const TIMEOUT_MS = 25_000;
const RETRY_BUDGET_MS = 30_000;

export const getModel = () => (process.env.MANDALA_AI_MODEL || process.env.AI_MODEL || '').trim() || DEFAULT_MODEL;
export const isAiConfigured = () => !!process.env.ANTHROPIC_API_KEY;

export const WEEKLY_REVIEW_SYSTEM_PROMPT = `あなたは複数の美容サロン(アイラッシュ・アイブロウ・整体/ボディケア)を運営するグループの経営コーチAIです。スタッフの週次振り返りをもとに、翌週の行動を具体化するのが仕事です。

前提:
- 売上・客数・単価などの数値は別のツールで管理しているため、このツールには入ってきません。数字を尋ねたり、入力を促したりしないでください。
- あなたが見るのは「マンダラチャートの行動が week 単位で回っているか」と「本人の記述」だけです。

原則:
- 事実は入力データにあるものだけを使う。推測で数字や出来事を作らない。
- 良かった点は必ず具体的に承認する(実行できた行動名や、チェック率・継続週数を引用する)。
- 課題は責めずに、しかし曖昧にせず指摘する。人格ではなく行動と仕組みの話をする。
- サロンの成果は「次回予約の声かけ」「カウンセリング」「口コミ依頼」といった日々の行動の積み上げで決まる。実行できていない行動が続いている領域は必ず指摘する。
- 翌週のフォーカスは、提供された候補リストの中から必ず3つ、mandala_item_id を正確に指定して選ぶ。候補にない施策を勧めたい場合は message_to_staff で軽く触れるに留める。
- 3つの選定基準: (1)センターゴールへのインパクトが大きい (2)今週できなかった領域を補う (3)本人の「課題」の記述に応える。理由には可能な限りチェックの実績を引用する。
- すべて日本語。スタッフ本人が1分で読める分量。各フィールドの文字数目安を守る。
- 口調は「丁寧だが距離の近い先輩」。絵文字は使わない。
- 出力は必ず record_weekly_review ツールで返す。`;

export const MANDALA_ASSIST_SYSTEM_PROMPT = `あなたは美容サロンの目標設計コーチです。スタッフが書いたマンダラチャートの項目を、週次で追跡できる形に整えます。

各項目について次を判定・提案してください:
- suggested_type: "action"(やったかどうかで週次チェックできる行動)/ "metric"(数値で測るもの。数値は別ツールで管理するため、このツールでは追跡しない)/ "mindset"(心構え・状態。追跡しない)
- rewrite: 週次で「やったかどうか」を答えられる形への書き換え案。「いつ・何を・どのくらい」を含める。具体的な数値は本人が決めるべきなので、数量はプレースホルダ「◯」を使う(例: 「口コミの量を増やす」→「会計時にQRを提示して口コミを依頼する(週◯人)」)。元の文で十分具体的なら書き換えない(rewriteをnullに)。
- weekly_trackable: action のうち、毎週チェックする価値があるものを true にする。
- 本人の言葉と意図を尊重し、意味を変えない。項目の追加・削除はしない。
- 出力は必ず classify_mandala_items ツールで、全項目分を返す。`;

export const recordWeeklyReviewTool = {
  name: 'record_weekly_review',
  description: '週次レビュー結果を構造化して記録する',
  input_schema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: '今週の総評。2〜3文、120字以内' },
      wins: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3, description: '具体的に良かった点。実行できた行動名やチェック率を引用' },
      concerns: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 3, description: '気になる点・リスク' },
      habit_insight: { type: 'string', description: '行動の回り方から読み取れる最重要ポイント1つ。80字以内。売上などの数値には触れない' },
      next_focus: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            mandala_item_id: { type: 'string', description: '候補リストのidをそのまま使う' },
            title: { type: 'string', description: '項目の内容(候補の文言を基に)' },
            reason: { type: 'string', description: 'なぜ今この項目か。60字以内' },
          },
          required: ['mandala_item_id', 'title', 'reason'],
        },
      },
      message_to_staff: { type: 'string', description: '承認と励ましの一言。80字以内' },
    },
    required: ['summary', 'wins', 'concerns', 'habit_insight', 'next_focus', 'message_to_staff'],
  },
};

export const classifyMandalaItemsTool = {
  name: 'classify_mandala_items',
  description: 'マンダラ項目の分類・書き換え案を構造化して返す',
  input_schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            theme_position: { type: 'integer' },
            position: { type: 'integer' },
            suggested_type: { type: 'string', enum: ['action', 'metric', 'mindset'] },
            weekly_trackable: { type: 'boolean', description: 'actionのうち毎週チェックする価値があるものtrue' },
            rewrite: { type: ['string', 'null'] },
          },
          required: ['theme_position', 'position', 'suggested_type', 'weekly_trackable'],
        },
      },
    },
    required: ['items'],
  },
};

// ------------------------------------------------------------
// 出力の検証（足りない・型違い・件数違いは issues に入れて不合格）
// ------------------------------------------------------------
const isText = (v) => typeof v === 'string' && v.trim().length > 0;

function textList(v, path, min, max, issues) {
  if (!Array.isArray(v)) { issues.push(`${path}: 配列ではありません`); return []; }
  if (v.length < min || v.length > max) issues.push(`${path}: ${min}〜${max}件にしてください（${v.length}件）`);
  v.forEach((s, i) => { if (!isText(s)) issues.push(`${path}.${i}: 空の文字列です`); });
  return v.map((s) => String(s).trim());
}

export function validateWeeklyReview(raw) {
  const issues = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, issues: ['出力がオブジェクトではありません'] };
  for (const k of ['summary', 'habit_insight', 'message_to_staff']) if (!isText(raw[k])) issues.push(`${k}: 必須の文字列です`);
  const wins = textList(raw.wins, 'wins', 1, 3, issues);
  const concerns = textList(raw.concerns, 'concerns', 1, 3, issues);
  let nextFocus = [];
  if (!Array.isArray(raw.next_focus)) issues.push('next_focus: 配列ではありません');
  else {
    if (raw.next_focus.length !== 3) issues.push(`next_focus: 3件にしてください（${raw.next_focus.length}件）`);
    nextFocus = raw.next_focus.map((f, i) => {
      if (!f || typeof f !== 'object') { issues.push(`next_focus.${i}: オブジェクトではありません`); return null; }
      for (const k of ['mandala_item_id', 'title', 'reason']) if (!isText(f[k])) issues.push(`next_focus.${i}.${k}: 必須の文字列です`);
      return { mandala_item_id: String(f.mandala_item_id || '').trim(), title: String(f.title || '').trim(), reason: String(f.reason || '').trim() };
    });
  }
  if (issues.length) return { ok: false, issues };
  return {
    ok: true,
    data: { summary: raw.summary.trim(), wins, concerns, habit_insight: raw.habit_insight.trim(), next_focus: nextFocus, message_to_staff: raw.message_to_staff.trim() },
  };
}

export function validateMandalaAssist(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) return { ok: false, issues: ['items: 配列ではありません'] };
  const issues = [];
  const pos = (v) => Number.isInteger(v) && v >= 1 && v <= 8;
  const items = raw.items.map((it, i) => {
    if (!it || typeof it !== 'object') { issues.push(`items.${i}: オブジェクトではありません`); return null; }
    if (!pos(it.theme_position)) issues.push(`items.${i}.theme_position: 1〜8 の整数です`);
    if (!pos(it.position)) issues.push(`items.${i}.position: 1〜8 の整数です`);
    if (!['action', 'metric', 'mindset'].includes(it.suggested_type)) issues.push(`items.${i}.suggested_type: action / metric / mindset のどれかです`);
    if (typeof it.weekly_trackable !== 'boolean') issues.push(`items.${i}.weekly_trackable: true / false です`);
    if (it.rewrite !== undefined && it.rewrite !== null && typeof it.rewrite !== 'string') issues.push(`items.${i}.rewrite: 文字列か null です`);
    return { theme_position: it.theme_position, position: it.position, suggested_type: it.suggested_type, weekly_trackable: it.weekly_trackable, rewrite: isText(it.rewrite) ? it.rewrite.trim() : null };
  });
  return issues.length ? { ok: false, issues } : { ok: true, data: { items } };
}

// ------------------------------------------------------------
// 入力の組み立て（docs/02 §1 のテンプレート）
// ------------------------------------------------------------
export function buildWeeklyReviewPayload({ week, review, chart, trackables, checks, focus, storeLabel, displayName, history, candidates }) {
  const themesCsv = (chart && chart.themes.map((t) => t.title).filter(Boolean).join(', ')) || '(未設定)';
  const rates = themeCheckRates(trackables, checks);
  const checkLines = rates.length > 0
    ? rates.map((r) => `- ${r.theme}: ${r.done}/${r.total} ${r.missed.length ? `(未実施: ${r.missed.join(' / ')})` : ''}`.trim()).join('\n')
    : '- (週次チェック対象の行動が未設定)';
  const totalDone = rates.reduce((s, r) => s + r.done, 0);
  const totalAll = rates.reduce((s, r) => s + r.total, 0);
  const historyLine = history.length > 0
    ? history.map((w) => {
      const label = w.week.slice(5).replace('-', '/');
      if (w.state === 'none') return `${label} 未提出`;
      const rate = w.checkTotal > 0 ? formatRate(w.checked / w.checkTotal) : '対象なし';
      return `${label} ${w.state === 'submitted' ? '提出' : '下書き'} ${rate}`;
    }).join(' → ')
    : '(履歴なし)';
  const idx = chart ? itemIndex(chart) : new Map();
  const focusLines = focus.length > 0
    ? focus.map((f) => {
      const label = f.freeText || (f.mandalaItemId ? (idx.get(f.mandalaItemId) ? idx.get(f.mandalaItemId).item.content : '(削除済み)') : '');
      const mark = f.achieved === true ? '◯' : f.achieved === false ? '×' : '未回答';
      return `- ${mark} ${label}`;
    }).join('\n')
    : '- (今週のフォーカスは未設定)';
  const candidateLines = candidates.length > 0
    ? candidates.map((c) => `id: ${c.id} | テーマ: ${c.themeTitle} | 内容: ${c.content}`).join('\n')
    : '(候補なし)';
  const month = (v) => (v ? formatMonthJa(String(v).slice(0, 7)) : '未設定');

  return `# スタッフと目標
- 店舗: ${storeLabel || '(未設定)'} / スタッフ: ${displayName}
- センターゴール: ${(chart && chart.centerGoal) || '(未設定)'}
- 基準: 月${chart && chart.baselineAmount ? formatManYen(chart.baselineAmount) : '未設定'} → 目標: 月${chart && chart.targetAmount ? formatManYen(chart.targetAmount) : '未設定'}(期限: ${month(chart && chart.deadlineMonth)})
- 目標の内訳メモ: ${(chart && chart.targetBreakdown && chart.targetBreakdown.trim()) || '(未記入)'}
- 8テーマ: ${themesCsv}

# 今週(${week}週)の行動チェック
- 全体: ${totalAll > 0 ? `${totalDone}/${totalAll}(${formatRate(totalDone / totalAll)})` : '対象なし'}
${checkLines}

# 直近の週報の回り方(古い順)
${historyLine}

# 今週のフォーカスの結果
${focusLines}

# 本人の記述
- よかったこと: ${(review && review.goodThings.trim()) || '(記入なし)'}
- 課題・つまずき: ${(review && review.challenges.trim()) || '(記入なし)'}

# 翌週フォーカスの候補リスト(この中からのみ選ぶこと)
${candidateLines}`;
}

export function buildMandalaAssistPayload({ centerGoal, themes }) {
  const blocks = themes.map((t) => `## テーマ${t.position}: ${t.title || '(未設定)'}\n${t.items.map((i) => `- position ${i.position}: ${i.content}`).join('\n')}`).join('\n\n');
  return `センターゴール: ${centerGoal}

以下の項目すべてについて判定してください。theme_position と position は入力のものをそのまま返してください。

${blocks}`;
}

// ------------------------------------------------------------
// 呼び出し
// ------------------------------------------------------------
// ツールの指定（tool_choice: tool）を受け付けないモデルでは auto にしてプロンプトで指示する
const NO_FORCED_TOOL = /^claude-(fable-5-1|mythos-5-1|opus-5-5|sonnet-5-5)/;
export const toolChoiceFor = (model, name) => (NO_FORCED_TOOL.test(model) ? { type: 'auto' } : { type: 'tool', name });

export class AiError extends Error {}

async function callClaude({ system, tool, userMessage, maxTokens }) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: TIMEOUT_MS, maxRetries: 0 });
  const model = getModel();
  let message;
  try {
    message = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      tools: [tool],
      tool_choice: toolChoiceFor(model, tool.name),
      messages: [{ role: 'user', content: userMessage }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new AiError('AI の API キーが無効です（ANTHROPIC_API_KEY を確認してください）');
    if (e instanceof Anthropic.RateLimitError) throw new AiError('AI の利用が混み合っています。少し待ってから再実行してください');
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new AiError('AI の応答が時間内に返りませんでした。再実行してください');
    if (e instanceof Anthropic.APIError) throw new AiError(`AI の呼び出しに失敗しました（${e.status || '接続エラー'}）`);
    throw e;
  }
  if (message.stop_reason === 'refusal') throw new AiError('AI がこの内容の処理を断りました。記述を見直して再実行してください');
  const block = (message.content || []).find((b) => b.type === 'tool_use' && b.name === tool.name);
  return {
    raw: block ? block.input : null,
    model: message.model || model,
    inputTokens: message.usage ? message.usage.input_tokens : null,
    outputTokens: message.usage ? message.usage.output_tokens : null,
  };
}

// テストで Claude の代わりを差し込む
let caller = callClaude;
export function setAiCallerForTest(fn) { caller = fn || callClaude; }

/**
 * 週次レビューを作る。候補にない ID・スキーマ違反は 1回だけ理由を添えて再試行し、
 * それでも ID が合わなければフォーカス提案を空にして返す（画面は壊さない）。
 */
export async function runWeeklyReview({ payload, candidateIds }) {
  let attemptPayload = payload;
  let parsed = null;
  let call = null;
  const started = Date.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    // 1回目に時間がかかった時は再試行しない（関数の制限時間を超えないように）
    if (attempt > 0 && Date.now() - started > RETRY_BUDGET_MS) break;
    call = await caller({ system: WEEKLY_REVIEW_SYSTEM_PROMPT, tool: recordWeeklyReviewTool, userMessage: attemptPayload, maxTokens: 1500 });
    parsed = validateWeeklyReview(call.raw);
    if (parsed.ok) {
      const invalid = parsed.data.next_focus.filter((f) => !candidateIds.has(f.mandala_item_id));
      if (invalid.length === 0) break;
      attemptPayload = `${payload}\n\n# 前回の出力エラー(修正して再出力すること)\n次のIDは候補リストに存在しません: ${invalid.map((f) => f.mandala_item_id).join(', ')}\n必ず候補リストに記載された id をそのまま使ってください。`;
      parsed = null;
    } else {
      attemptPayload = `${payload}\n\n# 前回の出力エラー(修正して再出力すること)\n出力がスキーマに適合しませんでした: ${parsed.issues.join(' / ')}`;
    }
  }
  const fallback = validateWeeklyReview(call.raw);
  const result = parsed && parsed.ok ? parsed.data : fallback.ok ? { ...fallback.data, next_focus: [] } : null;
  if (!result) throw new AiError('AI の出力を確かめられませんでした。再実行してください');
  return { result, model: call.model, inputTokens: call.inputTokens, outputTokens: call.outputTokens };
}

export async function runMandalaAssist(payload) {
  const call = await caller({ system: MANDALA_ASSIST_SYSTEM_PROMPT, tool: classifyMandalaItemsTool, userMessage: payload, maxTokens: 2000 });
  const parsed = validateMandalaAssist(call.raw);
  if (!parsed.ok) throw new AiError('AI の出力を確かめられませんでした。再実行してください');
  return { items: parsed.data.items, model: call.model };
}
