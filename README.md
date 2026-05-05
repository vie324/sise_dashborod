# si'se Dashboard

整体院（si'se 系列）の経営ダッシュボード。Square 会員管理・出納帳・勤怠・LINE 連携・カウンセリング・施術レポート・マーケティング分析を一元化する SPA。

| | |
|---|---|
| Stack | React 18 (CDN) + Tailwind CSS + Recharts + Chart.js |
| Backend | Vercel Serverless Functions + Supabase (Postgres) |
| Auth | HMAC-SHA256 署名付きトークン (URL) + admin bcrypt + HttpOnly cookie |
| Email | Resend HTTP API（日報通知。未設定なら送信スキップ） |
| Deploy | Vercel (Hobby プランの 12 ファンクション上限に合わせて `/api/db` に集約) |
| Entry | `public/index.html`（単一 SPA） |

## データソース

- **Supabase** — 出納帳・勤怠・会員（QR/現金）・回数券・スタッフ・店舗・日報・HPB・LINE 各種・ダッシュボード設定・メニュー
- **Square API** — Sub 会員・売上・ロケーション情報（読み取りのみ）
- **GAS (gas/unified.gs)** — カウンセリングフォーム回答のみ（Google フォーム連携の都合で残存）
- **Meta / TikTok API** — 広告データ（headquarter ロールのみ）

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
│       ├── stores.js       # 店舗マスタ補助 (env→DB / merged_into 解決)
│       ├── email.js        # Resend HTTP API (日報メール通知)
│       └── db-handlers-*.js # table 別ハンドラ
├── supabase/migrations/    # DB スキーマ定義
├── gas/
│   └── unified.gs          # カウンセリングフォーム連携のみ (約 480 行)
├── scripts/
│   └── gen-admin-hash.js   # 管理者パスワード bcrypt ハッシュ生成
└── vercel.json             # リライト / ヘッダ設定
```

## 機能マップ

| 機能 | 主要コンポーネント | サーバ handler |
|---|---|---|
| ダッシュボード | `DashboardView` | `reportsGet` |
| 会員管理 | `MemberManagementView` / `useManualMembers` | `membersGet/Post` |
| 出納帳 | `CashbookView` / `useCashbook` | `cashbookGet/Post`（重複店舗の merged_into 解決済み） |
| 勤怠 | `AttendanceView` / `useAttendance` | `attendanceGet/Post`（同上） |
| 日報 | `DailyReportInputForm` / `DailyReportListView` | `reportsGet/Post`（送信時に Resend 経由で通知メール） |
| カウンセリング | `ConceptFormView` / `useCounseling` | **GAS (gas/unified.gs)** — Google フォーム回答シート読み取り |
| 施術レポート | `TreatmentReportView` | — |
| 姿勢分析 | `PostureAnalysisView` | `/api/claude/advice` |
| LINE | `LineChatView` / `useLineChat` | `line*` handlers + webhook |
| 回数券 | `TicketManagementView` / `useTickets` | `ticketGet/Post` (per-entity) |
| マーケティング | `MarketingView` | `/api/meta`, `/api/tiktok`, `hpbGet/Post` |
| 来店フロー | `FlowNavigationView` | — |
| 設定 | `SettingsView` + `StaffManagementSection` + `StoreManagementSection` | `staffGet/Post`, `storesGet/Post`（mergeStore / unmergeStore / syncSquareNames 含む） |

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
- フィーチャーブランチで作業 → PR 経由でのみマージ

## よく使う SQL（Supabase SQL Editor 用）

```sql
-- 店舗一覧（非アクティブ + 別名統合行も含む）
SELECT id, name, status, merged_into, created_at FROM stores ORDER BY created_at;

-- 重複統合（別名）の状態確認
SELECT s.id, s.name, s.status, s.merged_into,
       (SELECT name FROM stores WHERE id = s.merged_into) AS canonical_name
FROM stores s WHERE s.merged_into IS NOT NULL;

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

## アーキテクチャの注意点

### 店舗マスタの二系統
`stores` テーブルには 2 種類の行が混在する:
- **Square 連携行** (id="1"〜"20" / "default"): `SQUARE_STORE_{N}_NAME` env で名前管理。`api/_lib/stores.js` が読み取って自動同期（`syncSquareNames` アクション）
- **手動追加行** (任意 ID): 管理画面から作られる。Square 連携店舗と同名で重複したら **`merged_into`** で別名統合し、書き込みは正規 ID へ寄せる

### スタッフ URL のトークン形式
- **新形式** (signed): `<base64url(payload)>.<base64url(HMAC)>` — `SISE_AUTH_SECRET` で署名検証
- **旧形式** (legacy): `<base64(JSON)>` — `ALLOW_LEGACY_TOKENS=true` の間のみ受理。全件再発行後に `false` で完全無効化
