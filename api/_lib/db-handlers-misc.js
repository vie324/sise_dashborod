import { supabase } from './supabase.js';

// ============================================================
// 利用回数 (usage)
// ============================================================

export async function usageGet(params) {
  const month = params.month || new Date().toISOString().slice(0, 7);
  const { data, error } = await supabase.from('usage_records').select('*').eq('month', month);
  if (error) throw error;

  const usage = {};
  for (const r of data || []) {
    const key = r.period_key ? `${r.member_id}__${r.period_key}` : r.member_id;
    usage[key] = r.count;
  }
  return { usage, month, lastUpdated: new Date().toISOString() };
}

export async function usagePost(body) {
  const items = body.data || [];
  for (const item of items) {
    const { error } = await supabase.from('usage_records').upsert({
      member_id: item.memberId, month: item.month,
      period_key: item.periodKey || '',
      count: item.count || 0,
      member_name: item.memberName || '',
      store_name: item.storeName || '',
      plan_name: item.planName || '',
      updated_at: item.updatedAt || new Date().toISOString()
    }, { onConflict: 'member_id,month,period_key' });
    if (error) throw error;
  }
  return { success: true, updated: items.length };
}

// ============================================================
// 回数券 (ticket)
// ============================================================

export async function ticketGet() {
  const { data: plans, error: pErr } = await supabase.from('ticket_plans').select('*').order('id');
  if (pErr) throw pErr;

  const { data: tickets, error: tErr } = await supabase.from('ticket_data').select('*');
  if (tErr) throw tErr;

  return {
    plans: (plans || []).map(r => ({
      id: r.id, name: r.name, sessions: r.sessions,
      price: r.price, validityDays: r.validity_days, active: r.active
    })),
    tickets: (tickets || []).map(r => r.data),
    lastUpdated: new Date().toISOString()
  };
}

export async function ticketPost(body) {
  if (body.plans) {
    const rows = body.plans.map(p => ({
      id: p.id, name: p.name || '', sessions: p.sessions || 0,
      price: p.price || 0, validity_days: p.validityDays || 0, active: !!p.active
    }));
    // 全置換
    await supabase.from('ticket_plans').delete().neq('id', '');
    if (rows.length > 0) {
      const { error } = await supabase.from('ticket_plans').insert(rows);
      if (error) throw error;
    }
  }

  if (body.tickets) {
    await supabase.from('ticket_data').delete().neq('id', 0);
    if (body.tickets.length > 0) {
      const rows = body.tickets.map(t => ({ data: t }));
      const { error } = await supabase.from('ticket_data').insert(rows);
      if (error) throw error;
    }
  }

  return { success: true };
}

// ============================================================
// QR現金会員 (members)
// ============================================================

export async function membersGet() {
  const { data, error } = await supabase.from('members').select('*');
  if (error) throw error;
  return {
    members: (data || []).map(r => r.data),
    lastUpdated: new Date().toISOString()
  };
}

export async function membersPost(body) {
  const members = body.members || [];
  // 全置換
  await supabase.from('members').delete().neq('id', 0);
  if (members.length > 0) {
    const rows = members.map(m => ({ data: m }));
    const { error } = await supabase.from('members').insert(rows);
    if (error) throw error;
  }
  return { success: true, count: members.length, savedAt: new Date().toISOString() };
}

// ============================================================
// 勤怠 (attendance)
// ============================================================

export async function attendanceGet(params) {
  let query = supabase.from('attendance').select('*').order('date', { ascending: false });
  if (params.store) query = query.eq('store_id', params.store);
  if (params.staffId) query = query.eq('staff_id', params.staffId);
  if (params.date) query = query.eq('date', params.date);
  else if (params.month) {
    const [y, m] = params.month.split('-').map(Number);
    const start = `${params.month}-01`;
    const end = new Date(y, m, 0).toISOString().split('T')[0];
    query = query.gte('date', start).lte('date', end);
  }

  const { data, error } = await query;
  if (error) throw error;

  return {
    records: (data || []).map(r => ({
      id: r.id, staffId: r.staff_id, staffName: r.staff_name || '',
      storeId: r.store_id, date: r.date,
      clockIn: r.clock_in || '', clockOut: r.clock_out || '',
      workMinutes: r.work_minutes || 0,
      lat: r.lat, lng: r.lng, method: r.method || '',
      notes: r.notes || '',
      clockOutLat: r.clock_out_lat, clockOutLng: r.clock_out_lng
    })),
    lastUpdated: new Date().toISOString()
  };
}

export async function attendancePost(body) {
  const action = body.action || '';
  switch (action) {
    case 'clockIn': return attClockIn(body);
    case 'clockOut': return attClockOut(body);
    case 'update': return attUpdate(body.recordId, body.updates || {});
    case 'delete': return attDelete(body.recordId);
    default: return { error: '不明なaction: ' + action };
  }
}

async function attClockIn(body) {
  if (!body.staffId || !body.storeId) return { error: 'staffIdとstoreIdが必要です' };

  const today = new Date().toISOString().split('T')[0];
  const now = new Date();
  const clockIn = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const id = 'att_' + now.getTime().toString(36) + Math.random().toString(36).slice(2, 5);

  const { error } = await supabase.from('attendance').insert({
    id, staff_id: body.staffId, staff_name: body.staffName || '',
    store_id: body.storeId, date: today, clock_in: clockIn, clock_out: '',
    work_minutes: 0, lat: body.lat || null, lng: body.lng || null,
    method: body.method || '', notes: body.notes || ''
  });
  if (error) throw error;

  return { success: true, record: { id, staffId: body.staffId, date: today, clockIn } };
}

async function attClockOut(body) {
  if (!body.recordId) return { error: 'recordIdが必要です' };

  const { data: rec } = await supabase.from('attendance').select('*').eq('id', body.recordId).single();
  if (!rec) return { error: 'レコードが見つかりません' };

  const now = new Date();
  const clockOut = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

  // 労働時間計算
  let workMinutes = 0;
  if (rec.clock_in) {
    const [ih, im] = rec.clock_in.split(':').map(Number);
    const [oh, om] = clockOut.split(':').map(Number);
    workMinutes = (oh * 60 + om) - (ih * 60 + im);
    if (workMinutes < 0) workMinutes += 24 * 60;
  }

  const { error } = await supabase.from('attendance').update({
    clock_out: clockOut, work_minutes: workMinutes,
    clock_out_lat: body.lat || null, clock_out_lng: body.lng || null
  }).eq('id', body.recordId);
  if (error) throw error;

  return { success: true, record: { id: body.recordId, clockOut, workMinutes } };
}

async function attUpdate(recordId, updates) {
  if (!recordId) return { error: 'recordIdが必要です' };
  const dbUpdates = {};
  if (updates.clockIn !== undefined) dbUpdates.clock_in = updates.clockIn;
  if (updates.clockOut !== undefined) dbUpdates.clock_out = updates.clockOut;
  if (updates.workMinutes !== undefined) dbUpdates.work_minutes = updates.workMinutes;
  if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
  if (updates.method !== undefined) dbUpdates.method = updates.method;
  const { error } = await supabase.from('attendance').update(dbUpdates).eq('id', recordId);
  if (error) throw error;
  return { success: true };
}

async function attDelete(recordId) {
  if (!recordId) return { error: 'recordIdが必要です' };
  const { error } = await supabase.from('attendance').delete().eq('id', recordId);
  if (error) throw error;
  return { success: true };
}

// ============================================================
// 勤怠QRトークン (qrToken)
// ============================================================

export async function qrTokenGet(params) {
  if (!params.store) return { error: 'storeが必要です' };

  const { data, error } = await supabase.from('qr_tokens').select('*')
    .eq('store_id', params.store).eq('used', false)
    .gte('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;

  if (!data) return { error: '有効なトークンがありません' };

  return {
    token: data.token, storeId: data.store_id,
    expiresAt: data.expires_at, valid: true
  };
}

export async function qrTokenPost(body) {
  const action = body.action || '';
  switch (action) {
    case 'generate': {
      if (!body.storeId) return { error: 'storeIdが必要です' };
      const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5分有効
      const { error } = await supabase.from('qr_tokens').insert({
        token, store_id: body.storeId, expires_at: expiresAt, used: false
      });
      if (error) throw error;
      return { token, storeId: body.storeId, expiresAt, valid: true };
    }
    case 'validate': {
      if (!body.token) return { error: 'tokenが必要です' };
      const { data, error } = await supabase.from('qr_tokens').select('*')
        .eq('token', body.token).maybeSingle();
      if (error) throw error;
      if (!data) return { valid: false, error: 'トークンが見つかりません' };
      if (data.used) return { valid: false, error: '使用済みトークンです' };
      if (new Date(data.expires_at) < new Date()) return { valid: false, error: 'トークンが期限切れです' };
      if (body.storeId && data.store_id !== body.storeId) return { valid: false, error: '店舗IDが一致しません' };

      // トークンを使用済みにする
      await supabase.from('qr_tokens').update({ used: true }).eq('token', body.token);
      return { valid: true };
    }
    default: return { error: '不明なaction: ' + action };
  }
}
