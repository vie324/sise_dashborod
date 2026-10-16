# RUNBOOK — si'se ダッシュボード運用手順

デプロイ・環境変数・SalonOne 連携・鍵ローテーション・障害対応の手順集。

---

## 1. 環境変数

### 必須（本番で未設定だと機能しない）

| 変数 | 用途 | 値の例 / 生成方法 |
|---|---|---|
| `SUPABASE_URL` | Supabase プロジェクト URL | `https://xxxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role キー | Supabase Dashboard > Settings > API |
| `SISE_AUTH_SECRET` | スタッフ URL トークン / 管理者セッションの HMAC 秘密鍵 | `openssl rand -hex 32` |

### SalonOne 連携

| 変数 | 用途 | 既定挙動 |
|---|---|---|
| `SALONONE_API_KEY` | SalonOne 分析API のアクセスキー | 未設定ならデモデータで表示（画面に「デモデータ」と出る） |
| `SALONONE_API_BASE_URL` | API のベース URL | `https://salonone.net/api/analytics/v1` |
| `SALONONE_API_ENDPOINTS` | エンドポイントのパスの上書き（JSON） | 既定のパスを使う。詳細は [docs/SALONONE.md](docs/SALONONE.md) |
| `SALONONE_RATE_LIMIT_PER_MINUTE` | 1分あたりの呼び出しの上限 | `55`（SalonOne の既定の上限 60 より少し小さく） |

### 推奨（設定しないと機能縮退）

| 変数 | 用途 | 既定挙動 |
|---|---|---|
| `SISE_ADMIN_PASSWORD_HASH` | 管理者ログインのパスワード bcrypt ハッシュ | 未設定時はログインできない（`REQUIRE_ADMIN_AUTH=false` なら問題なし） |
| `REQUIRE_ADMIN_AUTH` | 管理者モードをパスワード保護する | `false`（URL 無しで誰でも管理者画面を開ける。**本番は `true` を推奨**） |
| `ALLOW_LEGACY_TOKENS` | 旧 base64 のみのスタッフ URL を受理 | `true`（移行期間用） |
| `SISE_AUTH_SECRET_PREV` | 1世代前の HMAC 秘密鍵 | 未設定（ローテーション時のみ） |
| `ALLOWED_ORIGIN` | CORS 制限 | `*` |
| `ANTHROPIC_API_KEY` | 施術ツールの AI 姿勢アドバイス | 未設定ならアドバイス生成だけ使えない |

### 削除してよい環境変数（旧機能）

SalonOne へ移った機能の変数は使わなくなった。Vercel から削除してよい:
`SQUARE_*`, `LINE_STORE_*`, `GAS_WEBHOOK_URL`, `META_*`, `TIKTOK_*`, `SISE_RESEND_API_KEY`, `SISE_DAILY_REPORT_FROM`, `SISE_DAILY_REPORT_TO`, `BLOB_READ_WRITE_TOKEN`

> LINE 公式アカウントの Webhook URL を SalonOne の LINE 連携に切り替えていない場合は、先に SalonOne 側の設定を済ませること
> （このダッシュボードの `/api/line/webhook` は削除済み）。

---

## 2. デプロイ

```bash
npm run deploy      # = vercel --prod
git push            # PR ごとに Vercel がプレビュー URL を発行
```

- Vercel は `vercel.json` の `buildCommand`（`npm run build`）で画面をビルドし、`public/` を配信する
- ビルド成果物（`public/assets/`）はリポジトリに含めない
- Serverless Functions は 3 本（`api/db`, `api/salonone`, `api/claude/advice`）。Hobby プランの上限 12 に余裕あり

---

## 3. 管理者パスワード設定

```bash
node scripts/gen-admin-hash.js
# → 対話式でパスワード入力 → bcrypt ハッシュ出力
```

Vercel の Environment Variables に `SISE_ADMIN_PASSWORD_HASH = <ハッシュ>` を設定して再デプロイ。

### `REQUIRE_ADMIN_AUTH` の切替

1. `SISE_ADMIN_PASSWORD_HASH` を先に設定
2. プレビュー環境で `REQUIRE_ADMIN_AUTH=true` にしてログイン画面を確認
3. 問題なければ本番も `REQUIRE_ADMIN_AUTH=true`

`REQUIRE_ADMIN_AUTH=true` の間は、URL 無しのアクセスは管理者ログインが必要になり、`/api/db`・`/api/salonone`・`/api/claude/advice` もログインかスタッフ URL が無いと 401 を返す。

---

## 4. HMAC シークレットのローテーション

```
[Step 1] SISE_AUTH_SECRET_PREV = <現在の SISE_AUTH_SECRET>          → デプロイ
[Step 2] SISE_AUTH_SECRET      = <openssl rand -hex 32 で新鍵>      → デプロイ
         （既存のスタッフ URL は _PREV で検証され使える。新規発行は新鍵）
[Step 3] 設定 > スタッフ >「URLの一括発行」の「全員分を発行」→ 各スタッフに配布
[Step 4] 旧 URL の期限（1年）経過後に SISE_AUTH_SECRET_PREV を削除
```

緊急で全 URL を無効化する場合は、`SISE_AUTH_SECRET` を新鍵にして `_PREV` を設定しない。管理者モードで全 URL を再発行する。

---

## 5. Legacy トークンの廃止

全スタッフに新しい URL を配布し終えたら `ALLOW_LEGACY_TOKENS=false`。

---

## 6. スタッフ管理（設定 > スタッフ）

- 追加: 名前 / 役割（スタッフ・店舗責任者・本部）/ パスワード（任意）/ 所属店舗
- URL 発行: 一覧の「URL をコピー」（管理者モードのみ）。スタッフはこの URL をホーム画面に追加して使う
- 無効化: `status='inactive'`（その時点で URL は使えなくなる。データは残る）
- **SalonOne との対応付け**: 設定 > SalonOne連携 >「スタッフの対応付け」。未連携のスタッフは自分のインセンティブが表示されない
- パスワードはサーバーで照合し、一覧 API では返さない（「パスワードあり」の表示のみ）

### URL が使えないスタッフ

- `ALLOW_LEGACY_TOKENS=false` なのに旧 URL → 再発行
- `SISE_AUTH_SECRET` 変更済みで `_PREV` も無い → 再発行
- `status='inactive'` → 有効化
- 所属店舗が 1つも無い → スタッフ編集で店舗を追加

---

## 7. 店舗管理（設定 > 店舗）

- 追加: ID（英数）/ 名前 / 備考。追加後、設定 > SalonOne連携 で SalonOne の店舗と対応付ける
- 重複店舗の統合: 同じ名前の店舗があると店舗タブに「重複を統合」が出る（`merged_into` で別名化。発行済み URL・出納帳データは壊れない）

---

## 8. SalonOne 連携

手順の詳細は [docs/SALONONE.md](docs/SALONONE.md)。

1. SalonOne のブランド選択画面 >「API連携」でキーを発行してもらう（個人情報: 含めない / ユーザー認証: 必須にしない / 有効期限 1年）
2. Vercel に `SALONONE_API_KEY` を設定して再デプロイ
3. 設定 > SalonOne連携 で「接続テスト」→ 店舗・スタッフ・来店経由を対応付けて保存

### よくある症状

| 症状 | 確認すること |
|---|---|
| 画面に「デモデータ」と出る | `SALONONE_API_KEY` が本番環境に設定されているか、再デプロイしたか |
| 接続テストで 401「APIキーが無効です」 | キーの入力ミス・期限切れ・失効。SalonOne で再発行して差し替え、再デプロイ |
| 接続テストで 401「ログインを必須にする」 | ユーザー認証を必須にしないキーを発行し直す |
| 接続テストで 403 | ブランドで機能（マーケティング・継続管理）が無効、または他ブランドの店舗 |
| 「利用上限（1分 60回）」 | 1分待って ⟳。続くなら docs/SALONONE.md §2 の呼び出し回数を参照 |
| 「◯時◯分時点のデータを表示しています」 | SalonOne から取り直せず前回の値を表示中。時間をおいて ⟳ |
| 会員数・退会率が「—」 | 連携より前の月は記録が無い（当月分から毎月残る）。当月が「—」なら接続テストで継続管理を確認 |
| 「SalonOne の店舗と未連携の店舗があります」 | 店舗の対応付けを保存 |
| スタッフの数字が 0 / 「未連携」バッジ | スタッフの対応付けを保存。SalonOne 側の担当スタッフ設定も確認 |
| 新規契約・SNS・紹介の数が合わない | 来店経由 → 集客経路の対応付け（自動判定が違う媒体名を明示指定） |
| 数字が古い | 画面右上の ⟳、または 設定 > SalonOne連携 >「データを取り直す」 |

---

## 9. インセンティブ制度の変更

金額・閾値・条件は `shared/incentive-rules.js` だけで管理している（計算・画面・制度の説明が連動）。

1. `shared/incentive-rules.js` を修正
2. `npm test`（`test/incentive.test.js` の期待値も合わせて更新）
3. PR → マージ → デプロイ

制度開始月（`startMonth`）より前の月は、画面で「試算」と表示される。

---

## 10. 出納帳の日次締めと SalonOne の現金売上

1. 出納帳 > 残高総覧 で店舗を選ぶ
2. 「本日の日次締め」で金庫 / 小口現金 / レジの実残高を入力して確定
   - SalonOne が接続済みなら、その日の SalonOne の現金売上を **レジの入金として取り込んでから締める**（既定でオン）
3. `daily_close.locked=true` になり、その日の記録は編集・削除できない

SalonOne で会計した現金売上は、店舗・日ごとに 1件の入金（カテゴリ「施術売上」・記録者「SalonOne」・ID `so_<店舗ID>_<日付>`）として取り込む。
**SalonOne で会計した売上は出納帳に手入力しない**（手入力の現金売上がある日は二重計上を避けるため取り込まない）。
出納帳には釣銭の補充・経費・金庫/小口への移動など、SalonOne 以外の現金の動きだけを記録する。

| 操作 | 場所 |
|---|---|
| 取り込み忘れの確認・まとめて取り込み | 出納帳 > SalonOne突合（前日までの未取り込みは残高総覧にもお知らせが出る） |
| SalonOne 側で金額が変わった日の取り直し | 出納帳 > SalonOne突合 の「更新」（締め前の日だけ） |
| 取り込んだ記録の取り消し | 入出金タブで削除（操作ログに残る） |

デモデータ（`SALONONE_API_KEY` 未設定）のときは取り込めない。
締め後に修正が必要な場合は Supabase SQL Editor で `daily_close.locked` を false に戻す（慎重に）。

---

## 11. 障害対応

### Vercel のデプロイが失敗する

- `npm run build` のエラー → Vercel の Deployments ログでビルドエラーを確認（手元でも `npm run build` で再現できる）
- `Cannot find module` → import パスの typo

### `/api/db` が 500 を返す

- Vercel Functions Logs を確認
- Supabase の service_role キーの失効、プロジェクトの一時停止（Free tier の inactivity）

### `/api/salonone` が 502 を返す

- SalonOne API がエラーを返している。レスポンスの `error` / `upstreamStatus` / `endpoint` と、§8 の表を確認

### スタッフが「認証エラー」で入れない

- §6「URL が使えないスタッフ」を参照

---

## 12. バックアップ

- Supabase Dashboard > Database > Backups（日次）。緊急時は Point-in-Time Recovery（有料プラン）
- Vercel の環境変数（`SISE_AUTH_SECRET`・`SALONONE_API_KEY` など）はパスワード管理ツールにも控えておく

---

## 13. データの整理（SQL）

```sql
-- 削除済み出納帳エントリを完全削除（soft-delete → hard-delete）
DELETE FROM cashbook WHERE deleted = true AND updated_at < now() - interval '180 days';

-- 店舗一覧（非アクティブ + 別名統合行も含む）
SELECT id, name, status, merged_into, created_at FROM stores ORDER BY created_at;

-- スタッフ + 所属店舗
SELECT s.id, s.name, s.role, s.status, array_agg(ss.store_id) AS store_ids
FROM staff s LEFT JOIN staff_stores ss ON ss.staff_id = s.id
GROUP BY s.id ORDER BY s.role, s.name;

-- 目標・SalonOne の対応付け（dash_config に JSON で保存）
SELECT key, value FROM dash_config WHERE key LIKE 'goals.%' OR key LIKE 'salonone.%' ORDER BY key;
```

### 使わなくなったテーブル

SalonOne へ移った機能のテーブルは、データ保全のため削除していない。不要と判断できたらバックアップ後に削除してよい:
`daily_reports`, `members`, `ticket_plans`, `ticket_data`, `usage_records`, `attendance`, `qr_tokens`,
`line_messages`, `line_profiles`, `line_broadcasts`, `line_templates`, `line_auto_replies`, `line_tags`, `line_user_tags`, `hpb_data`

引き続き使うテーブル: `stores`, `staff`, `staff_stores`, `dash_config`, `menu_items`, `cashbook`, `cashbook_log`, `daily_close`

---

## 14. テスト

```bash
npm test                                                     # 単体テスト
npm run build && npm run dev:local                           # 手元で起動（疑似 DB・デモデータ）
PLAYWRIGHT_BASE_URL=http://localhost:3000 npm run test:e2e   # スモークテスト
PLAYWRIGHT_BASE_URL=https://<preview>.vercel.app npm run test:e2e
```

ブラウザが別の場所にある環境では `PLAYWRIGHT_CHROMIUM_PATH` で実行ファイルを指定できる。

---

## 15. 開発者向けメモ

- 画面は `src/`（React + Tailwind）を `scripts/build.mjs` で `public/assets/` にビルドする。ブラウザ内 Babel は使わない
- アイコンは lucide。`src/` に書いたアイコン名（`'chevron-down'` など）をビルド時に拾って必要な分だけ取り込む
- 色は `src/styles/app.css` のトークン（`bg-surface` `text-ink` `border-line` など）を使う。ライト/ダークはトークン側で切り替わる
- 日付は JST の文字列（`shared/dates.js`）で扱う。`new Date().toISOString()` で日付を作らない
- インセンティブ・集計のロジックは `shared/`（サーバーと画面で共通、`node --test` でテスト）
- 権限チェックは必ずサーバー側（`staffCtx` / `canAccessStore` / `isAdminOrHeadquarter`）。画面の出し分けは補助
