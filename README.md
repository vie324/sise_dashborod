# si'se ダッシュボード

整体院（si'se 系列）の経営ダッシュボード。**SalonOne** の実績データから、売上・インセンティブ（2026年11月〜の制度）・目標を管理する。
あわせて、SalonOne に無い **出納帳（現金・小口・経費・日次締め）** と **施術ツール（AI 姿勢分析・施術レポート）** を提供する。

| | |
|---|---|
| 画面 | React 18 + Tailwind CSS（esbuild と Tailwind CLI でビルド）。PWA |
| サーバー | Vercel Serverless Functions（3 本）+ Supabase (Postgres) |
| 実績データ | SalonOne 分析API（読み取り専用）。APIキー未設定時はデモデータ |
| 認証 | スタッフ個別の署名付き URL（HMAC-SHA256）+ 管理者パスワード（bcrypt / HttpOnly cookie） |
| デプロイ | Vercel（`npm run build` → `public/` を配信） |

## 画面

| 画面 | 内容 | 見られる人 |
|---|---|---|
| ホーム | スタッフ: 今月のインセンティブ見込み・次のランクまで・各インセンティブの条件 / 店舗: KPI・累計推移・スタッフ別ランキング | 全員 |
| インセンティブ | スタッフ別の内訳（5 制度）・支給期間（2ヶ月）の合計・制度の内容 | 全員（スタッフは自分のみ） |
| 目標 | 店舗・スタッフの月間目標、達成率とペース、1日あたり必要額。インセンティブのランクから選べる | 全員（設定は権限に応じて） |
| 売上分析 | 月別推移・日別・経路別の新規と契約・スタッフ別 | 店長・マネージャー・オーナー |
| 出納帳 | レジ・金庫・小口現金の残高、入出金、日次締め、操作ログ。SalonOne の現金売上を日ごとに取り込み・突合 | 全員（所属店舗） |
| 施術ツール | AI 姿勢分析（MediaPipe + Claude）・施術レポート（画像保存/共有/印刷） | 全員 |
| 設定 | SalonOne 連携（接続テスト・対応付け）・スタッフと URL 発行・店舗・制度・表示 | 管理者・オーナー |

役割（設定 > スタッフ で選ぶ）: **スタッフ**（自分の数字と所属店舗の合計）/ **店長**（所属店舗の全体とスタッフ全員）/
**マネージャー**（管轄する複数店舗の店長と同じ）/ **オーナー**（全店舗・全スタッフ・設定）。詳しくは RUNBOOK §6。

## インセンティブ制度（2026年11月1日〜・2ヶ月に1回支給）

`shared/incentive-rules.js` にデータ化し、`shared/incentive.js` で計算する（単体テストあり）。

1. 施術消化売上: 57.6万〜 5,000円 / 68.8万〜 30,000円 / 80.8万〜 40,000円 / 92.8万〜 50,000円 / 104.8万〜 100,000円（1回 8,000円基準）
2. 継続率: 店舗の退会率 10%以下・平均継続 3ヶ月以上・会員 50名以上 → 1人 月5,000円
3. 新規契約: 既存顧客の消化売上 40万以上 かつ 3経路の新規 9名以上 → 契約率 40%〜90% で 2,000〜30,000円
4. Minimo・Threads・Instagram: 10名以上集客 → 契約 1件 2,000円
5. 紹介: 紹介からのサブスク契約 1件 2,000円

集計方法と SalonOne API の仕様合わせは **[docs/SALONONE.md](docs/SALONONE.md)** を参照。

## SalonOne へ移った機能（このリポジトリから削除）

SalonOne を正として、重複していた機能は削除した（Supabase の旧テーブルは消さずに残している）。

| 旧機能 | SalonOne での代わり |
|---|---|
| 日報（新規・契約数の手入力）・日報メール | 売上 > 日報（デイリー売上）、マーケティング > 新規客台帳 |
| 会員管理（Square サブスク・QR/現金会員）・利用管理・回数券 | 顧客管理・回数券/サブスク・Square連携 |
| 勤怠（GPS/QR 打刻） | 打刻・勤怠管理 |
| LINE チャット・一斉配信・自動応答・タグ | LINEチャット・再来店促進・LINE連携 |
| カウンセリング（Google フォーム / GAS） | 問診票 |
| マーケティング（Meta / TikTok / HPB） | マーケティング（広告API連携・媒体別分析） |
| 来店フロー・顧客360・クイック検索 | 予約表・受付・顧客カルテ |
| 写真アップロード（Vercel Blob） | 顧客カルテの写真・動画（レポート画像は保存して SalonOne へ） |

## 開発

```bash
npm install
npm run dev:local     # ビルド済みの画面 + API を http://localhost:3000 で起動（疑似 DB・デモデータ）
npm run watch         # 別ターミナルで。src/ の変更を自動ビルド
npm test              # 単体テスト（インセンティブ計算・集計・正規化・権限）
npm run build         # 本番ビルド（public/assets/ に出力）
```

- 実際の Supabase を使う場合は `.env.local` に `SUPABASE_URL` などを書いて `node scripts/dev-server.mjs`（`--mock-db` なし）
- Vercel CLI を使う場合は従来どおり `npm run dev`
- E2E: `PLAYWRIGHT_BASE_URL=http://localhost:3000 npm run test:e2e`

## ディレクトリ構成

```
sise_dashborod/
├── src/                      # 画面（React）
│   ├── main.jsx / app/       # 起動・レイアウト・ルーティング・状態
│   ├── features/             # home / incentives / goals / sales / cashbook / care / settings
│   ├── ui/                   # 共通部品（ボタン・カード・チャート・メーター…）
│   ├── lib/                  # API クライアント・権限・書式・データ取得フック
│   └── styles/app.css        # デザイントークン（ライト/ダーク）
├── shared/                   # サーバーと画面で共通の純粋ロジック
│   ├── incentive-rules.js    # インセンティブ制度（金額・閾値）
│   ├── incentive.js          # インセンティブ計算
│   ├── metrics.js            # SalonOne データの集計
│   ├── channels.js           # 来店経由 → 集客経路
│   └── dates.js              # 日付（JST）
├── api/
│   ├── db/index.js           # Supabase: 店舗・スタッフ・出納帳・メニュー・目標・設定・認証
│   ├── salonone/index.js     # SalonOne 連携（実績・インセンティブ・推移・接続テスト）
│   ├── claude/advice.js      # 姿勢分析の AI アドバイス
│   └── _lib/                 # 認証・Supabase・SalonOne クライアント/正規化/デモ/集計
├── public/                   # index.html・manifest・Service Worker・画像（assets/ はビルド成果物）
├── scripts/                  # build.mjs・dev-server.mjs・管理者パスワードハッシュ生成
├── test/                     # 単体テスト (node --test)
├── e2e/                      # Playwright スモークテスト
└── supabase/migrations/      # DB スキーマ
```

## 権限モデル

```
URL に ?v=<署名付きトークン> が付いているか?
  No  → 管理者モード（REQUIRE_ADMIN_AUTH=true なら HttpOnly cookie のログイン必須）
  Yes → スタッフモード（HMAC 検証 → DB の staff / staff_stores で権限を確定）
        staff        自分の実績 + 所属店舗の合計
        manager      所属店舗のスタッフ全員
        headquarter  全店舗
```

詳細な運用手順は **[RUNBOOK.md](RUNBOOK.md)**、環境変数は `.env.example` を参照。

## ブランチ運用

- メインブランチ: `main`
- フィーチャーブランチで作業 → PR 経由でのみマージ
