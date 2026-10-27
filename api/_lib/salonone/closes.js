// ============================================================
// インセンティブの確定（支給期間ごと）
// ------------------------------------------------------------
// 契約数は SalonOne の購入数と同じ「生涯基準」（後の月の契約で前の月の数が増える）、会員数・退会率は
// 「取得した時点」の値なので、支給した後に画面を開き直すと金額が変わることがある。
// 支給期間が終わったら、オーナー（管理者）がその時点の金額を「確定」として保存し、
// 以後はその金額を支給額として表示する（計算し直した金額は参考として並べる）。
//
//   dash_config: incentive.close.<期の最初の月 YYYY-MM>
//     { current: 確定の記録 | null, history: [取り消した・確定し直した記録（新しい順・10件まで）] }
//   確定の記録:
//     { periodStart, months, label, rulesVersion, closedAt, closedBy, note, dataAsOf, issues,
//       total, staff: [{ key, staffId, name, storeId, storeName, linked, total,
//                        months: [{ month, total, items: { sales, retention, ... }, basis: {...} }] }] }
//
// 'incentive.' のキーは /api/db の dashConfig からは読み書きできない（スタッフに他の人の金額を見せないため）。
// 確定・取り消しは summary.js の closePeriod / reopenPeriod から行う。
// ============================================================

import { supabase } from '../supabase.js';

export const CLOSE_PREFIX = 'incentive.close.';
const HISTORY_LIMIT = 10;

export const closeKeyOf = (periodStart) => `${CLOSE_PREFIX}${periodStart}`;

/** @returns {Promise<{ current: Object|null, history: Array }>} */
export async function loadCloseDoc(periodStart) {
  const { data, error } = await supabase.from('dash_config').select('value').eq('key', closeKeyOf(periodStart)).maybeSingle();
  if (error) throw error;
  const v = data && data.value && typeof data.value === 'object' ? data.value : {};
  return { current: v.current || null, history: Array.isArray(v.history) ? v.history : [] };
}

export async function saveCloseDoc(periodStart, doc) {
  const value = { current: doc.current || null, history: (doc.history || []).slice(0, HISTORY_LIMIT) };
  const { error } = await supabase.from('dash_config').upsert({ key: closeKeyOf(periodStart), value }, { onConflict: 'key' });
  if (error) throw error;
}

/**
 * 画面に返す確定の情報（見られる範囲のスタッフだけ）
 * @param {Object|null} record 確定の記録
 * @param {(row:Object) => boolean} canSee スタッフの行を見られるか
 */
export function closeView(record, canSee) {
  if (!record) return null;
  const staff = (record.staff || []).filter(canSee);
  return {
    periodStart: record.periodStart,
    months: record.months,
    label: record.label,
    closedAt: record.closedAt,
    closedBy: record.closedBy || '',
    note: record.note || '',
    dataAsOf: record.dataAsOf,
    rulesVersion: record.rulesVersion,
    total: staff.reduce((s, r) => s + (Number(r.total) || 0), 0),
    staff,
  };
}
