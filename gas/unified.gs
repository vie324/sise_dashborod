/**
 * si'se 統合データ管理 GAS (Google Apps Script)
 *
 * 1つのスプレッドシートで全データを一元管理します。
 *
 * 【セットアップ手順】
 * 1. Google スプレッドシートを作成し、以下のシートを用意する
 *    ─ 日報（Googleフォーム回答シート）
 *    ─ カウンセリング回答_本厚木店（Googleフォーム回答シート）
 *    ─ カウンセリング回答_大和店
 *    ─ カウンセリング回答_横浜店
 *    ─ カウンセリング回答_町田店
 *    ─ カウンセリング回答_川口店
 *    ─ 利用回数      （GASが自動で読み書き）
 *    ─ 回数券プラン    （GASが自動で読み書き）
 *    ─ 回数券データ    （GASが自動で読み書き）
 *    ─ QR現金会員     （GASが自動で読み書き）
 *    ─ 出納帳        （GASが自動で読み書き）
 *    ─ スタッフ管理    （GASが自動で作成・読み書き）
 *    ─ 店舗管理       （GASが自動で作成・読み書き）
 *    ─ ダッシュボード設定 （GASが自動で作成・読み書き）
 *    ─ HPBデータ      （GASが自動で作成・読み書き）
 *
 * 2. 拡張機能 → Apps Script を開く
 * 3. このコードを貼り付ける
 * 4. デプロイ → 新しいデプロイ → ウェブアプリ
 *    - 実行するユーザー: 自分
 *    - アクセスできるユーザー: 全員
 * 5. 生成されたURLをダッシュボードの設定画面に貼り付ける（1つだけ！）
 *
 * 【APIリファレンス】
 * GET ?type=report&months=2          → 日報データ（直近2ヶ月）
 * GET ?type=counseling&store=honatsugi&action=recent&limit=50 → カウンセリング
 * GET ?type=usage&month=2026-03      → 利用回数データ
 * GET ?type=ticket                   → 回数券データ
 * GET ?type=members                  → QR現金会員データ
 * GET ?type=cashbook                 → 出納帳データ
 * GET ?type=stores                   → 店舗一覧
 * GET ?type=staff                    → スタッフ一覧（&includeInactive=true で無効含む）
 * GET ?type=storeManage              → 店舗一覧（&includeInactive=true で無効含む）
 *
 * POST { type:"usage", action:"saveUsage", data:[...] }
 * POST { type:"staff", action:"saveStaff", staff:[...] }
 * POST { type:"staff", action:"updateStaff", staffId:"xxx", updates:{name,role,password,storeIds} }
 * POST { type:"staff", action:"deleteStaff", staffId:"xxx" }  → ソフトデリート
 * POST { type:"staff", action:"restoreStaff", staffId:"xxx" } → 復元
 * POST { type:"storeManage", action:"addStore", store:{id,name} }
 * POST { type:"storeManage", action:"deleteStore", storeId:"xxx" } → ソフトデリート
 * POST { type:"storeManage", action:"restoreStore", storeId:"xxx" } → 復元
 * GET ?type=dashConfig                → 全設定取得
 * GET ?type=dashConfig&key=planLimits → 個別キー取得
 * POST { type:"dashConfig", action:"set", key:"planLimits", value:{...} }
 * POST { type:"dashConfig", action:"setBulk", entries:{key1:val1, key2:val2} }
 * GET ?type=hpb                       → HPB月次データ取得
 * POST { type:"hpb", action:"upsert", entry:{yearMonth,views,...} }
 * POST { type:"hpb", action:"delete", yearMonth:"2026-03" }
 * POST { type:"ticket", action:"saveTickets", plans:[...], tickets:[...] }
 * POST { type:"members", action:"saveManualMembers", members:[...] }
 * POST { type:"cashbook", action:"saveCashbook", entries:[...] }
 */

// ============================================================
// シート名定義
// ============================================================

const SHEETS = {
  REPORT: '日報',
  USAGE: '利用回数',
  TICKET_PLANS: '回数券プラン',
  TICKET_DATA: '回数券データ',
  MEMBERS: 'QR現金会員',
  CASHBOOK: '出納帳',
  STAFF: 'スタッフ管理',
  STORES: '店舗管理',
  DASH_CONFIG: 'ダッシュボード設定',
  HPB: 'HPBデータ'
};

const COUNSELING_STORES = {
  honatsugi: 'カウンセリング回答_本厚木店',
  yamato:    'カウンセリング回答_大和店',
  yokohama:  'カウンセリング回答_横浜店',
  machida:   'カウンセリング回答_町田店',
  kawaguchi: 'カウンセリング回答_川口店'
};

// ============================================================
// 列定義
// ============================================================

// 日報
const REPORT_COL = {
  TIMESTAMP: 0, STORE: 1, HPB_NEW: 2, META_NEW: 3,
  REFERRAL_NEW: 4, DISCOUNT_NEW: 5, HPB_CONTRACT: 6, META_CONTRACT: 7,
  REFERRAL_CONTRACT: 8, DISCOUNT_CONTRACT: 9, EXISTING_TREATMENTS: 10,
  TASK_COMPLETE: 11, PREP_COMPLETE: 12
};

// カウンセリング
const COUNSELING_COL = {
  TIMESTAMP: 0, NAME: 1, BIRTHDAY: 2, PHONE: 3, EMAIL: 4,
  OCCUPATION: 5, ADDRESS: 6, VISIT_PURPOSE: 7, CONCERNS: 8,
  IMPROVEMENT_TIMELINE: 9, TREATMENT_REQUEST: 10, TREATMENT_EXPERIENCE: 11,
  SURGERY_HISTORY: 12, CURRENT_TREATMENT: 13, ALLERGY: 14,
  COSMETIC_SURGERY: 15, PREGNANCY_CHECK: 16, DISCLAIMER: 17
};

// ============================================================
// ルーター
// ============================================================

function doGet(e) {
  try {
    const params = e ? (e.parameter || {}) : {};
    const type = params.type || 'report';

    switch (type) {
      case 'report':     return jsonResponse(handleReportGet(params));
      case 'counseling': return jsonResponse(handleCounselingGet(params));
      case 'usage':      return jsonResponse(handleUsageGet(params));
      case 'ticket':     return jsonResponse(handleTicketGet(params));
      case 'members':    return jsonResponse(handleMembersGet(params));
      case 'cashbook':   return jsonResponse(handleCashbookGet(params));
      case 'stores':     return jsonResponse(handleStoresGet());
      case 'staff':       return jsonResponse(handleStaffGet(params));
      case 'storeManage': return jsonResponse(handleStoreManageGet(params));
      case 'dashConfig':  return jsonResponse(handleDashConfigGet(params));
      case 'hpb':         return jsonResponse(handleHpbGet(params));
      default:            return jsonResponse({ error: '不明なtype: ' + type }, 400);
    }
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const type = body.type || '';

    switch (type) {
      case 'usage':    return jsonResponse(handleUsagePost(body));
      case 'ticket':   return jsonResponse(handleTicketPost(body));
      case 'members':  return jsonResponse(handleMembersPost(body));
      case 'cashbook':    return jsonResponse(handleCashbookPost(body));
      case 'staff':       return jsonResponse(handleStaffPost(body));
      case 'storeManage': return jsonResponse(handleStoreManagePost(body));
      case 'dashConfig':  return jsonResponse(handleDashConfigPost(body));
      case 'hpb':         return jsonResponse(handleHpbPost(body));
      default:         return jsonResponse({ error: '不明なtype: ' + type }, 400);
    }
  } catch (error) {
    return jsonResponse({ error: error.message }, 500);
  }
}

// ============================================================
// 店舗一覧
// ============================================================

function handleStoresGet() {
  return {
    stores: Object.keys(COUNSELING_STORES).map(key => ({
      id: key,
      name: COUNSELING_STORES[key].replace('カウンセリング回答_', '')
    }))
  };
}

// ============================================================
// 日報（読み取り専用 - Googleフォーム入力）
// ============================================================

function handleReportGet(params) {
  const sheet = getSheet(SHEETS.REPORT);
  if (!sheet) return { error: 'シート "' + SHEETS.REPORT + '" が見つかりません' };

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { reports: [], total: 0 };

  const data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();

  // フィルタ範囲の決定
  let startDate = null, endDate = null;
  if (params.all === 'true') {
    // 全データ
  } else if (params.month) {
    const [y, m] = params.month.split('-').map(Number);
    startDate = new Date(y, m - 1, 1);
    endDate = new Date(y, m, 0, 23, 59, 59);
  } else if (params.months) {
    const n = parseInt(params.months) || 1;
    const now = new Date();
    startDate = new Date(now.getFullYear(), now.getMonth() - (n - 1), 1);
  } else {
    const now = new Date();
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  const C = REPORT_COL;
  const reports = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const ts = row[C.TIMESTAMP];
    if (!ts) continue;
    const date = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(date.getTime())) continue;
    if (startDate && date < startDate) continue;
    if (endDate && date > endDate) continue;

    reports.push({
      timestamp: date.toISOString(),
      store: String(row[C.STORE] || '').trim(),
      hpbNew: toInt(row[C.HPB_NEW]),
      metaNew: toInt(row[C.META_NEW]),
      referralNew: toInt(row[C.REFERRAL_NEW]),
      discountNew: toInt(row[C.DISCOUNT_NEW]),
      hpbContract: toInt(row[C.HPB_CONTRACT]),
      metaContract: toInt(row[C.META_CONTRACT]),
      referralContract: toInt(row[C.REFERRAL_CONTRACT]),
      discountContract: toInt(row[C.DISCOUNT_CONTRACT]),
      existingTreatments: toInt(row[C.EXISTING_TREATMENTS]),
      taskComplete: String(row[C.TASK_COMPLETE] || '') === '完了しました',
      prepComplete: String(row[C.PREP_COMPLETE] || '') === '完了しました'
    });
  }

  reports.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return { reports, total: reports.length, lastUpdated: new Date().toISOString() };
}

// ============================================================
// カウンセリング（読み取り専用 - Googleフォーム入力）
// ============================================================

function handleCounselingGet(params) {
  const action = params.action || 'list';

  // 店舗一覧
  if (action === 'stores') return handleStoresGet();

  const storeKey = params.store || '';
  if (!storeKey || !COUNSELING_STORES[storeKey]) {
    return { error: '店舗を指定してください（store=' + Object.keys(COUNSELING_STORES).join('|') + '）' };
  }

  const sheetName = COUNSELING_STORES[storeKey];
  const sheet = getSheet(sheetName);
  if (!sheet) return { error: 'シート "' + sheetName + '" が見つかりません' };

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { customers: [], total: 0, store: storeKey };

  const numCols = sheet.getLastColumn();
  const data = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
  const C = COUNSELING_COL;

  switch (action) {
    case 'list':
      return { ...counselingList(data, C), store: storeKey };
    case 'recent':
      var limit = parseInt(params.limit) || 20;
      var result = counselingList(data, C);
      result.customers = result.customers.slice(0, limit);
      result.total = result.customers.length;
      return { ...result, store: storeKey };
    case 'detail':
      return { ...counselingDetail(data, C, params.name, params.index), store: storeKey };
    case 'search':
      return { ...counselingSearch(data, C, params.q || ''), store: storeKey };
    default:
      return { error: '不明なアクション: ' + action };
  }
}

function counselingList(data, C) {
  const customers = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const ts = row[C.TIMESTAMP];
    if (!ts) continue;
    const date = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(date.getTime())) continue;
    const name = String(row[C.NAME] || '').trim();
    if (!name) continue;
    customers.push({ index: i, name, timestamp: date.toISOString(), concerns: parseMultiSelect(row[C.CONCERNS]) });
  }
  customers.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  return { customers, total: customers.length, lastUpdated: new Date().toISOString() };
}

function counselingDetail(data, C, name, index) {
  let row = null, rowIndex = -1;
  if (index !== undefined && index !== '') {
    const idx = parseInt(index);
    if (idx >= 0 && idx < data.length) { row = data[idx]; rowIndex = idx; }
  } else if (name) {
    for (let i = data.length - 1; i >= 0; i--) {
      if (String(data[i][C.NAME] || '').trim() === name) { row = data[i]; rowIndex = i; break; }
    }
  }
  if (!row) return { error: '顧客が見つかりません', customer: null };
  const ts = row[C.TIMESTAMP];
  const date = ts instanceof Date ? ts : new Date(ts);
  return {
    customer: {
      index: rowIndex,
      name: String(row[C.NAME] || '').trim(),
      timestamp: date.toISOString(),
      birthday: formatDate(row[C.BIRTHDAY]),
      phone: String(row[C.PHONE] || '').trim(),
      email: String(row[C.EMAIL] || '').trim(),
      occupation: String(row[C.OCCUPATION] || '').trim(),
      address: String(row[C.ADDRESS] || '').trim(),
      visitPurpose: parseMultiSelect(row[C.VISIT_PURPOSE]),
      concerns: parseMultiSelect(row[C.CONCERNS]),
      improvementTimeline: String(row[C.IMPROVEMENT_TIMELINE] || '').trim(),
      treatmentRequest: String(row[C.TREATMENT_REQUEST] || '').trim(),
      treatmentExperience: parseMultiSelect(row[C.TREATMENT_EXPERIENCE]),
      surgeryHistory: String(row[C.SURGERY_HISTORY] || '').trim(),
      currentTreatment: String(row[C.CURRENT_TREATMENT] || '').trim(),
      allergy: String(row[C.ALLERGY] || '').trim(),
      cosmeticSurgery: String(row[C.COSMETIC_SURGERY] || '').trim(),
      pregnancyCheck: String(row[C.PREGNANCY_CHECK] || '').trim()
    }
  };
}

function counselingSearch(data, C, query) {
  if (!query) return { customers: [], total: 0 };
  const customers = [], seen = {};
  for (let i = data.length - 1; i >= 0; i--) {
    const row = data[i];
    const name = String(row[C.NAME] || '').trim();
    if (!name || !name.includes(query) || seen[name]) continue;
    seen[name] = true;
    const ts = row[C.TIMESTAMP];
    const date = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(date.getTime())) continue;
    customers.push({ index: i, name, timestamp: date.toISOString(), concerns: parseMultiSelect(row[C.CONCERNS]) });
  }
  return { customers, total: customers.length, lastUpdated: new Date().toISOString() };
}

// ============================================================
// 利用回数（読み書き）
// ============================================================

function handleUsageGet(params) {
  const sheet = getOrCreateSheet(SHEETS.USAGE, ['会員ID', '会員名', '店舗', 'プラン', '月', '期間キー', '回数', '更新日時']);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { usage: {} };

  const data = sheet.getRange(2, 1, lastRow - 1, 8).getValues();
  const month = params.month || new Date().toISOString().slice(0, 7);
  const usage = {};

  for (let i = 0; i < data.length; i++) {
    if (String(data[i][4]) !== month) continue;
    const memberId = String(data[i][0]);
    const periodKey = String(data[i][5] || '');
    const key = periodKey ? memberId + '__' + periodKey : memberId;
    usage[key] = toInt(data[i][6]);
  }

  return { usage, month, lastUpdated: new Date().toISOString() };
}

function handleUsagePost(body) {
  const sheet = getOrCreateSheet(SHEETS.USAGE, ['会員ID', '会員名', '店舗', 'プラン', '月', '期間キー', '回数', '更新日時']);
  const items = body.data || [];
  if (!items.length) return { success: true, updated: 0 };

  const lastRow = sheet.getLastRow();
  const existing = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 8).getValues() : [];

  let updated = 0;
  items.forEach(item => {
    const memberId = String(item.memberId || '');
    const month = String(item.month || '');
    const periodKey = String(item.periodKey || '');
    if (!memberId || !month) return;

    // 既存行を検索
    let found = false;
    for (let i = 0; i < existing.length; i++) {
      if (String(existing[i][0]) === memberId && String(existing[i][4]) === month && String(existing[i][5] || '') === periodKey) {
        sheet.getRange(i + 2, 7).setValue(item.count);
        sheet.getRange(i + 2, 8).setValue(item.updatedAt || new Date().toISOString());
        found = true;
        break;
      }
    }
    if (!found) {
      sheet.appendRow([memberId, item.memberName || '', item.storeName || '', item.planName || '', month, periodKey, item.count, item.updatedAt || new Date().toISOString()]);
      existing.push([memberId, item.memberName || '', item.storeName || '', item.planName || '', month, periodKey, item.count, '']);
    }
    updated++;
  });

  return { success: true, updated };
}

// ============================================================
// 回数券（読み書き）
// ============================================================

function handleTicketGet(params) {
  const planSheet = getOrCreateSheet(SHEETS.TICKET_PLANS, ['ID', 'プラン名', '回数', '金額', '有効日数', '有効']);
  const dataSheet = getOrCreateSheet(SHEETS.TICKET_DATA, ['JSON']);

  // プラン
  const plans = [];
  const planLastRow = planSheet.getLastRow();
  if (planLastRow >= 2) {
    const planData = planSheet.getRange(2, 1, planLastRow - 1, 6).getValues();
    planData.forEach(row => {
      if (!row[0]) return;
      plans.push({ id: String(row[0]), name: String(row[1]), sessions: toInt(row[2]), price: toInt(row[3]), validityDays: toInt(row[4]), active: row[5] !== false && row[5] !== 'FALSE' });
    });
  }

  // 回数券データ（JSON形式で保存）
  let tickets = [];
  const dataLastRow = dataSheet.getLastRow();
  if (dataLastRow >= 2) {
    const raw = dataSheet.getRange(2, 1, dataLastRow - 1, 1).getValues();
    raw.forEach(row => {
      try { if (row[0]) tickets.push(JSON.parse(row[0])); } catch(e) {}
    });
  }

  return { plans, tickets, lastUpdated: new Date().toISOString() };
}

function handleTicketPost(body) {
  // プラン保存
  if (body.plans) {
    const planSheet = getOrCreateSheet(SHEETS.TICKET_PLANS, ['ID', 'プラン名', '回数', '金額', '有効日数', '有効']);
    planSheet.getRange(2, 1, Math.max(planSheet.getLastRow(), 2), 6).clearContent();
    body.plans.forEach(p => {
      planSheet.appendRow([p.id, p.name, p.sessions, p.price, p.validityDays, p.active !== false]);
    });
  }

  // 回数券データ保存
  if (body.tickets) {
    const dataSheet = getOrCreateSheet(SHEETS.TICKET_DATA, ['JSON']);
    const lastRow = dataSheet.getLastRow();
    if (lastRow >= 2) dataSheet.getRange(2, 1, lastRow - 1, 1).clearContent();
    body.tickets.forEach(t => {
      dataSheet.appendRow([JSON.stringify(t)]);
    });
  }

  return { success: true };
}

// ============================================================
// QR・現金会員（読み書き）
// ============================================================

function handleMembersGet(params) {
  const sheet = getOrCreateSheet(SHEETS.MEMBERS, ['JSON']);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { members: [] };

  const data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const members = [];
  data.forEach(row => {
    try { if (row[0]) members.push(JSON.parse(row[0])); } catch(e) {}
  });

  return { members, lastUpdated: new Date().toISOString() };
}

function handleMembersPost(body) {
  const sheet = getOrCreateSheet(SHEETS.MEMBERS, ['JSON']);
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) sheet.getRange(2, 1, lastRow - 1, 1).clearContent();

  (body.members || []).forEach(m => {
    sheet.appendRow([JSON.stringify(m)]);
  });

  return { success: true };
}

// ============================================================
// 出納帳（読み書き）
// ============================================================

function handleCashbookGet(params) {
  const sheet = getOrCreateSheet(SHEETS.CASHBOOK, ['JSON']);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { entries: [] };

  const data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  const entries = [];
  data.forEach(row => {
    try { if (row[0]) entries.push(JSON.parse(row[0])); } catch(e) {}
  });

  return { entries, lastUpdated: new Date().toISOString() };
}

function handleCashbookPost(body) {
  const sheet = getOrCreateSheet(SHEETS.CASHBOOK, ['JSON']);
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) sheet.getRange(2, 1, lastRow - 1, 1).clearContent();

  (body.entries || []).forEach(entry => {
    sheet.appendRow([JSON.stringify(entry)]);
  });

  return { success: true };
}

// ============================================================
// ユーティリティ
// ============================================================

function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }
  }
  return sheet;
}

function parseMultiSelect(val) {
  if (!val) return [];
  const str = String(val).trim();
  if (!str) return [];
  return str.split(/[,;、]\s*/).map(s => s.trim()).filter(s => s);
}

function formatDate(val) {
  if (!val) return '';
  if (val instanceof Date) {
    return val.getFullYear() + '-' + String(val.getMonth() + 1).padStart(2, '0') + '-' + String(val.getDate()).padStart(2, '0');
  }
  return String(val).trim();
}

function toInt(val) {
  const n = parseInt(val, 10);
  return isNaN(n) ? 0 : n;
}

// ============================================================
// スタッフ管理
// ============================================================
// シート列: A=ID, B=名前, C=役割, D=パスワード, E=店舗IDs, F=作成日, G=ステータス(active/inactive)

function ensureStaffSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEETS.STAFF);
  if (!sheet) {
    sheet = ss.insertSheet(SHEETS.STAFF);
    sheet.appendRow(['ID', '名前', '役割', 'パスワード', '店舗IDs', '作成日', 'ステータス']);
    sheet.setFrozenRows(1);
    sheet.getRange('A1:G1').setFontWeight('bold');
  } else {
    // 既存シートにG列が無い場合はヘッダー追加
    var header = sheet.getRange(1, 7).getValue();
    if (!header) sheet.getRange(1, 7).setValue('ステータス');
  }
  return sheet;
}

function handleStaffGet(params) {
  var includeInactive = params.includeInactive === 'true' || params.includeInactive === '1';
  var sheet = ensureStaffSheet();
  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { staff: [] };

  var staff = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0]) continue;
    var status = String(r[6] || 'active');
    if (!includeInactive && status === 'inactive') continue;
    staff.push({
      id: String(r[0]),
      name: String(r[1] || ''),
      role: String(r[2] || 'staff'),
      password: String(r[3] || ''),
      storeIds: splitList(r[4]),
      createdAt: formatDate(r[5]),
      status: status
    });
  }
  return { staff: staff };
}

function handleStaffPost(body) {
  var action = body.action || '';
  switch (action) {
    case 'saveStaff':    return saveStaffList(body.staff || []);
    case 'updateStaff':  return updateSingleStaff(body.staffId, body.updates || {});
    case 'deleteStaff':  return softDeleteStaff(body.staffId);
    case 'restoreStaff': return restoreStaff(body.staffId);
    default: return { error: '不明なstaff action: ' + action };
  }
}

function saveStaffList(staffArr) {
  var sheet = ensureStaffSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 7).clearContent();
  }
  var rows = staffArr.map(function(s) {
    return [
      s.id || '',
      s.name || '',
      s.role || 'staff',
      s.password || '',
      (s.storeIds || []).join(','),
      s.createdAt || new Date(),
      s.status || 'active'
    ];
  });
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 7).setValues(rows);
  }
  return { success: true, count: rows.length };
}

function updateSingleStaff(staffId, updates) {
  if (!staffId) return { error: 'staffIdが必要です' };
  var sheet = ensureStaffSheet();
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(staffId)) {
      // B=名前, C=役割, D=パスワード, E=店舗IDs
      if (updates.name !== undefined)     sheet.getRange(i + 1, 2).setValue(updates.name);
      if (updates.role !== undefined)     sheet.getRange(i + 1, 3).setValue(updates.role);
      if (updates.password !== undefined) sheet.getRange(i + 1, 4).setValue(updates.password);
      if (updates.storeIds !== undefined) sheet.getRange(i + 1, 5).setValue((updates.storeIds || []).join(','));
      return { success: true, staffId: staffId };
    }
  }
  return { error: 'スタッフが見つかりません: ' + staffId };
}

function softDeleteStaff(staffId) {
  if (!staffId) return { error: 'staffIdが必要です' };
  var sheet = ensureStaffSheet();
  var rows = sheet.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === String(staffId)) {
      sheet.getRange(i + 1, 7).setValue('inactive');
      return { success: true, staffId: staffId, status: 'inactive' };
    }
  }
  return { error: 'スタッフが見つかりません: ' + staffId };
}

function restoreStaff(staffId) {
  if (!staffId) return { error: 'staffIdが必要です' };
  var sheet = ensureStaffSheet();
  var rows = sheet.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === String(staffId)) {
      sheet.getRange(i + 1, 7).setValue('active');
      return { success: true, staffId: staffId, status: 'active' };
    }
  }
  return { error: 'スタッフが見つかりません: ' + staffId };
}

// ============================================================
// 店舗管理
// ============================================================
// シート列: A=ID, B=店舗名, C=ステータス(active/inactive), D=作成日, E=メモ

function ensureStoreSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.STORES);
  if (!sheet) {
    sheet = ss.insertSheet(SHEETS.STORES);
    sheet.appendRow(['ID', '店舗名', 'ステータス', '作成日', 'メモ']);
    sheet.setFrozenRows(1);
    sheet.getRange('A1:E1').setFontWeight('bold');
  }
  return sheet;
}

function handleStoreManageGet(params) {
  var includeInactive = params.includeInactive === 'true' || params.includeInactive === '1';
  var sheet = ensureStoreSheet();
  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { stores: [] };

  var stores = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0]) continue;
    var status = String(r[2] || 'active');
    if (!includeInactive && status === 'inactive') continue;
    stores.push({
      id: String(r[0]),
      name: String(r[1] || ''),
      status: status,
      createdAt: formatDate(r[3]),
      memo: String(r[4] || '')
    });
  }
  return { stores: stores };
}

function handleStoreManagePost(body) {
  var action = body.action || '';
  switch (action) {
    case 'saveStores':    return saveStoreList(body.stores || []);
    case 'addStore':      return addStore(body.store || {});
    case 'updateStore':   return updateStore(body.store || {});
    case 'deleteStore':   return softDeleteStore(body.storeId);
    case 'restoreStore':  return restoreStore(body.storeId);
    default: return { error: '不明なstoreManage action: ' + action };
  }
}

function saveStoreList(storeArr) {
  var sheet = ensureStoreSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 5).clearContent();
  }
  var rows = storeArr.map(function(s) {
    return [
      s.id || '',
      s.name || '',
      s.status || 'active',
      s.createdAt || new Date(),
      s.memo || ''
    ];
  });
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 5).setValues(rows);
  }
  return { success: true, count: rows.length };
}

function addStore(store) {
  if (!store.id || !store.name) return { error: 'IDと店舗名が必要です' };
  var sheet = ensureStoreSheet();
  sheet.appendRow([
    store.id,
    store.name,
    'active',
    new Date(),
    store.memo || ''
  ]);
  return { success: true, store: { id: store.id, name: store.name, status: 'active' } };
}

function updateStore(store) {
  if (!store.id) return { error: 'storeIdが必要です' };
  var sheet = ensureStoreSheet();
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(store.id)) {
      if (store.name) sheet.getRange(i + 1, 2).setValue(store.name);
      if (store.memo !== undefined) sheet.getRange(i + 1, 5).setValue(store.memo);
      return { success: true, storeId: store.id };
    }
  }
  return { error: '店舗が見つかりません: ' + store.id };
}

function softDeleteStore(storeId) {
  if (!storeId) return { error: 'storeIdが必要です' };
  var sheet = ensureStoreSheet();
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(storeId)) {
      sheet.getRange(i + 1, 3).setValue('inactive');
      return { success: true, storeId: storeId, status: 'inactive' };
    }
  }
  return { error: '店舗が見つかりません: ' + storeId };
}

function restoreStore(storeId) {
  if (!storeId) return { error: 'storeIdが必要です' };
  var sheet = ensureStoreSheet();
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(storeId)) {
      sheet.getRange(i + 1, 3).setValue('active');
      return { success: true, storeId: storeId, status: 'active' };
    }
  }
  return { error: '店舗が見つかりません: ' + storeId };
}

// ============================================================
// ダッシュボード設定（キー・バリュー型）
// ============================================================
// シート列: A=キー, B=値(JSON文字列)

function ensureDashConfigSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.DASH_CONFIG);
  if (!sheet) {
    sheet = ss.insertSheet(SHEETS.DASH_CONFIG);
    sheet.appendRow(['キー', '値']);
    sheet.setFrozenRows(1);
    sheet.getRange('A1:B1').setFontWeight('bold');
  }
  return sheet;
}

function handleDashConfigGet(params) {
  var key = params.key || '';
  var sheet = ensureDashConfigSheet();
  var rows = sheet.getDataRange().getValues();
  if (key) {
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === key) {
        try { return { key: key, value: JSON.parse(String(rows[i][1])) }; }
        catch(e) { return { key: key, value: String(rows[i][1]) }; }
      }
    }
    return { key: key, value: null };
  }
  // 全件取得
  var result = {};
  for (var i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    try { result[String(rows[i][0])] = JSON.parse(String(rows[i][1])); }
    catch(e) { result[String(rows[i][0])] = String(rows[i][1]); }
  }
  return { config: result };
}

function handleDashConfigPost(body) {
  var action = body.action || 'set';
  if (action === 'set') {
    return setDashConfig(body.key, body.value);
  } else if (action === 'setBulk') {
    return setDashConfigBulk(body.entries || {});
  }
  return { error: '不明なdashConfig action: ' + action };
}

function setDashConfig(key, value) {
  if (!key) return { error: 'keyが必要です' };
  var sheet = ensureDashConfigSheet();
  var rows = sheet.getDataRange().getValues();
  var jsonVal = JSON.stringify(value);
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === key) {
      sheet.getRange(i + 1, 2).setValue(jsonVal);
      return { success: true, key: key };
    }
  }
  sheet.appendRow([key, jsonVal]);
  return { success: true, key: key };
}

function setDashConfigBulk(entries) {
  var keys = Object.keys(entries);
  for (var k = 0; k < keys.length; k++) {
    setDashConfig(keys[k], entries[keys[k]]);
  }
  return { success: true, count: keys.length };
}

// ============================================================
// HPBデータ
// ============================================================
// シート列: A=年月, B=PV数, C=予約数, D=掲載費, E=クリック数, F=CVR, G=メモ

function ensureHpbSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEETS.HPB);
  if (!sheet) {
    sheet = ss.insertSheet(SHEETS.HPB);
    sheet.appendRow(['年月', 'PV数', '予約数', '掲載費', 'クリック数', 'CVR', 'メモ']);
    sheet.setFrozenRows(1);
    sheet.getRange('A1:G1').setFontWeight('bold');
  }
  return sheet;
}

function handleHpbGet(params) {
  var sheet = ensureHpbSheet();
  var rows = sheet.getDataRange().getValues();
  var monthly = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (!r[0]) continue;
    monthly.push({
      yearMonth: String(r[0]),
      views: toInt(r[1]),
      bookings: toInt(r[2]),
      cost: toInt(r[3]),
      clicks: toInt(r[4]),
      cvr: r[5] ? parseFloat(r[5]) : 0,
      memo: String(r[6] || '')
    });
  }
  return { monthly: monthly };
}

function handleHpbPost(body) {
  var action = body.action || '';
  switch (action) {
    case 'saveAll':   return saveHpbAll(body.monthly || []);
    case 'upsert':    return upsertHpbMonth(body.entry || {});
    case 'delete':    return deleteHpbMonth(body.yearMonth);
    default: return { error: '不明なhpb action: ' + action };
  }
}

function saveHpbAll(monthly) {
  var sheet = ensureHpbSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 7).clearContent();
  }
  var rows = monthly.map(function(m) {
    return [
      m.yearMonth || '',
      m.views || 0,
      m.bookings || 0,
      m.cost || 0,
      m.clicks || 0,
      m.cvr || 0,
      m.memo || ''
    ];
  });
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, 7).setValues(rows);
  }
  return { success: true, count: rows.length };
}

function upsertHpbMonth(entry) {
  if (!entry.yearMonth) return { error: 'yearMonthが必要です' };
  var sheet = ensureHpbSheet();
  var rows = sheet.getDataRange().getValues();
  var rowData = [
    entry.yearMonth,
    entry.views || 0,
    entry.bookings || 0,
    entry.cost || 0,
    entry.clicks || 0,
    entry.cvr || 0,
    entry.memo || ''
  ];
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(entry.yearMonth)) {
      sheet.getRange(i + 1, 1, 1, 7).setValues([rowData]);
      return { success: true, yearMonth: entry.yearMonth, action: 'updated' };
    }
  }
  sheet.appendRow(rowData);
  return { success: true, yearMonth: entry.yearMonth, action: 'added' };
}

function deleteHpbMonth(yearMonth) {
  if (!yearMonth) return { error: 'yearMonthが必要です' };
  var sheet = ensureHpbSheet();
  var rows = sheet.getDataRange().getValues();
  for (var i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i][0]) === String(yearMonth)) {
      sheet.deleteRow(i + 1);
      return { success: true, yearMonth: yearMonth };
    }
  }
  return { error: 'データが見つかりません: ' + yearMonth };
}

function jsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
