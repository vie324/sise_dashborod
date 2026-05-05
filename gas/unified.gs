/**
 * si'se カウンセリング GAS (Google Apps Script)
 *
 * カウンセリング Google フォームの回答を si'se ダッシュボードに供給するための
 * 唯一の GAS 関数群です。出納帳・勤怠・会員・回数券・スタッフ・店舗・日報・HPB
 * など他のデータは Supabase (/api/db) に集約済みのため、ここには含まれません。
 *
 * 【セットアップ手順】
 * 1. Google スプレッドシートを作成し、各店舗のカウンセリングフォーム回答先に
 *    指定する。シート名を以下に変更:
 *      ─ カウンセリング回答_本厚木店
 *      ─ カウンセリング回答_大和店
 *      ─ カウンセリング回答_横浜店
 *      ─ カウンセリング回答_町田店
 *      ─ カウンセリング回答_川口店
 * 2. 拡張機能 → Apps Script を開き、このコードを貼り付け
 * 3. デプロイ → 新しいデプロイ → ウェブアプリ
 *      - 実行するユーザー: 自分
 *      - アクセスできるユーザー: 全員
 * 4. 生成された URL をダッシュボードの「カウンセリング GAS URL」設定欄に貼り付け
 *
 * 【API リファレンス】
 * GET ?type=counseling&action=stores
 *   → カウンセリング店舗一覧
 * GET ?type=counseling&store=honatsugi&action=recent&limit=50
 *   → 直近 50 件のカウンセリング顧客
 * GET ?type=counseling&store=honatsugi&action=detail&name=xxx
 *   → 個別の顧客カウンセリング詳細
 * GET ?type=counseling&store=honatsugi&action=search&q=xxx
 *   → 名前で検索
 * GET ?type=counseling&action=diagnose
 *   → 全店舗のシート/カラム検出を診断
 */

// ============================================================
// 定数
// ============================================================

const COUNSELING_STORES = {
  honatsugi: 'カウンセリング回答_本厚木店',
  yamato:    'カウンセリング回答_大和店',
  yokohama:  'カウンセリング回答_横浜店',
  machida:   'カウンセリング回答_町田店',
  kawaguchi: 'カウンセリング回答_川口店'
};

// 本厚木店のフォーム列順のフォールバック (ヘッダー検出失敗時の保険)
const COUNSELING_COL_DEFAULT = {
  TIMESTAMP: 0, NAME: 1, BIRTHDAY: 2, PHONE: 3, EMAIL: 4,
  OCCUPATION: 5, ADDRESS: 6, VISIT_PURPOSE: 7, CONCERNS: 8,
  IMPROVEMENT_TIMELINE: 9, TREATMENT_REQUEST: 10, TREATMENT_EXPERIENCE: 11,
  SURGERY_HISTORY: 12, CURRENT_TREATMENT: 13, ALLERGY: 14,
  COSMETIC_SURGERY: 15, PREGNANCY_CHECK: 16, DISCLAIMER: 17
};

// ヘッダーテキストに含まれるキーワードでマッチング（優先度の高いものを先に）
const COUNSELING_HEADER_KEYWORDS = {
  TIMESTAMP:            ['タイムスタンプ', 'timestamp', '日時', '送信日'],
  NAME:                 ['お名前', '氏名', 'フルネーム', '名前', 'name'],
  BIRTHDAY:             ['生年月日', '誕生日', 'birthday', '生まれ'],
  PHONE:                ['電話番号', '電話', 'tel', 'phone', '連絡先'],
  EMAIL:                ['メールアドレス', 'メール', 'email', 'mail'],
  OCCUPATION:           ['ご職業', '職業', 'occupation'],
  ADDRESS:              ['ご住所', '住所', '地域', 'address', 'お住まい'],
  VISIT_PURPOSE:        ['ご来店', '来店目的', '来店きっかけ', 'きっかけ', '何で知りました', '知ったきっかけ'],
  CONCERNS:             ['お悩み', '気になる箇所', '気になる部位', '気になること', 'お身体のお悩み', 'お体のお悩み', 'お体で気になる', 'お身体で気になる', '不調', '症状', 'お困り'],
  IMPROVEMENT_TIMELINE: ['いつまでに', 'どのくらいの期間', '改善したい時期', '改善', '期間', 'いつ頃まで'],
  TREATMENT_REQUEST:    ['施術のご希望', '施術の希望', 'ご希望の施術', '施術についてのご要望', 'リクエスト', '希望する施術'],
  TREATMENT_EXPERIENCE: ['整体', 'マッサージ', 'カイロ', 'ご利用経験', '利用経験', '受けたことが', '施術経験'],
  SURGERY_HISTORY:      ['手術', '外科'],
  CURRENT_TREATMENT:    ['通院', '治療中'],
  ALLERGY:              ['アレルギー'],
  COSMETIC_SURGERY:     ['美容整形', '美容外科', '美容医療'],
  PREGNANCY_CHECK:      ['妊娠', '授乳', '特定疾患'],
  DISCLAIMER:           ['異議を申し立て', '上記の内容を理解', '同意します', '注意事項', '免責', '確認事項', '確認いたしました', '確認しました', '同意']
};

// 医療系フィールドから免責・同意系の誤検出値を除外
var DISCLAIMER_VALUES = ['確認いたしました', '確認しました', '同意します', '同意しました', '同意いたします', '了承しました', '了承いたしました', '承知しました'];

// CONCERNS フォールバックスキャン用キーワード
var CONCERN_SCAN_KEYWORDS = ['肩こり', '腰痛', '頭痛', '猫背', '骨盤', 'むくみ', '冷え', '眼精疲労',
  'ストレートネック', '反り腰', '股関節', '姿勢', '食いしばり', '頬のたるみ', '生理痛', '下半身',
  'X脚', 'O脚', 'はちの張り', '顔の左右差', 'エラの張り', '首', '膝'];

// 施術経験フォールバックスキャン用キーワード
var TREATMENT_EXP_SCAN_KEYWORDS = ['整体', 'マッサージ', 'カイロ', '鍼灸', 'エステ', 'リラクゼーション', '接骨院', '整骨院', 'ストレッチ専門'];

// 免責事項テキストの判定キーワード
var DISCLAIMER_KEYWORDS = ['異議を申し立て', '上記の内容を理解', '施術をうけ', '同意します', '確認いたしました'];

// ============================================================
// ルーター
// ============================================================

function doGet(e) {
  try {
    var params = e ? (e.parameter || {}) : {};
    var type = params.type || 'counseling';
    if (type !== 'counseling') {
      return jsonResponse({
        error: 'このエンドポイントはカウンセリングデータ専用です (type=counseling)。' +
               'その他のデータは Supabase (/api/db) を利用してください。'
      });
    }
    return jsonResponse(handleCounselingGet(params));
  } catch (err) {
    return jsonResponse({ error: 'Server error: ' + (err.message || err) });
  }
}

// POST は使用しない（カウンセリングは読み取り専用）
function doPost() {
  return jsonResponse({
    error: 'このエンドポイントは GET のみ対応です。書き込みは Supabase (/api/db) を利用してください。'
  });
}

// ============================================================
// カウンセリング（読み取り専用 - Google フォーム入力）
// ============================================================

function handleCounselingGet(params) {
  var action = params.action || 'list';

  if (action === 'stores') {
    return {
      stores: Object.keys(COUNSELING_STORES).map(function(key) {
        return { id: key, name: COUNSELING_STORES[key].replace('カウンセリング回答_', '') };
      })
    };
  }

  if (action === 'diagnose') return diagnoseCounselingSheets();

  var storeKey = params.store || '';
  if (!storeKey || !COUNSELING_STORES[storeKey]) {
    return { error: '店舗を指定してください（store=' + Object.keys(COUNSELING_STORES).join('|') + '）' };
  }

  var sheetName = COUNSELING_STORES[storeKey];
  var sheet = getSheet(sheetName);
  if (!sheet) return { error: 'シート "' + sheetName + '" が見つかりません' };

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { customers: [], total: 0, store: storeKey };

  var numCols = sheet.getLastColumn();
  // ヘッダー行を読み取り、カラムを動的検出
  var headerRow = sheet.getRange(1, 1, 1, numCols).getValues()[0];
  var C = detectCounselingColumns(headerRow);
  var data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();

  // デバッグ用
  var debugHeaders = headerRow.map(function(h, i) { return i + ':' + String(h || '').trim().substring(0, 30); });
  var sampleConcern = '';
  if (C.CONCERNS >= 0) {
    for (var si = 0; si < Math.min(data.length, 10); si++) {
      var sv = colVal(data[si], C.CONCERNS);
      if (sv) { sampleConcern = String(sv).substring(0, 100); break; }
    }
  }
  var _debug = { colMap: C, headers: debugHeaders, sampleConcern: sampleConcern, sheetName: sheetName };

  switch (action) {
    case 'list':
      return Object.assign({ store: storeKey, _debug: _debug }, counselingList(data, C));
    case 'recent':
      var limit = parseInt(params.limit) || 20;
      var recent = counselingList(data, C);
      recent.customers = recent.customers.slice(0, limit);
      recent.total = recent.customers.length;
      return Object.assign({ store: storeKey, _debug: _debug }, recent);
    case 'detail':
      return Object.assign({ store: storeKey, _debug: _debug }, counselingDetail(data, C, params.name, params.index));
    case 'search':
      return Object.assign({ store: storeKey, _debug: _debug }, counselingSearch(data, C, params.q || ''));
    default:
      return { error: '不明なアクション: ' + action };
  }
}

// ヘッダー行から動的にカラムマッピングを構築
function detectCounselingColumns(headerRow) {
  var C = {};
  var headers = headerRow.map(function(h) { return String(h || '').trim(); });
  var headersLower = headers.map(function(h) { return h.toLowerCase(); });
  var keys = Object.keys(COUNSELING_HEADER_KEYWORDS);
  var usedCols = {};

  for (var k = 0; k < keys.length; k++) {
    var key = keys[k];
    var keywords = COUNSELING_HEADER_KEYWORDS[key];
    var found = -1;
    for (var j = 0; j < keywords.length; j++) {
      var kw = keywords[j].toLowerCase();
      for (var i = 0; i < headersLower.length; i++) {
        if (usedCols[i]) continue;
        if (headersLower[i].indexOf(kw) !== -1) { found = i; break; }
      }
      if (found !== -1) break;
    }
    if (found !== -1) {
      C[key] = found;
      usedCols[found] = key;
    } else {
      C[key] = COUNSELING_COL_DEFAULT[key] !== undefined ? COUNSELING_COL_DEFAULT[key] : -1;
    }
  }
  return C;
}

// 安全なカラムアクセス
function colVal(row, colIndex) {
  if (colIndex === undefined || colIndex < 0 || colIndex >= row.length) return '';
  return row[colIndex];
}

// 医療系フィールドから免責・同意系の誤検出値を除外
function sanitizeMedicalField(val) {
  var s = String(val || '').trim();
  if (!s) return '';
  for (var i = 0; i < DISCLAIMER_VALUES.length; i++) {
    if (s.indexOf(DISCLAIMER_VALUES[i]) !== -1) return '';
  }
  return s;
}

// 全列をスキャンしてお悩みデータを含むセルを探す（フォールバック）
function scanForConcerns(row, C) {
  var best = [];
  for (var ci = 0; ci < row.length; ci++) {
    if (ci === C.NAME || ci === C.TIMESTAMP || ci === C.PHONE || ci === C.EMAIL || ci === C.ADDRESS || ci === C.BIRTHDAY) continue;
    var cellVal = String(row[ci] || '').trim();
    if (!cellVal || cellVal.length > 200) continue;
    var matchCount = 0;
    for (var ck = 0; ck < CONCERN_SCAN_KEYWORDS.length; ck++) {
      if (cellVal.indexOf(CONCERN_SCAN_KEYWORDS[ck]) !== -1) matchCount++;
    }
    if (matchCount >= 1) {
      var candidate = parseMultiSelect(cellVal);
      if (candidate.length > best.length) best = candidate;
    }
  }
  return best;
}

function counselingList(data, C) {
  var customers = [];
  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    var ts = colVal(row, C.TIMESTAMP);
    if (!ts) continue;
    var date = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(date.getTime())) continue;
    var name = String(colVal(row, C.NAME) || '').trim();
    if (!name) continue;
    var concerns = parseMultiSelect(colVal(row, C.CONCERNS));
    if (concerns.length === 0) concerns = scanForConcerns(row, C);
    customers.push({ index: i, name: name, timestamp: date.toISOString(), concerns: concerns });
  }
  customers.sort(function(a, b) { return new Date(b.timestamp) - new Date(a.timestamp); });
  return { customers: customers, total: customers.length, lastUpdated: new Date().toISOString() };
}

function isDisclaimerText(val) {
  if (!val) return false;
  var s = String(val);
  for (var i = 0; i < DISCLAIMER_KEYWORDS.length; i++) {
    if (s.indexOf(DISCLAIMER_KEYWORDS[i]) !== -1) return true;
  }
  return false;
}

function scanForTreatmentExperience(row, C) {
  for (var ci = 0; ci < row.length; ci++) {
    if (ci === C.NAME || ci === C.TIMESTAMP || ci === C.PHONE || ci === C.EMAIL || ci === C.ADDRESS || ci === C.BIRTHDAY) continue;
    if (ci === C.CONCERNS || ci === C.DISCLAIMER) continue;
    var cellVal = String(row[ci] || '').trim();
    if (!cellVal || cellVal.length > 200) continue;
    if (isDisclaimerText(cellVal)) continue;
    var matchCount = 0;
    for (var ck = 0; ck < TREATMENT_EXP_SCAN_KEYWORDS.length; ck++) {
      if (cellVal.indexOf(TREATMENT_EXP_SCAN_KEYWORDS[ck]) !== -1) matchCount++;
    }
    if (matchCount >= 1) return parseMultiSelect(cellVal);
  }
  return [];
}

function counselingDetail(data, C, name, index) {
  var row = null, rowIndex = -1;
  if (index !== undefined && index !== '') {
    var idx = parseInt(index);
    if (idx >= 0 && idx < data.length) { row = data[idx]; rowIndex = idx; }
  } else if (name) {
    for (var i = data.length - 1; i >= 0; i--) {
      if (String(colVal(data[i], C.NAME) || '').trim() === name) { row = data[i]; rowIndex = i; break; }
    }
  }
  if (!row) return { error: '顧客が見つかりません', customer: null };
  var ts = colVal(row, C.TIMESTAMP);
  var date = ts instanceof Date ? ts : new Date(ts);

  var rawConcerns = colVal(row, C.CONCERNS);
  var concerns = parseMultiSelect(rawConcerns);
  if (concerns.length === 0) concerns = scanForConcerns(row, C);

  var treatmentExpRaw = parseMultiSelect(colVal(row, C.TREATMENT_EXPERIENCE));
  var treatmentExp = treatmentExpRaw.filter(function(v) { return !isDisclaimerText(v); });
  if (treatmentExp.length === 0 && treatmentExpRaw.length > 0) {
    treatmentExp = scanForTreatmentExperience(row, C);
  }

  return {
    customer: {
      index: rowIndex,
      name: String(colVal(row, C.NAME) || '').trim(),
      timestamp: date.toISOString(),
      birthday: formatDate(colVal(row, C.BIRTHDAY)),
      phone: String(colVal(row, C.PHONE) || '').trim(),
      email: String(colVal(row, C.EMAIL) || '').trim(),
      occupation: String(colVal(row, C.OCCUPATION) || '').trim(),
      address: String(colVal(row, C.ADDRESS) || '').trim(),
      visitPurpose: parseMultiSelect(colVal(row, C.VISIT_PURPOSE)),
      concerns: concerns,
      improvementTimeline: String(colVal(row, C.IMPROVEMENT_TIMELINE) || '').trim(),
      treatmentRequest: String(colVal(row, C.TREATMENT_REQUEST) || '').trim(),
      treatmentExperience: treatmentExp,
      surgeryHistory: String(colVal(row, C.SURGERY_HISTORY) || '').trim(),
      currentTreatment: String(colVal(row, C.CURRENT_TREATMENT) || '').trim(),
      allergy: String(colVal(row, C.ALLERGY) || '').trim(),
      cosmeticSurgery: sanitizeMedicalField(colVal(row, C.COSMETIC_SURGERY)),
      pregnancyCheck: sanitizeMedicalField(colVal(row, C.PREGNANCY_CHECK)),
      _rawConcerns: String(rawConcerns || '').substring(0, 100)
    }
  };
}

function counselingSearch(data, C, query) {
  if (!query) return { customers: [], total: 0 };
  var customers = [], seen = {};
  for (var i = data.length - 1; i >= 0; i--) {
    var row = data[i];
    var name = String(colVal(row, C.NAME) || '').trim();
    if (!name || name.indexOf(query) === -1 || seen[name]) continue;
    seen[name] = true;
    var ts = colVal(row, C.TIMESTAMP);
    var date = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(date.getTime())) continue;
    var concerns = parseMultiSelect(colVal(row, C.CONCERNS));
    if (concerns.length === 0) concerns = scanForConcerns(row, C);
    customers.push({ index: i, name: name, timestamp: date.toISOString(), concerns: concerns });
  }
  return { customers: customers, total: customers.length, lastUpdated: new Date().toISOString() };
}

// ============================================================
// 診断（全店舗のシート/カラム検出状態をチェック）
// ============================================================

function diagnoseCounselingSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var allSheetNames = ss.getSheets().map(function(s) { return s.getName(); });
  var storeKeys = Object.keys(COUNSELING_STORES);
  var results = {};

  for (var s = 0; s < storeKeys.length; s++) {
    var storeKey = storeKeys[s];
    var expectedName = COUNSELING_STORES[storeKey];
    var info = { expectedSheetName: expectedName, exists: false };

    var sheet = ss.getSheetByName(expectedName);
    if (!sheet) {
      var partialMatch = null;
      for (var a = 0; a < allSheetNames.length; a++) {
        if (allSheetNames[a].indexOf(storeKey === 'honatsugi' ? '本厚木' :
            storeKey === 'yamato' ? '大和' :
            storeKey === 'yokohama' ? '横浜' :
            storeKey === 'machida' ? '町田' : '川口') !== -1) {
          partialMatch = allSheetNames[a];
          break;
        }
      }
      info.exists = false;
      info.error = 'シートが見つかりません';
      info.suggestion = partialMatch
        ? '似た名前のシートがあります: "' + partialMatch + '" → シート名を "' + expectedName + '" に変更してください'
        : 'このスプレッドシートにシートを作成してください';
      info.allSheetNames = allSheetNames;
      results[storeKey] = info;
      continue;
    }

    info.exists = true;
    var lastRow = sheet.getLastRow();
    var numCols = sheet.getLastColumn();
    info.rows = lastRow - 1;
    info.cols = numCols;

    if (lastRow < 1 || numCols < 1) {
      info.error = 'シートが空です';
      results[storeKey] = info;
      continue;
    }

    var headerRow = sheet.getRange(1, 1, 1, numCols).getValues()[0];
    info.headers = headerRow.map(function(h, i) { return { col: i, header: String(h || '').trim() }; });

    var C = detectCounselingColumns(headerRow);
    info.detectedColumns = {};
    var allKeys = Object.keys(COUNSELING_COL_DEFAULT);
    for (var k = 0; k < allKeys.length; k++) {
      var colKey = allKeys[k];
      var colIdx = C[colKey];
      var headerText = (colIdx >= 0 && colIdx < headerRow.length) ? String(headerRow[colIdx] || '').trim() : '(未検出)';
      info.detectedColumns[colKey] = { column: colIdx, header: headerText };
    }

    if (lastRow >= 2) {
      var sampleRows = Math.min(lastRow - 1, 5);
      var data = sheet.getRange(2, 1, sampleRows, numCols).getValues();
      info.sampleData = [];
      for (var r = 0; r < data.length; r++) {
        var row = data[r];
        var sample = {
          name: String(colVal(row, C.NAME) || '').trim(),
          concernsCol: C.CONCERNS,
          rawConcernsValue: C.CONCERNS >= 0 ? String(row[C.CONCERNS] || '').substring(0, 100) : '(列未検出)',
          parsedConcerns: C.CONCERNS >= 0 ? parseMultiSelect(row[C.CONCERNS]) : []
        };
        if (sample.parsedConcerns.length === 0) {
          var scanned = scanForConcerns(row, C);
          if (scanned.length > 0) {
            sample.fallbackScanFound = scanned;
            for (var ci = 0; ci < row.length; ci++) {
              var cv = String(row[ci] || '').trim();
              if (cv && scanned.join(',') === parseMultiSelect(cv).join(',')) {
                sample.fallbackScanColumn = ci;
                sample.fallbackScanHeader = String(headerRow[ci] || '').trim();
                break;
              }
            }
          }
        }
        info.sampleData.push(sample);
      }
    }

    results[storeKey] = info;
  }

  return {
    diagnosis: results,
    allSheetNames: allSheetNames,
    instructions: '各店舗の結果を確認してください。exists=false の場合はシート名を修正。detectedColumns.CONCERNS.column が正しくない場合はヘッダー名を確認してください。'
  };
}

// ============================================================
// 共通ユーティリティ
// ============================================================

function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function parseMultiSelect(val) {
  if (!val) return [];
  var str = String(val).trim();
  if (!str) return [];
  // Google Forms 複数選択: カンマ/セミコロン/読点/改行 で分割
  return str.split(/[,;、\n\r]+/).map(function(s) { return s.trim(); }).filter(function(s) { return s; });
}

function formatDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return val.getFullYear() + '-' + String(val.getMonth() + 1).padStart(2, '0') + '-' + String(val.getDate()).padStart(2, '0');
  }
  return String(val).trim();
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
