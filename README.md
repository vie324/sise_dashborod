# si'se 会員管理ダッシュボード

Square APIと連携したサブスクリプション型整骨院の会員管理ダッシュボード

## 機能

✅ **Square API連携**
- 会員情報の取得（Customers API）
- サブスクリプション管理（Subscriptions API）
- 支払い履歴（Invoices API）

✅ **会員管理**
- 会員一覧表示
- ステータス管理（アクティブ/退会/保留）
- 入会日・退会日の記録
- プラン情報と月額料金

✅ **分析機能**
- 月間入退会トレンドチャート
- 収益分析
- KPI表示
- 解約率（Churn Rate）計算

✅ **日報管理**
- 新規問い合わせ記録
- 契約数トラッキング
- 店舗別データ管理

## セットアップ

### 必要なもの

- Node.js 14以上
- Square Developer アカウント
- Square API アクセストークン

### インストール手順

1. **リポジトリをクローン**
   ```bash
   git clone <repository-url>
   cd sise_dashborod
   ```

2. **サーバーを起動**
   ```bash
   npm start
   ```

3. **ブラウザでアクセス**
   ```
   http://localhost:3000
   ```

## Square API設定

### 1. Square Developer Accountを作成
- https://developer.squareup.com/ にアクセス
- アカウントを作成してログイン

### 2. アプリを作成
- Developer Dashboard で「Create App」をクリック
- アプリ名を入力して作成

### 3. アクセストークンを取得
- 左サイドバーから「Credentials」をクリック
- 「Sandbox Access Token」をコピー

### 4. Location IDを取得
- Credentialsページの「Locations」セクションからコピー
- または `get-location-id.html` ツールを使用

### 5. server.jsに設定
`server.js`の以下の部分を編集：

```javascript
const SQUARE_CONFIG = {
    accessToken: 'YOUR_ACCESS_TOKEN',
    locationId: 'YOUR_LOCATION_ID',
    baseUrl: 'https://connect.squareupsandbox.com/v2'
};
```

## 使い方

### サーバー起動

```bash
npm start
```

サーバーが起動したら、ブラウザで http://localhost:3000 を開きます。

### 各機能の説明

#### 会員管理ページ
- 左サイドバーから「会員管理」をクリック
- 「データ更新」ボタンでSquare APIから最新データを取得
- 会員の検索・フィルタリング
- 支払い履歴の確認

#### 日報入力ページ
- 左サイドバーから「日報入力」をクリック
- 新規問い合わせ、契約数を入力
- Google Sheets連携で自動保存（設定が必要）

## トラブルシューティング

### エラー: Failed to fetch

**原因**: CORS制限により、ブラウザから直接Square APIにアクセスできません。

**解決策**: 必ずサーバーを起動してアクセスしてください。
```bash
npm start
```

### エラー: Unauthorized (401)

**原因**: アクセストークンが間違っています。

**解決策**:
1. Square Developer Dashboardでトークンをコピーしなおす
2. `server.js`に正しく貼り付ける
3. サーバーを再起動

### データが表示されない

**原因**:
- Location IDが間違っている
- Sandboxにデータがない

**解決策**:
1. Location IDを再確認
2. Square Dashboardでテストデータを作成
3. またはProduction環境に切り替え

## ファイル構成

```
sise_dashborod/
├── index.html              # メインダッシュボード
├── server.js               # プロキシサーバー（CORS回避）
├── package.json            # Node.js設定
├── get-location-id.html    # Location ID取得ツール
└── README.md              # このファイル
```

## 本番環境への移行

Sandbox環境から本番環境に移行する場合：

1. **Production Access Tokenを取得**
   - Square Developer Dashboard → Credentials
   - Production Access Tokenをコピー

2. **server.jsを更新**
   ```javascript
   baseUrl: 'https://connect.squareup.com/v2'  // Productionに変更
   ```

3. **セキュリティ強化**
   - アクセストークンを環境変数に移動
   - HTTPS対応
   - 認証機能の追加

## ライセンス

MIT

## サポート

問題が発生した場合は、Issue を作成してください。
