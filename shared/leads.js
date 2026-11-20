// ============================================================
// 新規台帳の「契約できなかった理由」（画面のタブと、未契約の理由の一覧の集計で使う）
// ------------------------------------------------------------
// 記録は理由のタブ（reasons: 下の選択肢）とメモ（reason: 自由に書く）を持つ。
// 前の形の記録（タブを押すと理由の文に「・」でつないで足していた）は、文の中のタブを拾って同じように扱う。
// ============================================================

export const LOST_REASONS = Object.freeze([
  '料金が合わない',
  '通う時間・頻度が合わない',
  '効果をもう少し見たい',
  '他店と比べたい',
  '家族と相談',
  '体験だけのつもり',
  'イベント直前',
  '旅行中',
  '仕事・家庭の都合',
  '開始時期を改めたい',
  '必要性を感じさせられなかった',
]);

const KNOWN = new Set(LOST_REASONS);

/** 理由のタブを、選択肢にあるものだけ・重なりなく・選択肢の順にする */
export function cleanReasonTags(list) {
  const picked = new Set([].concat(list || []).map((v) => String(v == null ? '' : v).trim()).filter((v) => KNOWN.has(v)));
  return LOST_REASONS.filter((r) => picked.has(r));
}

/**
 * 前の形の理由の文を、タブとメモに分ける。
 * 行がタブだけ（「料金が合わない・家族と相談」）ならタブにし、それ以外の行はそのままメモに残す
 */
export function splitReasonText(text) {
  const tags = [];
  const memo = [];
  for (const line of String(text == null ? '' : text).split('\n')) {
    const parts = line.split('・').map((p) => p.trim()).filter(Boolean);
    // 「通う時間・頻度が合わない」「仕事・家庭の都合」は「・」を含むので、つなぎ直して選択肢と見比べる
    const found = [];
    let ok = parts.length > 0;
    for (let i = 0; i < parts.length && ok; i += 1) {
      const two = i + 1 < parts.length ? `${parts[i]}・${parts[i + 1]}` : '';
      if (two && KNOWN.has(two)) { found.push(two); i += 1; }
      else if (KNOWN.has(parts[i])) found.push(parts[i]);
      else ok = false;
    }
    if (ok) tags.push(...found);
    else if (line.trim()) memo.push(line.trim());
  }
  return { tags: cleanReasonTags(tags), memo: memo.join('\n') };
}

/** 記録の理由のタブとメモ（新しい記録は reasons と reason、前の形の記録は理由の文から） */
export function reasonPartsOf(record) {
  if (!record || record.outcome !== 'lost') return { tags: [], memo: '' };
  if (Array.isArray(record.reasons)) return { tags: cleanReasonTags(record.reasons), memo: String(record.reason || '') };
  return splitReasonText(record.reason);
}
