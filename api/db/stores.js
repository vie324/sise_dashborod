import { supabase } from '../_lib/supabase.js';
import { cors } from '../_lib/cors.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;

  try {
    if (req.method === 'GET') {
      return res.json(await handleGet(req.query));
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      return res.json(await handlePost(body));
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('stores error:', e);
    res.status(500).json({ error: e.message });
  }
}

// GET: 店舗一覧取得
async function handleGet(params) {
  const includeInactive = params.includeInactive === 'true' || params.includeInactive === '1';

  let query = supabase.from('stores').select('*').order('created_at');
  if (!includeInactive) {
    query = query.eq('status', 'active');
  }

  const { data, error } = await query;
  if (error) throw error;

  return {
    stores: (data || []).map(r => ({
      id: r.id,
      name: r.name,
      status: r.status,
      createdAt: r.created_at,
      memo: r.memo || '',
      lat: r.lat,
      lng: r.lng
    }))
  };
}

// POST: 店舗操作
async function handlePost(body) {
  const action = body.action || '';

  switch (action) {
    case 'addStore':          return addStore(body.store || {});
    case 'updateStore':       return updateStore(body.store || {});
    case 'updateCoordinates': return updateCoordinates(body.storeId, body.lat, body.lng);
    case 'deleteStore':       return softDelete(body.storeId);
    case 'restoreStore':      return restore(body.storeId);
    case 'saveStores':        return saveStoreList(body.stores || []);
    default:
      return { error: '不明なaction: ' + action };
  }
}

async function addStore(store) {
  if (!store.id || !store.name) return { error: 'IDと店舗名が必要です' };

  const { error } = await supabase.from('stores').insert({
    id: store.id,
    name: store.name,
    status: 'active',
    memo: store.memo || ''
  });
  if (error) throw error;

  return { success: true, store: { id: store.id, name: store.name, status: 'active' } };
}

async function updateStore(store) {
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

async function updateCoordinates(storeId, lat, lng) {
  if (!storeId) return { error: 'storeIdが必要です' };
  if (lat === undefined || lng === undefined) return { error: '緯度・経度が必要です' };

  const { error } = await supabase.from('stores').update({ lat, lng }).eq('id', storeId);
  if (error) throw error;

  return { success: true, storeId };
}

async function softDelete(storeId) {
  if (!storeId) return { error: 'storeIdが必要です' };

  const { error } = await supabase.from('stores').update({ status: 'inactive' }).eq('id', storeId);
  if (error) throw error;

  return { success: true, storeId };
}

async function restore(storeId) {
  if (!storeId) return { error: 'storeIdが必要です' };

  const { error } = await supabase.from('stores').update({ status: 'active' }).eq('id', storeId);
  if (error) throw error;

  return { success: true, storeId };
}

async function saveStoreList(storeArr) {
  // GAS互換: 全店舗を一括上書き (upsert)
  const rows = storeArr.map(s => ({
    id: s.id || '',
    name: s.name || '',
    status: s.status || 'active',
    created_at: s.createdAt || new Date().toISOString(),
    memo: s.memo || ''
  }));

  if (rows.length > 0) {
    const { error } = await supabase.from('stores').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
  }

  return { success: true, count: rows.length };
}
