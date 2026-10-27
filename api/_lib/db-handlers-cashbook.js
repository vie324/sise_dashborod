import { supabase } from './supabase.js';
import { canAccessStore, allowedStoreIds, isAdminOrOwner } from './auth.js';
import { resolveStoreId } from './stores.js';
import { dailyCashSales, AccessError } from './salonone/summary.js';
import { SalonOneError } from './salonone/client.js';
import { SALES_CATEGORIES, SALONONE_CASH_CATEGORY, salonOneCashEntryId, isSalonOneCashEntry } from '../../shared/cashbook.js';
import { isDate, monthOf } from '../../shared/dates.js';

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

  // 論理削除済み（deleted=true）は返さない。以前は返していたため、削除した記録が
  // 次の同期で復活し、現金残高の計算にも含まれていた。
  let query = supabase.from('cashbook').select('*').eq('deleted', false).order('date', { ascending: false });
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
    case 'importSalonOneCash': return cbImportSalonOneCash(body, staffCtx);
    case 'getDailyCloses':
      if (body.store && !canAccessStore(staffCtx, body.store)) return { error: 'この店舗にアクセスする権限がありません' };
      if (!body.store && !isAdminOrOwner(staffCtx)) return { error: '店舗を指定してください' };
      return cbGetDailyCloses(body.store || '', staffCtx);
    case 'getLogs':
      if (body.store && !canAccessStore(staffCtx, body.store)) return { error: 'この店舗にアクセスする権限がありません' };
      if (!body.store && !isAdminOrOwner(staffCtx)) return { error: '店舗を指定してください' };
      return cbGetLogs(body.store || '', body.limit || 100, staffCtx);
    // 一括保存はデータ移行用。管理者・本部のみ
    case 'saveCashbook':
      if (!isAdminOrOwner(staffCtx)) return { error: '権限がありません（管理者・オーナーのみ）' };
      return cbSaveAll(body.entries || [], body.operator || '', staffCtx);
    case 'saveDailyCloses':
      if (!isAdminOrOwner(staffCtx)) return { error: '権限がありません（管理者・オーナーのみ）' };
      return cbSaveDailyCloses(body.dailyCloses || [], staffCtx);
    default: return { error: '不明なaction: ' + action };
  }
}

async function cbSaveDailyCloses(closes) {
  const rows = closes.map(c => ({
    date: c.date, store_id: c.storeId,
    safe_balance: c.safeBalance || 0,
    petty_balance: c.pettyCashBalance || 0,
    register_balance: c.registerBalance || 0,
    closed_by: c.closedBy || '',
    closed_at: c.closedAt || new Date().toISOString(),
    notes: c.notes || '',
    locked: c.locked !== undefined ? !!c.locked : true
  }));
  if (rows.length > 0) {
    const { error } = await supabase.from('daily_close').upsert(rows, { onConflict: 'date,store_id' });
    if (error) throw error;
  }
  return { success: true, count: rows.length };
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

  const closeRow = {
    date, store_id: canonicalStoreId,
    safe_balance: safeBalance || 0, petty_balance: pettyCashBalance || 0,
    register_balance: registerBalance || 0,
    closed_by: closedBy || '', closed_at: new Date().toISOString(),
    notes: notes || '', locked: true
  };
  const { error } = await supabase.from('daily_close').upsert(closeRow, { onConflict: 'date,store_id' });
  if (error) throw error;

  await cbLog('dailyClose', `close_${canonicalStoreId}_${date}`, canonicalStoreId, closedBy || '', null, closeRow);
  return { success: true };
}

// ------------------------------------------------------------
// SalonOne の現金売上を出納帳へ取り込む
// ------------------------------------------------------------
// 店舗・日ごとに 1件の入金（レジ・現金・施術売上）として記録する。ID は店舗と日付から
// 決まるので、同じ日を何度取り込んでも 1件にまとまり、SalonOne 側の金額が変われば更新する。
// 次の日は取り込まない（記録はそのまま残し、理由を返す）:
//   - SalonOne の集計日より後 / 締め済み
//   - 手入力の現金売上がある（二重計上になるため。手入力を消してから取り込み直す）
const MAX_IMPORT_DAYS = 62;

async function cbImportSalonOneCash(body, staffCtx) {
  const storeId = body.storeId ? String(body.storeId) : '';
  const dates = Array.isArray(body.dates) ? [...new Set(body.dates.map(String))] : [];
  const operator = body.operator || '';
  if (!storeId || dates.length === 0) return { error: '店舗と日付が必要です' };
  if (dates.length > MAX_IMPORT_DAYS) return { error: `一度に取り込めるのは ${MAX_IMPORT_DAYS}日分までです` };
  if (!dates.every(isDate)) return { error: '日付の形式が正しくありません' };
  if (!canAccessStore(staffCtx, storeId)) return { error: 'この店舗への記帳権限がありません' };

  let cash;
  try {
    // 取り込む金額は常に SalonOne から読み直す（当月・前月。画面に出ていた金額が数分前のものでも、最新で記録する）。
    // 受付履歴だけを取るので、1ヶ月あたり 1回の呼び出しで済む
    cash = await dailyCashSales(staffCtx, { storeId, months: [...new Set(dates.map(monthOf))].sort(), refresh: true });
  } catch (e) {
    if (e instanceof AccessError) return { error: e.message };
    if (e instanceof SalonOneError) return { error: `SalonOne のデータを取得できませんでした: ${e.message}` };
    throw e;
  }
  // デモデータを実際の出納帳へ書き込まない
  if (cash.mode !== 'live') return { error: 'SalonOne が未接続のため取り込めません（デモデータは取り込みません）', demo: true };
  if (!cash.linked) return { error: 'この店舗は SalonOne の店舗と対応付けされていません（設定 > SalonOne連携）' };

  const canonical = await resolveStoreId(storeId);
  const results = [];
  for (const date of dates.sort()) {
    const amount = Math.max(0, Math.round(cash.days[date] || 0));
    if (date > cash.asOf) { results.push({ date, status: 'pending' }); continue; }

    const { data: dc } = await supabase.from('daily_close')
      .select('locked').eq('date', date).eq('store_id', canonical).maybeSingle();
    if (dc && dc.locked) { results.push({ date, status: 'closed' }); continue; }

    const { data: sameDay, error: dayErr } = await supabase.from('cashbook')
      .select('id, type, category, payment_method, amount')
      .eq('store_id', canonical).eq('date', date).eq('deleted', false);
    if (dayErr) throw dayErr;
    const manual = (sameDay || []).filter((r) => r.type === 'income' && (r.payment_method || 'CASH') === 'CASH'
      && SALES_CATEGORIES.includes(r.category) && !isSalonOneCashEntry(r));
    const manualAmount = manual.reduce((a, r) => a + (parseInt(r.amount) || 0), 0);
    if (manual.length > 0) { results.push({ date, status: 'manual', amount, manualAmount }); continue; }

    const id = salonOneCashEntryId(canonical, date);
    const { data: existing } = await supabase.from('cashbook').select('*').eq('id', id).maybeSingle();
    if (existing && !existing.deleted && (parseInt(existing.amount) || 0) === amount) {
      results.push({ date, status: 'unchanged', amount });
      continue;
    }
    if (amount === 0) {
      // SalonOne 側で現金の会計が取り消された日は、取り込んだ記録も外す
      if (existing && !existing.deleted) {
        const { error } = await supabase.from('cashbook').update({ deleted: true, updated_by: operator }).eq('id', id);
        if (error) throw error;
        await cbLog('delete', id, canonical, operator, existing, null);
        results.push({ date, status: 'removed', amount: 0 });
      } else {
        results.push({ date, status: 'zero', amount: 0 });
      }
      continue;
    }
    const fields = {
      date, type: 'income', category: SALONONE_CASH_CATEGORY,
      description: 'SalonOne 現金売上（自動取り込み）', amount,
      customer_name: '', treatment_count: 0,
      payment_method: 'CASH', cash_type: 'register', member_id: '', store_id: canonical,
      recorder: 'SalonOne', notes: '', updated_by: operator, deleted: false,
    };
    if (existing) {
      const { error } = await supabase.from('cashbook').update(fields).eq('id', id);
      if (error) throw error;
      await cbLog('update', id, canonical, operator, existing, fields);
      results.push({ date, status: existing.deleted ? 'imported' : 'updated', amount, previous: existing.deleted ? null : parseInt(existing.amount) || 0 });
    } else {
      const { error } = await supabase.from('cashbook').insert({ id, ...fields });
      // 同じ日を同時に取り込んだ（締めの二度押しなど）時は、先に入った方を正とする
      if (error && error.code === '23505') { results.push({ date, status: 'unchanged', amount }); continue; }
      if (error) throw error;
      await cbLog('create', id, canonical, operator, null, { id, ...fields });
      results.push({ date, status: 'imported', amount });
    }
  }
  return { success: true, asOf: cash.asOf, results };
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
