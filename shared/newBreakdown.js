// ============================================================
// 新規の内訳（媒体別の新規数・契約数・契約率）— サーバー / ブラウザ共通・純粋関数
// ------------------------------------------------------------
// 売上分析の「新規の内訳と媒体別の契約率」で使う。
//   - 媒体 = shared/channels.js の経路（SalonOne の「来店経由」を、設定の対応付け・名前からまとめたもの）
//   - 新規・契約は computeMonth の経路別の数字（受付履歴から。インセンティブの判定と同じ数え方）。
//     契約は 2回目以降の来店で契約した分も、初回来店の月に数える
//   - 来店経由ごとの数字は computeMonth の sources（SalonOne の名前のまま。表示中の店舗の分）
// ============================================================

import { CHANNELS, channelLabel } from './channels.js';
import { INCENTIVE_RULES } from './incentive-rules.js';

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const sameName = (a, b) => String(a || '').normalize('NFKC').trim() === String(b || '').normalize('NFKC').trim();

/** 契約率（%）。新規が 0名なら null */
export const contractRatePct = (contracts, visits) => (n(visits) > 0 ? (n(contracts) / n(visits)) * 100 : null);

/**
 * @param {{ newVisits?:Object<string,number>, newContracts?:Object<string,number> }} metrics
 *   経路キー → 人数（表示中の店舗の合計。pickMetrics の newVisits / newContracts）
 * @param {Array<{ name:string, channel:string, newVisits:number, contracts:number }>} [sources] 来店経由ごと
 * @returns {{
 *   total: { visits:number, contracts:number, ratePct:number|null },
 *   threeChannels: { visits:number, contracts:number, ratePct:number|null, labels:string[] },
 *   media: Array<{ key:string, label:string, visits:number, contracts:number, ratePct:number|null, share:number,
 *     incentive:boolean, aliases:string[] }>,
 *   sources: Array<{ name:string, channel:string, channelLabel:string, visits:number, contracts:number, ratePct:number|null }>,
 * }}
 *   threeChannels: 新規契約インセンティブの 3経路の合計（契約率はインセンティブの判定と同じ）
 *   media: 新規の多い順（同数は経路の並び順）。3経路は 0名でも並べ、ほかは 0名なら出さない
 *   share: 新規全体に占める割合（0〜1）
 *   aliases: その媒体に入った来店経由のうち、媒体名と違う名前（「その他」の Googleマップ など。新規の多い順）
 *   sources: 来店経由ごと（新規の多い順）。新規が 0名のものは出さない
 */
export function newBreakdown(metrics, sources = []) {
  const visitsOf = (k) => n(metrics && metrics.newVisits && metrics.newVisits[k]);
  const contractsOf = (k) => n(metrics && metrics.newContracts && metrics.newContracts[k]);
  const order = new Map(CHANNELS.map((c, i) => [c.key, i]));
  const three = INCENTIVE_RULES.newContract.channels;

  const srcList = (sources || [])
    .filter((s) => s && n(s.newVisits) > 0)
    .map((s) => {
      const channel = order.has(s.channel) ? s.channel : 'other';
      const visits = n(s.newVisits);
      const contracts = n(s.contracts);
      return { name: String(s.name || '（未設定）'), channel, channelLabel: channelLabel(channel), visits, contracts, ratePct: contractRatePct(contracts, visits) };
    })
    .sort((a, b) => b.visits - a.visits || order.get(a.channel) - order.get(b.channel) || a.name.localeCompare(b.name, 'ja'));

  const totalVisits = CHANNELS.reduce((s, c) => s + visitsOf(c.key), 0);
  const totalContracts = CHANNELS.reduce((s, c) => s + contractsOf(c.key), 0);
  const media = CHANNELS
    .map((c) => {
      const visits = visitsOf(c.key);
      const contracts = contractsOf(c.key);
      return {
        key: c.key,
        label: c.label,
        visits,
        contracts,
        ratePct: contractRatePct(contracts, visits),
        share: totalVisits > 0 ? visits / totalVisits : 0,
        incentive: three.includes(c.key),
        aliases: srcList.filter((s) => s.channel === c.key && !sameName(s.name, c.label)).map((s) => s.name),
      };
    })
    .filter((m) => m.visits > 0 || m.incentive)
    .sort((a, b) => b.visits - a.visits || order.get(a.key) - order.get(b.key));

  const threeVisits = three.reduce((s, k) => s + visitsOf(k), 0);
  const threeContracts = three.reduce((s, k) => s + contractsOf(k), 0);
  return {
    total: { visits: totalVisits, contracts: totalContracts, ratePct: contractRatePct(totalContracts, totalVisits) },
    threeChannels: { visits: threeVisits, contracts: threeContracts, ratePct: contractRatePct(threeContracts, threeVisits), labels: three.map(channelLabel) },
    media,
    sources: srcList,
  };
}
