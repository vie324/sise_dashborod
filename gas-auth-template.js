// =============================================
// Google Apps Script - si'se Dashboard 統合テンプレート
// =============================================
//
// 【セットアップ手順】
//
// ■ シート1: 「認証」
//   1行目ヘッダー: パスワード | 役割 | 名前 | 店舗IDs
//   例:
//     master123  | master   | オーナー     |
//     overview456| overview | エリアMGR    |
//     manager789 | manager  | 大和店長     | 1,4
//     staff001   | staff    | 田中太郎     | 1
//
// ■ シート2: 「手動会員」
//   1行目ヘッダー: ID | 名前 | 電話番号 | メール | 店舗ID | 店舗名 | プラン名 | 月額 | 支払方法 | ステータス | 開始日 | メモ | 更新日
//   ※ このシートはダッシュボードから自動管理されます
//
// ■ デプロイ手順:
//   1. 拡張機能 → Apps Script → このコードを貼り付け
//   2. デプロイ → 新しいデプロイ → ウェブアプリ
//      - 実行するユーザー: 自分
//      - アクセス: 全員
//   3. URLをVercel環境変数 AUTH_SHEET_URL に設定
//
// =============================================

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action;

    // --- 認証 ---
    if (action === 'verify') return handleVerify(data);

    // --- パスワード管理 ---
    if (action === 'listUsers') return handleListUsers(data);
    if (action === 'addUser') return handleAddUser(data);
    if (action === 'updateUser') return handleUpdateUser(data);
    if (action === 'deleteUser') return handleDeleteUser(data);

    // --- 手動会員管理 ---
    if (action === 'listManualMembers') return handleListManualMembers(data);
    if (action === 'addManualMember') return handleAddManualMember(data);
    if (action === 'updateManualMember') return handleUpdateManualMember(data);
    if (action === 'deleteManualMember') return handleDeleteManualMember(data);

    return res({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return res({ success: false, error: err.message });
  }
}

// =============================================
// 認証
// =============================================

function handleVerify(data) {
  var sheet = getSheet('認証');
  if (!sheet) return res({ success: false, error: 'シート「認証」が見つかりません' });

  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === String(data.password).trim()) {
      var storeIdsRaw = String(rows[i][3]).trim();
      var storeIds = storeIdsRaw ? storeIdsRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
      return res({ success: true, role: String(rows[i][1]).trim(), name: String(rows[i][2]).trim(), storeIds: storeIds });
    }
  }
  return res({ success: false });
}

// =============================================
// パスワード管理 CRUD
// =============================================

function handleListUsers(data) {
  if (!checkMasterAuth(data)) return res({ success: false, error: '権限がありません' });
  var sheet = getSheet('認証');
  if (!sheet) return res({ success: false, users: [] });

  var rows = sheet.getDataRange().getValues();
  var users = [];
  for (var i = 1; i < rows.length; i++) {
    if (!String(rows[i][0]).trim()) continue;
    var storeIdsRaw = String(rows[i][3]).trim();
    users.push({
      rowIndex: i + 1,
      password: String(rows[i][0]).trim(),
      role: String(rows[i][1]).trim(),
      name: String(rows[i][2]).trim(),
      storeIds: storeIdsRaw ? storeIdsRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : []
    });
  }
  return res({ success: true, users: users });
}

function handleAddUser(data) {
  if (!checkMasterAuth(data)) return res({ success: false, error: '権限がありません' });
  var sheet = getSheet('認証');
  if (!sheet) return res({ success: false, error: 'シートが見つかりません' });

  var u = data.user;
  if (!u || !u.password || !u.role || !u.name) {
    return res({ success: false, error: 'パスワード、役割、名前は必須です' });
  }

  // 重複チェック
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === u.password.trim()) {
      return res({ success: false, error: 'このパスワードは既に使用されています' });
    }
  }

  var storeIds = (u.storeIds || []).join(',');
  sheet.appendRow([u.password.trim(), u.role.trim(), u.name.trim(), storeIds]);
  return res({ success: true });
}

function handleUpdateUser(data) {
  if (!checkMasterAuth(data)) return res({ success: false, error: '権限がありません' });
  var sheet = getSheet('認証');
  if (!sheet) return res({ success: false, error: 'シートが見つかりません' });

  var row = data.rowIndex;
  var u = data.user;
  if (!row || !u) return res({ success: false, error: 'rowIndexとuserが必要です' });

  // 重複チェック（自分以外）
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if ((i + 1) !== row && String(rows[i][0]).trim() === u.password.trim()) {
      return res({ success: false, error: 'このパスワードは既に使用されています' });
    }
  }

  var storeIds = (u.storeIds || []).join(',');
  sheet.getRange(row, 1, 1, 4).setValues([[u.password.trim(), u.role.trim(), u.name.trim(), storeIds]]);
  return res({ success: true });
}

function handleDeleteUser(data) {
  if (!checkMasterAuth(data)) return res({ success: false, error: '権限がありません' });
  var sheet = getSheet('認証');
  if (!sheet) return res({ success: false, error: 'シートが見つかりません' });

  var row = data.rowIndex;
  if (!row || row < 2) return res({ success: false, error: '無効な行番号です' });

  sheet.deleteRow(row);
  return res({ success: true });
}

// =============================================
// 手動会員管理 CRUD
// =============================================

function handleListManualMembers(data) {
  var sheet = getOrCreateManualMemberSheet();
  var rows = sheet.getDataRange().getValues();
  var members = [];

  // アクセス制限適用
  var allowedStoreIds = data.allowedStoreIds || null;

  for (var i = 1; i < rows.length; i++) {
    if (!String(rows[i][0]).trim()) continue;
    var storeId = String(rows[i][4]).trim();

    // 店舗制限がある場合、対象外はスキップ
    if (allowedStoreIds && allowedStoreIds.length > 0 && allowedStoreIds.indexOf(storeId) === -1) continue;

    members.push({
      rowIndex: i + 1,
      id: String(rows[i][0]).trim(),
      name: String(rows[i][1]).trim(),
      phone: String(rows[i][2]).trim(),
      email: String(rows[i][3]).trim(),
      storeId: storeId,
      storeName: String(rows[i][5]).trim(),
      planName: String(rows[i][6]).trim(),
      monthlyPrice: Number(rows[i][7]) || 0,
      paymentMethod: String(rows[i][8]).trim(),
      status: String(rows[i][9]).trim(),
      startDate: String(rows[i][10]).trim(),
      memo: String(rows[i][11]).trim(),
      updatedAt: String(rows[i][12]).trim()
    });
  }
  return res({ success: true, members: members });
}

function handleAddManualMember(data) {
  var sheet = getOrCreateManualMemberSheet();
  var m = data.member;
  if (!m || !m.name) return res({ success: false, error: '名前は必須です' });

  var id = 'M' + new Date().getTime().toString(36) + Math.random().toString(36).slice(2, 6);
  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');

  sheet.appendRow([
    id,
    m.name || '',
    m.phone || '',
    m.email || '',
    m.storeId || '',
    m.storeName || '',
    m.planName || 'スタンダードプラン',
    m.monthlyPrice || 0,
    m.paymentMethod || '現金',
    m.status || 'ACTIVE',
    m.startDate || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    m.memo || '',
    now
  ]);
  return res({ success: true, id: id });
}

function handleUpdateManualMember(data) {
  var sheet = getOrCreateManualMemberSheet();
  var row = data.rowIndex;
  var m = data.member;
  if (!row || !m) return res({ success: false, error: 'rowIndexとmemberが必要です' });

  var now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  // IDは変更しない（列1）、列2〜13を更新
  sheet.getRange(row, 2, 1, 12).setValues([[
    m.name || '',
    m.phone || '',
    m.email || '',
    m.storeId || '',
    m.storeName || '',
    m.planName || '',
    m.monthlyPrice || 0,
    m.paymentMethod || '',
    m.status || 'ACTIVE',
    m.startDate || '',
    m.memo || '',
    now
  ]]);
  return res({ success: true });
}

function handleDeleteManualMember(data) {
  var sheet = getOrCreateManualMemberSheet();
  var row = data.rowIndex;
  if (!row || row < 2) return res({ success: false, error: '無効な行番号です' });

  sheet.deleteRow(row);
  return res({ success: true });
}

// =============================================
// ユーティリティ
// =============================================

function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function getOrCreateManualMemberSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('手動会員');
  if (!sheet) {
    sheet = ss.insertSheet('手動会員');
    sheet.appendRow(['ID', '名前', '電話番号', 'メール', '店舗ID', '店舗名', 'プラン名', '月額', '支払方法', 'ステータス', '開始日', 'メモ', '更新日']);
    sheet.setFrozenRows(1);
    // ヘッダー書式
    var headerRange = sheet.getRange(1, 1, 1, 13);
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#f0f0f0');
  }
  return sheet;
}

function checkMasterAuth(data) {
  if (!data.authPassword) return false;
  var sheet = getSheet('認証');
  if (!sheet) return false;

  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === String(data.authPassword).trim()) {
      var role = String(rows[i][1]).trim();
      return role === 'master';
    }
  }
  return false;
}

function res(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// =============================================
// テスト用
// =============================================

function testVerify() {
  var result = doPost({ postData: { contents: JSON.stringify({ action: 'verify', password: 'master123' }) } });
  Logger.log(result.getContent());
}

function testListUsers() {
  var result = doPost({ postData: { contents: JSON.stringify({ action: 'listUsers', authPassword: 'master123' }) } });
  Logger.log(result.getContent());
}

function testListManualMembers() {
  var result = doPost({ postData: { contents: JSON.stringify({ action: 'listManualMembers' }) } });
  Logger.log(result.getContent());
}
