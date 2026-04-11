import { supabase } from './supabase.js';

// ============================================================
// スタッフ管理 (staff)
// ============================================================

export async function staffGet(params) {
  const includeInactive = params.includeInactive === 'true' || params.includeInactive === '1';

  let query = supabase.from('staff').select('*').order('created_at');
  if (!includeInactive) query = query.eq('status', 'active');

  const { data, error } = await query;
  if (error) throw error;

  // staff_stores から storeIds を取得
  const staffIds = (data || []).map(s => s.id);
  let storeMap = {};
  if (staffIds.length > 0) {
    const { data: ssData } = await supabase
      .from('staff_stores').select('staff_id, store_id').in('staff_id', staffIds);
    for (const ss of ssData || []) {
      if (!storeMap[ss.staff_id]) storeMap[ss.staff_id] = [];
      storeMap[ss.staff_id].push(ss.store_id);
    }
  }

  return {
    staff: (data || []).map(r => ({
      id: r.id, name: r.name, role: r.role, password: r.password,
      storeIds: storeMap[r.id] || [],
      createdAt: r.created_at, status: r.status
    }))
  };
}

export async function staffPost(body) {
  const action = body.action || '';
  switch (action) {
    case 'saveStaff':    return staffSaveAll(body.staff || []);
    case 'updateStaff':  return staffUpdate(body.staffId, body.updates || {});
    case 'deleteStaff':  return staffSetStatus(body.staffId, 'inactive');
    case 'restoreStaff': return staffSetStatus(body.staffId, 'active');
    default: return { error: '不明なaction: ' + action };
  }
}

// staff_stores.store_id は stores(id) への FK があるため、まだ stores に無い
// Square 由来の店舗 ID（"1" ～ "20"）を参照すると挿入が失敗する。
// 欠けている store レコードを事前にアップサートして FK エラーを防ぐ。
async function ensureStoresExist(storeIds) {
  if (!storeIds || storeIds.length === 0) return;
  const uniqIds = [...new Set(storeIds)];
  const rows = uniqIds.map(id => ({
    id: String(id),
    name: `店舗 ${id}`,
    status: 'active'
  }));
  // 既存レコードを上書きしないよう ignoreDuplicates: true で挿入のみ
  const { error } = await supabase
    .from('stores')
    .upsert(rows, { onConflict: 'id', ignoreDuplicates: true });
  if (error) {
    console.warn('[staff] ensureStoresExist warning:', error.message);
  }
}

async function staffSaveAll(staffArr) {
  for (const s of staffArr) {
    const storeIds = s.storeIds || [];
    const { error } = await supabase.from('staff').upsert({
      id: s.id, name: s.name || '', role: s.role || 'staff',
      password: s.password || '', status: s.status || 'active',
      created_at: s.createdAt || new Date().toISOString()
    }, { onConflict: 'id' });
    if (error) throw error;

    // staff_stores を更新
    await supabase.from('staff_stores').delete().eq('staff_id', s.id);
    if (storeIds.length > 0) {
      // FK エラー回避のため欠けている stores レコードを事前に作成
      await ensureStoresExist(storeIds);
      const rows = storeIds.map(sid => ({ staff_id: s.id, store_id: String(sid) }));
      const { error: ssErr } = await supabase.from('staff_stores').insert(rows);
      if (ssErr) throw ssErr;
    }
  }
  return { success: true, count: staffArr.length };
}

async function staffUpdate(staffId, updates) {
  if (!staffId) return { error: 'staffIdが必要です' };
  const dbUpdates = {};
  if (updates.name !== undefined) dbUpdates.name = updates.name;
  if (updates.role !== undefined) dbUpdates.role = updates.role;
  if (updates.password !== undefined) dbUpdates.password = updates.password;
  if (updates.status !== undefined) dbUpdates.status = updates.status;

  if (Object.keys(dbUpdates).length > 0) {
    const { error } = await supabase.from('staff').update(dbUpdates).eq('id', staffId);
    if (error) throw error;
  }

  if (updates.storeIds !== undefined) {
    await supabase.from('staff_stores').delete().eq('staff_id', staffId);
    if (updates.storeIds.length > 0) {
      // FK エラー回避のため欠けている stores レコードを事前に作成
      await ensureStoresExist(updates.storeIds);
      const rows = updates.storeIds.map(sid => ({ staff_id: staffId, store_id: String(sid) }));
      const { error } = await supabase.from('staff_stores').insert(rows);
      if (error) throw error;
    }
  }
  return { success: true, updated: 1 };
}

async function staffSetStatus(staffId, status) {
  if (!staffId) return { error: 'staffIdが必要です' };
  const { error } = await supabase.from('staff').update({ status }).eq('id', staffId);
  if (error) throw error;
  return { success: true };
}

// ============================================================
// メニュー (menuItems)
// ============================================================

export async function menuItemsGet(params) {
  const includeInactive = params.includeInactive === 'true';
  let query = supabase.from('menu_items').select('*').order('created_at');
  if (!includeInactive) query = query.eq('active', true);

  const { data, error } = await query;
  if (error) throw error;

  return {
    menuItems: (data || []).map(r => ({
      id: r.id, name: r.name, category: r.category || '',
      price: r.price, itemType: r.item_type, active: r.active,
      createdAt: r.created_at
    }))
  };
}

export async function menuItemsPost(body) {
  const action = body.action || '';
  switch (action) {
    case 'saveAll': {
      const items = (body.menuItems || []).map(i => ({
        id: i.id || ('menu_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
        name: i.name, category: i.category || '', price: i.price || 0,
        item_type: i.itemType || 'menu', active: i.active !== false,
        created_at: i.createdAt || new Date().toISOString()
      }));
      if (items.length > 0) {
        const { error } = await supabase.from('menu_items').upsert(items, { onConflict: 'id' });
        if (error) throw error;
      }
      return { success: true, count: items.length };
    }
    case 'addItem': {
      const item = body.item || {};
      const id = item.id || ('menu_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
      const { error } = await supabase.from('menu_items').insert({
        id, name: item.name, category: item.category || '', price: item.price || 0,
        item_type: item.itemType || 'menu', active: item.active !== false
      });
      if (error) throw error;
      return { success: true, itemId: id };
    }
    case 'updateItem': {
      const updates = body.updates || {};
      const dbUpdates = {};
      if (updates.name !== undefined) dbUpdates.name = updates.name;
      if (updates.category !== undefined) dbUpdates.category = updates.category;
      if (updates.price !== undefined) dbUpdates.price = updates.price;
      if (updates.itemType !== undefined) dbUpdates.item_type = updates.itemType;
      if (updates.active !== undefined) dbUpdates.active = updates.active;
      const { error } = await supabase.from('menu_items').update(dbUpdates).eq('id', body.itemId);
      if (error) throw error;
      return { success: true };
    }
    case 'deleteItem': {
      const { error } = await supabase.from('menu_items').update({ active: false }).eq('id', body.itemId);
      if (error) throw error;
      return { success: true };
    }
    default: return { error: '不明なaction: ' + action };
  }
}

// ============================================================
// HPBデータ (hpb)
// ============================================================

export async function hpbGet() {
  const { data, error } = await supabase.from('hpb_data').select('*').order('year_month');
  if (error) throw error;
  return {
    monthly: (data || []).map(r => ({
      yearMonth: r.year_month, views: r.views, bookings: r.bookings,
      cost: r.cost, clicks: r.clicks, cvr: r.cvr, memo: r.memo || ''
    }))
  };
}

export async function hpbPost(body) {
  const action = body.action || '';
  switch (action) {
    case 'saveAll': {
      const rows = (body.monthly || []).map(e => ({
        year_month: e.yearMonth, views: e.views || 0, bookings: e.bookings || 0,
        cost: e.cost || 0, clicks: e.clicks || 0, cvr: e.cvr || 0, memo: e.memo || ''
      }));
      if (rows.length > 0) {
        const { error } = await supabase.from('hpb_data').upsert(rows, { onConflict: 'year_month' });
        if (error) throw error;
      }
      return { success: true };
    }
    case 'upsert': {
      const e = body.entry || {};
      if (!e.yearMonth) return { error: 'yearMonthが必要です' };
      const { error } = await supabase.from('hpb_data').upsert({
        year_month: e.yearMonth, views: e.views || 0, bookings: e.bookings || 0,
        cost: e.cost || 0, clicks: e.clicks || 0, cvr: e.cvr || 0, memo: e.memo || ''
      }, { onConflict: 'year_month' });
      if (error) throw error;
      return { success: true, yearMonth: e.yearMonth };
    }
    case 'delete': {
      if (!body.yearMonth) return { error: 'yearMonthが必要です' };
      const { error } = await supabase.from('hpb_data').delete().eq('year_month', body.yearMonth);
      if (error) throw error;
      return { success: true };
    }
    default: return { error: '不明なaction: ' + action };
  }
}
