import { supabase } from '../_lib/supabase.js';
import { cors } from '../_lib/cors.js';
import { extractStaffContext } from '../_lib/auth.js';
import { staffGet, staffPost, menuItemsGet, menuItemsPost, hpbGet, hpbPost } from '../_lib/db-handlers-master.js';
import { cashbookGet, cashbookPost } from '../_lib/db-handlers-cashbook.js';
import {
  lineMessagesGet, lineMessagesPost, lineProfilesGet, lineProfilesPost,
  lineBroadcastsGet, lineBroadcastsPost, lineTemplatesGet, lineTemplatesPost,
  lineAutoRepliesGet, lineAutoRepliesPost, lineTagsGet, lineTagsPost,
  lineUserTagsGet, lineUserTagsPost, lineAnalyticsGet
} from '../_lib/db-handlers-line.js';
import {
  usageGet, usagePost, ticketGet, ticketPost,
  membersGet, membersPost, attendanceGet, attendancePost,
  qrTokenGet, qrTokenPost
} from '../_lib/db-handlers-misc.js';

// ============================================================
// 統合DBエンドポイント
// Vercel Hobby プランの12ファンクション上限対策として1ファイルに集約
// 使い方: /api/db?table=stores
// ============================================================

const HANDLERS = {
  stores:          { get: storesGet,         post: storesPost },
  dashConfig:      { get: dashConfigGet,     post: dashConfigPost },
  reports:         { get: reportsGet,        post: reportsPost },
  staff:           { get: staffGet,          post: staffPost },
  menuItems:       { get: menuItemsGet,      post: menuItemsPost },
  hpb:             { get: hpbGet,            post: hpbPost },
  cashbook:        { get: cashbookGet,       post: cashbookPost },
  usage:           { get: usageGet,          post: usagePost },
  ticket:          { get: ticketGet,         post: ticketPost },
  members:         { get: membersGet,        post: membersPost },
  attendance:      { get: attendanceGet,     post: attendancePost },
  qrToken:         { get: qrTokenGet,        post: qrTokenPost },
  lineMessages:    { get: lineMessagesGet,   post: lineMessagesPost },
  lineProfiles:    { get: lineProfilesGet,   post: lineProfilesPost },
  lineBroadcasts:  { get: lineBroadcastsGet, post: lineBroadcastsPost },
  lineTemplates:   { get: lineTemplatesGet,  post: lineTemplatesPost },
  lineAutoReplies: { get: lineAutoRepliesGet, post: lineAutoRepliesPost },
  lineTags:        { get: lineTagsGet,       post: lineTagsPost },
  lineUserTags:    { get: lineUserTagsGet,   post: lineUserTagsPost },
  lineAnalytics:   { get: lineAnalyticsGet,  post: async () => ({ error: 'lineAnalyticsはGET専用です' }) },
};

export default async function handler(req, res) {
  if (cors(req, res)) return;

  const table = req.query.table || '';
  const params = { ...req.query };
  delete params.table;

  const h = HANDLERS[table];
  if (!h) {
    return res.status(400).json({
      error: '不明なtable: ' + table,
      available: Object.keys(HANDLERS)
    });
  }

  // ---- スタッフ権限コンテキスト抽出 ----
  // 返り値:
  //   null        : token 無し（admin モード）→ 既存挙動と同等の全店舗許可
  //   { valid:false, reason } : token 不正 / staff 無効 → 401 で拒否
  //   { valid:true, staffId, role, storeIds } : 通常のスタッフアクセス
  const staffCtx = await extractStaffContext(req);
  if (staffCtx && staffCtx.valid === false) {
    return res.status(401).json({ error: '認証エラー: ' + (staffCtx.reason || 'invalid') });
  }

  try {
    const body = req.method === 'POST'
      ? (typeof req.body === 'string' ? JSON.parse(req.body) : req.body)
      : null;

    // 各ハンドラには第2引数として staffCtx を渡す。
    // 第2引数を受け取らない既存ハンドラは単に無視するため後方互換。
    const result = req.method === 'GET' ? await h.get(params, staffCtx) : await h.post(body, staffCtx);
    return res.json(result);
  } catch (e) {
    console.error(`db/${table} error:`, e);
    res.status(500).json({ error: e.message });
  }
}

// ============================================================
// 店舗管理 (stores) - インラインで保持
// ============================================================

async function storesGet(params) {
  const includeInactive = params.includeInactive === 'true' || params.includeInactive === '1';
  let query = supabase.from('stores').select('*').order('created_at');
  if (!includeInactive) query = query.eq('status', 'active');
  const { data, error } = await query;
  if (error) throw error;
  return {
    stores: (data || []).map(r => ({
      id: r.id, name: r.name, status: r.status,
      createdAt: r.created_at, memo: r.memo || '',
      lat: r.lat, lng: r.lng
    }))
  };
}

async function storesPost(body) {
  const action = body.action || '';
  switch (action) {
    case 'addStore': {
      const store = body.store || {};
      if (!store.id || !store.name) return { error: 'IDと店舗名が必要です' };
      const { error } = await supabase.from('stores').insert({
        id: store.id, name: store.name, status: 'active', memo: store.memo || ''
      });
      if (error) throw error;
      return { success: true, store: { id: store.id, name: store.name, status: 'active' } };
    }
    case 'updateStore': {
      const store = body.store || {};
      if (!store.id) return { error: 'storeIdが必要です' };
      const updates = {};
      if (store.name !== undefined) updates.name = store.name;
      if (store.memo !== undefined) updates.memo = store.memo;
      if (store.lat !== undefined) updates.lat = store.lat;
      if (store.lng !== undefined) updates.lng = store.lng;
      const { error } = await supabase.from('stores').update(updates).eq('id', store.id);
      if (error) throw error;
      return { success: true, storeId: store.id };
    }
    case 'updateCoordinates': {
      if (!body.storeId) return { error: 'storeIdが必要です' };
      const { error } = await supabase.from('stores').update({ lat: body.lat, lng: body.lng }).eq('id', body.storeId);
      if (error) throw error;
      return { success: true, storeId: body.storeId };
    }
    case 'deleteStore':  return setStoreStatus(body.storeId, 'inactive');
    case 'restoreStore': return setStoreStatus(body.storeId, 'active');
    case 'saveStores': {
      const rows = (body.stores || []).map(s => ({
        id: s.id || '', name: s.name || '', status: s.status || 'active',
        created_at: s.createdAt || new Date().toISOString(), memo: s.memo || ''
      }));
      if (rows.length > 0) {
        const { error } = await supabase.from('stores').upsert(rows, { onConflict: 'id' });
        if (error) throw error;
      }
      return { success: true, count: rows.length };
    }
    default: return { error: '不明なaction: ' + action };
  }
}

async function setStoreStatus(storeId, status) {
  if (!storeId) return { error: 'storeIdが必要です' };
  const { error } = await supabase.from('stores').update({ status }).eq('id', storeId);
  if (error) throw error;
  return { success: true, storeId };
}

// ============================================================
// ダッシュボード設定 (dashConfig) - インラインで保持
// ============================================================

async function dashConfigGet(params) {
  if (params.key) {
    const { data, error } = await supabase
      .from('dash_config').select('*').eq('key', params.key).maybeSingle();
    if (error) throw error;
    return { key: params.key, value: data ? data.value : null };
  }
  const { data, error } = await supabase.from('dash_config').select('*');
  if (error) throw error;
  const config = {};
  for (const row of data || []) config[row.key] = row.value;
  return { config };
}

async function dashConfigPost(body) {
  const action = body.action || '';
  switch (action) {
    case 'set': {
      if (!body.key) return { error: 'keyが必要です' };
      const { error } = await supabase.from('dash_config')
        .upsert({ key: body.key, value: body.value }, { onConflict: 'key' });
      if (error) throw error;
      return { success: true, key: body.key };
    }
    case 'setBulk': {
      const rows = Object.entries(body.entries || {}).map(([k, v]) => ({ key: k, value: v }));
      if (rows.length > 0) {
        const { error } = await supabase.from('dash_config').upsert(rows, { onConflict: 'key' });
        if (error) throw error;
      }
      return { success: true, count: rows.length };
    }
    default: return { error: '不明なaction: ' + action };
  }
}

// ============================================================
// 日報 (reports) - インラインで保持
// ============================================================

async function reportsGet(params) {
  let query = supabase.from('daily_reports').select('*')
    .order('timestamp', { ascending: false });

  if (params.all === 'true') {
    // 全データ
  } else if (params.month) {
    const [y, m] = params.month.split('-').map(Number);
    query = query.gte('timestamp', new Date(y, m - 1, 1).toISOString())
                 .lte('timestamp', new Date(y, m, 0, 23, 59, 59).toISOString());
  } else if (params.months) {
    const n = parseInt(params.months) || 1;
    const now = new Date();
    query = query.gte('timestamp', new Date(now.getFullYear(), now.getMonth() - (n - 1), 1).toISOString());
  } else {
    const now = new Date();
    query = query.gte('timestamp', new Date(now.getFullYear(), now.getMonth(), 1).toISOString());
  }

  const { data, error } = await query;
  if (error) throw error;

  return {
    reports: (data || []).map(r => ({
      id: r.id, timestamp: r.timestamp, store: r.store,
      hpbNew: r.hpb_new, metaNew: r.meta_new,
      referralNew: r.referral_new, discountNew: r.discount_new,
      hpbContract: r.hpb_contract, metaContract: r.meta_contract,
      referralContract: r.referral_contract, discountContract: r.discount_contract,
      existingTreatments: r.existing_treatments,
      taskComplete: r.task_complete, prepComplete: r.prep_complete
    })),
    total: (data || []).length,
    lastUpdated: new Date().toISOString()
  };
}

async function reportsPost(body) {
  const action = body.action || 'create';
  switch (action) {
    case 'create': {
      const r = body.report || body;
      if (!r.store) return { error: '店舗が必要です' };
      const row = {
        timestamp: r.timestamp || new Date().toISOString(), store: r.store,
        hpb_new: parseInt(r.hpbNew) || 0, meta_new: parseInt(r.metaNew) || 0,
        referral_new: parseInt(r.referralNew) || 0, discount_new: parseInt(r.discountNew) || 0,
        hpb_contract: parseInt(r.hpbContract) || 0, meta_contract: parseInt(r.metaContract) || 0,
        referral_contract: parseInt(r.referralContract) || 0, discount_contract: parseInt(r.discountContract) || 0,
        existing_treatments: parseInt(r.existingTreatments) || 0,
        task_complete: !!r.taskComplete, prep_complete: !!r.prepComplete
      };
      const { data, error } = await supabase.from('daily_reports').insert(row).select().single();
      if (error) throw error;
      return { success: true, report: data };
    }
    case 'update': {
      const r = body.report || body;
      if (!r.id) return { error: 'idが必要です' };
      const updates = {};
      if (r.store !== undefined) updates.store = r.store;
      if (r.hpbNew !== undefined) updates.hpb_new = parseInt(r.hpbNew) || 0;
      if (r.metaNew !== undefined) updates.meta_new = parseInt(r.metaNew) || 0;
      if (r.referralNew !== undefined) updates.referral_new = parseInt(r.referralNew) || 0;
      if (r.discountNew !== undefined) updates.discount_new = parseInt(r.discountNew) || 0;
      if (r.hpbContract !== undefined) updates.hpb_contract = parseInt(r.hpbContract) || 0;
      if (r.metaContract !== undefined) updates.meta_contract = parseInt(r.metaContract) || 0;
      if (r.referralContract !== undefined) updates.referral_contract = parseInt(r.referralContract) || 0;
      if (r.discountContract !== undefined) updates.discount_contract = parseInt(r.discountContract) || 0;
      if (r.existingTreatments !== undefined) updates.existing_treatments = parseInt(r.existingTreatments) || 0;
      if (r.taskComplete !== undefined) updates.task_complete = !!r.taskComplete;
      if (r.prepComplete !== undefined) updates.prep_complete = !!r.prepComplete;
      const { error } = await supabase.from('daily_reports').update(updates).eq('id', r.id);
      if (error) throw error;
      return { success: true, id: r.id };
    }
    case 'delete': {
      if (!body.id) return { error: 'idが必要です' };
      const { error } = await supabase.from('daily_reports').delete().eq('id', body.id);
      if (error) throw error;
      return { success: true, id: body.id };
    }
    case 'saveAll': {
      const reports = body.reports || [];
      const rows = reports.map(r => ({
        timestamp: r.timestamp || new Date().toISOString(),
        store: r.store || '',
        hpb_new: parseInt(r.hpbNew) || 0,
        meta_new: parseInt(r.metaNew) || 0,
        referral_new: parseInt(r.referralNew) || 0,
        discount_new: parseInt(r.discountNew) || 0,
        hpb_contract: parseInt(r.hpbContract) || 0,
        meta_contract: parseInt(r.metaContract) || 0,
        referral_contract: parseInt(r.referralContract) || 0,
        discount_contract: parseInt(r.discountContract) || 0,
        existing_treatments: parseInt(r.existingTreatments) || 0,
        task_complete: !!r.taskComplete,
        prep_complete: !!r.prepComplete
      }));
      if (body.replace) {
        await supabase.from('daily_reports').delete().neq('id', 0);
      }
      if (rows.length > 0) {
        const { error } = await supabase.from('daily_reports').insert(rows);
        if (error) throw error;
      }
      return { success: true, count: rows.length };
    }
    default: return { error: '不明なaction: ' + action };
  }
}
