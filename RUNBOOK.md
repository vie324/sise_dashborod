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
| `CRON_SECRET` | 毎日の継続指標の記録（Vercel Cron）の合言葉。`openssl rand -hex 32` | 未設定でも `REQUIRE_ADMIN_AUTH=false` なら動く。**`REQUIRE_ADMIN_AUTH=true` の本番では必須**（無いと Cron が 401 になり、会員数・退会率の月末の記録が残らない） |

施術ツールのカウンセリング（本日のお客様）も同じキーで SalonOne の予約を読む。お名前まで出すかはキーの「個人情報を含める」で決まる
（[docs/COUNSELING.md](docs/COUNSELING.md)）。

### カウンセリングフォーム（Google フォーム / GAS・フォームを使う店舗だけ）

| 変数 | 用途 | 既定挙動 |
|---|---|---|
| `COUNSELING_GAS_URL` | カウンセリングの回答を返す GAS のウェブアプリ URL | 未設定なら 設定 > カウンセリングフォーム で保存した値。どちらも無ければフォームとはつながない（予約から始める・チェックは手で付ける） |
| `COUNSELING_GAS_TOKEN` | GAS の合言葉（スクリプト プロパティ `DASHBOARD_TOKEN` と同じ） | 未設定なら 設定 > カウンセリングフォーム の値 |

手順は [docs/COUNSELING.md](docs/COUNSELING.md) §4。

### 推奨（設定しないと機能縮退）

| 変数 | 用途 | 既定挙動 |
|---|---|---|
| `SISE_ADMIN_PASSWORD_HASH` | 管理者ログインのパスワード bcrypt ハッシュ | 未設定時はログインできない（`REQUIRE_ADMIN_AUTH=false` なら問題なし） |
| `REQUIRE_ADMIN_AUTH` | 管理者モードをパスワード保護する | `false`（URL 無しで誰でも管理者画面を開ける。**本番は `true` を推奨**） |
| `ALLOW_LEGACY_TOKENS` | 旧 base64 のみのスタッフ URL を受理 | `true`（移行期間用） |
| `SISE_AUTH_SECRET_PREV` | 1世代前の HMAC 秘密鍵 | 未設定（ローテーション時のみ） |
| `ALLOWED_ORIGIN` | CORS 制限 | `*` |
| `ANTHROPIC_API_KEY` | 施術ツールの AI 姿勢アドバイス・マンダラの AI レビューと分類の提案 | 未設定なら AI の部分だけ使えない（マンダラの週報・日報は使える） |
| `MANDALA_AI_MODEL` | マンダラの AI のモデル | `claude-sonnet-4-6`（旧ツールの `AI_MODEL` も読む） |

### 削除してよい環境変数（旧機能）

SalonOne へ移った機能の変数は使わなくなった。Vercel から削除してよい:
`SQUARE_*`, `LINE_STORE_*`, `GAS_WEBHOOK_URL`, `META_*`, `TIKTOK_*`, `SISE_RESEND_API_KEY`, `SISE_DAILY_REPORT_FROM`, `SISE_DAILY_REPORT_TO`, `BLOB_READ_WRITE_TOKEN`
（`COUNSELING_GAS_*` はカウンセリングフォームで使うので消さない）

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
- Serverless Functions は 4 本（`api/db`, `api/salonone`, `api/claude/advice`, `api/mandala`）。Hobby プランの上限 12 に余裕あり
- Cron は 1 本（`vercel.json` の `crons`）: 毎日 23時台（JST）に `/api/salonone?action=cron` で全店舗の継続管理（会員数・退会率）を記録する。
  Vercel > Project > Cron Jobs で実行の記録を見られる（Hobby プランは指定した時刻の 1時間以内のどこかで動く）

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

`REQUIRE_ADMIN_AUTH=true` の間は、URL 無しのアクセスは管理者ログインが必要になり、`/api/db`・`/api/salonone`・`/api/claude/advice`・`/api/mandala` もログインかスタッフ URL が無いと 401 を返す。

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

- 追加: 名前 / 役割 / パスワード（任意）/ 所属店舗（マネージャーは管轄店舗）
- 役割（`shared/roles.js`。見える範囲はサーバーで判定）

  | 役割 | 見られる範囲 |
  |---|---|
  | スタッフ | 自分の数字と、所属店舗の合計 |
  | 店長 | 所属店舗の全体と、所属スタッフ全員の数字（目標の設定・メニューの変更も） |
  | マネージャー | 管轄する店舗（複数可）の店長と同じ。「担当の全店舗」でまとめて見られる |
  | オーナー | 全店舗・全スタッフ。設定の変更も（以前の「本部」はオーナーとして扱う） |

- URL 発行: 一覧の「URL をコピー」、または「URLの一括発行」で全員分（管理者モードのみ）。スタッフはこの URL をホーム画面に追加して使う
- 役割・所属店舗を変えても、発行済みの URL はそのまま使える（開いた時にサーバーの今の権限で表示する）
- 無効化: `status='inactive'`（その時点で URL は使えなくなる。データは残る）
- **SalonOne との対応付け**: 設定 > SalonOne連携 >「スタッフの対応付け」。未連携のスタッフは自分のインセンティブが表示されない
- パスワードはサーバーで照合し、一覧 API では返さない（「パスワードあり」の表示のみ）

### URL が使えないスタッフ

画面に理由が出る（「このURLは使えません」の下）。

- 「以前のダッシュボードで発行されたURLです」（`staff_id_missing`）→ 旧ダッシュボードの URL。再発行して配り直す
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
2. Vercel に `SALONONE_API_KEY`（と `CRON_SECRET`）を設定して再デプロイ
3. 設定 > SalonOne連携 で「接続テスト」→ 店舗・スタッフ・来店経由を対応付けて保存
4. 運用を始める前に [docs/SALONONE.md](docs/SALONONE.md) §9「運用開始前の確認」で、SalonOne の画面と数字が合うかを確かめる

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
| 先月の会員数・退会率が月末の値ではない | Cron（毎日 23時台）が動いているか（Vercel > Cron Jobs。1店舗も記録できなかった日は 502）・`CRON_SECRET`。画面の「◯/◯時点」がその月の最後の記録の日 |
| 「対応付いていない SalonOne の店舗に実績があります」 | 新しい店舗の対応付け忘れ。設定 > SalonOne連携 で対応付ける（その店舗だけで施術したスタッフはインセンティブの一覧に出ない） |
| 「他の店舗の実績の一部を取得できなかった」 | ヘルプで入った分がスタッフのインセンティブに入っていないかもしれない。1分待って ⟳ |
| スタッフのインセンティブが店舗の画面と全店舗の画面で違う | 違わないのが正しい（全店舗の実績で計算する）。古いデプロイのままでないか確認 |
| 「SalonOne の店舗と未連携の店舗があります」 | 店舗の対応付けを保存 |
| スタッフの数字が 0 / 「未連携」バッジ | スタッフの対応付けを保存。SalonOne 側の担当スタッフ設定も確認 |
| 新規契約・SNS・紹介の数が合わない | 来店経由 → 集客経路の対応付け（自動判定が違う媒体名を明示指定） |
| 数字が古い | 画面右上の ⟳、または 設定 > SalonOne連携 >「データを取り直す」 |

---

## 8.5 カウンセリング（本日のお客様・カウンセリングフォーム・お客様へのご説明）

施術ツール →「カウンセリング」は、SalonOne の今日の予約からお客様を選び、カウンセリングの後に
全画面のご説明（コンセプト・改善のイメージ・おすすめプラン・特典・まとめ）をお客様に見せる。
Google フォームでカウンセリングシートを取っている店舗は、回答からお悩みを自動でチェックし、記入内容を表示する。詳細は [docs/COUNSELING.md](docs/COUNSELING.md)。

1. 設定 > SalonOne連携 で店舗を対応付ける（対応付けの無い店舗は「予約に無いお客様」として手入力で使う）
2. お名前を一覧・ご説明に出したい場合（フォームの回答と予約をお名前で自動で結びつけたい場合も）は、
   SalonOne のキーを「個人情報を含める」で発行し直す（含めない場合は顧客番号で選び、シートは選んだお客様の「回答から選ぶ」で付ける）
3. Google フォームの店舗だけ:
   - スプレッドシートの Apps Script に `gas/counseling.gs` を貼り付け、スクリプト プロパティ `DASHBOARD_TOKEN`（合言葉）を設定
   - ウェブアプリとしてデプロイ（実行: 自分 / アクセス: 全員）
   - 設定 > カウンセリングフォーム に URL と合言葉を保存 →「接続テスト」→ 名前の違う店舗は対応付け。
     **SalonOne の問診票を使う店舗は「連携しない」**
   - 古いデプロイ（以前のダッシュボードに埋め込まれていた URL）はアーカイブして止める
   - `gas/counseling.gs` を直した時は、コードを貼り替えて **デプロイを管理 → 編集 → 新バージョン** でデプロイし直す（URL は変わらない）
4. 予約とシートがお名前で結びつかない時（漢字とカタカナ・旧姓など）は、選んだお客様の「回答から選ぶ」で付ける

---

## 8.6 マンダラ（チャート・週報・日報）

旧「マンダラチャート週次進捗管理ツール」を組み込んだ画面。詳細は [docs/MANDALA.md](docs/MANDALA.md)。

1. Supabase の SQL Editor で `supabase/migrations/00006_mandala.sql` を実行（未適用だと マンダラ の画面に「テーブルがありません」と出る）
2. AI を使うなら `ANTHROPIC_API_KEY`（施術ツールと共通）。モデルを変えるなら `MANDALA_AI_MODEL`
3. 旧ツールのデータを移す: `node scripts/import-mandala-tool.mjs`（確認）→ `--apply`（書き込み）。
   移す元の `MANDALA_SUPABASE_URL` / `MANDALA_SUPABASE_SERVICE_ROLE_KEY` を .env.local に書く。名前が合わない人は `--map "三浦=st-miura"`
4. マンダラ → 設定 で、共有の範囲（オーナー）・日報の対象・日報のチェック項目を確かめる

| 症状 | 確認すること |
|---|---|
| 「マンダラのテーブルがありません」 | `00006_mandala.sql` を適用したか |
| AI のレビューが出ない | `ANTHROPIC_API_KEY` を設定して再デプロイしたか。週報の画面の「作り直す」で再実行できる |
| 店長にメンバーが出ない | 設定 → スタッフ で、店長とメンバーの所属店舗が同じか |
| 仲間のチャートが見えない | 共有の範囲がオンか。自分と相手の両方が公開しているか（相互） |
| 日報のメニューが出ない | 店長・オーナーが その人を「日報の対象」にしたか（マンダラ → 設定 / メンバー） |

---

## 9. インセンティブ制度の変更

金額・閾値・条件は `shared/incentive-rules.js` だけで管理している（計算・画面・制度の説明が連動）。

1. `shared/incentive-rules.js` を修正
2. `npm test`（`test/incentive.test.js` の期待値も合わせて更新）
3. PR → マージ → デプロイ

制度開始月（`startMonth`）より前の月は、画面で「試算」と表示される。
確定済みの支給期間の金額は、制度を変えても変わらない（確定した時の `rulesVersion` を記録に残す）。

### 9.1 支給期間の確定と支給一覧（2ヶ月ごと）

契約数（後の月の契約も数える）・会員数（取得した時点の人数）は後から変わるため、**支給の前に金額を確定して固定する**。

1. 支給期間が終わったら（11〜12月の分は 1月に入ってから）、オーナー（または管理者モード）で インセンティブ > スタッフ別 を開き、期間の最後の月（12月）を表示する
2. 「確定する」→ 確認事項が出たら内容を確かめて「このまま確定する」。主なもの:
   - 取得できなかったデータ（1分待ってやり直すと、取れなかった分だけ取りに行く）
   - 会員数の記録が無い月・月末の記録ではない月（Cron が動いていたか）
   - 施術の無い月にも継続率インセンティブが入っているスタッフ（休職中の人など。支給してよいか）
   - 対応付いていない SalonOne の店舗の実績・未連携のスタッフの支給額
3. 「CSV」で支給一覧をダウンロードして給与の計算に使う（スタッフ × 月の内訳と判定に使った数字・支給期間の合計）
4. 間違いに気づいた時は「確定を取り消す」→ 直してから「確定する」（記録は履歴に残る）
5. 確定した後に「確定した記録に入っていないのに、いま計算すると支給額があるスタッフ」と出たら、対応付けなどを直した後の
   計算と確定がずれている。取り消して確定し直すか確かめる

### 9.2 系列店での契約（ドミナント出店・1件 2,000円）

来店したお客様が系列の他店舗で契約した時は、店長以上が インセンティブ > スタッフ別 >「系列店での契約」で登録する
（確定の前までに。確定した支給期間の月は登録・削除できない）。

1. 「登録する」→ 契約日・契約した店舗を選び、出てきた SalonOne の契約から該当のものを選ぶ（その店舗の担当の契約数から除く）
2. お客様名・プラン名・2,000円を付けるスタッフ（初回に来店した店舗の担当）を入れて「登録する」
3. 間違えた時は一覧の「削除」（削除した登録は記録に残る）

新規のお客様が 2回目以降の来店で別のスタッフのもとで契約した時は、初回の担当の契約として数える（系列店での契約とは別）。
詳しくは [docs/SALONONE.md](docs/SALONONE.md) §5.5。

確定した日までの契約を数える。詳しくは [docs/SALONONE.md](docs/SALONONE.md) §5。

---

## 9.5 目標（単月・3ヶ月・特別目標）

目標 の画面の上のタブで切り替える。

| | 内容 | 設定できる人 |
|---|---|---|
| 単月 | 店舗（施術消化売上・新規来店・契約率・会員数）とスタッフ（施術消化売上）の月の目標 | 店長・マネージャー（担当店舗）・オーナー。スタッフは自分の分 |
| 3ヶ月 | 1〜3月・4〜6月・7〜9月・10〜12月の目標。売上・新規は 3ヶ月の合計、契約率は通算、会員数は期末 | 単月と同じ |
| 特別目標 | 「12月までに月売上100万円！」のような 1店舗だけの期限付きの目標（月の施術消化売上・月の新規数・会員数） | オーナー（と管理者モード）のみ。見るのはその店舗を見られる人全員 |

- **単月に振り分け**（3ヶ月タブ）: 3ヶ月の目標を 3等分して、まだ目標を決めていない月に入れる（売上は 1,000円単位で端数は 3ヶ月目、契約率は毎月同じ、会員数は 3ヶ月目）。決めてある単月の目標は変えない
- 3ヶ月の区切りを変える時は `shared/dates.js` の `quarterStart` だけを直す（保存のキーは期の最初の月）
- **特別目標の「達成までの道すじ」**（`shared/goal-plan.js`。単体テストあり）
  - 今の水準 = SalonOne の月別推移の直近 3ヶ月（締まった月）の平均。今のペースが続くと仮定する
  - 月売上 = 施術数 × 単価、施術数 = 新規 + 既存のお客様 × 来店頻度。契約したお客様は月2回来店し、毎月 過去の退会率の分だけ減るとして、目標の月までの月数ぶん積み上げる
  - 足りない分を「新規を増やす」「契約率を上げる」「来店頻度を上げる」「単価を上げる」それぞれ単独と、新規・契約率・来店頻度で 3等分する「バランス」で示す。必要な値は過去いちばん良かった月と比べて「過去に達成あり / 少し超える / 大きく超える / この手段だけでは届かない」を表示
  - 会員数は「毎月の契約 − 退会」で必要な契約数を逆算（退会を減らす手段も表示）。新規数は毎月の目安と、続けた時の売上への効果
- ホームの上部に、表示中の店舗の特別目標（期限が来ていないもの）を表示する

---

## 10. 出納帳の日次締めと SalonOne の現金売上

1. 出納帳 > 残高総覧 で店舗を選ぶ
2. 「本日の日次締め」で金庫 / 小口現金 / レジの実残高を入力して確定
   - SalonOne が接続済みなら、その日の SalonOne の現金売上を **レジの入金として取り込んでから締める**（既定でオン）
3. `daily_close.locked=true` になり、その日の記録は編集・削除できない

SalonOne で会計した現金売上は、店舗・日ごとに 1件の入金（カテゴリ「施術売上」・記録者「SalonOne」・ID `so_<店舗ID>_<日付>`）として取り込む。
**SalonOne で会計した売上は出納帳に手入力しない**（手入力の現金売上がある日は二重計上を避けるため取り込まない）。
出納帳には釣銭の補充・経費・金庫/小口への移動など、SalonOne 以外の現金の動きだけを記録する。
現金での返金・キャンセル料・プリペイドの入金は SalonOne の受付履歴（会計完了の行）に出ないので取り込まれない。
現金の受け渡しがあれば「その他収入」「その他経費」で手入力する（売上のカテゴリで入れるとその日の取り込みが止まる）。

レジ金チェック・日次締めは、ダイアログを開くたびに本日の現金売上を SalonOne から読み直し、確定の前に必ず取り込み直す
（取り込んだ後の現金の会計を「差異」として記録しないため）。SalonOne の金額を確かめている間は確定できない。
「現金 / クレジットカード」のように複数の決済方法で内訳が無い会計は現金の分がわからないため取り込まず、件数と金額を出す。
SalonOne の会計で決済の内訳を登録してからダイアログを開き直す（そのまま確定するとレジの差異になる）。

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
--   goals.YYYY-MM   単月の目標 / goals.q.YYYY-MM  3ヶ月の目標（期の最初の月）/ goals.special  特別目標
SELECT key, value FROM dash_config WHERE key LIKE 'goals.%' OR key LIKE 'salonone.%' OR key LIKE 'counseling.%' ORDER BY key;
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
