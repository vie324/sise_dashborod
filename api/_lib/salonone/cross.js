// ============================================================
// 系列店での契約（ドミナント出店）
// ------------------------------------------------------------
// 来店した店舗とは別の系列店で契約したお客様は、SalonOne では契約した店舗の契約になる。
// 店長以上がこのシステムで登録すると、初回に来店した店舗のスタッフに 1件 2,000円
// （INCENTIVE_RULES.crossStore）が付く。契約した店舗の SalonOne の契約（受付）を選んで結びつけると、
// その店舗の新規契約の数から除く（二重に数えない。SalonOne の購入数そのものは変えない）。
//
//   dash_config: incentive.cross.<契約日の月 YYYY-MM>
//     { items: [Entry], removed: [削除した Entry（新しい順・20件まで）], updatedAt, updatedBy }
//   Entry:
//     { id, date, customerName, planName, contractStoreId,
//       creditKey（2,000円を付ける SalonOne のスタッフ ID）, creditName, creditStoreId,
//       link: { shopId, customerId, receptionId, staffKey, staffName, time } | null,
//       memo, createdAt, createdBy }
//
// 'incentive.' のキーは /api/db の dashConfig からは読み書きできない（お客様名を含むため）。
// 登録・削除・一覧は summary の crossStore* から行う（api/_lib/salonone/cross-handlers.js）。
// ============================================================

import { supabase } from '../supabase.js';

export const CROSS_PREFIX = 'incentive.cross.';
const REMOVED_LIMIT = 20;

export const crossKeyOf = (month) => `${CROSS_PREFIX}${month}`;

/**
 * 月ごとの登録（1回の問い合わせで読む）
 * @param {string[]} months 'YYYY-MM'
 * @returns {Promise<Map<string, { items:Array, removed:Array }>>}
 */
export async function loadCrossDocs(months) {
  const list = [...new Set(months)];
  const out = new Map(list.map((m) => [m, { items: [], removed: [] }]));
  if (list.length === 0) return out;
  const { data, error } = await supabase.from('dash_config').select('key, value').in('key', list.map(crossKeyOf));
  if (error) throw error;
  for (const row of data || []) {
    const month = String(row.key).slice(CROSS_PREFIX.length);
    const v = row.value && typeof row.value === 'object' ? row.value : {};
    out.set(month, { items: Array.isArray(v.items) ? v.items : [], removed: Array.isArray(v.removed) ? v.removed : [] });
  }
  return out;
}

/** 月の登録をまとめて読む（items だけ。月の順） */
export async function loadCrossEntries(months) {
  const docs = await loadCrossDocs(months);
  return [...docs.values()].flatMap((d) => d.items);
}

export async function saveCrossDoc(month, doc, operator) {
  const value = {
    items: doc.items || [],
    removed: (doc.removed || []).slice(0, REMOVED_LIMIT),
    updatedAt: new Date().toISOString(),
    updatedBy: operator || '',
  };
  const { error } = await supabase.from('dash_config').upsert({ key: crossKeyOf(month), value }, { onConflict: 'key' });
  if (error) throw error;
}

/** 契約した店舗の新規契約から除く契約（SalonOne の店舗 ID|顧客 ID） */
export const linkKeyOf = (link) => (link && link.shopId && link.customerId ? `${link.shopId}|${link.customerId}` : null);

export function crossExclusions(entries) {
  return new Set((entries || []).map((e) => linkKeyOf(e.link)).filter(Boolean));
}

/** 月 → スタッフ（SalonOne のスタッフ ID）→ 件数 */
export function crossCreditsByMonth(entries) {
  const out = new Map();
  for (const e of entries || []) {
    if (!e || !e.creditKey || !e.date) continue;
    const month = String(e.date).slice(0, 7);
    const byStaff = out.get(month) || new Map();
    byStaff.set(e.creditKey, (byStaff.get(e.creditKey) || 0) + 1);
    out.set(month, byStaff);
  }
  return out;
}
