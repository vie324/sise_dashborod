import { supabase } from '../_lib/supabase.js';
import { cors } from '../_lib/cors.js';

// ============================================================
// 統合DBエンドポイント
// Vercel Hobby プランの12ファンクション上限対策として1ファイルに集約
// 使い方: /api/db?table=stores  /api/db?table=dashConfig  /api/db?table=reports
// ============================================================

export default async function handler(req, res) {
  if (cors(req, res)) return;

  const table = req.query.table || '';
  const params = { ...req.query };
  delete params.table;

  try {
    const body = req.method === 'POST'
      ? (typeof req.body === 'string' ? JSON.parse(req.body) : req.body)
      : null;

    let result;
    switch (table) {
      case 'stores':
        result = req.method === 'GET' ? await storesGet(params) : await storesPost(body);
        break;
      case 'dashConfig':
        result = req.method === 'GET' ? await dashConfigGet(params) : await dashConfigPost(body);
        break;
      case 'reports':
        result = req.method === 'GET' ? await reportsGet(params) : await reportsPost(body);
        break;
      default:
        return res.status(400).json({ error: '不明なtable: ' + table + ' (stores|dashConfig|reports)' });
    }

    return res.json(result);
  } catch (e) {
    console.error(`db/${table} error:`, e);
    res.status(500).json({ error: e.message });
  }
}

// ============================================================
// 店舗管理 (stores)
// ============================================================

async function storesGet(params) {
  const includeInactive = params.includeInactive === 'true' || params.includeInactive === '1';

  let query = supabase.from('stores').select('*').order('created_at');
  if (!includeInactive) {
    query = query.eq('status', 'active');
  }

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
    case 'addStore':          return storesAdd(body.store || {});
    case 'updateStore':       return storesUpdate(body.store || {});
    case 'updateCoordinates': return storesUpdateCoords(body.storeId, body.lat, body.lng);
    case 'deleteStore':       return storesSetStatus(body.storeId, 'inactive');
    case 'restoreStore':      return storesSetStatus(body.storeId, 'active');
    case 'saveStores':        return storesSaveList(body.stores || []);
    default: return { error: '不明なaction: ' + action };
  }
}

async function storesAdd(store) {
  if (!store.id || !store.name) return { error: 'IDと店舗名が必要です' };
  const { error } = await supabase.from('stores').insert({
    id: store.id, name: store.name, status: 'active', memo: store.memo || ''
  });
  if (error) throw error;
  return { success: true, store: { id: store.id, name: store.name, status: 'active' } };
}

async function storesUpdate(store) {
  if (!store.id) return { error: 'storeIdが必要です' };
  const updates = {};
  if (store.name !== undefined) updates.name = store.name;
  if (store.memo !== undefined) updates.memo = store.memo;
  if (store.lat !== undefined)  updates.lat = store.lat;
  if (store.lng !== undefined)  updates.lng = store.lng;
  const { error } = await supabase.from('stores').update(updates).eq('id', store.id);
  if (error) throw error;
  return { success: true, storeId: store.id };
}

async function storesUpdateCoords(storeId, lat, lng) {
  if (!storeId) return { error: 'storeIdが必要です' };
  if (lat === undefined || lng === undefined) return { error: '緯度・経度が必要です' };
  const { error } = await supabase.from('stores').update({ lat, lng }).eq('id', storeId);
  if (error) throw error;
  return { success: true, storeId };
}

async function storesSetStatus(storeId, status) {
  if (!storeId) return { error: 'storeIdが必要です' };
  const { error } = await supabase.from('stores').update({ status }).eq('id', storeId);
  if (error) throw error;
  return { success: true, storeId };
}

async function storesSaveList(storeArr) {
  const rows = storeArr.map(s => ({
    id: s.id || '', name: s.name || '', status: s.status || 'active',
    created_at: s.createdAt || new Date().toISOString(), memo: s.memo || ''
  }));
  if (rows.length > 0) {
    const { error } = await supabase.from('stores').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
  }
  return { success: true, count: rows.length };
}

// ============================================================
// ダッシュボード設定 (dashConfig)
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
  for (const row of data || []) { config[row.key] = row.value; }
  return { config };
}

async function dashConfigPost(body) {
  const action = body.action || '';
  switch (action) {
    case 'set': {
      if (!body.key) return { error: 'keyが必要です' };
      const { error } = await supabase
        .from('dash_config').upsert({ key: body.key, value: body.value }, { onConflict: 'key' });
      if (error) throw error;
      return { success: true, key: body.key };
    }
    case 'setBulk': {
      const entries = body.entries || {};
      const rows = Object.entries(entries).map(([k, v]) => ({ key: k, value: v }));
      if (rows.length > 0) {
        const { error } = await supabase
          .from('dash_config').upsert(rows, { onConflict: 'key' });
        if (error) throw error;
      }
      return { success: true, count: rows.length };
    }
    default: return { error: '不明なaction: ' + action };
  }
}

// ============================================================
// 日報 (reports)
// ============================================================

async function reportsGet(params) {
  let query = supabase
    .from('daily_reports').select('*')
    .order('timestamp', { ascending: false });

  if (params.all === 'true') {
    // 全データ
  } else if (params.month) {
    const [y, m] = params.month.split('-').map(Number);
    const start = new Date(y, m - 1, 1).toISOString();
    const end = new Date(y, m, 0, 23, 59, 59).toISOString();
    query = query.gte('timestamp', start).lte('timestamp', end);
  } else if (params.months) {
    const n = parseInt(params.months) || 1;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - (n - 1), 1).toISOString();
    query = query.gte('timestamp', start);
  } else {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    query = query.gte('timestamp', start);
  }

  const { data, error } = await query;
  if (error) throw error;

  const reports = (data || []).map(r => ({
    id: r.id, timestamp: r.timestamp, store: r.store,
    hpbNew: r.hpb_new, metaNew: r.meta_new,
    referralNew: r.referral_new, discountNew: r.discount_new,
    hpbContract: r.hpb_contract, metaContract: r.meta_contract,
    referralContract: r.referral_contract, discountContract: r.discount_contract,
    existingTreatments: r.existing_treatments,
    taskComplete: r.task_complete, prepComplete: r.prep_complete
  }));

  return { reports, total: reports.length, lastUpdated: new Date().toISOString() };
}

async function reportsPost(body) {
  const action = body.action || 'create';
  switch (action) {
    case 'create': return reportCreate(body.report || body);
    case 'update': return reportUpdate(body.report || body);
    case 'delete': return reportDelete(body.id);
    default: return { error: '不明なaction: ' + action };
  }
}

async function reportCreate(report) {
  if (!report.store) return { error: '店舗が必要です' };
  const row = {
    timestamp: report.timestamp || new Date().toISOString(),
    store: report.store,
    hpb_new: parseInt(report.hpbNew) || 0,
    meta_new: parseInt(report.metaNew) || 0,
    referral_new: parseInt(report.referralNew) || 0,
    discount_new: parseInt(report.discountNew) || 0,
    hpb_contract: parseInt(report.hpbContract) || 0,
    meta_contract: parseInt(report.metaContract) || 0,
    referral_contract: parseInt(report.referralContract) || 0,
    discount_contract: parseInt(report.discountContract) || 0,
    existing_treatments: parseInt(report.existingTreatments) || 0,
    task_complete: !!report.taskComplete,
    prep_complete: !!report.prepComplete
  };
  const { data, error } = await supabase.from('daily_reports').insert(row).select().single();
  if (error) throw error;
  return { success: true, report: data };
}

async function reportUpdate(report) {
  if (!report.id) return { error: 'idが必要です' };
  const updates = {};
  if (report.store !== undefined)              updates.store = report.store;
  if (report.hpbNew !== undefined)             updates.hpb_new = parseInt(report.hpbNew) || 0;
  if (report.metaNew !== undefined)            updates.meta_new = parseInt(report.metaNew) || 0;
  if (report.referralNew !== undefined)        updates.referral_new = parseInt(report.referralNew) || 0;
  if (report.discountNew !== undefined)        updates.discount_new = parseInt(report.discountNew) || 0;
  if (report.hpbContract !== undefined)        updates.hpb_contract = parseInt(report.hpbContract) || 0;
  if (report.metaContract !== undefined)       updates.meta_contract = parseInt(report.metaContract) || 0;
  if (report.referralContract !== undefined)   updates.referral_contract = parseInt(report.referralContract) || 0;
  if (report.discountContract !== undefined)   updates.discount_contract = parseInt(report.discountContract) || 0;
  if (report.existingTreatments !== undefined) updates.existing_treatments = parseInt(report.existingTreatments) || 0;
  if (report.taskComplete !== undefined)       updates.task_complete = !!report.taskComplete;
  if (report.prepComplete !== undefined)       updates.prep_complete = !!report.prepComplete;
  const { error } = await supabase.from('daily_reports').update(updates).eq('id', report.id);
  if (error) throw error;
  return { success: true, id: report.id };
}

async function reportDelete(id) {
  if (!id) return { error: 'idが必要です' };
  const { error } = await supabase.from('daily_reports').delete().eq('id', id);
  if (error) throw error;
  return { success: true, id };
}
