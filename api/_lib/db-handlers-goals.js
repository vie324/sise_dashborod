import { supabase } from './supabase.js';
import { isAdminOrHeadquarter } from './auth.js';

// ============================================================
// 目標 (goals)
// ------------------------------------------------------------
// 月ごとの目標を dash_config の 'goals.YYYY-MM' に 1 行で保存する
// （テーブル追加のマイグレーション不要）。
//   { stores: { [storeId]: Goal }, staff: { [staffId]: Goal }, updatedAt, updatedBy }
//   Goal = { consumedSales?, treatmentCount?, newVisits?, contractRatePct?, memberCount?, memo?, updatedAt, updatedBy }
// 権限:
//   管理者・本部   … すべて閲覧・設定
//   店舗責任者     … 所属店舗とそのスタッフの目標を閲覧・設定
//   スタッフ       … 所属店舗の目標を閲覧、自分の目標を閲覧・設定
// ============================================================

const NUMERIC_FIELDS = ['consumedSales', 'treatmentCount', 'newVisits', 'contractRatePct', 'memberCount'];
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const keyOf = (month) => `goals.${month}`;

async function readGoals(month) {
  const { data, error } = await supabase.from('dash_config').select('value').eq('key', keyOf(month)).maybeSingle();
  if (error) throw error;
  const v = (data && data.value) || {};
  return { stores: v.stores || {}, staff: v.staff || {}, updatedAt: v.updatedAt || null, updatedBy: v.updatedBy || '' };
}

async function writeGoals(month, doc) {
  const { error } = await supabase.from('dash_config').upsert({ key: keyOf(month), value: doc }, { onConflict: 'key' });
  if (error) throw error;
}

async function staffStoreIds(staffIds) {
  if (staffIds.length === 0) return new Map();
  const { data, error } = await supabase.from('staff_stores').select('staff_id, store_id').in('staff_id', staffIds);
  if (error) throw error;
  const map = new Map();
  for (const r of data || []) {
    const list = map.get(r.staff_id) || [];
    list.push(String(r.store_id));
    map.set(r.staff_id, list);
  }
  return map;
}

function sanitizeGoal(values) {
  const out = {};
  for (const f of NUMERIC_FIELDS) {
    const raw = values ? values[f] : undefined;
    if (raw === undefined || raw === null || raw === '') continue;
    const num = Number(String(raw).replace(/[,，円%％\s]/g, ''));
    if (!Number.isFinite(num) || num < 0) continue;
    out[f] = f === 'contractRatePct' ? Math.min(100, Math.round(num * 10) / 10) : Math.round(num);
  }
  if (values && typeof values.memo === 'string' && values.memo.trim()) out.memo = values.memo.trim().slice(0, 200);
  return out;
}

/** 閲覧できる範囲に絞る */
async function filterForViewer(doc, staffCtx) {
  if (isAdminOrHeadquarter(staffCtx)) return doc;
  const myStores = new Set((staffCtx.storeIds || []).map(String));
  const stores = Object.fromEntries(Object.entries(doc.stores).filter(([id]) => myStores.has(id)));
  let staff = {};
  if (staffCtx.role === 'manager') {
    const ids = Object.keys(doc.staff);
    const map = await staffStoreIds(ids);
    staff = Object.fromEntries(Object.entries(doc.staff).filter(([id]) =>
      id === staffCtx.staffId || (map.get(id) || []).some((s) => myStores.has(s))));
  } else if (doc.staff[staffCtx.staffId]) {
    staff = { [staffCtx.staffId]: doc.staff[staffCtx.staffId] };
  }
  return { ...doc, stores, staff };
}

async function canEdit(staffCtx, scope, targetId) {
  if (isAdminOrHeadquarter(staffCtx)) return true;
  const myStores = new Set((staffCtx.storeIds || []).map(String));
  if (scope === 'store') return staffCtx.role === 'manager' && myStores.has(String(targetId));
  if (scope === 'staff') {
    if (targetId === staffCtx.staffId) return true;
    if (staffCtx.role !== 'manager') return false;
    const map = await staffStoreIds([targetId]);
    return (map.get(targetId) || []).some((s) => myStores.has(s));
  }
  return false;
}

export async function goalsGet(params, staffCtx) {
  const month = String(params.month || '');
  if (!MONTH_RE.test(month)) return { error: 'month (YYYY-MM) が必要です' };
  const doc = await readGoals(month);
  return { month, ...(await filterForViewer(doc, staffCtx)) };
}

export async function goalsPost(body, staffCtx) {
  const action = body.action || 'set';
  const month = String(body.month || '');
  if (!MONTH_RE.test(month)) return { error: 'month (YYYY-MM) が必要です' };
  const operator = staffCtx ? (staffCtx.name || staffCtx.staffId) : '管理者';

  switch (action) {
    case 'set': {
      const scope = body.scope === 'staff' ? 'staff' : body.scope === 'store' ? 'store' : '';
      const targetId = String(body.targetId || '');
      if (!scope || !targetId) return { error: 'scope と targetId が必要です' };
      if (!(await canEdit(staffCtx, scope, targetId))) return { error: 'この目標を設定する権限がありません' };
      const doc = await readGoals(month);
      const bucket = scope === 'store' ? doc.stores : doc.staff;
      const goal = sanitizeGoal(body.values || {});
      if (Object.keys(goal).length === 0) delete bucket[targetId];
      else bucket[targetId] = { ...goal, updatedAt: new Date().toISOString(), updatedBy: operator };
      doc.updatedAt = new Date().toISOString();
      doc.updatedBy = operator;
      await writeGoals(month, doc);
      return { success: true, month, scope, targetId, goal: bucket[targetId] || null };
    }
    case 'copyFrom': {
      // 前月などの目標を、まだ設定されていない対象にだけコピーする
      const fromMonth = String(body.fromMonth || '');
      if (!MONTH_RE.test(fromMonth)) return { error: 'fromMonth (YYYY-MM) が必要です' };
      const src = await filterForViewer(await readGoals(fromMonth), staffCtx);
      const doc = await readGoals(month);
      let copied = 0;
      for (const [scope, bucketKey] of [['store', 'stores'], ['staff', 'staff']]) {
        for (const [id, goal] of Object.entries(src[bucketKey])) {
          if (doc[bucketKey][id]) continue;
          if (!(await canEdit(staffCtx, scope, id))) continue;
          doc[bucketKey][id] = { ...sanitizeGoal(goal), updatedAt: new Date().toISOString(), updatedBy: operator };
          copied += 1;
        }
      }
      if (copied > 0) {
        doc.updatedAt = new Date().toISOString();
        doc.updatedBy = operator;
        await writeGoals(month, doc);
      }
      return { success: true, copied };
    }
    default: return { error: '不明なaction: ' + action };
  }
}
