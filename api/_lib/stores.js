// ============================================================
// 店舗マスタ補助ヘルパー
// ------------------------------------------------------------
// Square 連携店舗の "本当の名前" は環境変数 SQUARE_STORE_{N}_NAME に
// 保管されている。Supabase の stores テーブルには別途レコードが必要
// (FK 制約のため) だが、スタッフを店舗に紐付けたタイミングで自動挿入
// していたので、SQUARE_STORE_{N}_NAME が無いと "店舗 N" という
// プレースホルダ名で保存されてしまっていた。
//
// このヘルパーは:
//   - resolveStoreNameFromEnv(id): 環境変数から実名を解決
//   - listSquareEnvStores():       env var で定義されている全店舗を列挙
//   - resolveStoreId(supabase,id): merged_into を辿って正規IDへ解決
//   - expandStoreIdsWithAliases:   storeIds に merged_into 先を追加
// を提供し、ハンドラ側でプレースホルダ insert と重複統合を扱う。
// ============================================================

import { supabase as defaultSupabase } from './supabase.js';

// 環境変数から店舗名を解決する。優先順位:
//   1. SQUARE_STORE_{id}_NAME
//   2. id === 'default' なら SQUARE_STORE_NAME
//   3. 見つからなければ null（呼び出し元で fallback）
export function resolveStoreNameFromEnv(storeId) {
  if (!storeId) return null;
  const id = String(storeId);
  const direct = process.env[`SQUARE_STORE_${id}_NAME`];
  if (direct) return direct;
  if (id === 'default') {
    const def = process.env.SQUARE_STORE_NAME;
    if (def) return def;
  }
  return null;
}

// 環境変数で定義されている Square 店舗を列挙する
// （square/config.js と同じスキャンロジック）
export function listSquareEnvStores() {
  const stores = [];
  // 既定店舗
  if (process.env.SQUARE_ACCESS_TOKEN && process.env.SQUARE_ACCESS_TOKEN !== 'YOUR_SQUARE_ACCESS_TOKEN') {
    stores.push({
      id: 'default',
      name: process.env.SQUARE_STORE_NAME || 'デフォルト店舗',
    });
  }
  // 多店舗 (SQUARE_STORE_1〜20)
  for (let i = 1; i <= 20; i++) {
    if (!process.env[`SQUARE_STORE_${i}_ACCESS_TOKEN`]) continue;
    stores.push({
      id: String(i),
      name: process.env[`SQUARE_STORE_${i}_NAME`] || `店舗 ${i}`,
    });
  }
  return stores;
}

// プレースホルダ名（ensureStoresExist が過去に生成した "店舗 N" 形式）
// かどうかを判定する。新形式 "(未登録: ID)" もプレースホルダ扱い。
export function isPlaceholderStoreName(name, id) {
  if (!name) return true;
  if (name === `店舗 ${id}`) return true;
  if (name === `(未登録: ${id})`) return true;
  return false;
}

// ------------------------------------------------------------
// マージ別名（merged_into）の解決
// ------------------------------------------------------------
// 重複統合された行は merged_into に正規IDが入っている。
// 新規書き込み時はサーバ側でこの解決を挟み、発行済みURLや
// 古いデータの storeId をそのまま受け付けつつ正規IDへ寄せる。

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

// 複数 ID をまとめて解決する（N+1 を避けるため一括 select）。
// 戻り値: { [originalId]: canonicalId }
export async function resolveStoreIds(storeIds, supabase = defaultSupabase) {
  const out = {};
  const ids = [...new Set((storeIds || []).map(String).filter(Boolean))];
  if (ids.length === 0) return out;
  for (const id of ids) out[id] = id; // デフォルト=自身
  try {
    const { data } = await supabase
      .from('stores')
      .select('id, merged_into')
      .in('id', ids);
    for (const r of data || []) {
      if (r.merged_into) out[String(r.id)] = String(r.merged_into);
    }
  } catch (_) { /* fallback to identity map */ }
  return out;
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
