import { supabase } from './supabase.js';
import { canAccessStore, allowedStoreIds } from './auth.js';
import { resolveStoreId } from './stores.js';

// ============================================================
// 出納帳 (cashbook) + 出納帳ログ + 日次締め
// ============================================================

export async function cashbookGet(params, staffCtx) {
  // スタッフモード: 明示 params.store が無い場合でも staffCtx.storeIds に
  // 自動フィルタを掛け、権限外の店舗行を返さない。
  // 明示 params.store がある場合は権限チェック後に通す。
  const scoped = allowedStoreIds(staffCtx); // null=admin / [] or storeIds
  if (params.store) {
    if (scoped !== null && !scoped.includes(params.store)) {
      return { error: 'この店舗の出納帳にアクセスする権限がありません' };
    }
  }

  let query = supabase.from('cashbook').select('*').order('date', { ascending: false });
  if (params.store) query = query.eq('store_id', params.store);
  else if (scoped !== null) {
    if (scoped.length === 0) return { entries: [], dailyCloses: [], logs: [], lastUpdated: new Date().toISOString() };
    query = query.in('store_id', scoped);
  }
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
  else if (scoped !== null && scoped.length > 0) dcQuery = dcQuery.in('store_id', scoped);
  const { data: dcData } = await dcQuery;

  // ログ
  let logs = [];
  if (params.includeLogs === 'true') {
    let logQuery = supabase.from('cashbook_log').select('*')
      .order('timestamp', { ascending: false }).limit(100);
    if (params.store) logQuery = logQuery.eq('store_id', params.store);
    else if (scoped !== null && scoped.length > 0) logQuery = logQuery.in('store_id', scoped);
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
      customerName: r.customer_name || '',
      treatmentCount: r.treatment_count || 0,
      therapyCount: r.treatment_count || 0,
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

export async function cashbookPost(body, staffCtx) {
  const action = body.action || '';
  switch (action) {
    case 'addEntry':      return cbAddEntry(body.entry || {}, body.operator || '', staffCtx);
    case 'updateEntry':   return cbUpdateEntry(body.entryId, body.updates || {}, body.operator || '', staffCtx);
    case 'deleteEntry':   return cbDeleteEntry(body.entryId, body.operator || '', staffCtx);
    case 'dailyClose':    return cbDailyClose(body, staffCtx);
    default: return { error: '不明なaction: ' + action };
  }
}

async function cbAddEntry(entry, operator, staffCtx) {
  // 店舗ID必須チェック（FK制約対応）
  if (!entry.store) return { error: '店舗IDが必要です' };

  // スタッフ権限: 対象店舗にアクセス権があるか
  if (!canAccessStore(staffCtx, entry.store)) {
    return { error: 'この店舗への記帳権限がありません' };
  }

  // 重複統合 (merged_into) を解決して正規IDへ寄せる。
  // 旧IDのスタッフURLからの記帳でも、新規データは統合先の正規行に集約。
  const canonicalStoreId = await resolveStoreId(entry.store);

  // 日次締めロック確認
  if (canonicalStoreId) {
    const { data: dc } = await supabase.from('daily_close')
      .select('locked').eq('date', entry.date).eq('store_id', canonicalStoreId).maybeSingle();
    if (dc && dc.locked) return { error: 'この日は締め済みです', closed: true };
  }

  const id = entry.id || ('cb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5));
  const row = {
    id, date: entry.date, type: entry.type || '', category: entry.category || '',
    description: entry.description || '', amount: parseInt(entry.amount) || 0,
    customer_name: entry.customerName || '',
    treatment_count: parseInt(entry.treatmentCount ?? entry.therapyCount) || 0,
    payment_method: entry.paymentMethod || 'CASH', cash_type: entry.cashType || 'register',
    member_id: entry.memberId || '', store_id: canonicalStoreId,
    recorder: entry.recorder || operator, notes: entry.notes || '',
    updated_by: operator, deleted: false
  };

  const { error } = await supabase.from('cashbook').insert(row);
  if (error) {
    if (error.code === '23503') return { error: '指定された店舗IDが存在しません: ' + entry.store };
    throw error;
  }

  await cbLog('create', id, row.store_id, operator, null, row);
  return { success: true, entry: { ...row, id } };
}

async function cbUpdateEntry(entryId, updates, operator, staffCtx) {
  if (!entryId) return { error: 'entryIdが必要です' };

  const { data: before } = await supabase.from('cashbook').select('*').eq('id', entryId).single();
  if (!before) return { error: 'エントリが見つかりません' };
  if (before.deleted) return { error: '削除済みエントリです' };

  // スタッフ権限: 既存レコードの店舗にアクセス権があるか + 変更後の店舗にも権限があるか
  if (!canAccessStore(staffCtx, before.store_id)) {
    return { error: 'この店舗のエントリを編集する権限がありません' };
  }
  if (updates.store !== undefined && !canAccessStore(staffCtx, updates.store)) {
    return { error: '変更先の店舗にアクセス権限がありません' };
  }

  // ロック確認
  const { data: dc } = await supabase.from('daily_close')
    .select('locked').eq('date', before.date).eq('store_id', before.store_id).maybeSingle();
  if (dc && dc.locked) return { error: 'この日は締め済みです', closed: true };

  const dbUpdates = { updated_by: operator };
  if (updates.date !== undefined) dbUpdates.date = updates.date;
  if (updates.type !== undefined) dbUpdates.type = updates.type;
  if (updates.category !== undefined) dbUpdates.category = updates.category;
  if (updates.description !== undefined) dbUpdates.description = updates.description;
  if (updates.amount !== undefined) dbUpdates.amount = parseInt(updates.amount) || 0;
  if (updates.customerName !== undefined) dbUpdates.customer_name = updates.customerName;
  if (updates.treatmentCount !== undefined) dbUpdates.treatment_count = parseInt(updates.treatmentCount) || 0;
  else if (updates.therapyCount !== undefined) dbUpdates.treatment_count = parseInt(updates.therapyCount) || 0;
  if (updates.paymentMethod !== undefined) dbUpdates.payment_method = updates.paymentMethod;
  if (updates.cashType !== undefined) dbUpdates.cash_type = updates.cashType;
  if (updates.memberId !== undefined) dbUpdates.member_id = updates.memberId;
  if (updates.notes !== undefined) dbUpdates.notes = updates.notes;
  if (updates.store !== undefined) {
    // 重複統合先 (merged_into) があれば正規IDへ寄せる
    dbUpdates.store_id = await resolveStoreId(updates.store);
  }

  const { error } = await supabase.from('cashbook').update(dbUpdates).eq('id', entryId);
  if (error) throw error;

  await cbLog('update', entryId, before.store_id, operator, before, dbUpdates);
  return { success: true };
}

async function cbDeleteEntry(entryId, operator, staffCtx) {
  if (!entryId) return { error: 'entryIdが必要です' };

  const { data: before } = await supabase.from('cashbook').select('*').eq('id', entryId).single();
  if (!before) return { error: 'エントリが見つかりません' };

  if (!canAccessStore(staffCtx, before.store_id)) {
    return { error: 'この店舗のエントリを削除する権限がありません' };
  }

  const { data: dc } = await supabase.from('daily_close')
    .select('locked').eq('date', before.date).eq('store_id', before.store_id).maybeSingle();
  if (dc && dc.locked) return { error: 'この日は締め済みです', closed: true };

  const { error } = await supabase.from('cashbook')
    .update({ deleted: true, updated_by: operator }).eq('id', entryId);
  if (error) throw error;

  await cbLog('delete', entryId, before.store_id, operator, before, null);
  return { success: true };
}

async function cbDailyClose(body, staffCtx) {
  const { date, storeId, safeBalance, pettyCashBalance, registerBalance, closedBy, notes } = body;
  if (!date || !storeId) return { error: '日付と店舗IDが必要です' };

  if (!canAccessStore(staffCtx, storeId)) {
    return { error: 'この店舗の日次締めを行う権限がありません' };
  }

  // 重複統合先を解決
  const canonicalStoreId = await resolveStoreId(storeId);

  const { data: existing } = await supabase.from('daily_close')
    .select('locked').eq('date', date).eq('store_id', canonicalStoreId).maybeSingle();
  if (existing && existing.locked) return { error: 'この日は既に締め済みです', closed: true };

  const { error } = await supabase.from('daily_close').upsert({
    date, store_id: canonicalStoreId,
    safe_balance: safeBalance || 0, petty_balance: pettyCashBalance || 0,
    register_balance: registerBalance || 0,
    closed_by: closedBy || '', closed_at: new Date().toISOString(),
    notes: notes || '', locked: true
  }, { onConflict: 'date,store_id' });
  if (error) throw error;

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
