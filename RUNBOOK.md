# RUNBOOK — si'se Dashboard 運用手順

日次運用・デプロイ・障害対応・鍵ローテーションの手順集。

---

## 1. 環境変数

### 必須（本番で未設定だと機能しない）

| 変数 | 用途 | 値の例 / 生成方法 |
|---|---|---|
| `SUPABASE_URL` | Supabase プロジェクト URL | `https://xxxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service_role キー | Supabase Dashboard > Settings > API |
| `SISE_AUTH_SECRET` | スタッフ URL トークン / 管理者セッション の HMAC 秘密鍵 | `openssl rand -hex 32` |

### 推奨（設定しないと機能縮退）

| 変数 | 用途 | 既定挙動 |
|---|---|---|
| `SISE_ADMIN_PASSWORD_HASH` | 管理者ログインのパスワード bcrypt ハッシュ | 未設定時はログインできない（`REQUIRE_ADMIN_AUTH=false` なら問題なし） |
| `REQUIRE_ADMIN_AUTH` | 管理者モードをパスワード保護する | `false`（未設定時と同じ、URL-less = フリーアクセス） |
| `ALLOW_LEGACY_TOKENS` | 旧 base64 のみのスタッフ URL を受理 | `true`（未設定時と同じ、移行期間用） |
| `SISE_AUTH_SECRET_PREV` | 1世代前の HMAC 秘密鍵 | 未設定（ローテーション時のみ） |
| `ALLOWED_ORIGIN` | CORS 制限 | `*` |

### 日報メール通知（Resend）

| 変数 | 用途 | 既定挙動 |
|---|---|---|
| `SISE_RESEND_API_KEY` | Resend API キー (`re_...`) | 未設定なら通知をスキップ（保存のみ成功） |
| `SISE_DAILY_REPORT_FROM` | 送信元アドレス（Resend で検証済みドメイン） | 未設定なら通知スキップ |
| `SISE_DAILY_REPORT_TO` | 送信先（カンマ区切り複数可） | 未設定なら通知スキップ |

### Square / LINE / Meta / TikTok / Claude（使う機能のみ）

`.env.example` 参照。店舗ごとに `SQUARE_STORE_{N}_ACCESS_TOKEN` / `LINE_STORE_{N}_ACCESS_TOKEN` などを列挙。

---

## 2. デプロイ

```bash
# 本番デプロイ
npm run deploy           # = vercel --prod

# プレビューデプロイ (PR 単位)
git push                 # Vercel が自動でプレビュー URL 発行
```

Vercel Dashboard > Deployments から環境変数の有効状態を確認できる。

### Vercel Hobby プラン制約

- **Serverless Functions 上限: 12**
- `api/` 直下の `.js` ファイル数で数える（`api/_lib/` は除外）
- 超えるとデプロイ失敗。現在: **12/12**
- 新 API を追加する際は `/api/db?table=XXX` への相乗りが原則

---

## 3. 管理者パスワード設定

初回 or パスワード変更時:

```bash
node scripts/gen-admin-hash.js
# → 対話式でパスワード入力 → bcrypt ハッシュ出力
```

Vercel Dashboard > Environment Variables:
```
SISE_ADMIN_PASSWORD_HASH = <生成されたハッシュ>
```

再デプロイ後に反映。既存 cookie は HMAC 検証に `SISE_AUTH_SECRET` を使うため、パスワード変更だけでは既存セッションは失効しない（次の exp まで有効）。

### `REQUIRE_ADMIN_AUTH` の切替

```
REQUIRE_ADMIN_AUTH=false   # デフォルト。URL-less は無認証でアクセス可
REQUIRE_ADMIN_AUTH=true    # URL-less アクセス時にパスワードログイン要求
```

段階導入手順:
1. `SISE_ADMIN_PASSWORD_HASH` を先に設定
2. ブラウザで動作確認（テスト用に `REQUIRE_ADMIN_AUTH=true` を一時的に）
3. 問題なければ本番で `REQUIRE_ADMIN_AUTH=true` に切替

---

## 4. HMAC シークレットのローテーション

**シナリオ**: 秘密鍵漏洩の疑い、年次ローテーション、退職スタッフへの全 URL 無効化

### 手順（無停止ローテ）

```
[Step 1] 現在の鍵を PREV へコピー
  環境変数:
    SISE_AUTH_SECRET       → (既存の値はそのまま維持して PREV に)
    SISE_AUTH_SECRET_PREV  = <現在の SISE_AUTH_SECRET の値>
  デプロイ

[Step 2] 新しい鍵を生成して SECRET を置き換え
  openssl rand -hex 32    # 新鍵を生成
  SISE_AUTH_SECRET       = <新鍵>
  SISE_AUTH_SECRET_PREV  = <旧鍵> (そのまま)
  デプロイ
  → 既存のスタッフトークンは _PREV で検証成功 (verifyToken の signedWith='previous')
  → 新規発行は新鍵で署名

[Step 3] 全スタッフ URL を再発行 (推奨)
  管理画面 > スタッフ管理 > 「全URLを再発行」ボタン
  → 全アクティブスタッフの URL を新鍵で再発行、クリップボード一括コピー
  → 各スタッフに新 URL を配布

[Step 4] 旧鍵の exp 経過後（既定 1 年）に _PREV を削除
  SISE_AUTH_SECRET_PREV  = (削除)
  デプロイ
  → 旧鍵で署名された URL は全て bad_signature で拒否
```

### 緊急無効化（即座に全 URL を無効化したい場合）

```
SISE_AUTH_SECRET       = <新鍵>
SISE_AUTH_SECRET_PREV  = (設定しない or 削除)
```

→ 既存の全スタッフ URL が bad_signature で拒否される。管理者モード（URL-less）でログインして全 URL を再発行。

---

## 5. Legacy トークンの廃止

旧形式（base64 JSON のみ、署名なし）を完全に無効化する:

```
ALLOW_LEGACY_TOKENS=false
```

※ これを設定する前に「全 URL を再発行」ボタンで全スタッフに新 URL を配布し終えていること。

---

## 6. スタッフ管理

### 新規スタッフ追加

1. 管理者モードで 設定 > スタッフ管理 > 「スタッフを追加」
2. 名前 / 役割（staff / manager / headquarter）/ パスワード（任意）/ 所属店舗 を設定
3. 保存後、一覧の「コピー」ボタンで URL を取得してスタッフに配布

### スタッフ削除

- 「無効化」: `status='inactive'` に更新（URL はその時点で無効、データは残る）
- DB からの完全削除は Supabase SQL Editor から手動

### URL が使えないスタッフ

よくある原因:
- `ALLOW_LEGACY_TOKENS=false` なのに旧 URL を使っている → 再発行が必要
- `SISE_AUTH_SECRET` が変更されて _PREV も削除済み → 同上
- `status='inactive'` → 活性化 or 新規作成
- `staff_stores` に店舗が 1 つも紐付いていない → スタッフ編集で店舗を追加

---

## 7. 店舗管理

### 新店舗の追加

1. 管理者モードで 設定 > 店舗管理 > 「店舗を追加」
2. ID（英数、任意）/ 名前 / 備考 を入力
3. Square 連携する場合は Vercel env に `SQUARE_STORE_{N}_ACCESS_TOKEN` 等を追加
4. env を反映するため設定画面で「Square名を同期」ボタンを押すと、env 上の店舗を Supabase へ実名で挿入する

### ダミー店舗の掃除（"店舗 N" プレースホルダ）

過去のバージョンでスタッフを店舗に紐付けた際に `店舗 N` という仮の名前で
レコードが自動生成されていた問題の対処。`storesGet` には自動ヒーリング機構が
あり、env に実名がある場合は GET 時に自動で実名へ置換される。手動で対処する
場合は **設定 > 店舗管理 > 「Square名を同期」** ボタン。

### 重複店舗の統合（マージ別名）

同名の店舗が `stores` に複数ある場合（手動行 + Square 自動生成行 など）:

- 設定 > 店舗管理 のバナーから **「重複を統合」** を押す
- 内部的には `mergeStore` アクションで `merged_into=正規ID, status=inactive` に更新
- **発行済みスタッフ URL は壊れない**（`extractStaffContext` が `merged_into` 経由で別名を展開）
- 新規データ（cashbook / attendance / daily_close）はサーバ側で正規IDへ自動寄せ
- 統合済みは「統合済み店舗」セクションに表示。「別名解除」で `unmergeStore` で戻せる

### 店舗の GPS 座標設定

勤怠の GPS 出勤に使う。管理画面 > 勤怠管理 > QR 表示タブ > 店舗 GPS 座標設定。

---

## 8. LINE 連携

### 新店舗への LINE 連携追加

Vercel env:
```
LINE_STORE_{N}_CHANNEL_ACCESS_TOKEN = <token>
LINE_STORE_{N}_CHANNEL_SECRET        = <secret>
LINE_STORE_{N}_NAME                  = <店舗名 (任意、省略時は SQUARE_STORE_{N}_NAME)>
```

LINE Developers で Webhook URL を設定:
```
https://<your-domain>/api/line/webhook?store={N}
```

### LINE 受信メッセージが出てこない

- Webhook URL が合っているか確認
- チャネルシークレット（署名検証用）が正しいか
- `line_messages` テーブルに INSERT されているか SQL で確認
- 店舗 ID と環境変数の番号が一致しているか

---

## 8.5 日報フォーム + メール通知

ダッシュボード内の「日報」タブから入力できる。送信時に `reportsPost` の create
アクションが Supabase へ保存し、`api/_lib/email.js` の `sendEmail` を Resend
API 経由で叩いて本部宛に通知メールを送る。

### Resend のセットアップ

1. <https://resend.com> でアカウント作成
2. ドメインを追加して DNS（SPF / DKIM）検証を通す
3. API キーを発行（`re_...` 形式）
4. Vercel env に以下を設定:
   - `SISE_RESEND_API_KEY`
   - `SISE_DAILY_REPORT_FROM`（例: `noreply@your-domain.com`）
   - `SISE_DAILY_REPORT_TO`（例: `manager@example.com,owner@example.com`）

### 動作確認

- 環境変数未設定でも日報は保存される（メールがスキップされる）
- UI トーストで「日報を送信しました（メール通知は未設定）」と表示される
- API レスポンスの `mail` フィールドで送信状態を確認可能（`{ success, id }` / `{ skipped, reason }` / `{ error, detail }`）

### よくある失敗

- **`resend_403`**: API キーが invalid。再発行
- **`resend_400` + "from"**: 送信元ドメインが Resend で未検証。DNS 設定を見直し
- **メールが届かない**: Resend Dashboard > Logs で実際の送信状態を確認

---

## 9. 出納帳の日次締め

1. 管理画面 > 出納帳 > 当日のセクション
2. 金庫 / 小口現金 / レジ 残高を入力
3. 「日次締め」ボタン → `locked=true` になり、その日の編集が不可に
4. `daily_close` テーブルに保存

締め後にエントリーを追加・編集したい場合は Supabase SQL Editor で `daily_close.locked` を false に戻す（慎重に）。

---

## 10. 回数券 (Ticket)

### storeId 未設定のチケット（旧データ）

- 管理者モードで回数券管理画面の上部にオレンジバナー表示
- 「店舗を付与」→ 一括バックフィル UI

### プラン CRUD は admin 専用

スタッフはチケット発行・消化のみ（自店舗に限定）。プランは全店共通マスタ。

---

## 11. 障害対応

### Vercel デプロイが失敗する

- **`Functions exceed limit (12)`**: `api/` 直下の .js を数えて 12 以下になっているか確認
- **`Build failed`**: `npm install` のエラーログを Vercel Deployments で確認
- **`Cannot find module`**: import パスの typo or 相対パス間違い

### `/api/db` が 500 を返す

- Vercel Functions Logs を確認
- Supabase の service_role キーが失効していないか
- Supabase のプロジェクトが一時停止されていないか（Free tier の inactivity）

### スタッフが "認証エラー" で入れない

- `SISE_AUTH_SECRET` が変更されて _PREV が未設定 → 再発行 or _PREV 復活
- `ALLOW_LEGACY_TOKENS=false` なのに旧 URL を使っている → 再発行
- DB で `staff.status='inactive'` → 活性化

### LINE のプロフィール名が「お客様 #xxxx」のまま

- `line_profiles` テーブルに該当 userId の行があるか
- なければ自動補完が動くまで待つ（次回ダッシュボード開閉で再取得）
- LINE Messaging API のトークンが失効していないか

### 出納帳に入力できない（「この店舗への記帳権限がありません」）

- staff の `staff_stores` に該当店舗が入っているか Supabase SQL で確認
- 入っていれば、スタッフ URL の再発行で DB と同期される
- 管理者モード（URL-less）では常に全店舗に書ける

---

## 12. バックアップ

### Supabase

- Supabase Dashboard > Database > Backups で日次バックアップ
- 緊急時は Point-in-Time Recovery （有料プランのみ）

### LINE / Square のトークン

Vercel Environment Variables を定期的に 1Password 等に記録。Vercel 側から値を取り出すのは Read only のため、失うと再発行が必要な場合あり。

---

## 13. データクレンジング SQL 集

```sql
-- 削除済み cashbook エントリを完全削除 (soft-delete → hard-delete)
DELETE FROM cashbook WHERE deleted = true AND updated_at < now() - interval '180 days';

-- 期限切れで未使用の QR トークンを削除
DELETE FROM qr_tokens WHERE expires_at < now() - interval '1 day';

-- 1 年以上前の LINE メッセージをアーカイブ (先に別テーブルにコピー推奨)
-- DELETE FROM line_messages WHERE timestamp < now() - interval '365 days';

-- 非アクティブ店舗で 180 日以上更新されていないものを物理削除 (慎重に)
-- DELETE FROM stores WHERE status='inactive' AND created_at < now() - interval '180 days';

-- 重複した line_messages (同一 store_id + user_id + message_id) の確認
SELECT store_id, user_id, message_id, COUNT(*)
FROM line_messages
WHERE message_id <> ''
GROUP BY store_id, user_id, message_id
HAVING COUNT(*) > 1;

-- 上記で重複が見つかったら (一つ残して削除)
-- DELETE FROM line_messages a USING line_messages b
-- WHERE a.id > b.id AND a.store_id=b.store_id AND a.user_id=b.user_id AND a.message_id=b.message_id AND a.message_id <> '';
```

---

## 14. E2E テスト (Playwright)

デプロイ直後の smoke test に使う。

### 初回セットアップ

```bash
npm install                    # @playwright/test が dev dep として入る
npm run playwright:install     # Chromium ブラウザをダウンロード
```

### 実行

```bash
# プレビュー URL 向け（推奨）
PLAYWRIGHT_BASE_URL=https://sise-dashborod-xxx.vercel.app npm run test:e2e

# UI モード (対話的)
PLAYWRIGHT_BASE_URL=https://... npm run test:e2e:ui

# ローカル dev server 向け
npm run dev                    # 別ターミナルで
PLAYWRIGHT_BASE_URL=http://localhost:3000 npm run test:e2e
```

### カバー範囲

`e2e/smoke.spec.js` が最小限の動作確認:
- ダッシュボード HTML がマウントされる
- `manifest.json` / `sw.js` / PWA アイコンの配信
- `/api/db?table=auth` の session レスポンス形状
- 不明 table → 400、不正 staff token → 401
- login action の未設定環境エラー

追加テストはこのファイルに書くか、`e2e/` 配下にカテゴリ別ファイルを分ける。

### CI 連携 (任意)

GitHub Actions 例:
```yaml
- uses: actions/setup-node@v4
  with: { node-version: '20' }
- run: npm ci
- run: npx playwright install --with-deps chromium
- run: npx playwright test
  env:
    PLAYWRIGHT_BASE_URL: ${{ needs.deploy.outputs.preview_url }}
```

---

## 15. 開発者向けメモ

- **Client は単一 HTML**: `public/index.html` に React + Tailwind (CDN) を直接埋め込み。ビルドプロセスなし
- **Babel は in-browser**: `<script type="text/babel">` で JSX をブラウザ内でコンパイル。本番の性能はこれで十分（タイト性優先で tradeoff）
- **Date 処理は local 厳格**: `todayLocalYMD()` / `thisMonthLocalYM()` / `shiftMonthLocalYM()` を必ず使う。`new Date().toISOString()` は UTC 変換されるので禁止
- **API 追加時は `/api/db` への相乗り**: Vercel Hobby の 12 ファンクション上限を超えないよう、`table=XXX` action パターンで統合
- **権限チェックは handler 引数の `staffCtx`**: `canAccessStore(staffCtx, storeId)` で per-store ゲート
- **新規エンドポイントの CORS**: `api/_lib/cors.js` で `X-Staff-Id`, `X-Staff-Token`, `X-Store-Id` を許可
