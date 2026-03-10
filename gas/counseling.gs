/**
 * si'se カウンセリングデータ取得 GAS (Google Apps Script)
 *
 * 【セットアップ手順】
 * 1. カウンセリングフォームの回答スプレッドシートを開く
 * 2. 拡張機能 → Apps Script を開く
 * 3. このコードを貼り付ける
 * 4. SHEET_NAME を回答シートのシート名に合わせる
 *    （デフォルトは「店舗」）
 * 5. 必要に応じて COL の列番号を調整する
 * 6. デプロイ → 新しいデプロイ → ウェブアプリ
 *    - 実行するユーザー: 自分
 *    - アクセスできるユーザー: 全員
 * 7. 生成されたURLをダッシュボードの設定画面に貼り付ける
 *
 * 【フォーム列の対応】（A列から順に）
 * A: タイムスタンプ
 * B: お名前
 * C: 生年月日
 * D: 電話番号
 * E: メールアドレス
 * F: 職業
 * G: 住所
 * H: 来店目的（複数選択、カンマ区切り）
 * I: お悩み箇所（複数選択、カンマ区切り）
 * J: 改善目標時期
 * K: 施術リクエスト
 * L: 施術経験
 * M: 手術歴
 * N: 治療中の疾患
 * O: アレルギー
 * P: 美容整形
 * Q: 妊娠・疾患確認
 * R: 免責事項同意
 *
 * ※列の順序がフォームと異なる場合は COL の数値を変更してください
 */

const SHEET_NAME = '店舗';

// 列インデックス（0始まり）
const COL = {
  TIMESTAMP: 0,
  NAME: 1,
  BIRTHDAY: 2,
  PHONE: 3,
  EMAIL: 4,
  OCCUPATION: 5,
  ADDRESS: 6,
  VISIT_PURPOSE: 7,
  CONCERNS: 8,
  IMPROVEMENT_TIMELINE: 9,
  TREATMENT_REQUEST: 10,
  TREATMENT_EXPERIENCE: 11,
  SURGERY_HISTORY: 12,
  CURRENT_TREATMENT: 13,
  ALLERGY: 14,
  COSMETIC_SURGERY: 15,
  PREGNANCY_CHECK: 16,
  DISCLAIMER: 17
};

/**
 * GETリクエストハンドラ
 * クエリパラメータ:
 *   ?action=list          → 顧客一覧（名前・タイムスタンプのみ）
 *   ?action=detail&name=xxx → 特定顧客の詳細データ
 *   ?action=search&q=xxx  → 名前で部分一致検索
 *   ?action=recent&limit=N → 直近N件の顧客一覧（デフォルト20件）
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
      return jsonResponse({ customers: [], total: 0 });
    }

    const numCols = sheet.getLastColumn();
    const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
    const params = e ? (e.parameter || {}) : {};
    const action = params.action || 'list';

    switch (action) {
      case 'list':
        return jsonResponse(getCustomerList(data));

      case 'recent':
        const limit = parseInt(params.limit) || 20;
        return jsonResponse(getRecentCustomers(data, limit));

      case 'detail':
        const name = params.name || '';
        const index = params.index;
        return jsonResponse(getCustomerDetail(data, name, index));

      case 'search':
        const query = params.q || '';
        return jsonResponse(searchCustomers(data, query));

      default:
        return jsonResponse({ error: '不明なアクション: ' + action }, 400);
    }

  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

/** 顧客一覧（名前・タイムスタンプ・お悩み箇所のみ） */
function getCustomerList(data) {
  const customers = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const ts = row[COL.TIMESTAMP];
    if (!ts) continue;

    const date = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(date.getTime())) continue;

    const name = String(row[COL.NAME] || '').trim();
    if (!name) continue;

    customers.push({
      index: i,
      name: name,
      timestamp: date.toISOString(),
      concerns: parseMultiSelect(row[COL.CONCERNS])
    });
  }

  // 新しい順にソート
  customers.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return {
    customers: customers,
    total: customers.length,
    lastUpdated: new Date().toISOString()
  };
}

/** 直近N件の顧客一覧 */
function getRecentCustomers(data, limit) {
  const result = getCustomerList(data);
  result.customers = result.customers.slice(0, limit);
  result.total = result.customers.length;
  return result;
}

/** 特定顧客の詳細データ */
function getCustomerDetail(data, name, index) {
  let row = null;
  let rowIndex = -1;

  if (index !== undefined && index !== '') {
    // インデックス指定
    const idx = parseInt(index);
    if (idx >= 0 && idx < data.length) {
      row = data[idx];
      rowIndex = idx;
    }
  } else if (name) {
    // 名前で検索（最新の回答を返す）
    for (let i = data.length - 1; i >= 0; i--) {
      const rowName = String(data[i][COL.NAME] || '').trim();
      if (rowName === name) {
        row = data[i];
        rowIndex = i;
        break;
      }
    }
  }

  if (!row) {
    return { error: '顧客が見つかりません', customer: null };
  }

  const ts = row[COL.TIMESTAMP];
  const date = ts instanceof Date ? ts : new Date(ts);

  return {
    customer: {
      index: rowIndex,
      name: String(row[COL.NAME] || '').trim(),
      timestamp: date.toISOString(),
      birthday: formatDate(row[COL.BIRTHDAY]),
      phone: String(row[COL.PHONE] || '').trim(),
      email: String(row[COL.EMAIL] || '').trim(),
      occupation: String(row[COL.OCCUPATION] || '').trim(),
      address: String(row[COL.ADDRESS] || '').trim(),
      visitPurpose: parseMultiSelect(row[COL.VISIT_PURPOSE]),
      concerns: parseMultiSelect(row[COL.CONCERNS]),
      improvementTimeline: String(row[COL.IMPROVEMENT_TIMELINE] || '').trim(),
      treatmentRequest: String(row[COL.TREATMENT_REQUEST] || '').trim(),
      treatmentExperience: parseMultiSelect(row[COL.TREATMENT_EXPERIENCE]),
      surgeryHistory: String(row[COL.SURGERY_HISTORY] || '').trim(),
      currentTreatment: String(row[COL.CURRENT_TREATMENT] || '').trim(),
      allergy: String(row[COL.ALLERGY] || '').trim(),
      cosmeticSurgery: String(row[COL.COSMETIC_SURGERY] || '').trim(),
      pregnancyCheck: String(row[COL.PREGNANCY_CHECK] || '').trim()
    }
  };
}

/** 名前で部分一致検索 */
function searchCustomers(data, query) {
  if (!query) {
    return { customers: [], total: 0 };
  }

  const customers = [];
  const seen = {};

  // 新しい順に検索し、同名の場合は最新のみ
  for (let i = data.length - 1; i >= 0; i--) {
    const row = data[i];
    const name = String(row[COL.NAME] || '').trim();
    if (!name || !name.includes(query)) continue;
    if (seen[name]) continue;
    seen[name] = true;

    const ts = row[COL.TIMESTAMP];
    const date = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(date.getTime())) continue;

    customers.push({
      index: i,
      name: name,
      timestamp: date.toISOString(),
      concerns: parseMultiSelect(row[COL.CONCERNS])
    });
  }

  return {
    customers: customers,
    total: customers.length,
    lastUpdated: new Date().toISOString()
  };
}

/** 複数選択フィールドをパース（カンマ or セミコロン区切り） */
function parseMultiSelect(val) {
  if (!val) return [];
  const str = String(val).trim();
  if (!str) return [];
  // Googleフォームはカンマ+スペースで区切る
  return str.split(/[,;、]\s*/).map(s => s.trim()).filter(s => s);
}

/** 日付フォーマット */
function formatDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return val.getFullYear() + '-' +
      String(val.getMonth() + 1).padStart(2, '0') + '-' +
      String(val.getDate()).padStart(2, '0');
  }
  return String(val).trim();
}

/** JSONレスポンス生成（CORS対応） */
function jsonResponse(data, status) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
