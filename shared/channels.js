// ============================================================
// 集客経路（媒体）の正規化
// ------------------------------------------------------------
// SalonOne の「来店経由」は店舗ごとに自由に名前を付けられるため、
// インセンティブ判定に使う経路キーへ寄せる必要がある。
//   1) 設定画面で保存した明示マッピング（媒体名 → 経路キー）を最優先
//   2) 無ければ媒体名のキーワードから推定
// ============================================================

export const CHANNELS = [
  { key: 'hotpepper', label: 'ホットペッパー', short: 'HPB' },
  { key: 'meta', label: 'Meta広告', short: 'Meta' },
  { key: 'homepage', label: 'ホームページ', short: 'Web' },
  { key: 'minimo', label: 'Minimo', short: 'Minimo' },
  { key: 'threads', label: 'Threads', short: 'Threads' },
  { key: 'instagram', label: 'Instagram', short: 'Insta' },
  { key: 'referral', label: '紹介', short: '紹介' },
  { key: 'other', label: 'その他', short: 'その他' },
];

export const CHANNEL_KEYS = CHANNELS.map((c) => c.key);

const LABELS = Object.fromEntries(CHANNELS.map((c) => [c.key, c.label]));

export function channelLabel(key) {
  return LABELS[key] || LABELS.other;
}

// キーワード推定。上から順に評価する（「Instagram広告」は Meta 広告として扱う
// ため meta を instagram より先に置く）。
// 「HP」は業界ではホットペッパーの略として使われることが多く、制度資料の計算例
// （HP 10名 / Meta 5名 / Web 3名）でもホットペッパーを指しているため hotpepper に寄せる。
// Google マップ（MEO）やチラシは 3 経路に含めないため、どれにも当てはまらず other になる。
const KEYWORD_RULES = [
  { key: 'referral', re: /紹介|リファラル|referral/i },
  { key: 'hotpepper', re: /ホットペッパー|ﾎｯﾄﾍﾟｯﾊﾟｰ|hot\s*pepper|hpb|サロンボード|salon\s*board|^hp$|^hp[\s_\-（(]/i },
  { key: 'meta', re: /\bmeta\b|メタ広告|facebook|フェイスブック|\bfb\b|インスタ広告|instagram\s*広告/i },
  { key: 'minimo', re: /minimo|ミニモ/i },
  { key: 'threads', re: /threads|スレッズ/i },
  { key: 'instagram', re: /instagram|インスタ|\binsta\b|\big\b/i },
  { key: 'homepage', re: /ホームページ|自社サイト|公式サイト|\bweb\b|ウェブ|website|\blp\b/i },
];

export function guessChannel(sourceName) {
  const name = String(sourceName || '').trim();
  if (!name) return 'other';
  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(name)) return rule.key;
  }
  return 'other';
}

/**
 * 媒体名 → 経路キー。
 * @param {string} sourceName SalonOne の来店経由名
 * @param {Record<string,string>} [mapping] 設定画面で保存した明示マッピング
 */
export function resolveChannel(sourceName, mapping) {
  const name = String(sourceName || '').trim();
  if (mapping && name && Object.prototype.hasOwnProperty.call(mapping, name)) {
    const key = mapping[name];
    if (CHANNEL_KEYS.includes(key)) return key;
  }
  return guessChannel(name);
}
