# SalonOne 連携ガイド

ダッシュボードの売上・インセンティブ・目標は、SalonOne の **分析API**（読み取り専用）から取得したデータで計算しています。
このページは「API の接続方法」と「SalonOne のデータをどう集計しているか」「実際の API 仕様に合わせるときにどこを直すか」をまとめたものです。

---

## 1. 接続手順

1. SalonOne 管理画面 > **ブランド管理 > 「API連携」** でアクセスキーを発行する
   - 用途がわかる名前: `社内分析ダッシュボード`
   - 有効期限: 1年（期限が来たら再発行して差し替える）
   - **個人情報を含める: オフ**（集計に氏名・電話番号は使わない）
   - **サロンワンのログインを必須にする: オフ**（サーバー間でキーだけを使うため）
2. Vercel > Project > Settings > Environment Variables に登録して再デプロイ
   | 変数 | 内容 |
   |---|---|
   | `SALONONE_API_KEY` | 発行したキー（必須。未設定ならデモデータで動く） |
   | `SALONONE_API_BASE_URL` | 既定 `https://salonone.net`。別ホストの場合だけ |
   | `SALONONE_API_ENDPOINTS` | エンドポイントの上書き（JSON。後述） |
3. ダッシュボード > **設定 > SalonOne連携** の「接続テスト」で、各データが取得できるか確認する
4. 同じ画面で **店舗・スタッフ・来店経由** を対応付けて保存する

キーはサーバーの環境変数にだけ置き、ブラウザ・スタッフの端末には送りません。

---

## 2. 取得しているデータ

| データ | 既定のエンドポイント | 使い道 |
|---|---|---|
| 店舗 | `GET /api/analytics/shops` | 店舗の対応付け |
| スタッフ | `GET /api/analytics/staffs` | スタッフの対応付け・所属店舗 |
| 来店経由 | `GET /api/analytics/visit-sources` | 来店経由 → 集客経路の対応付け（無くても可） |
| 受付明細 | `GET /api/analytics/receptions?from=&to=&shop_id=` | 消化売上・施術数・新規・経路 |
| 契約 | `GET /api/analytics/contracts?shop_id=&to=` | 新規契約・紹介・会員数・退会率・継続期間 |
| 継続指標（任意） | 未設定 | API が集計済みの値を返す場合だけ使う |

ページングは `page` / `per_page` で辿ります（Laravel の `meta.last_page`・`links.next`・件数で判定）。
認証ヘッダは `Authorization: Bearer <キー>` と `X-API-Key: <キー>` の両方を送っています。

> ⚠ **仕様の確認が必要です。** 分析API の仕様ページ（`/api-docs`）はログインしないと見られないため、
> 上のパス・クエリ名・項目名は SalonOne 画面の用語と CSV の項目名から推定した暫定値です。
> 接続テストの結果（HTTP ステータスと先頭レコードの項目名）を見て、必要なら次の「3. 仕様に合わせる」で調整してください。

---

## 3. 仕様に合わせる

### パス・クエリ名が違う場合（コード変更不要）

`SALONONE_API_ENDPOINTS` に JSON で上書きします。指定しなかった項目は既定値のまま。

```json
{
  "receptions": "/api/v1/analytics/reservations",
  "contracts": "/api/v1/analytics/entitlements",
  "retention": "/api/v1/analytics/retention",
  "query": { "from": "start_date", "to": "end_date", "shop": "shop_id", "page": "page", "perPage": "per_page" }
}
```

### 項目名が違う場合

`api/_lib/salonone/normalize.js` の候補リストに項目名を 1 つ追加します（`snake_case` / `camelCase` / `a.b` のネストに対応）。

| 正規化後 | 主な候補（抜粋） |
|---|---|
| 来店日 | `visit_date` `reserved_at` `start_at` … |
| 状態 | `status`（completed / cancelled / no_show / 「完了」「キャンセル」「無断」などを判定） |
| 新規/既存 | `classification`（新規 / 継続 / 既存）、`visit_number === 1`、`is_new` |
| 来店経由 | `visit_source.name` `visit_source_name` `media` … |
| 消化 | `consumed_sales` `consumed_amount` `consumed` … |
| 売上（入金） | `sales` `sales_amount` `deposit_sales` … |
| 契約の種別 | `type` `plan_type`、またはプラン名（サブスク / 回数券 / プリペイド / 都度） |
| 契約の開始・終了 | `started_at` `contracted_at` … / `ended_at` `cancelled_at` `leaved_at` … |

修正後は `npm test` で正規化のテスト（`test/normalize.test.js`）も更新してください。

---

## 4. 集計ルール

すべて `shared/metrics.js`（集計）と `shared/incentive.js`（インセンティブ）で計算しています。サーバーとブラウザで同じコードです。

| 指標 | 計算方法 |
|---|---|
| 施術消化売上 | 会計確定（completed）の来店の「消化」を担当スタッフ別に合計 |
| 既存顧客の消化売上 | 新規（初回来店）以外のお客様の消化売上 |
| 新規初回来店 | その月に初めて来店し会計確定したお客様。担当は初回来店のスタッフ |
| 新規契約 | 新規のお客様が回数券・サブスクを契約した件数。**初回来店月に計上**（SalonOne の「購入数」と同じ） |
| 経路 | 来店経由を「ホットペッパー / Meta広告 / ホームページ / Minimo / Threads / Instagram / 紹介 / その他」に対応付け（未設定は名前から推定） |
| 会員数 | 有効なサブスク契約を持つお客様（都度払い・回数券のみは除く） |
| 退会率 | 月内にサブスクがすべて終了した人数 ÷ 月初（前月末）の会員数 |
| 平均継続期間 | サブスク契約歴のある全てのお客様の継続月数の平均（継続中は基準日まで） |
| 紹介 | 経路が「紹介」の新規のお客様がサブスク（シェアプラン除く）を契約した件数。紹介リンクのスタッフ（`referral_staff_id`）がいればその人、無ければ担当スタッフ |

インセンティブ制度（金額・閾値）は `shared/incentive-rules.js` にまとまっています。
資料の「既存顧客の施術消化売上が月間 40,0000円以上」は **400,000円** と解釈しています。

---

## 5. デモデータ

`SALONONE_API_KEY` が未設定のときは、Supabase の店舗・スタッフ名に、シミュレーションした受付明細・契約を当てはめて表示します
（`api/_lib/salonone/demo.js`）。画面には常に「デモデータ」と表示されます。

## 6. キャッシュ

サーバーレス関数のメモリに、当月の受付明細は 3 分、過去月は 60 分、契約は 10 分キャッシュします。
画面の更新ボタン（⟳）と 設定 > SalonOne連携 >「データを取り直す」で取り直せます。
