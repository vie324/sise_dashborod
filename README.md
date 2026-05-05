# si'se Dashboard

整体院（si'se 系列）の経営ダッシュボード。Square 会員管理・出納帳・勤怠・LINE 連携・カウンセリング・施術レポート・マーケティング分析を一元化する SPA。

| | |
|---|---|
| Stack | React 18 (CDN) + Tailwind CSS + Recharts + Chart.js |
| Backend | Vercel Serverless Functions + Supabase (Postgres) |
| Auth | HMAC-SHA256 署名付きトークン (URL) + admin bcrypt + HttpOnly cookie |
| Deploy | Vercel (Hobby プランの 12 ファンクション上限に合わせて `/api/db` に集約) |
| Entry | `public/index.html` (~20,700行、単一 SPA) |

## ドキュメント

- **[RUNBOOK.md](RUNBOOK.md)** — デプロイ・環境変数・ローテーション・障害対応の運用手順
- `.env.example` — 全環境変数の説明と設定例

## 開発

```bash
# 初回のみ
npm install

# ローカル開発 (Vercel CLI 必須)
npm run dev

# 本番デプロイ
npm run deploy
```

## ディレクトリ構成

```
sise_dashborod/
├── public/
│   ├── index.html          # SPA 本体 (React + 全ロジック)
│   ├── manifest.json       # PWA マニフェスト
│   ├── sw.js               # Service Worker
│   └── images/
│       ├── logo.png
│       ├── icon-192.png        # PWA アイコン
│       ├── icon-512.png
│       └── icon-maskable-512.png
├── api/                    # Vercel Serverless Functions
│   ├── db/index.js         # 統合DB エンドポイント (table ベース dispatch)
│   ├── line/               # LINE Messaging API プロキシ/webhook/broadcast
│   ├── square/             # Square API プロキシ
│   ├── meta/proxy.js       # Meta Ads API (headquarter only)
│   ├── tiktok/             # TikTok Ads API (headquarter only)
│   ├── claude/advice.js    # Claude AI アドバイス生成
│   ├── photos/index.js     # Vercel Blob アップロード
│   └── _lib/
│       ├── supabase.js     # Supabase クライアント
│       ├── cors.js         # CORS ヘルパー
│       ├── auth.js         # staffCtx 抽出 + admin session + store 権限判定
│       ├── sign.js         # HMAC-SHA256 トークン署名/検証
│       └── db-handlers-*.js # table 別ハンドラ
├── supabase/migrations/    # DB スキーマ定義
├── gas/                    # Google Apps Script (カウンセリングフォーム連携のみ)
├── scripts/
│   └── gen-admin-hash.js   # 管理者パスワード bcrypt ハッシュ生成
└── vercel.json             # リライト / ヘッダ設定
```

## 機能マップ

| 機能 | 主要コンポーネント | サーバ handler |
|---|---|---|
| ダッシュボード | `DashboardView` | `reportsGet` |
| 会員管理 | `MemberManagementView` / `useManualMembers` | `membersGet/Post` |
| 出納帳 | `CashbookView` / `useCashbook` | `cashbookGet/Post` |
| 勤怠 | `AttendanceView` / `useAttendance` | `attendanceGet/Post` |
| カウンセリング | `ConceptFormView` / `useCounseling` | GAS (残存) |
| 施術レポート | `TreatmentReportView` | — |
| 姿勢分析 | `PostureAnalysisView` | `/api/claude/advice` |
| LINE | `LineChatView` / `useLineChat` | `line*` handlers + webhook |
| 回数券 | `TicketManagementView` / `useTickets` | `ticketGet/Post` (per-entity) |
| マーケティング | `MarketingView` | `/api/meta`, `/api/tiktok`, `hpbGet/Post` |
| 来店フロー | `FlowNavigationView` | — |
| 設定 | `SettingsView` + `StaffManagementSection` + `StoreManagementSection` | `staffGet/Post`, `storesGet/Post` |

## 権限モデル

```
┌──────────────────────────────────────────────┐
│  URL に ?v=<signed token> が付いているか?     │
├──────────────────────────────────────────────┤
│ No → admin モード (staffCtx === null)         │
│      REQUIRE_ADMIN_AUTH=true の場合は          │
│      HttpOnly cookie (bcrypt 検証済み) 必須    │
├──────────────────────────────────────────────┤
│ Yes → staff モード                             │
│       extractStaffContext で HMAC 検証         │
│       → DB の staff_stores 参照で正規 storeIds │
│       → canAccessStore で per-store ゲート    │
└──────────────────────────────────────────────┘
```

詳細な権限境界は [RUNBOOK.md](RUNBOOK.md) 参照。

## セキュリティ補足

- **スタッフ URL トークン**: HMAC-SHA256 署名付き。1 世代前の `SISE_AUTH_SECRET_PREV` による無停止ローテーション対応
- **管理者セッション**: HttpOnly cookie + bcrypt (`SISE_ADMIN_PASSWORD_HASH`) + 失敗 rate limit
- **LINE webhook**: 店舗シークレットで署名検証（Staff auth 非適用）
- **Square/Meta/TikTok proxy**: headquarter ロールのみ（Marketing API）、staff モードは store scope でゲート

## ブランチ運用

- メインブランチ: `main`
- フィーチャーブランチ: `claude/explore-ui-ux-animations-mdF4n` (現行作業ブランチ)
- PR 経由でのみマージ

## よく使う SQL（Supabase SQL Editor 用）

```sql
-- 店舗一覧（非アクティブ含む）
SELECT id, name, status, created_at FROM stores ORDER BY created_at;

-- スタッフ + 所属店舗
SELECT s.id, s.name, s.role, s.status, array_agg(ss.store_id) AS store_ids
FROM staff s LEFT JOIN staff_stores ss ON ss.staff_id = s.id
GROUP BY s.id ORDER BY s.role, s.name;

-- 今月の出納帳集計（店舗別）
SELECT store_id, type, SUM(amount) AS total, COUNT(*) AS n
FROM cashbook
WHERE date >= date_trunc('month', now())::date AND deleted = false
GROUP BY store_id, type ORDER BY store_id, type;

-- storeId 未設定の回数券（admin UI の backfill ツールで埋める対象）
SELECT id, data->>'customerName' AS name, data->>'storeName' AS storeName
FROM ticket_data WHERE (data->>'storeId') IS NULL;
```
