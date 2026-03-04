/**
 * si'se 日報データ取得 GAS (Google Apps Script)
 *
 * 【セットアップ手順】
 * 1. Google スプレッドシート（フォーム回答シート）を開く
 * 2. 拡張機能 → Apps Script を開く
 * 3. このコードを貼り付ける
 * 4. SHEET_NAME をフォーム回答シートのシート名に合わせる
 *    （デフォルトは「フォームの回答 1」）
 * 5. デプロイ → 新しいデプロイ → ウェブアプリ
 *    - 実行するユーザー: 自分
 *    - アクセスできるユーザー: 全員
 * 6. 生成されたURLをダッシュボードの設定画面に貼り付ける
 *
 * 【フォーム列の対応】（A列から順に）
 * A: タイムスタンプ
 * B: 出勤店舗
 * C: HPBの新規数
 * D: metaの新規数
 * E: ご紹介の新規数
 * F: 割引集客の新規数
 * G: HPBの契約数
 * H: metaの契約数
 * I: ご紹介の契約数
 * J: 割引集客の契約数
 * K: 既存施術数
 * L: 本日の業務完了確認
 * M: 明日の準備完了確認
 */

const SHEET_NAME = 'フォームの回答 1';

// 列インデックス（0始まり）
const COL = {
  TIMESTAMP: 0,
  STORE: 1,
  HPB_NEW: 2,
  META_NEW: 3,
  REFERRAL_NEW: 4,
  DISCOUNT_NEW: 5,
  HPB_CONTRACT: 6,
  META_CONTRACT: 7,
  REFERRAL_CONTRACT: 8,
  DISCOUNT_CONTRACT: 9,
  EXISTING_TREATMENTS: 10,
  TASK_COMPLETE: 11,
  PREP_COMPLETE: 12
};

/**
 * GETリクエストハンドラ
 * クエリパラメータ:
 *   ?month=2026-03  → 指定月のデータのみ返す（省略時: 当月）
 *   ?months=3       → 直近N ヶ月分を返す
 *   ?all=true       → 全データを返す
 */
function doGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      return jsonResponse({ error: 'シート "' + SHEET_NAME + '" が見つかりません' }, 404);
    }

    const lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      return jsonResponse({ reports: [], total: 0 });
    }

    // 全データを一括取得（1行目はヘッダー）
    const data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
    const params = e ? (e.parameter || {}) : {};

    // フィルタ範囲の決定
    let startDate = null;
    let endDate = null;

    if (params.all === 'true') {
      // 全データ
    } else if (params.month) {
      // 特定月
      const [y, m] = params.month.split('-').map(Number);
      startDate = new Date(y, m - 1, 1);
      endDate = new Date(y, m, 0, 23, 59, 59);
    } else if (params.months) {
      // 直近N ヶ月
      const n = parseInt(params.months) || 1;
      const now = new Date();
      startDate = new Date(now.getFullYear(), now.getMonth() - (n - 1), 1);
    } else {
      // デフォルト: 当月
      const now = new Date();
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    const reports = [];
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const ts = row[COL.TIMESTAMP];
      if (!ts) continue;

      const date = ts instanceof Date ? ts : new Date(ts);
      if (isNaN(date.getTime())) continue;

      // 日付フィルタ
      if (startDate && date < startDate) continue;
      if (endDate && date > endDate) continue;

      reports.push({
        timestamp: date.toISOString(),
        store: String(row[COL.STORE] || '').trim(),
        hpbNew: toInt(row[COL.HPB_NEW]),
        metaNew: toInt(row[COL.META_NEW]),
        referralNew: toInt(row[COL.REFERRAL_NEW]),
        discountNew: toInt(row[COL.DISCOUNT_NEW]),
        hpbContract: toInt(row[COL.HPB_CONTRACT]),
        metaContract: toInt(row[COL.META_CONTRACT]),
        referralContract: toInt(row[COL.REFERRAL_CONTRACT]),
        discountContract: toInt(row[COL.DISCOUNT_CONTRACT]),
        existingTreatments: toInt(row[COL.EXISTING_TREATMENTS]),
        taskComplete: String(row[COL.TASK_COMPLETE] || '') === '完了しました',
        prepComplete: String(row[COL.PREP_COMPLETE] || '') === '完了しました'
      });
    }

    // 新しい順にソート
    reports.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return jsonResponse({
      reports: reports,
      total: reports.length,
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

/** 数値変換（空文字・文字列対応） */
function toInt(val) {
  const n = parseInt(val, 10);
  return isNaN(n) ? 0 : n;
}

/** JSONレスポンス生成（CORS対応） */
function jsonResponse(data, status) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
