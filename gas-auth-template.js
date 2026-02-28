// =============================================
// Google Apps Script - 認証用テンプレート
// =============================================
//
// 【セットアップ手順】
// 1. Google スプレッドシートを新規作成
// 2. シート名を「認証」に変更
// 3. 以下のヘッダー行（1行目）を入力:
//    A1: パスワード  B1: 役割  C1: 名前  D1: 店舗IDs
//
// 4. 2行目以降にユーザーを登録:
//    | パスワード     | 役割     | 名前       | 店舗IDs |
//    |---------------|----------|-----------|---------|
//    | master123     | master   | オーナー    |         |
//    | overview456   | overview | エリアMGR   |         |
//    | manager789    | manager  | 大和店長    | 1,4     |
//    | staff001      | staff    | 田中太郎    | 1       |
//    | staff002      | staff    | 佐藤花子    | 4       |
//
//    ※ 役割は master / overview / manager / staff の4種類
//    ※ 店舗IDsは店舗番号をカンマ区切り（master/overviewは空欄でOK＝全店舗）
//
// 5. 拡張機能 → Apps Script を開く
// 6. このコードを貼り付けて保存
// 7. デプロイ → 新しいデプロイ → ウェブアプリ
//    - 実行するユーザー: 自分
//    - アクセス: 全員
// 8. デプロイURLをコピー
// 9. Vercel環境変数に設定:
//    AUTH_SHEET_URL = コピーしたURL
//
// =============================================

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    if (data.action === 'verify') {
      var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('認証');
      if (!sheet) {
        return createResponse({ success: false, error: 'シート「認証」が見つかりません' });
      }

      var rows = sheet.getDataRange().getValues();
      // ヘッダー行をスキップ（1行目）
      for (var i = 1; i < rows.length; i++) {
        var password = String(rows[i][0]).trim();
        var role = String(rows[i][1]).trim();
        var name = String(rows[i][2]).trim();
        var storeIdsRaw = String(rows[i][3]).trim();

        if (password === String(data.password).trim()) {
          var storeIds = [];
          if (storeIdsRaw && storeIdsRaw !== '') {
            storeIds = storeIdsRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
          }

          return createResponse({
            success: true,
            role: role,
            name: name,
            storeIds: storeIds
          });
        }
      }

      return createResponse({ success: false });
    }

    return createResponse({ success: false, error: 'Unknown action' });

  } catch (err) {
    return createResponse({ success: false, error: err.message });
  }
}

function createResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// テスト用（Apps Scriptエディタから実行して動作確認）
function testVerify() {
  var result = doPost({
    postData: {
      contents: JSON.stringify({ action: 'verify', password: 'master123' })
    }
  });
  Logger.log(result.getContent());
}
