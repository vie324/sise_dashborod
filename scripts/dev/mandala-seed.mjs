// ============================================================
// 疑似 DB（scripts/dev/supabase-mock.mjs）に入れるマンダラのデモデータ
// ------------------------------------------------------------
// 佐藤さん（スタッフ）: チャートあり・直近の週報・日報の対象
// 鈴木さん（スタッフ）: チャートは書きかけ・週報は下書き
// 高橋さん（店長）    : チャートあり
// 田中さん・伊藤さん  : チャート未作成
// 日付は「今日」から逆算して作るので、いつ起動しても直近の週に並ぶ。
// ============================================================

import crypto from 'node:crypto';
import { todayJst } from '../../shared/dates.js';
import { currentWeekStart, shiftWeek, recentDays } from '../../shared/mandala.js';

const uid = () => crypto.randomUUID();

const SATO_THEMES = [
  ['離脱防止（毎月1〜2人）', [['変化を感じさせる', 'mindset'], ['短期・中期・長期の目標を一緒に決める', 'action', true], ["si'seにしかない強みを活かす", 'mindset'], ['解約ではなく月イチへの切り替えを提案する', 'action', true], ['関係構築（ラポール）', 'mindset'], ['現状維持バイアスを理解する', 'mindset'], ['「この人すごい！」を引き出せる知識量', 'mindset'], ['セルフケアを1つ提案する', 'action', true]]],
  ['深掘り（聴く・拾う）', [['絶対的傾聴', 'mindset'], ['話を遮らない', 'action'], ['価値観を知る質問をする', 'action', true], ['分かりやすい言葉で説明する', 'action', true], ['潜在的なニーズを引き出す', 'action'], ['その人に興味を持つ', 'mindset'], ['質問力を上げる', 'action'], ['説明は短くする', 'action', true]]],
  ['評価（三人称の変化）', [['姿勢評価をする', 'action', true], ['ROMチェックをする', 'action', true], ['顔の左右差を確認する', 'action'], ['姿勢の例の画像を作る', 'action', true], ['セルフで行える指標を作る', 'action'], ['「変わった気がします」を「変わりました」へ', 'mindset'], ['術前術後の変化の基準を持つ', 'action'], ['仮説を立てる', 'action']]],
  ['成約率（70%以上）', [['最初の印象を良く', 'mindset'], ['押し売らない', 'mindset'], ['悩みを徹底的に聞く', 'action', true], ['通う目的を明確にする', 'action', true], ['どうなりたいかのゴールを決める', 'action', true], ['取れたパターンを分析する', 'action', true], ['料金・契約内容のプレゼンを磨く', 'action'], ['1回で体感を引き出す施術', 'mindset']]],
  ['説明', [['短く簡潔に', 'mindset'], ['求める人には与える', 'mindset'], ['悩みに確実に関係する1つを伝える', 'action', true], ['推理じゃないし、診断じゃない', 'mindset'], ['自分の状態を自分で説明できるようにする', 'action', true], ['例え話を使う', 'action'], ['専門用語・細かい筋肉名は省く', 'action', true], ['なるべくその人の言葉で', 'mindset']]],
  ['集客', [['看板を作る', 'action'], ['会計時に口コミを依頼する（週◯人）', 'action', true], ['SNSを週◯回投稿する', 'action', true], ['関係のできた方から口コミをもらう', 'action', true], ['紹介をお願いする', 'action', true], ['他店舗と協力する', 'action'], ['入りやすいお店づくり', 'action'], ['口コミの件数', 'metric']]],
  ['体感（主観の変化）', [['施術前に評価する', 'action', true], ['セルフチェックをしてもらう', 'action', true], ['前後の変化を伝える', 'action', true], ['その人の生活と結びつける', 'action'], ['ROMで確かめる', 'action'], ['施術の意図や狙いを理解する', 'mindset'], ['結果よりも伝え方', 'mindset'], ['その人の主観の動きやすさ', 'mindset']]],
  ['基本業務', [['時間管理（施術時間・勤怠）', 'action', true], ['Daily の数字・出納帳の入力', 'action', true], ['予約のリマインドを正確に送る', 'action', true], ['戸締り・ゴミ捨て・清掃', 'action', true], ['報告・連絡・相談', 'action', true], ['空き時間のログを残す', 'action', true], ['日報を送る', 'action', true], ['週報を入力する', 'action', true]]],
];

const TAKAHASHI_THEMES = [
  ['店舗の雰囲気づくり', [['朝礼で今日の目標を共有する', 'action', true], ['スタッフの良いところを毎日1つ伝える', 'action', true], ['笑顔で迎える', 'mindset'], ['', 'action'], ['', 'action'], ['', 'action'], ['', 'action'], ['', 'action']]],
  ['育成', [['週1回ロープレをする', 'action', true], ['新人の施術を見てフィードバックする', 'action', true], ['任せて見守る', 'mindset'], ['', 'action'], ['', 'action'], ['', 'action'], ['', 'action'], ['', 'action']]],
  ['リピート', [['次回予約の声かけを全員に', 'action', true], ['離脱しそうな方に連絡する', 'action', true], ['次回予約率', 'metric'], ['', 'action'], ['', 'action'], ['', 'action'], ['', 'action'], ['', 'action']]],
  ['', []], ['', []], ['', []], ['', []], ['', []],
];

function buildChart(staffId, { centerGoal, title, target, baseline, breakdown, themes, createdDaysAgo }, now) {
  const chartId = uid();
  const created = new Date(now - createdDaysAgo * 86400000).toISOString();
  const chart = {
    id: chartId, staff_id: staffId, title, center_goal: centerGoal,
    baseline_amount: baseline ?? null, target_amount: target ?? null, target_breakdown: breakdown || null,
    deadline_month: null, status: 'active', created_at: created, updated_at: new Date(now - 3 * 86400000).toISOString(),
  };
  const themeRows = [];
  const itemRows = [];
  for (let t = 0; t < 8; t++) {
    const [themeTitle, items] = themes[t] || ['', []];
    const themeId = uid();
    themeRows.push({ id: themeId, chart_id: chartId, position: t + 1, title: themeTitle });
    for (let i = 0; i < 8; i++) {
      const [content, type, trackable] = items[i] || ['', 'action'];
      itemRows.push({ id: uid(), theme_id: themeId, position: i + 1, content, item_type: type || 'action', weekly_trackable: !!trackable && type === 'action' && !!content });
    }
  }
  return { chart, themeRows, itemRows };
}

export function mandalaSeed(now = Date.now()) {
  const week = currentWeekStart(now);
  const out = {
    mandala_members: [
      { staff_id: 'st-sato', share_chart: true, daily_report_enabled: true, updated_at: new Date(now).toISOString() },
      { staff_id: 'st-ito', share_chart: true, daily_report_enabled: true, updated_at: new Date(now).toISOString() },
    ],
    mandala_charts: [], mandala_themes: [], mandala_items: [],
    mandala_weekly_reviews: [], mandala_habit_checks: [], mandala_focus_items: [],
    mandala_ai_reviews: [], mandala_review_comments: [], mandala_cheers: [],
    mandala_daily_check_items: [], mandala_daily_reports: [], mandala_daily_report_checks: [], mandala_daily_report_comments: [],
  };
  const add = ({ chart, themeRows, itemRows }) => {
    out.mandala_charts.push(chart);
    out.mandala_themes.push(...themeRows);
    out.mandala_items.push(...itemRows);
    return { chart, itemRows };
  };

  const sato = add(buildChart('st-sato', {
    centerGoal: '施術消化売上 月100万！', title: '100万への道', target: 1000000, baseline: 620000,
    breakdown: 'サブスク +4人 = +20万円\n新規の契約率 50% → 70% で +10万円\n来店頻度を月1.5回 → 2回に +8万円',
    themes: SATO_THEMES, createdDaysAgo: 60,
  }, now));
  add(buildChart('st-takahashi', { centerGoal: '店舗の次回予約率 80%', title: '', themes: TAKAHASHI_THEMES, createdDaysAgo: 30 }, now));
  const suzuki = add(buildChart('st-suzuki', {
    centerGoal: '指名を月20件', title: '', target: 700000,
    themes: [['カウンセリング', [['お悩みを3つ聞く', 'action', true], ['ゴールを一緒に決める', 'action', true]]], ['技術', [['毎日30分練習する', 'action']]]],
    createdDaysAgo: 10,
  }, now));

  // 佐藤さんの週報（直近 7週。今週は下書き）
  const trackable = sato.itemRows.filter((i) => i.weekly_trackable);
  const pattern = [0.55, 0.62, 0.48, 0.7, 0.66, 0.78, 0.81, 0.4];
  for (let k = 7; k >= 0; k--) {
    if (k === 5) continue; // 1週だけ出し忘れ
    const w = shiftWeek(week, -k);
    const reviewId = uid();
    const submitted = k > 0;
    const at = new Date(k === 0 ? now - 3600000 : now - (k * 7 - 5) * 86400000).toISOString();
    out.mandala_weekly_reviews.push({
      id: reviewId, staff_id: 'st-sato', week_start: w,
      good_things: submitted ? '初回のお客様に通う目的を一緒に決められた。口コミを2件いただけた。' : '',
      challenges: submitted ? 'セルフケアの提案を忘れる日があった。' : '',
      status: submitted ? 'submitted' : 'draft', submitted_at: submitted ? at : null,
      created_at: new Date(new Date(at).getTime() - 3 * 3600000).toISOString(), updated_at: at,
    });
    const rate = pattern[7 - k];
    trackable.forEach((item, idx) => {
      out.mandala_habit_checks.push({ id: uid(), review_id: reviewId, mandala_item_id: item.id, checked: (idx * 37 % 100) / 100 < rate });
    });
    if (k === 1) {
      out.mandala_review_comments.push({ id: uid(), review_id: reviewId, author_id: 'st-takahashi', author_name: '高橋 涼子', body: '目的を決めるの、すごく良いですね！セルフケアは会計前に一言でOKです。', created_at: new Date(new Date(at).getTime() + 86400000).toISOString() });
    }
  }
  // 今週のフォーカス（先週の AI 提案を採用した想定）
  [trackable[0], trackable[10], trackable[16]].forEach((item, i) => {
    out.mandala_focus_items.push({ id: uid(), staff_id: 'st-sato', week_start: week, mandala_item_id: item.id, free_text: null, source: i === 2 ? 'self' : 'ai', achieved: null, sort_order: i, created_at: new Date(now - 2 * 86400000).toISOString() });
  });
  // 鈴木さんは今週の下書きだけ
  out.mandala_weekly_reviews.push({ id: uid(), staff_id: 'st-suzuki', week_start: week, good_things: '', challenges: '', status: 'draft', submitted_at: null, created_at: new Date(now - 86400000).toISOString(), updated_at: new Date(now - 86400000).toISOString() });
  void suzuki;

  // 日報のチェック項目（全店舗共通。00006_mandala.sql の既定と同じ）
  const ITEMS = [
    ['start', '出勤・勤怠確認'], ['start', '当日の予約確認'], ['start', '引き継ぎ事項の確認'], ['start', 'Salon One / 必要事項の確認'], ['start', '各種電源ON'],
    ['during', '施術時間の管理、徹底'], ['during', 'スプシの数字入力'], ['during', '【入出金】出納帳の入力'], ['during', '予約変更・キャンセル対応'], ['during', '空き時間ログの記録'], ['during', 'カウンセリングシートの枚数'], ['during', 'お客様へのリマインド確認・送信'],
    ['end', 'リマインドの日付・時間を再確認'], ['end', 'Daily / 出納帳の入力漏れ確認'], ['end', '日報の作成・送信'], ['end', '週報・マンダラチャート【該当日】'], ['end', '翌日の予約確認、シート準備'], ['end', 'ゴミ出し【月・木 / ※要確認】'], ['end', '戸締り（入口）'], ['end', '戸締り（窓）'], ['end', '電気の確認'], ['end', '空調の確認'],
  ];
  const counters = {};
  for (const [section, label] of ITEMS) {
    counters[section] = (counters[section] || 0) + 10;
    out.mandala_daily_check_items.push({ id: uid(), store_id: null, section, label, sort_order: counters[section], is_active: true, created_at: new Date(now - 90 * 86400000).toISOString() });
  }
  out.mandala_daily_check_items.push({ id: uid(), store_id: 'store-2', section: 'end', label: '駐輪場の片付け（駅前店）', sort_order: 130, is_active: true, created_at: new Date(now - 90 * 86400000).toISOString() });

  // 佐藤さんの日報（直近 5日・昨日まで提出）
  const today = todayJst(now);
  recentDays(today, 6).slice(0, 5).forEach((day, i) => {
    if (i === 2) return; // 休み
    const reportId = uid();
    const at = `${day}T10:30:00.000Z`;
    out.mandala_daily_reports.push({ id: reportId, staff_id: 'st-sato', report_date: day, condition: null, learnings: '初めてのお客様にセルフケアを伝えたら、とても喜ばれた。', challenges: '', tomorrow: 'リマインドを午前中に送る', memo: '', status: 'submitted', submitted_at: at, created_at: at, updated_at: at });
    out.mandala_daily_check_items.filter((c) => !c.store_id).forEach((c, idx) => {
      out.mandala_daily_report_checks.push({ id: uid(), report_id: reportId, check_item_id: c.id, checked: (idx + i) % 7 !== 0 });
    });
  });
  return out;
}

/** 疑似 DB のキー（主キー） */
export const MANDALA_KEYS = {
  mandala_members: ['staff_id'],
  mandala_charts: ['id'],
  mandala_themes: ['id'],
  mandala_items: ['id'],
  mandala_weekly_reviews: ['id'],
  mandala_habit_checks: ['id'],
  mandala_focus_items: ['id'],
  mandala_ai_reviews: ['id'],
  mandala_review_comments: ['id'],
  mandala_cheers: ['id'],
  mandala_daily_check_items: ['id'],
  mandala_daily_reports: ['id'],
  mandala_daily_report_checks: ['id'],
  mandala_daily_report_comments: ['id'],
};
