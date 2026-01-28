# Square連携ガイド - si'se ダッシュボード

このガイドでは、si'se整体院ダッシュボードとSquareを連携する方法を、初心者の方でもわかるように説明します。

## 📋 目次

1. [Square連携とは](#square連携とは)
2. [必要なもの](#必要なもの)
3. [ステップ1: Squareアカウントの準備](#ステップ1-squareアカウントの準備)
4. [ステップ2: Square Developer Accountの作成](#ステップ2-square-developer-accountの作成)
5. [ステップ3: アプリケーションの作成](#ステップ3-アプリケーションの作成)
6. [ステップ4: 必要な情報の取得](#ステップ4-必要な情報の取得)
7. [ステップ5: ダッシュボードへの設定](#ステップ5-ダッシュボードへの設定)
8. [トラブルシューティング](#トラブルシューティング)

---

## Square連携とは

Square連携により、以下の情報を自動的にダッシュボードに表示できます:

- ✅ **アクティブ会員数**: 現在契約中のサブスク会員の人数
- ✅ **今月の想定売上**: 月額サブスク料金×会員数
- ✅ **今月の新規会員**: 今月入会した会員数
- ✅ **退会率**: 退会者の割合
- ✅ **推定LTV**: 会員1人あたりの生涯価値

これにより、**手作業でデータ入力する必要がなくなり**、常に最新の会員情報が自動反映されます。

---

## 必要なもの

- ✅ Squareアカウント（各店舗ごと）
- ✅ Squareでサブスクリプション機能を使用している
- ✅ パソコンとインターネット接続
- ✅ メールアドレス（Square Developer用）

⚠️ **重要**: 各店舗が独立したSquareアカウントを持っている場合、店舗ごとに設定が必要です。

---

## ステップ1: Squareアカウントの準備

### 1.1 Squareにログイン

1. [Square管理画面](https://squareup.com/dashboard/) にアクセス
2. 各店舗のアカウントでログイン
3. サブスクリプション機能が有効になっていることを確認

### 1.2 サブスクリプションの確認

1. 左メニューから「サブスクリプション」を選択
2. アクティブなサブスクリプションプランがあることを確認
3. 会員が登録されていることを確認

---

## ステップ2: Square Developer Accountの作成

### 2.1 Developer Portalへのアクセス

1. [Square Developer Portal](https://developer.squareup.com/) にアクセス
2. 「Sign In」をクリック
3. Squareアカウントでログイン（店舗のアカウント）

### 2.2 Developerアカウントの設定

1. 初めてアクセスする場合、利用規約に同意
2. 開発者情報を入力（会社名など）

---

## ステップ3: アプリケーションの作成

### 3.1 新規アプリケーションの作成

1. Developer Portalのダッシュボードで「Applications」をクリック
2. 「Create an application」または「新しいアプリケーション」をクリック
3. アプリケーション名を入力（例: `si'se Dashboard - 新宿店`）
4. 「Create application」をクリック

### 3.2 アプリケーションモードの選択

- **サンドボックス（Sandbox）**: テスト用（無料、本番データは使えない）
- **本番（Production）**: 実際のデータを使用

⚠️ 最初はサンドボックスで動作確認し、問題なければ本番モードに切り替えることをお勧めします。

### 3.3 API権限の設定

1. 作成したアプリケーションをクリック
2. 左メニューから「OAuth」を選択
3. 以下の権限を有効にします:

   **必須の権限:**
   - ✅ `CUSTOMERS_READ` - 顧客情報の読み取り
   - ✅ `SUBSCRIPTIONS_READ` - サブスクリプション情報の読み取り
   - ✅ `MERCHANT_PROFILE_READ` - 店舗情報の読み取り

4. 「Save」をクリック

---

## ステップ4: 必要な情報の取得

### 4.1 アクセストークンの取得

1. アプリケーションの「Credentials」タブを開く
2. **Production** または **Sandbox** のセクションを確認
3. 「Access Token」をコピー
   - 本番環境: `Production Access token`
   - テスト環境: `Sandbox Access token`

⚠️ **セキュリティ上の注意:**
- アクセストークンは**絶対に他人に教えない**でください
- GitHubなどにアップロードしないでください
- 定期的に再生成することをお勧めします

形式: `sq0atp-xxxxxxxxxxxxxxxxxxxxx`

### 4.2 ロケーションIDの取得

#### 方法1: Square管理画面から

1. [Square管理画面](https://squareup.com/dashboard/) にログイン
2. 右上のアカウント名をクリック
3. 「ビジネス情報」または「Settings」を選択
4. 「Locations」または「店舗」を選択
5. URLバーに表示されるIDをコピー

形式: `L...` または `LOCATION_ID`

#### 方法2: APIで取得（上級者向け）

Curlコマンドで取得する方法:

```bash
curl https://connect.squareup.com/v2/locations \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json"
```

レスポンスから `id` フィールドの値をコピーします。

---

## ステップ5: ダッシュボードへの設定

### 5.1 設定ファイルの編集

1. `index.html` ファイルをテキストエディタで開く
2. 以下の部分を見つけます（約186-203行目）:

```javascript
// 店舗マスタ
const stores = [
    {
        id: 1,
        name: "新宿店",
        code: "shinjuku",
        squareConfig: {
            accessToken: 'YOUR_SQUARE_ACCESS_TOKEN_SHINJUKU',
            locationId: 'YOUR_LOCATION_ID_SHINJUKU',
        }
    },
    {
        id: 2,
        name: "渋谷店",
        code: "shibuya",
        squareConfig: {
            accessToken: 'YOUR_SQUARE_ACCESS_TOKEN_SHIBUYA',
            locationId: 'YOUR_LOCATION_ID_SHIBUYA',
        }
    }
];
```

3. 各店舗の `accessToken` と `locationId` を、ステップ4で取得した値に置き換えます

### 5.2 設定例

```javascript
const stores = [
    {
        id: 1,
        name: "新宿店",
        code: "shinjuku",
        squareConfig: {
            accessToken: 'sq0atp-abc123def456ghi789jkl012mno345',
            locationId: 'L1234567890ABC',
        }
    },
    {
        id: 2,
        name: "渋谷店",
        code: "shibuya",
        squareConfig: {
            accessToken: 'sq0atp-pqr678stu901vwx234yzabcd567efg',
            locationId: 'L9876543210XYZ',
        }
    }
];
```

### 5.3 月額料金の設定

同じファイル内で、サブスクリプションの月額料金を設定します（約356行目）:

```javascript
const monthlyPrice = 10000; // 月額料金（円）
```

実際の料金に合わせて変更してください。

### 5.4 保存と確認

1. ファイルを保存
2. ブラウザでダッシュボードを開く（または再読み込み）
3. 「会員管理」ページでデータが表示されることを確認

---

## トラブルシューティング

### ❌ エラー: "Square API request failed"

**原因:**
- アクセストークンが間違っている
- API権限が不足している
- ネットワークエラー

**解決方法:**
1. アクセストークンを再確認
2. Developer Portalで権限を確認
3. ブラウザのコンソールでエラー詳細を確認（F12キーで開く）

### ❌ データが表示されない

**原因:**
- ロケーションIDが間違っている
- Squareにサブスクリプションデータがない
- デモモードで動作している

**解決方法:**
1. ロケーションIDを再確認
2. Square管理画面でサブスクリプション状況を確認
3. `index.html`で`YOUR_SQUARE_ACCESS_TOKEN`が実際の値に置き換わっているか確認

### ❌ CORS エラー

**原因:**
- ブラウザのセキュリティ制限

**解決方法:**
- 本番環境では問題ありません
- ローカルでテストする場合は、Webサーバーを使用してください

```bash
# Python 3の場合
python3 -m http.server 8000

# その後ブラウザで http://localhost:8000 を開く
```

### ❌ 「デモモードで動作しています」と表示される

**原因:**
- アクセストークンが設定されていない

**解決方法:**
- `index.html`の設定を確認し、実際のトークンに置き換えてください

---

## 🔒 セキュリティのベストプラクティス

1. **アクセストークンを安全に管理**
   - GitHubなどの公開リポジトリにアップロードしない
   - 定期的にトークンを再生成する
   - 不要になったトークンは削除する

2. **必要最小限の権限のみ付与**
   - 読み取り専用権限を使用
   - 書き込み権限は不要

3. **HTTPS接続を使用**
   - 本番環境では必ずHTTPSを使用

4. **定期的な監査**
   - Square Developer Portalでアクセスログを確認
   - 不審なアクティビティがないかチェック

---

## 📞 サポート

- **Square公式サポート**: https://squareup.com/help/jp/ja
- **Square Developer Forum**: https://developer.squareup.com/forums
- **API ドキュメント**: https://developer.squareup.com/docs

---

## 🎉 完了!

これで、si'seダッシュボードとSquareの連携が完了しました！

ダッシュボードに戻り、リアルタイムで会員データが表示されることを確認してください。

**次のステップ:**
- 定期的にデータを確認し、ビジネスの成長を追跡
- 退会率やLTVなどのKPIを監視
- データに基づいた意思決定を行う

Happy tracking! 📊✨
