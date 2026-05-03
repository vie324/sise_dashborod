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
// を提供し、ハンドラ側でプレースホルダ insert を防ぐ。
// ============================================================

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
