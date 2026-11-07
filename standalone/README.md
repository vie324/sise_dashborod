# 姿勢分析ツール（スタンドアロン版）

ダッシュボード（`public/index.html`）から **姿勢分析ツールだけを切り離した単体版** です。
`posture-analysis-standalone.html` の **1ファイルだけ** で完結し、コピペ・単体配置で動きます。

## 使い方

### そのまま開く
`posture-analysis-standalone.html` をブラウザで開くだけ。追加のビルド・サーバーは不要です。

> **カメラを使うには HTTPS または `http://localhost` が必要**（ブラウザの `getUserMedia` 制約）。
> `file://` で開くとカメラが起動しない場合があります。その場合は簡易サーバー経由で開いてください:
> ```bash
> cd standalone
> npx http-server -p 8080     # もしくは  python3 -m http.server 8080
> # → http://localhost:8080/posture-analysis-standalone.html
> ```

### コピペで別プロジェクトへ
`posture-analysis-standalone.html` の中身をそのまま貼り付けるか、
`<script type="text/babel">` 内の以下を必要な部分だけコピーしてください:

- **サポートヘルパー**（`showToast` / `resolveDisplayName` / `hapticSuccess` など）
- **姿勢分析ロジック**（`POSTURE_LM`, `postureAnalyzeFront/Back/Side/Seated`, `postureGetTotal` ほか）— DOM非依存の純粋関数
- **画像合成**（`postureComposeImage`, `postureCreateComparisonImage`）
- **LINE Flex ビルダー**（`buildPostureFlexMessage`, `buildPostureComparisonFlexMessage`）
- **UIコンポーネント**（`PostureAnalysisView`）

## 使用ライブラリ（CDN・すべてHTML内で読込）

| ライブラリ | 用途 |
|---|---|
| React 18 / ReactDOM 18 | UI |
| Babel Standalone 7.29 | ブラウザ内 JSX 変換 |
| Tailwind CSS (CDN) | スタイル |
| MediaPipe Pose 0.5 | 骨格検出（`カメラを起動`時に自動読込） |

## 単体版で「そのまま動く」機能

- カメラ起動 → MediaPipe Pose による骨格検出
- **正面 / 背面 / 側面 / 座位** の姿勢分析とスコア算出（査読論文ベースの閾値）
- 骨格オーバーレイ / スコア表示 / グリッド / 端末の傾き検出
- ランドマークの手動修正・手書き注釈
- **Before / After 比較**
- 合成画像 + 分析JSON のダウンロード / 端末共有（Web Share API）
- LINE Flex メッセージの組み立て（プレビュー用）

## バックエンド連携が必要な機能（単体版では無効）

これらは元ダッシュボードのサーバー API に依存します。単体版では呼び出しても
失敗トーストが出るだけで、他の機能には影響しません。

| 機能 | 依存先 | 再連携方法 |
|---|---|---|
| LINE 送信 | `lineChatHook` プロップ | HTML末尾の mount 部を参照。`sendFlexMessage(userId, flexMsg)` 等を持つオブジェクトを渡す |
| 比較画像アップロード | `POST /api/photos/upload` | `uploadToBlob()` 内の fetch 先を実装 |
| AIアドバイス生成 | `POST /api/claude/advice` | `generateAdvice()` 内の fetch 先を実装 |

### `lineChatHook` の最小形

```js
{
  lineConfig: { configured: true },
  allowedLineStores: [{ id, name }],
  lineStoreId,
  setLineStoreId(id),
  threads: [{ userId }],
  profiles: { [userId]: { displayName, pictureUrl } },
  refreshingUserIds: new Set(),
  loading: false,
  fetchThreads(storeId),
  sendFlexMessage(userId, flexMsg) => Promise<boolean>,
}
```

## 元ダッシュボードとの対応

抜粋元は `public/index.html`（`buildPostureFlexMessage` 〜 `PostureAnalysisView`）。
姿勢分析ロジック・UIは **無改変** で移植しており、サポートヘルパー（トースト・
表示名解決・触覚など）のみ単体で自己完結する形に再実装しています。
