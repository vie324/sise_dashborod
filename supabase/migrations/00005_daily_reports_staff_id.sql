-- ============================================================
-- 日報をスタッフへ FK で紐付ける
-- ------------------------------------------------------------
-- 既存の recorder(TEXT) はスタッフ名の自由記入で、(1) 改名で過去日報が
-- 切り離される、(2) 同姓スタッフが合算される、(3) 表記揺れで別人扱いに
-- なる、という問題がある。staff_id (FK) を追加して正の紐付けにする。
--
-- recorder はメール本文や旧データ表示の互換のため残す。集計は
-- staff_id 優先で、無ければ recorder にフォールバックする。
--
-- ON DELETE SET NULL: スタッフ行が物理削除された場合は staff_id を NULL
-- に落として日報自体は保持する（運用上は status='inactive' なので発生
-- しないはずだが防御的に）。
-- ============================================================

ALTER TABLE daily_reports
  ADD COLUMN IF NOT EXISTS staff_id TEXT REFERENCES staff(id) ON DELETE SET NULL;

COMMENT ON COLUMN daily_reports.staff_id IS '日報送信者のスタッフID (staff.id への FK)。NULL は旧データ／未割当。';

CREATE INDEX IF NOT EXISTS idx_daily_reports_staff_id ON daily_reports(staff_id) WHERE staff_id IS NOT NULL;

-- 既存データの一発バックフィル: recorder が staff.name と完全一致する
-- 行を自動マッチさせる。複数スタッフが同名だった場合は曖昧なので
-- 何もしない（管理画面の手動アサインで対応する）。
WITH unique_names AS (
  SELECT name, MIN(id) AS id
  FROM staff
  GROUP BY name
  HAVING COUNT(*) = 1
)
UPDATE daily_reports d
SET staff_id = u.id
FROM unique_names u
WHERE d.staff_id IS NULL
  AND d.recorder IS NOT NULL
  AND d.recorder <> ''
  AND d.recorder = u.name;
