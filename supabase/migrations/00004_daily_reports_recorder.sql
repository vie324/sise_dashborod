-- ============================================================
-- 日報の送信者(recorder)を保存できるようにする
-- ------------------------------------------------------------
-- 日報フォームは以前から `recorder`（送信者＝スタッフ名）を送り、
-- 通知メールには送信者として記載していたが、daily_reports に保存先
-- カラムが無く DB には永続化されていなかった（メール送信後に失われ
-- ていた）。スタッフ別の集計・ランキング表示のためにこのカラムを
-- 追加して保存する。
--
-- 追加のみ・デフォルト '' なので、既存コード／既存行に影響しない。
-- 既存DBに対しては、このマイグレーションを先に実行してから
-- recorder を書き込むアプリ側コードをデプロイすること。
-- ============================================================

ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS recorder TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN daily_reports.recorder IS '日報の送信者（スタッフ名）。空文字は未記入扱い。';

-- スタッフ別集計の絞り込みに使われるためインデックスを追加
CREATE INDEX IF NOT EXISTS idx_daily_reports_recorder ON daily_reports(recorder) WHERE recorder <> '';
