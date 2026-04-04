import { supabase } from './supabase.js';

// ============================================================
// 出納帳 (cashbook) + 出納帳ログ + 日次締め
// ============================================================

export async function cashbookGet(params) {
  let query = supabase.from('cashbook').select('*').order('date', { ascending: false });
  if (params.store) query = query.eq('store_id', params.store);
  if (params.month) {
    const [y, m] = params.month.split('-').map(Number);
    const start = `${params.month}-01`;
    const end = new Date(y, m, 0).toISOString().split('T')[0];
    query = query.gte('date', start).lte('date', end);
  }

  const { data, error } = await query;
  if (error) throw error;

  // 日次締めデータ
  let dcQuery = supabase.from('daily_close').select('*').order('date', { ascending: false });
  if (params.store) dcQuery = dcQuery.eq('store_id', params.store);
  const { data: dcData } = await dcQuery;

  // ログ
  let logs = [];
  if (params.includeLogs === 'true') {
    let logQuery = supabase.from('cashbook_log').select('*')
      .order('timestamp', { ascending: false }).limit(100);
    if (params.store) logQuery = logQuery.eq('store_id', params.store);
    const { data: logData } = await logQuery;
    logs = (logData || []).map(l => ({
      timestamp: l.timestamp, action: l.action, entryId: l.entry_id,
      storeId: l.store_id, operator: l.operator,
      before: l.before ? JSON.stringify(l.before) : '',
      after: l.after ? JSON.stringify(l.after) : ''
    }));
  }

  return {
    entries: (data || []).map(r => ({
      id: r.id, date: r.date, type: r.type, category: r.category || '',
      description: r.description || '', amount: r.amount,
      customerName: r.customer_name || '', therapyCount: r.treatment_count || 0,
      paymentMethod: r.payment_method, cashType: r.cash_type,
      memberId: r.member_id || '', store: r.store_id,
      recorder: r.recorder || '', notes: r.notes || '',
      createdAt: r.created_at, updatedAt: r.updated_at,
      updatedBy: r.updated_by || '', deleted: r.deleted
    })),
    dailyCloses: (dcData || []).map(d => ({
      date: d.date, storeId: d.store_id,
      safeBalance: d.safe_balance, pettyCashBalance: d.petty_balance,
      registerBalance: d.register_balance, closedBy: d.closed_by || '',
      closedAt: d.closed_at, notes: d.notes || '', locked: d.locked
    })),
    logs,
    lastUpdated: new Date().toISOString()
  };
}

export async function cashbookPost(body) {
  const action = body.action || '';
  switch (action) {
    case 'addEntry':      return cbAddEntry(body.entry || {}, body.operator || '');
    case 'updateEntry':   return cbUpdateEntry(body.entryId, body.updates || {}, body.operator || '');
    case 'deleteEntry':   return cbDeleteEntry(body.entryId, body.operator || '');
    case 'dailyClose':    return cbDailyClose(body);
    case 'getDailyCloses': return cbGetDailyCloses(body.store || '');
    case 'getLogs':       return cbGetLogs(body.store || '', body.limit || 100);
    case 'saveCashbook':  return cbSaveAll(body.entries || [], body.operator || '');
    default: return { error: '不明なaction: ' + action };
  }
}

async function cbAddEntry(entry, operator) {
  // 日次締めロック確認
  if (entry.store) {
    const { data: dc } = await supabase.from('daily_close')
      .select('locked').eq('date', entry.date).eq('store_id', entry.store).maybeSingle();
    if (dc && dc.locked) return { error: 'この日は締め済みです', closed: true };
  }

  const id = entry.id || ('cb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
  const row = {
    id, date: entry.date, type: entry.type || '', category: entry.category || '',
    description: entry.description || '', amount: entry.amount || 0,
    customer_name: entry.customerName || '', treatment_count: entry.therapyCount || 0,
    payment_method: entry.paymentMethod || 'CASH', cash_type: entry.cashType || 'register',
    member_id: entry.memberId || '', store_id: entry.store || '',
    recorder: entry.recorder || operator, notes: entry.notes || '',
    updated_by: operator, deleted: false
  };

  const { error } = await supabase.from('cashbook').insert(row);
  if (error) throw error;

  await cbLog('create', id, row.store_id, operator, null, row);
  return { success: true, entry: { ...row, id } };
}

async function cbUpdateEntry(entryId, updates, operator) {
  if (!entryId) return { error: 'entryIdが必要です' };

  const { data: before } = await supabase.from('cashbook').select('*').eq('id', entryId).single();
  if (!before) return { error: 'エントリが見つかりません' };
  if (before.deleted) return { error: '削除済みエントリです' };

  // ロック確認
  const { data: dc } = await supabase.from('daily_close')
    .select('locked').eq('date', before.date).eq('store_id', before.store_id).maybeSingle();
  if (dc && dc.locked) return { error: 'この日は締め済みです', closed: true };

  const dbUpdates = { updated_by: operator };
  if (updates.date !== undefined) dbUpdates.date = updates.date;
  if (updates.type !== undefined) dbUpdates.type = updates.type;
  if (updates.category !== undefined) dbUpdates.category = updates.category;
  if (updates.description !== undefined) dbUpdates.description = updates.description;
  if (updates.amount !== undefined) dbUpdates.amount = updates.amount;
  if (updates.customerName !== undefined) dbUpdates.customer_name = updates.customerName;
  if (updates.therapyCount !== undefined) dbUpdates.treatment_count = updates.therapyCount;
  if (updates.paymentMethod !== undefined) dbUpdates.payment_method = updates.paymentMethod;
  if (updates.cashType !== undefined) dbUpdates.cash_type = updates.cashType;
  if (updates.memberId !== undefined) dbUpdates.member_id = updates.memberId;
  if (updates.notes !== undefined) dbUpdates.notes = updates.notes;

  const { error } = await supabase.from('cashbook').update(dbUpdates).eq('id', entryId);
  if (error) throw error;

  await cbLog('update', entryId, before.store_id, operator, before, dbUpdates);
  return { success: true };
}

async function cbDeleteEntry(entryId, operator) {
  if (!entryId) return { error: 'entryIdが必要です' };

  const { data: before } = await supabase.from('cashbook').select('*').eq('id', entryId).single();
  if (!before) return { error: 'エントリが見つかりません' };

  const { data: dc } = await supabase.from('daily_close')
    .select('locked').eq('date', before.date).eq('store_id', before.store_id).maybeSingle();
  if (dc && dc.locked) return { error: 'この日は締め済みです', closed: true };

  const { error } = await supabase.from('cashbook')
    .update({ deleted: true, updated_by: operator }).eq('id', entryId);
  if (error) throw error;

  await cbLog('delete', entryId, before.store_id, operator, before, null);
  return { success: true };
}

async function cbDailyClose(body) {
  const { date, storeId, safeBalance, pettyCashBalance, registerBalance, closedBy, notes } = body;
  if (!date || !storeId) return { error: '日付と店舗IDが必要です' };

  const { data: existing } = await supabase.from('daily_close')
    .select('locked').eq('date', date).eq('store_id', storeId).maybeSingle();
  if (existing && existing.locked) return { error: 'この日は既に締め済みです', closed: true };

  const { error } = await supabase.from('daily_close').upsert({
    date, store_id: storeId,
    safe_balance: safeBalance || 0, petty_balance: pettyCashBalance || 0,
    register_balance: registerBalance || 0,
    closed_by: closedBy || '', closed_at: new Date().toISOString(),
    notes: notes || '', locked: true
  }, { onConflict: 'date,store_id' });
  if (error) throw error;

  return { success: true };
}

async function cbGetDailyCloses(store) {
  let query = supabase.from('daily_close').select('*').order('date', { ascending: false });
  if (store) query = query.eq('store_id', store);
  const { data, error } = await query;
  if (error) throw error;
  return {
    dailyCloses: (data || []).map(d => ({
      date: d.date, storeId: d.store_id,
      safeBalance: d.safe_balance, pettyCashBalance: d.petty_balance,
      registerBalance: d.register_balance, closedBy: d.closed_by || '',
      closedAt: d.closed_at, notes: d.notes || '', locked: d.locked
    }))
  };
}

async function cbGetLogs(store, limit) {
  let query = supabase.from('cashbook_log').select('*')
    .order('timestamp', { ascending: false }).limit(limit || 100);
  if (store) query = query.eq('store_id', store);
  const { data, error } = await query;
  if (error) throw error;
  return {
    logs: (data || []).map(l => ({
      timestamp: l.timestamp, action: l.action, entryId: l.entry_id,
      storeId: l.store_id, operator: l.operator,
      before: l.before ? JSON.stringify(l.before) : '',
      after: l.after ? JSON.stringify(l.after) : ''
    }))
  };
}

async function cbSaveAll(entries, operator) {
  const rows = entries.map(e => ({
    id: e.id || ('cb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
    date: e.date, type: e.type || '', category: e.category || '',
    description: e.description || '', amount: e.amount || 0,
    customer_name: e.customerName || '', treatment_count: e.therapyCount || 0,
    payment_method: e.paymentMethod || 'CASH', cash_type: e.cashType || 'register',
    member_id: e.memberId || '', store_id: e.store || '',
    recorder: e.recorder || operator, notes: e.notes || '',
    updated_by: operator, deleted: !!e.deleted
  }));
  if (rows.length > 0) {
    const { error } = await supabase.from('cashbook').upsert(rows, { onConflict: 'id' });
    if (error) throw error;
  }
  return { success: true };
}

async function cbLog(action, entryId, storeId, operator, before, after) {
  try {
    await supabase.from('cashbook_log').insert({
      action, entry_id: entryId, store_id: storeId || '',
      operator: operator || '', before: before || null, after: after || null
    });
  } catch (e) {
    console.error('cashbook_log insert error:', e);
  }
}
