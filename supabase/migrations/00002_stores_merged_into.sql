-- ============================================================
-- 店舗の重複統合（マージ別名）対応
-- ------------------------------------------------------------
-- 過去に "店舗 N" プレースホルダ名のままだった頃、ユーザーが手動で
-- 同じ店舗を追加してしまい、`stores` テーブルに同名で異なる ID の
-- 行が複数できているケースがある。
-- 重複行を削除すると、既に発行済みのスタッフ URL が `staff_stores`
-- に持つ store_id の参照や、cashbook / attendance などの履歴データの
-- 整合が崩れる。そこで重複行を「正規IDへのエイリアス」として残す
-- 設計に切り替える。
--
-- ・merged_into が NULL でない行 = 別名（重複）行
-- ・新規データ書き込みはサーバ側で merged_into を辿って正規IDへ統合
-- ・発行済み URL の storeIds に重複IDが含まれていても DB 上は健在の
--   ため引き続き参照可能（canAccessStore 側で別名展開する）
-- ============================================================

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS merged_into TEXT
    REFERENCES stores(id) ON DELETE SET NULL;

-- merged_into が指す先は (将来的に) 別名チェーンを作らせないため
-- アプリケーション層で 1 段に正規化する。NULL = 通常店舗。
COMMENT ON COLUMN stores.merged_into IS '正規店舗への別名 (重複統合)。NULL = 通常店舗。';

-- merged_into を引きやすくするためのインデックス
CREATE INDEX IF NOT EXISTS idx_stores_merged_into ON stores(merged_into) WHERE merged_into IS NOT NULL;
