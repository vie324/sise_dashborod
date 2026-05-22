-- ============================================================
-- SISE Dashboard: Supabase Schema Migration
-- GAS Spreadsheet → PostgreSQL
-- ============================================================
-- Migration order follows the dependency graph:
--   stores → staff/staff_stores → everything else
-- ============================================================

-- ============================================================
-- 1. 店舗管理 (stores)
-- ============================================================
CREATE TABLE stores (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active',  -- active / inactive
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  memo       TEXT DEFAULT '',
  lat        DOUBLE PRECISION,
  lng        DOUBLE PRECISION
);

COMMENT ON TABLE stores IS 'GASシート: 店舗管理';

-- ============================================================
-- 2. スタッフ管理 (staff)
-- ============================================================
CREATE TABLE staff (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'staff',    -- staff / manager / admin
  password   TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status     TEXT NOT NULL DEFAULT 'active'    -- active / inactive
);

COMMENT ON TABLE staff IS 'GASシート: スタッフ管理';

-- GASではカンマ区切りだった staff × store の多対多を正規化
CREATE TABLE staff_stores (
  staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, store_id)
);

COMMENT ON TABLE staff_stores IS 'スタッフと店舗の多対多リレーション (GASではカンマ区切り文字列)';

-- ============================================================
-- 3. ダッシュボード設定 (dash_config)
-- ============================================================
CREATE TABLE dash_config (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE dash_config IS 'GASシート: ダッシュボード設定 (KVストア)';

-- ============================================================
-- 4. メニュー (menu_items)
-- ============================================================
CREATE TABLE menu_items (
  id         TEXT PRIMARY KEY,              -- menu_[timestamp36][random]
  name       TEXT NOT NULL,
  category   TEXT DEFAULT '',
  price      INTEGER NOT NULL DEFAULT 0,
  item_type  TEXT NOT NULL DEFAULT 'menu',
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE menu_items IS 'GASシート: メニュー';

-- ============================================================
-- 5. HPBデータ (hpb_data)
-- ============================================================
CREATE TABLE hpb_data (
  year_month TEXT PRIMARY KEY,              -- YYYY-MM
  views      INTEGER NOT NULL DEFAULT 0,
  bookings   INTEGER NOT NULL DEFAULT 0,
  cost       INTEGER NOT NULL DEFAULT 0,
  clicks     INTEGER NOT NULL DEFAULT 0,
  cvr        DOUBLE PRECISION NOT NULL DEFAULT 0,
  memo       TEXT DEFAULT ''
);

COMMENT ON TABLE hpb_data IS 'GASシート: HPBデータ (月次集計)';

-- ============================================================
-- 6. 出納帳 (cashbook)
-- ============================================================
CREATE TABLE cashbook (
  id              TEXT PRIMARY KEY,          -- cb_[timestamp36][random]
  date            DATE NOT NULL,
  type            TEXT NOT NULL DEFAULT '',   -- 種別
  category        TEXT DEFAULT '',
  description     TEXT DEFAULT '',
  amount          INTEGER NOT NULL DEFAULT 0,
  customer_name   TEXT DEFAULT '',
  treatment_count INTEGER DEFAULT 0,
  payment_method  TEXT NOT NULL DEFAULT 'CASH',
  cash_type       TEXT NOT NULL DEFAULT 'register',  -- register / safe / petty
  member_id       TEXT DEFAULT '',
  store_id        TEXT NOT NULL REFERENCES stores(id),
  recorder        TEXT DEFAULT '',
  notes           TEXT DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      TEXT DEFAULT '',
  deleted         BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_cashbook_store_date ON cashbook(store_id, date);
CREATE INDEX idx_cashbook_date       ON cashbook(date);

COMMENT ON TABLE cashbook IS 'GASシート: 出納帳';

-- ============================================================
-- 7. 出納帳ログ (cashbook_log) - 監査証跡
-- ============================================================
CREATE TABLE cashbook_log (
  id        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now(),
  action    TEXT NOT NULL,                   -- create / update / delete
  entry_id  TEXT NOT NULL,                   -- cashbook.id への参照
  store_id  TEXT DEFAULT '',
  operator  TEXT DEFAULT '',
  before    JSONB,
  after     JSONB
);

CREATE INDEX idx_cashbook_log_entry ON cashbook_log(entry_id);

COMMENT ON TABLE cashbook_log IS 'GASシート: 出納帳ログ (監査証跡)';

-- ============================================================
-- 8. 日次締め (daily_close)
-- ============================================================
CREATE TABLE daily_close (
  date             DATE NOT NULL,
  store_id         TEXT NOT NULL REFERENCES stores(id),
  safe_balance     INTEGER NOT NULL DEFAULT 0,
  petty_balance    INTEGER NOT NULL DEFAULT 0,
  register_balance INTEGER NOT NULL DEFAULT 0,
  closed_by        TEXT DEFAULT '',
  closed_at        TIMESTAMPTZ,
  notes            TEXT DEFAULT '',
  locked           BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (date, store_id)
);

COMMENT ON TABLE daily_close IS 'GASシート: 日次締め';

-- ============================================================
-- 9. 利用回数 (usage_records)
-- ============================================================
CREATE TABLE usage_records (
  member_id  TEXT NOT NULL,
  member_name TEXT DEFAULT '',
  store_name TEXT DEFAULT '',
  plan_name  TEXT DEFAULT '',
  month      TEXT NOT NULL,               -- YYYY-MM
  period_key TEXT NOT NULL DEFAULT '',
  count      INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, month, period_key)
);

COMMENT ON TABLE usage_records IS 'GASシート: 利用回数';

-- ============================================================
-- 10. 回数券プラン (ticket_plans)
-- ============================================================
CREATE TABLE ticket_plans (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  sessions      INTEGER NOT NULL DEFAULT 0,
  price         INTEGER NOT NULL DEFAULT 0,
  validity_days INTEGER NOT NULL DEFAULT 0,
  active        BOOLEAN NOT NULL DEFAULT false
);

COMMENT ON TABLE ticket_plans IS 'GASシート: 回数券プラン';

-- ============================================================
-- 11. 回数券データ (ticket_data)
-- ============================================================
-- GASでは1行1JSONだったものをJSONB列で保持
CREATE TABLE ticket_data (
  id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  data JSONB NOT NULL
);

COMMENT ON TABLE ticket_data IS 'GASシート: 回数券データ (JSON格納)';

-- ============================================================
-- 12. QR現金会員 (members)
-- ============================================================
-- GASでは1行1JSONだったものをJSONB列で保持
CREATE TABLE members (
  id   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  data JSONB NOT NULL
);

COMMENT ON TABLE members IS 'GASシート: QR現金会員 (JSON格納)';

-- ============================================================
-- 13. LINEメッセージ (line_messages)
-- ============================================================
CREATE TABLE line_messages (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  timestamp    TIMESTAMPTZ NOT NULL DEFAULT now(),
  store_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  direction    TEXT NOT NULL,                -- received / sent
  message_type TEXT NOT NULL DEFAULT 'text', -- text / follow / unfollow / image etc.
  message_text TEXT DEFAULT '',
  message_id   TEXT DEFAULT ''
);

CREATE INDEX idx_line_messages_store_user ON line_messages(store_id, user_id, timestamp);
CREATE INDEX idx_line_messages_timestamp  ON line_messages(timestamp);

COMMENT ON TABLE line_messages IS 'GASシート: LINEメッセージ';

-- ============================================================
-- 14. LINEプロフィール (line_profiles)
-- ============================================================
CREATE TABLE line_profiles (
  user_id     TEXT NOT NULL,
  store_id    TEXT NOT NULL,
  display_name TEXT DEFAULT '',
  picture_url TEXT DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, store_id)
);

COMMENT ON TABLE line_profiles IS 'GASシート: LINEプロフィール';

-- ============================================================
-- 15. LINE一斉配信 (line_broadcasts)
-- ============================================================
CREATE TABLE line_broadcasts (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT now(),
  store_id        TEXT NOT NULL,
  broadcast_type  TEXT DEFAULT '',
  message_content TEXT DEFAULT '',
  recipient_count INTEGER DEFAULT 0,
  status          TEXT DEFAULT ''
);

CREATE INDEX idx_line_broadcasts_store ON line_broadcasts(store_id);

COMMENT ON TABLE line_broadcasts IS 'GASシート: LINE一斉配信';

-- ============================================================
-- 16. LINEテンプレート (line_templates)
-- ============================================================
CREATE TABLE line_templates (
  template_id     TEXT PRIMARY KEY,          -- tmpl_[timestamp]
  store_id        TEXT NOT NULL,
  name            TEXT NOT NULL DEFAULT '',
  category        TEXT DEFAULT '',
  message_type    TEXT DEFAULT 'text',
  message_content TEXT DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_line_templates_store ON line_templates(store_id);

COMMENT ON TABLE line_templates IS 'GASシート: LINEテンプレート';

-- ============================================================
-- 17. LINE自動応答 (line_auto_replies)
-- ============================================================
CREATE TABLE line_auto_replies (
  rule_id       TEXT PRIMARY KEY,            -- rule_[timestamp]
  store_id      TEXT NOT NULL,
  keyword       TEXT NOT NULL DEFAULT '',
  match_method  TEXT NOT NULL DEFAULT 'contains',  -- contains / exact
  reply_type    TEXT NOT NULL DEFAULT 'text',
  reply_content TEXT DEFAULT '',
  priority      INTEGER NOT NULL DEFAULT 0,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_line_auto_replies_store ON line_auto_replies(store_id);

COMMENT ON TABLE line_auto_replies IS 'GASシート: LINE自動応答';

-- ============================================================
-- 18. LINEタグ (line_tags)
-- ============================================================
CREATE TABLE line_tags (
  tag_id     TEXT PRIMARY KEY,               -- tag_[timestamp]
  store_id   TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT '#06C755',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_line_tags_store ON line_tags(store_id);

COMMENT ON TABLE line_tags IS 'GASシート: LINEタグ';

-- ============================================================
-- 19. LINEユーザータグ (line_user_tags)
-- ============================================================
CREATE TABLE line_user_tags (
  store_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  tag_id      TEXT NOT NULL REFERENCES line_tags(tag_id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, user_id, tag_id)
);

COMMENT ON TABLE line_user_tags IS 'GASシート: LINEユーザータグ';

-- ============================================================
-- 20. 勤怠 (attendance)
-- ============================================================
CREATE TABLE attendance (
  id            TEXT PRIMARY KEY,            -- att_[timestamp36][random]
  staff_id      TEXT NOT NULL,
  staff_name    TEXT DEFAULT '',              -- 非正規化 (表示用)
  store_id      TEXT NOT NULL REFERENCES stores(id),
  date          DATE NOT NULL,
  clock_in      TEXT DEFAULT '',              -- HH:MM
  clock_out     TEXT DEFAULT '',              -- HH:MM
  work_minutes  INTEGER DEFAULT 0,
  lat           DOUBLE PRECISION,
  lng           DOUBLE PRECISION,
  method        TEXT DEFAULT '',              -- gps / qr / manual
  notes         TEXT DEFAULT '',
  clock_out_lat DOUBLE PRECISION,
  clock_out_lng DOUBLE PRECISION
);

CREATE UNIQUE INDEX idx_attendance_staff_date ON attendance(staff_id, date)
  WHERE clock_out = '';  -- 1日1人1打刻の制約 (未退勤レコードのみ)
CREATE INDEX idx_attendance_store_date ON attendance(store_id, date);

COMMENT ON TABLE attendance IS 'GASシート: 勤怠';

-- ============================================================
-- 21. 勤怠QRトークン (qr_tokens)
-- ============================================================
CREATE TABLE qr_tokens (
  token      TEXT PRIMARY KEY,
  store_id   TEXT NOT NULL REFERENCES stores(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used       BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_qr_tokens_store ON qr_tokens(store_id);

COMMENT ON TABLE qr_tokens IS 'GASシート: 勤怠QRトークン';

-- ============================================================
-- 22. 日報 (daily_reports) - Googleフォーム連携のため任意
-- ============================================================
CREATE TABLE daily_reports (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  timestamp            TIMESTAMPTZ NOT NULL DEFAULT now(),
  store                TEXT NOT NULL DEFAULT '',
  hpb_new              INTEGER NOT NULL DEFAULT 0,
  meta_new             INTEGER NOT NULL DEFAULT 0,
  referral_new         INTEGER NOT NULL DEFAULT 0,
  discount_new         INTEGER NOT NULL DEFAULT 0,
  hpb_contract         INTEGER NOT NULL DEFAULT 0,
  meta_contract        INTEGER NOT NULL DEFAULT 0,
  referral_contract    INTEGER NOT NULL DEFAULT 0,
  discount_contract    INTEGER NOT NULL DEFAULT 0,
  existing_treatments  INTEGER NOT NULL DEFAULT 0,
  task_complete        BOOLEAN NOT NULL DEFAULT false,
  prep_complete        BOOLEAN NOT NULL DEFAULT false,
  notes                TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_daily_reports_store_ts ON daily_reports(store, timestamp);

COMMENT ON TABLE daily_reports IS 'GASシート: 日報 (Googleフォーム連携の場合GAS残留可)';

-- ============================================================
-- RLS (Row Level Security) - Phase 1以降で有効化
-- ============================================================
-- 現時点ではRLSを無効のままにしておく
-- Supabase service_role key経由でVercel API Routesからアクセスする想定
-- フロントエンドから直接Supabaseにアクセスさせない (Vercel APIを経由)

-- ============================================================
-- updated_at 自動更新トリガー
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cashbook_updated_at
  BEFORE UPDATE ON cashbook
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_line_templates_updated_at
  BEFORE UPDATE ON line_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_line_profiles_updated_at
  BEFORE UPDATE ON line_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
