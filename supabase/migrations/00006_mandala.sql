-- ============================================================
-- マンダラチャート（週報・日報）をダッシュボードに組み込む
-- ------------------------------------------------------------
-- 旧「マンダラチャート週次進捗管理ツール」（別アプリ・Supabase Auth）の機能を
-- このダッシュボードへ移した。ログインはスタッフ URL（staff.id）をそのまま使い、
-- 「ブランド」の代わりに「店舗」（staff_stores）で見える範囲を決める。
--
-- 追跡するのはマンダラチャートと週報・日報が回っているかだけ。
-- 売上・施術数などの数値は SalonOne（このダッシュボード）で見るので、ここには持たない。
-- チャートの目標金額（センターゴールの「◯万円」）だけは目標そのものなので残す。
--
-- 他のテーブルと同じく、ブラウザから Supabase へ直接は触らせない
-- （Vercel の API が service_role で読み書きし、権限はサーバーで判定する）。
-- 念のため RLS を有効にしてポリシーは作らない（anon / authenticated からは何も見えない）。
--
-- 何度実行してもよい（IF NOT EXISTS）。
-- 旧ツールのデータは scripts/import-mandala-tool.mjs で移せる（docs/MANDALA.md）。
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------
-- 1. メンバーごとの設定（行が無い = 既定値）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mandala_members (
  staff_id             TEXT PRIMARY KEY REFERENCES staff(id) ON DELETE CASCADE,
  share_chart          BOOLEAN NOT NULL DEFAULT true,   -- 仲間にチャートを公開する（共有がオンのときだけ効く）
  daily_report_enabled BOOLEAN NOT NULL DEFAULT false,  -- 日報の対象（店長・オーナーが指定）
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 2. マンダラチャート（1人 1つ。8テーマ × 8項目）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mandala_charts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id         TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  title            TEXT NOT NULL DEFAULT '',
  center_goal      TEXT NOT NULL,
  baseline_amount  INTEGER,  -- 現状の月売上（円）
  target_amount    INTEGER,  -- 目標の月売上（円）
  target_breakdown TEXT,     -- 差分の内訳メモ（逆算）
  deadline_month   DATE,     -- 到達期限（月初日）
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mandala_themes (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chart_id UUID NOT NULL REFERENCES mandala_charts(id) ON DELETE CASCADE,
  position SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 8),
  title    TEXT NOT NULL DEFAULT '',
  UNIQUE (chart_id, position)
);

-- item_type: action=行動（週次チェックできる）/ metric=数値（SalonOne で見る。ここでは追跡しない）/ mindset=心構え
CREATE TABLE IF NOT EXISTS mandala_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  theme_id         UUID NOT NULL REFERENCES mandala_themes(id) ON DELETE CASCADE,
  position         SMALLINT NOT NULL CHECK (position BETWEEN 1 AND 8),
  content          TEXT NOT NULL DEFAULT '',
  item_type        TEXT NOT NULL DEFAULT 'action' CHECK (item_type IN ('action', 'metric', 'mindset')),
  weekly_trackable BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (theme_id, position)
);

-- ------------------------------------------------------------
-- 3. 週報（週は月曜はじまり・日本時間）
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mandala_weekly_reviews (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  week_start   DATE NOT NULL CHECK (EXTRACT(ISODOW FROM week_start) = 1),
  good_things  TEXT,
  challenges   TEXT,
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  submitted_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (staff_id, week_start)
);

-- その週の「できた行動」（action かつ週次チェック対象の項目）
CREATE TABLE IF NOT EXISTS mandala_habit_checks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id       UUID NOT NULL REFERENCES mandala_weekly_reviews(id) ON DELETE CASCADE,
  mandala_item_id UUID NOT NULL REFERENCES mandala_items(id) ON DELETE CASCADE,
  checked         BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (review_id, mandala_item_id)
);

-- 週のフォーカス（最大 3つ。自分で選ぶ or AI の提案を採用）
CREATE TABLE IF NOT EXISTS mandala_focus_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id        TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  week_start      DATE NOT NULL CHECK (EXTRACT(ISODOW FROM week_start) = 1),
  mandala_item_id UUID REFERENCES mandala_items(id) ON DELETE SET NULL,
  free_text       TEXT,
  source          TEXT NOT NULL DEFAULT 'self' CHECK (source IN ('self', 'ai')),
  achieved        BOOLEAN,
  sort_order      SMALLINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (mandala_item_id IS NOT NULL OR free_text IS NOT NULL)
);

-- AI レビュー（モデル・プロンプトの版・トークン数も残す）
CREATE TABLE IF NOT EXISTS mandala_ai_reviews (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id      UUID NOT NULL REFERENCES mandala_weekly_reviews(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL DEFAULT 'weekly' CHECK (kind IN ('weekly')),
  model          TEXT NOT NULL,
  prompt_version TEXT NOT NULL DEFAULT 'v2',
  result         JSONB NOT NULL,
  input_tokens   INTEGER,
  output_tokens  INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 週報へのコメント（店長・オーナー → スタッフ。本人も返信できる）
-- author_id が NULL = 管理者モード（スタッフ URL 無し）。author_name は投稿時の名前
CREATE TABLE IF NOT EXISTS mandala_review_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id   UUID NOT NULL REFERENCES mandala_weekly_reviews(id) ON DELETE CASCADE,
  author_id   TEXT REFERENCES staff(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 仲間のチャートに送る応援
CREATE TABLE IF NOT EXISTS mandala_cheers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chart_id    UUID NOT NULL REFERENCES mandala_charts(id) ON DELETE CASCADE,
  author_id   TEXT REFERENCES staff(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 4. 日報（若手メンバー向け。紙の「業務チェックリスト」と同じ構成）
-- ------------------------------------------------------------
-- チェック項目。store_id が NULL = 全店舗共通（オーナーが設定）。店舗の行は店長も設定できる
CREATE TABLE IF NOT EXISTS mandala_daily_check_items (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id   TEXT REFERENCES stores(id) ON DELETE CASCADE,
  section    TEXT NOT NULL DEFAULT 'during' CHECK (section IN ('start', 'during', 'end')),
  label      TEXT NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mandala_daily_reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  report_date  DATE NOT NULL,
  condition    SMALLINT CHECK (condition BETWEEN 1 AND 5),
  learnings    TEXT,  -- 今日の学び・よかったこと
  challenges   TEXT,  -- 課題・つまずき
  tomorrow     TEXT,  -- 明日やること
  memo         TEXT,  -- 備考・メモ
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  submitted_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (staff_id, report_date)
);

CREATE TABLE IF NOT EXISTS mandala_daily_report_checks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id     UUID NOT NULL REFERENCES mandala_daily_reports(id) ON DELETE CASCADE,
  check_item_id UUID NOT NULL REFERENCES mandala_daily_check_items(id) ON DELETE CASCADE,
  checked       BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (report_id, check_item_id)
);

CREATE TABLE IF NOT EXISTS mandala_daily_report_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   UUID NOT NULL REFERENCES mandala_daily_reports(id) ON DELETE CASCADE,
  author_id   TEXT REFERENCES staff(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL DEFAULT '',
  body        TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 5. インデックス・updated_at
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_mandala_charts_staff     ON mandala_charts (staff_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mandala_charts_updated   ON mandala_charts (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mandala_themes_chart     ON mandala_themes (chart_id);
CREATE INDEX IF NOT EXISTS idx_mandala_items_theme      ON mandala_items (theme_id);
CREATE INDEX IF NOT EXISTS idx_mandala_reviews_week     ON mandala_weekly_reviews (week_start);
CREATE INDEX IF NOT EXISTS idx_mandala_reviews_updated  ON mandala_weekly_reviews (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mandala_checks_review    ON mandala_habit_checks (review_id);
CREATE INDEX IF NOT EXISTS idx_mandala_focus_staff_week ON mandala_focus_items (staff_id, week_start);
CREATE INDEX IF NOT EXISTS idx_mandala_ai_review        ON mandala_ai_reviews (review_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mandala_comments_review  ON mandala_review_comments (review_id, created_at);
CREATE INDEX IF NOT EXISTS idx_mandala_comments_created ON mandala_review_comments (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mandala_cheers_chart     ON mandala_cheers (chart_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mandala_check_items      ON mandala_daily_check_items (store_id, section, sort_order);
CREATE INDEX IF NOT EXISTS idx_mandala_daily_date       ON mandala_daily_reports (report_date);
CREATE INDEX IF NOT EXISTS idx_mandala_daily_checks     ON mandala_daily_report_checks (report_id);
CREATE INDEX IF NOT EXISTS idx_mandala_daily_comments   ON mandala_daily_report_comments (report_id, created_at);

-- update_updated_at() は 00001_initial_schema.sql で定義済み
DROP TRIGGER IF EXISTS trg_mandala_charts_updated ON mandala_charts;
CREATE TRIGGER trg_mandala_charts_updated BEFORE UPDATE ON mandala_charts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_mandala_reviews_updated ON mandala_weekly_reviews;
CREATE TRIGGER trg_mandala_reviews_updated BEFORE UPDATE ON mandala_weekly_reviews
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_mandala_daily_updated ON mandala_daily_reports;
CREATE TRIGGER trg_mandala_daily_updated BEFORE UPDATE ON mandala_daily_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_mandala_members_updated ON mandala_members;
CREATE TRIGGER trg_mandala_members_updated BEFORE UPDATE ON mandala_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------------------------------
-- 6. RLS（service_role だけが読み書きする。ポリシーは作らない）
-- ------------------------------------------------------------
ALTER TABLE mandala_members               ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandala_charts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandala_themes                ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandala_items                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandala_weekly_reviews        ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandala_habit_checks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandala_focus_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandala_ai_reviews            ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandala_review_comments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandala_cheers                ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandala_daily_check_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandala_daily_reports         ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandala_daily_report_checks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandala_daily_report_comments ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 7. 日報の既定のチェック項目（全店舗共通。項目が 1件も無いときだけ入れる）
-- ------------------------------------------------------------
INSERT INTO mandala_daily_check_items (store_id, section, label, sort_order)
SELECT NULL, v.section, v.label, v.sort_order
FROM (VALUES
  ('start',  '出勤・勤怠確認',                                  10),
  ('start',  '当日の予約確認',                                  20),
  ('start',  '引き継ぎ事項の確認',                              30),
  ('start',  'Salon One / 必要事項の確認',                      40),
  ('start',  '各種電源ON',                                      50),
  ('during', '施術時間の管理、徹底',                            10),
  ('during', 'スプシの数字入力',                                20),
  ('during', '【入出金】出納帳の入力',                          30),
  ('during', '予約変更・キャンセル対応',                        40),
  ('during', '空き時間ログの記録',                              50),
  ('during', 'カウンセリングシートの枚数',                      60),
  ('during', 'お客様へのリマインド確認・送信',                  70),
  ('end',    'リマインドの日付・時間を再確認',                  10),
  ('end',    'Daily / 出納帳の入力漏れ確認',                    20),
  ('end',    '日報の作成・送信',                                30),
  ('end',    '週報・マンダラチャート【該当日】',                40),
  ('end',    '翌日の予約確認、シート準備',                      50),
  ('end',    'ゴミ出し【月・木 / ※要確認】',                    60),
  ('end',    '戸締り（入口）',                                  70),
  ('end',    '戸締り（窓）',                                    80),
  ('end',    '戸締り（トイレ窓）',                              90),
  ('end',    '電気の確認',                                     100),
  ('end',    '空調の確認',                                     110),
  ('end',    '忘れ物・未対応事項の最終確認や疑問点の報告',     120)
) AS v(section, label, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM mandala_daily_check_items);

COMMENT ON TABLE mandala_charts IS 'マンダラチャート（1人1つ）。数値の実績は持たない（SalonOne で見る）';
COMMENT ON TABLE mandala_weekly_reviews IS '週報（行動チェック・フォーカス・ひとこと振り返り）';
COMMENT ON TABLE mandala_daily_reports IS '日報（若手メンバー向け。業務チェックと定性の振り返り）';
COMMENT ON COLUMN mandala_daily_check_items.store_id IS 'NULL = 全店舗共通の項目';
