// ============================================================
// 店舗マスタ補助ヘルパー
// ------------------------------------------------------------
// 重複統合された店舗（merged_into が入った別名行）の解決を行う。
//   - resolveStoreId(id):           merged_into を辿って正規IDへ解決
//   - expandStoreIdsWithAliases:    storeIds に別名・統合先を追加
// 発行済みスタッフ URL や過去の出納帳データの storeId をそのまま受け付けつつ、
// 新しい書き込みは正規IDへ寄せるために使う。
// ============================================================

import { supabase as defaultSupabase } from './supabase.js';

// 単一の storeId を merged_into を辿って正規IDへ解決する。
// 1 段だけ辿る（マイグレーション 00002 の仕様: チェーン禁止）。
// 戻り値は常に存在する（解決できなければ入力 ID をそのまま返す）。
export async function resolveStoreId(storeId, supabase = defaultSupabase) {
  if (!storeId) return storeId;
  try {
    const { data } = await supabase
      .from('stores')
      .select('id, merged_into')
      .eq('id', String(storeId))
      .maybeSingle();
    if (data && data.merged_into) return String(data.merged_into);
  } catch (_) { /* DB エラー時は元の ID を返して下流の FK 制約に任せる */ }
  return String(storeId);
}

// staff の storeIds リストに、merged_into 先と「自身を merged_into に
// 持つ別名行」の両方を追加する。スタッフが旧IDで紐付いていても新IDで
// アクセスでき、新IDで紐付いていても旧データを参照できるようにする。
export async function expandStoreIdsWithAliases(storeIds, supabase = defaultSupabase) {
  const baseIds = [...new Set((storeIds || []).map(String).filter(Boolean))];
  if (baseIds.length === 0) return [];
  const expanded = new Set(baseIds);
  try {
    // forward: merged_into 先を含める
    const { data: fwd } = await supabase
      .from('stores')
      .select('id, merged_into')
      .in('id', baseIds);
    for (const r of fwd || []) {
      if (r.merged_into) expanded.add(String(r.merged_into));
    }
    // reverse: 自身を merged_into に持つ別名行も含める
    const { data: rev } = await supabase
      .from('stores')
      .select('id')
      .in('merged_into', baseIds);
    for (const r of rev || []) expanded.add(String(r.id));
  } catch (_) { /* fallback to base */ }
  return Array.from(expanded);
}
