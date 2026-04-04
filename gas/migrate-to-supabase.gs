// ============================================================
// GAS → Supabase データ移行スクリプト
// 使い方:
//   1. このコードを既存のGASプロジェクトに追加
//   2. SUPABASE_API_URL を自分のVercelドメインに変更
//   3. migrateAll() を実行
// ============================================================

const SUPABASE_API_URL = 'https://sise-dashborod.vercel.app/api/db';

// ============================================================
// メイン: 全テーブル移行
// ============================================================
function migrateAll() {
  Logger.log('=== 移行開始 ===');

  migrateStores();
  migrateStaff();
  migrateDashConfig();
  migrateMenuItems();
  migrateHpb();
  migrateCashbook();
  migrateDailyCloses();
  migrateUsage();
  migrateTickets();
  migrateMembers();
  migrateReports();
  migrateLineMessages();
  migrateLineProfiles();
  migrateLineBroadcasts();
  migrateLineTemplates();
  migrateLineAutoReplies();
  migrateLineTags();
  migrateLineUserTags();
  migrateAttendance();
  migrateQrTokens();

  Logger.log('=== 移行完了 ===');
}

// ============================================================
// ヘルパー
// ============================================================

function postToSupabase(table, body) {
  const url = SUPABASE_API_URL + '?table=' + table;
  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  };
  const res = UrlFetchApp.fetch(url, options);
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code >= 400) {
    Logger.log('ERROR [' + table + '] HTTP ' + code + ': ' + text);
    return null;
  }
  return JSON.parse(text);
}

function getSheetData(sheetName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    Logger.log('SKIP: シート "' + sheetName + '" が見つかりません');
    return null;
  }
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('SKIP: シート "' + sheetName + '" にデータなし');
    return null;
  }
  return sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
}

function fmt(val) {
  if (val instanceof Date) return val.toISOString();
  return String(val || '');
}

function toInt(val) {
  const n = parseInt(val);
  return isNaN(n) ? 0 : n;
}

function toFloat(val) {
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

// ============================================================
// 個別テーブル移行
// ============================================================

function migrateStores() {
  const rows = getSheetData('店舗管理');
  if (!rows) return;
  const stores = rows.filter(r => r[0]).map(r => ({
    id: fmt(r[0]), name: fmt(r[1]), status: fmt(r[2]) || 'active',
    createdAt: fmt(r[3]), memo: fmt(r[4]),
    lat: toFloat(r[5]), lng: toFloat(r[6])
  }));
  const result = postToSupabase('stores', { action: 'saveStores', stores });
  Logger.log('stores: ' + (result ? result.count : 0) + '件');
}

function migrateStaff() {
  const rows = getSheetData('スタッフ管理');
  if (!rows) return;
  const staff = rows.filter(r => r[0]).map(r => ({
    id: fmt(r[0]), name: fmt(r[1]), role: fmt(r[2]) || 'staff',
    password: fmt(r[3]),
    storeIds: fmt(r[4]).split(',').map(s => s.trim()).filter(s => s),
    createdAt: fmt(r[5]), status: fmt(r[6]) || 'active'
  }));
  const result = postToSupabase('staff', { action: 'saveStaff', staff });
  Logger.log('staff: ' + (result ? result.count : 0) + '件');
}

function migrateDashConfig() {
  const rows = getSheetData('ダッシュボード設定');
  if (!rows) return;
  const entries = {};
  for (const r of rows) {
    if (!r[0]) continue;
    try {
      entries[fmt(r[0])] = JSON.parse(r[1]);
    } catch (e) {
      entries[fmt(r[0])] = fmt(r[1]);
    }
  }
  const result = postToSupabase('dashConfig', { action: 'setBulk', entries });
  Logger.log('dashConfig: ' + (result ? result.count : 0) + '件');
}

function migrateMenuItems() {
  const rows = getSheetData('メニュー');
  if (!rows) return;
  const menuItems = rows.filter(r => r[0]).map(r => ({
    id: fmt(r[0]), name: fmt(r[1]), category: fmt(r[2]),
    price: toInt(r[3]), itemType: fmt(r[4]) || 'menu',
    active: String(r[5]).toLowerCase() !== 'false',
    createdAt: fmt(r[6])
  }));
  const result = postToSupabase('menuItems', { action: 'saveAll', menuItems });
  Logger.log('menuItems: ' + (result ? result.count : 0) + '件');
}

function migrateHpb() {
  const rows = getSheetData('HPBデータ');
  if (!rows) return;
  const monthly = rows.filter(r => r[0]).map(r => ({
    yearMonth: fmt(r[0]), views: toInt(r[1]), bookings: toInt(r[2]),
    cost: toInt(r[3]), clicks: toInt(r[4]),
    cvr: toFloat(r[5]) || 0, memo: fmt(r[6])
  }));
  const result = postToSupabase('hpb', { action: 'saveAll', monthly });
  Logger.log('hpb: ' + (monthly.length) + '件');
}

function migrateCashbook() {
  const rows = getSheetData('出納帳');
  if (!rows) return;
  // ヘッダー: ID,日付,種別,カテゴリ,摘要,金額,顧客名,施術回数,支払方法,現金区分,会員ID,店舗ID,記帳者,備考,作成日時,更新日時,更新者,削除フラグ
  const entries = rows.filter(r => r[0]).map(r => ({
    id: fmt(r[0]), date: fmt(r[1]).slice(0, 10),
    type: fmt(r[2]), category: fmt(r[3]), description: fmt(r[4]),
    amount: toInt(r[5]), customerName: fmt(r[6]), therapyCount: toInt(r[7]),
    paymentMethod: fmt(r[8]) || 'CASH', cashType: fmt(r[9]) || 'register',
    memberId: fmt(r[10]), store: fmt(r[11]),
    recorder: fmt(r[12]), notes: fmt(r[13]),
    createdAt: fmt(r[14]), updatedAt: fmt(r[15]),
    updatedBy: fmt(r[16]), deleted: fmt(r[17]) === 'true'
  }));
  const result = postToSupabase('cashbook', { action: 'saveCashbook', entries, operator: 'migration' });
  Logger.log('cashbook: ' + entries.length + '件');
}

function migrateDailyCloses() {
  const rows = getSheetData('日次締め');
  if (!rows) return;
  for (const r of rows) {
    if (!r[0]) continue;
    postToSupabase('cashbook', {
      action: 'dailyClose',
      date: fmt(r[0]).slice(0, 10), storeId: fmt(r[1]),
      safeBalance: toInt(r[2]), pettyCashBalance: toInt(r[3]),
      registerBalance: toInt(r[4]), closedBy: fmt(r[5]),
      notes: fmt(r[7])
    });
  }
  Logger.log('dailyCloses: ' + rows.length + '件');
}

function migrateUsage() {
  const rows = getSheetData('利用回数');
  if (!rows) return;
  const data = rows.filter(r => r[0]).map(r => ({
    memberId: fmt(r[0]), memberName: fmt(r[1]),
    storeName: fmt(r[2]), planName: fmt(r[3]),
    month: fmt(r[4]), periodKey: fmt(r[5]),
    count: toInt(r[6]), updatedAt: fmt(r[7])
  }));
  const result = postToSupabase('usage', { data });
  Logger.log('usage: ' + (result ? result.updated : 0) + '件');
}

function migrateTickets() {
  // 回数券プラン
  const planRows = getSheetData('回数券プラン');
  const plans = planRows ? planRows.filter(r => r[0]).map(r => ({
    id: fmt(r[0]), name: fmt(r[1]), sessions: toInt(r[2]),
    price: toInt(r[3]), validityDays: toInt(r[4]),
    active: String(r[5]).toLowerCase() !== 'false'
  })) : [];

  // 回数券データ (JSON)
  const ticketRows = getSheetData('回数券データ');
  const tickets = [];
  if (ticketRows) {
    for (const r of ticketRows) {
      if (!r[0]) continue;
      try { tickets.push(JSON.parse(r[0])); } catch (e) {}
    }
  }

  const result = postToSupabase('ticket', { plans, tickets });
  Logger.log('tickets: plans=' + plans.length + ', data=' + tickets.length);
}

function migrateMembers() {
  const rows = getSheetData('QR現金会員');
  if (!rows) return;
  const members = [];
  for (const r of rows) {
    if (!r[0]) continue;
    try { members.push(JSON.parse(r[0])); } catch (e) {}
  }
  const result = postToSupabase('members', { members });
  Logger.log('members: ' + (result ? result.count : 0) + '件');
}

function migrateReports() {
  const rows = getSheetData('日報');
  if (!rows) return;
  let count = 0;
  for (const r of rows) {
    if (!r[0]) continue;
    const result = postToSupabase('reports', {
      action: 'create',
      report: {
        timestamp: fmt(r[0]), store: fmt(r[1]).trim(),
        hpbNew: toInt(r[2]), metaNew: toInt(r[3]),
        referralNew: toInt(r[4]), discountNew: toInt(r[5]),
        hpbContract: toInt(r[6]), metaContract: toInt(r[7]),
        referralContract: toInt(r[8]), discountContract: toInt(r[9]),
        existingTreatments: toInt(r[10]),
        taskComplete: fmt(r[11]) === '完了しました',
        prepComplete: fmt(r[12]) === '完了しました'
      }
    });
    if (result && result.success) count++;
  }
  Logger.log('reports: ' + count + '件');
}

function migrateLineMessages() {
  const rows = getSheetData('LINEメッセージ');
  if (!rows) return;
  // バッチ処理 (100件ずつ)
  const batchSize = 100;
  let count = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const events = batch.filter(r => r[2]).map(r => ({
      type: 'message', timestamp: new Date(r[0]).getTime(),
      userId: fmt(r[2]),
      messageType: fmt(r[4]) || 'text',
      messageText: fmt(r[5]), messageId: fmt(r[6])
    }));
    // direction を考慮: 受信のみeventsとして送る
    const storeId = fmt(batch[0][1]);
    postToSupabase('lineMessages', { storeId, events });
    count += events.length;
  }
  Logger.log('lineMessages: ' + count + '件');
}

function migrateLineProfiles() {
  const rows = getSheetData('LINEプロフィール');
  if (!rows) return;
  let count = 0;
  for (const r of rows) {
    if (!r[0]) continue;
    postToSupabase('lineProfiles', {
      userId: fmt(r[0]), storeId: fmt(r[1]),
      displayName: fmt(r[2]), pictureUrl: fmt(r[3])
    });
    count++;
  }
  Logger.log('lineProfiles: ' + count + '件');
}

function migrateLineBroadcasts() {
  const rows = getSheetData('LINE一斉配信');
  if (!rows) return;
  let count = 0;
  for (const r of rows) {
    if (!r[0]) continue;
    postToSupabase('lineBroadcasts', {
      timestamp: fmt(r[0]), storeId: fmt(r[1]),
      broadcastType: fmt(r[2]), messageContent: fmt(r[3]),
      recipientCount: toInt(r[4]), status: fmt(r[5])
    });
    count++;
  }
  Logger.log('lineBroadcasts: ' + count + '件');
}

function migrateLineTemplates() {
  const rows = getSheetData('LINEテンプレート');
  if (!rows) return;
  let count = 0;
  for (const r of rows) {
    if (!r[0]) continue;
    postToSupabase('lineTemplates', {
      action: 'create', storeId: fmt(r[1]),
      name: fmt(r[2]), category: fmt(r[3]),
      messageType: fmt(r[4]), messageContent: fmt(r[5])
    });
    count++;
  }
  Logger.log('lineTemplates: ' + count + '件');
}

function migrateLineAutoReplies() {
  const rows = getSheetData('LINE自動応答');
  if (!rows) return;
  let count = 0;
  for (const r of rows) {
    if (!r[0]) continue;
    postToSupabase('lineAutoReplies', {
      action: 'create', storeId: fmt(r[1]),
      keyword: fmt(r[2]), matchMethod: fmt(r[3]) || 'contains',
      replyType: fmt(r[4]) || 'text', replyContent: fmt(r[5]),
      priority: toInt(r[6]), enabled: String(r[7]).toLowerCase() !== 'false'
    });
    count++;
  }
  Logger.log('lineAutoReplies: ' + count + '件');
}

function migrateLineTags() {
  const rows = getSheetData('LINEタグ');
  if (!rows) return;
  let count = 0;
  for (const r of rows) {
    if (!r[0]) continue;
    postToSupabase('lineTags', {
      action: 'create', storeId: fmt(r[1]),
      name: fmt(r[2]), color: fmt(r[3]) || '#06C755'
    });
    count++;
  }
  Logger.log('lineTags: ' + count + '件');
}

function migrateLineUserTags() {
  const rows = getSheetData('LINEユーザータグ');
  if (!rows) return;
  let count = 0;
  for (const r of rows) {
    if (!r[0]) continue;
    postToSupabase('lineUserTags', {
      action: 'add', storeId: fmt(r[0]),
      userId: fmt(r[1]), tagId: fmt(r[2])
    });
    count++;
  }
  Logger.log('lineUserTags: ' + count + '件');
}

function migrateAttendance() {
  const rows = getSheetData('勤怠');
  if (!rows) return;
  let count = 0;
  for (const r of rows) {
    if (!r[0]) continue;
    // 直接INSERTのためclockIn actionを使わず、saveAll的に処理
    postToSupabase('attendance', {
      action: 'clockIn',
      staffId: fmt(r[1]), staffName: fmt(r[2]),
      storeId: fmt(r[3]),
      lat: toFloat(r[8]), lng: toFloat(r[9]),
      method: fmt(r[10]), notes: fmt(r[11])
    });
    count++;
  }
  Logger.log('attendance: ' + count + '件');
}

function migrateQrTokens() {
  // QRトークンは一時的なものなので移行不要
  Logger.log('qrTokens: SKIP (一時データのため移行不要)');
}
