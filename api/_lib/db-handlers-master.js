import crypto from 'node:crypto';
import { supabase } from './supabase.js';
import { isAdminOrOwner } from './auth.js';
import { normalizeRole, isKnownRole, isOwnerRole, isStoreManagerRole } from '../../shared/roles.js';

// ============================================================
// スタッフ管理 (staff)
// ------------------------------------------------------------
// パスワードはレスポンスに含めない（hasPassword だけ返す）。
// 照合はサーバー側の auth.verifyPassword で行う。
// 参照範囲: 管理者・オーナー = 全員 / 店長・マネージャー = 同じ店舗のスタッフ / スタッフ = 自分のみ
// 変更: 管理者・オーナーのみ
// ロールは shared/roles.js の 4つ（旧「本部 headquarter」はオーナーとして返す）
// ============================================================

export async function staffGet(params, staffCtx) {
  const includeInactive = params.includeInactive === 'true' || params.includeInactive === '1';

  let query = supabase.from('staff').select('id, name, role, status, password, created_at').order('created_at');
  if (!includeInactive) query = query.eq('status', 'active');

  const { data, error } = await query;
  if (error) throw error;

  const staffIds = (data || []).map(s => s.id);
  const storeMap = {};
  if (staffIds.length > 0) {
    const { data: ssData, error: ssErr } = await supabase
      .from('staff_stores').select('staff_id, store_id').in('staff_id', staffIds);
    if (ssErr) throw ssErr;
    for (const ss of ssData || []) {
      if (!storeMap[ss.staff_id]) storeMap[ss.staff_id] = [];
      storeMap[ss.staff_id].push(ss.store_id);
    }
  }

  let rows = (data || []).map(r => ({
    id: r.id, name: r.name, role: normalizeRole(r.role),
    hasPassword: !!(r.password && String(r.password).length > 0),
    storeIds: storeMap[r.id] || [],
    createdAt: r.created_at, status: r.status
  }));

  if (!isAdminOrOwner(staffCtx)) {
    if (isStoreManagerRole(staffCtx.role)) {
      const mine = new Set(staffCtx.storeIds || []);
      rows = rows.filter(s => s.id === staffCtx.staffId || s.storeIds.some(id => mine.has(String(id))));
    } else {
      rows = rows.filter(s => s.id === staffCtx.staffId);
    }
  }
  return { staff: rows };
}

export async function staffPost(body, staffCtx) {
  if (!isAdminOrOwner(staffCtx)) {
    return { error: 'スタッフ情報を変更できるのは管理者・オーナーのみです' };
  }
  const action = body.action || '';
  switch (action) {
    case 'saveStaff':    return staffSaveAll(body.staff || []);
    case 'updateStaff':  return staffUpdate(body.staffId, body.updates || {});
    case 'deleteStaff':  return staffSetStatus(body.staffId, 'inactive');
    case 'restoreStaff': return staffSetStatus(body.staffId, 'active');
    default: return { error: '不明なaction: ' + action };
  }
}


async function replaceStaffStores(staffId, storeIds) {
  const { error: delErr } = await supabase.from('staff_stores').delete().eq('staff_id', staffId);
  if (delErr) throw delErr;
  const ids = [...new Set((storeIds || []).map(String).filter(Boolean))];
  if (ids.length === 0) return;
  const { error } = await supabase.from('staff_stores').insert(ids.map(sid => ({ staff_id: staffId, store_id: sid })));
  if (error) throw error;
}

async function staffSaveAll(staffArr) {
  for (const s of staffArr) {
    if (!s.id || !s.name) return { error: 'スタッフID と名前が必要です' };
    const row = {
      id: s.id, name: s.name, role: isKnownRole(s.role) ? normalizeRole(s.role) : 'staff',
      status: s.status || 'active',
      created_at: s.createdAt || new Date().toISOString()
    };
    // パスワードは明示的に渡された時だけ更新する（未指定で既存を消さない）
    if (s.password !== undefined) row.password = s.password || '';
    const { error } = await supabase.from('staff').upsert(row, { onConflict: 'id' });
    if (error) throw error;
    if (s.storeIds !== undefined) await replaceStaffStores(s.id, s.storeIds);
  }
  return { success: true, count: staffArr.length };
}

async function staffUpdate(staffId, updates) {
  if (!staffId) return { error: 'staffIdが必要です' };
  const dbUpdates = {};
  if (updates.name !== undefined) dbUpdates.name = updates.name;
  if (updates.role !== undefined) {
    if (!isKnownRole(updates.role)) return { error: '不正なロールです' };
    dbUpdates.role = normalizeRole(updates.role);
  }
  if (updates.password !== undefined) dbUpdates.password = updates.password || '';
  if (updates.status !== undefined) dbUpdates.status = updates.status;

  if (Object.keys(dbUpdates).length > 0) {
    const { error } = await supabase.from('staff').update(dbUpdates).eq('id', staffId);
    if (error) throw error;
  }
  if (updates.storeIds !== undefined) await replaceStaffStores(staffId, updates.storeIds);
  return { success: true, updated: 1 };
}

async function staffSetStatus(staffId, status) {
  if (!staffId) return { error: 'staffIdが必要です' };
  const { error } = await supabase.from('staff').update({ status }).eq('id', staffId);
  if (error) throw error;
  return { success: true };
}

// スタッフ URL のパスワード照合（auth テーブルから呼ぶ）
const _pwFailures = new Map(); // staffId → { count, blockedUntil }

export async function verifyStaffPassword(staffId, password) {
  if (!staffId) return { ok: false, error: 'staffIdが必要です' };
  const now = Date.now();
  const f = _pwFailures.get(staffId);
  if (f && f.blockedUntil > now) {
    return { ok: false, error: `試行回数の上限を超えました。${Math.ceil((f.blockedUntil - now) / 1000)}秒後に再試行してください` };
  }
  const { data, error } = await supabase.from('staff').select('id, password, status').eq('id', staffId).maybeSingle();
  if (error) throw error;
  if (!data || data.status === 'inactive') return { ok: false, error: 'スタッフが見つかりません' };
  const expected = String(data.password || '');
  if (!expected) return { ok: true };
  const a = Buffer.from(String(password || ''));
  const b = Buffer.from(expected);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (ok) { _pwFailures.delete(staffId); return { ok: true }; }
  const entry = f && f.blockedUntil <= now ? { count: 0, blockedUntil: 0 } : (f || { count: 0, blockedUntil: 0 });
  entry.count += 1;
  if (entry.count >= 5) { entry.blockedUntil = now + 60 * 1000; entry.count = 0; }
  _pwFailures.set(staffId, entry);
  return { ok: false, error: 'パスワードが正しくありません' };
}

// ============================================================
// メニュー (menuItems) — 出納帳の入力補助
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

export async function menuItemsPost(body, staffCtx) {
  // メニューと価格は全店舗の記帳に使われるので、変更は店舗責任者以上に限る
  if (staffCtx && (staffCtx.valid === false || !(isStoreManagerRole(staffCtx.role) || isOwnerRole(staffCtx.role)))) {
    return { error: 'メニューを変更できるのは店舗責任者・本部・管理者のみです' };
  }
  const action = body.action || '';
  switch (action) {
    case 'addItem': {
      const item = body.item || {};
      if (!item.name) return { error: 'メニュー名が必要です' };
      const id = item.id || ('menu_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
      const { error } = await supabase.from('menu_items').insert({
        id, name: item.name, category: item.category || '', price: parseInt(item.price, 10) || 0,
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
      if (updates.price !== undefined) dbUpdates.price = parseInt(updates.price, 10) || 0;
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
