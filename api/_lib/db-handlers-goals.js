import { supabase } from './supabase.js';
import { isAdminOrOwner } from './auth.js';
import { isStoreManagerRole } from '../../shared/roles.js';
import { isQuarterStart, quarterMonths, todayJst, monthOf, monthsBetween } from '../../shared/dates.js';
import { SPECIAL_METRICS, defaultSpecialTitle } from '../../shared/goal-plan.js';

// ============================================================
// 目標 (goals)
// ------------------------------------------------------------
// dash_config に 1 行ずつ保存する（テーブル追加のマイグレーション不要）。
//   単月     'goals.YYYY-MM'
//   3ヶ月    'goals.q.YYYY-MM'（期の最初の月。1〜3月・4〜6月・7〜9月・10〜12月）
//            どちらも { stores: { [storeId]: Goal }, staff: { [staffId]: Goal }, updatedAt, updatedBy }
//            Goal = { consumedSales?, depositSales?, treatmentCount?, newVisits?, contractRatePct?, memberCount?, memo?, updatedAt, updatedBy }
//            depositSales は入金売上（SalonOne の売上分析の入金売上）
//            3ヶ月の consumedSales・depositSales・newVisits は 3ヶ月の合計、memberCount は期末の人数
//   特別目標 'goals.special' = { items: [SpecialGoal] }
//            SpecialGoal = { id, storeId, title, metric, target, deadline, startMonth, memo, createdAt, createdBy, updatedAt, updatedBy }
//            「12月までに月売上100万円！」のような、1店舗だけの期限付きの目標
// 権限:
//   管理者・オーナー … すべて閲覧・設定。特別目標の設定・削除はこの 2つだけ
//   店長・マネージャー … 所属（管轄）店舗とそのスタッフの単月・3ヶ月の目標を閲覧・設定
//   スタッフ       … 所属店舗の目標を閲覧、自分の単月・3ヶ月の目標を閲覧・設定
//   特別目標は、その店舗を見られる人が閲覧できる
// ============================================================

const NUMERIC_FIELDS = ['consumedSales', 'depositSales', 'treatmentCount', 'newVisits', 'contractRatePct', 'memberCount'];
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const SPECIAL_KEY = 'goals.special';
const SPECIAL_MAX = 100;
const keyOf = (period, month) => (period === 'quarter' ? `goals.q.${month}` : `goals.${month}`);
const periodOf = (v) => (v === 'quarter' ? 'quarter' : 'month');

/** 期間の指定が正しくなければエラー文を返す */
function periodError(period, month, field = 'month') {
  if (!MONTH_RE.test(month)) return `${field} (YYYY-MM) が必要です`;
  if (period === 'quarter' && !isQuarterStart(month)) return `${field} は 3ヶ月の期の最初の月（1・4・7・10月）にしてください`;
  return null;
}

async function readConfig(key) {
  const { data, error } = await supabase.from('dash_config').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  return (data && data.value) || {};
}

async function writeConfig(key, value) {
  const { error } = await supabase.from('dash_config').upsert({ key, value }, { onConflict: 'key' });
  if (error) throw error;
}

async function readGoals(period, month) {
  const v = await readConfig(keyOf(period, month));
  return { stores: v.stores || {}, staff: v.staff || {}, updatedAt: v.updatedAt || null, updatedBy: v.updatedBy || '' };
}

const writeGoals = (period, month, doc) => writeConfig(keyOf(period, month), doc);

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
  if (isAdminOrOwner(staffCtx)) return doc;
  const myStores = new Set((staffCtx.storeIds || []).map(String));
  const stores = Object.fromEntries(Object.entries(doc.stores).filter(([id]) => myStores.has(id)));
  let staff = {};
  if (isStoreManagerRole(staffCtx.role)) {
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
  if (isAdminOrOwner(staffCtx)) return true;
  const myStores = new Set((staffCtx.storeIds || []).map(String));
  if (scope === 'store') return isStoreManagerRole(staffCtx.role) && myStores.has(String(targetId));
  if (scope === 'staff') {
    if (targetId === staffCtx.staffId) return true;
    if (!isStoreManagerRole(staffCtx.role)) return false;
    const map = await staffStoreIds([targetId]);
    return (map.get(targetId) || []).some((s) => myStores.has(s));
  }
  return false;
}

// ------------------------------------------------------------
// 3ヶ月の目標を単月に振り分ける
// ------------------------------------------------------------
/** 3ヶ月の目標の index 月目（0〜2）。合計は 1,000円・1名単位で割り、端数は 3ヶ月目に */
function splitGoal(goal, index) {
  const out = {};
  const split = (total, unit) => {
    const each = Math.floor(total / 3 / unit) * unit;
    return index < 2 ? each : total - each * 2;
  };
  for (const [field, unit] of [['consumedSales', 1000], ['depositSales', 1000], ['treatmentCount', 1], ['newVisits', 1]]) {
    const v = goal[field] ? split(goal[field], unit) : 0;
    if (v > 0) out[field] = v;
  }
  if (goal.contractRatePct) out.contractRatePct = goal.contractRatePct;
  if (goal.memberCount && index === 2) out.memberCount = goal.memberCount; // 期末の人数は 3ヶ月目の目標
  if (goal.memo) out.memo = goal.memo;
  return out;
}

async function splitQuarter(start, staffCtx, operator) {
  const src = await filterForViewer(await readGoals('quarter', start), staffCtx);
  let filled = 0;
  let skipped = 0;
  const months = quarterMonths(start);
  for (let i = 0; i < months.length; i++) {
    const doc = await readGoals('month', months[i]);
    let changed = false;
    for (const [scope, bucketKey] of [['store', 'stores'], ['staff', 'staff']]) {
      for (const [id, goal] of Object.entries(src[bucketKey])) {
        if (doc[bucketKey][id]) { skipped += 1; continue; } // 決めてある単月の目標は上書きしない
        if (!(await canEdit(staffCtx, scope, id))) continue;
        const values = sanitizeGoal(splitGoal(goal, i));
        if (Object.keys(values).length === 0) continue;
        doc[bucketKey][id] = { ...values, updatedAt: new Date().toISOString(), updatedBy: operator };
        filled += 1;
        changed = true;
      }
    }
    if (changed) {
      doc.updatedAt = new Date().toISOString();
      doc.updatedBy = operator;
      await writeGoals('month', months[i], doc);
    }
  }
  return { success: true, filled, skipped };
}

// ------------------------------------------------------------
// 特別目標
// ------------------------------------------------------------
const SPECIAL_METRIC_KEYS = new Set(SPECIAL_METRICS.map((m) => m.key));

async function readSpecial() {
  const v = await readConfig(SPECIAL_KEY);
  return Array.isArray(v.items) ? v.items : [];
}

function filterSpecialForViewer(items, staffCtx) {
  if (isAdminOrOwner(staffCtx)) return items;
  const myStores = new Set((staffCtx.storeIds || []).map(String));
  return items.filter((g) => myStores.has(String(g.storeId)));
}

async function activeStoreExists(storeId) {
  const { data, error } = await supabase.from('stores').select('id, status, merged_into').eq('id', storeId).maybeSingle();
  if (error) throw error;
  return !!data && data.status !== 'inactive' && !data.merged_into;
}

const newSpecialId = () => `sg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

async function specialSet(input, operator) {
  const items = await readSpecial();
  const id = input.id ? String(input.id) : '';
  const existing = id ? items.find((g) => g.id === id) : null;
  if (id && !existing) return { error: '特別目標が見つかりません（削除された可能性があります）' };

  const storeId = String(input.storeId || (existing && existing.storeId) || '');
  if (!storeId) return { error: '店舗を選んでください' };
  if ((!existing || existing.storeId !== storeId) && !(await activeStoreExists(storeId))) return { error: 'この店舗は登録されていません' };
  const metric = String(input.metric || (existing && existing.metric) || '');
  if (!SPECIAL_METRIC_KEYS.has(metric)) return { error: '目標にする指標が正しくありません' };
  const target = Math.round(Number(String(input.target ?? '').replace(/[,，円名\s]/g, '')));
  if (!Number.isFinite(target) || target <= 0 || target >= 1e10) return { error: '目標の値を正しく入力してください' };
  const deadline = String(input.deadline || '');
  if (!MONTH_RE.test(deadline)) return { error: '期限の月 (YYYY-MM) が必要です' };
  const currentMonth = monthOf(todayJst());
  if (monthsBetween(currentMonth, deadline) < 0 && (!existing || existing.deadline !== deadline)) return { error: '期限は今月以降にしてください' };

  const now = new Date().toISOString();
  const title = String(input.title || '').trim().slice(0, 60) || defaultSpecialTitle(metric, target, deadline, currentMonth);
  const memo = typeof input.memo === 'string' ? input.memo.trim().slice(0, 200) : '';
  const goal = {
    id: existing ? existing.id : newSpecialId(),
    storeId,
    title,
    metric,
    target,
    deadline,
    startMonth: existing ? existing.startMonth : currentMonth,
    memo,
    createdAt: existing ? existing.createdAt : now,
    createdBy: existing ? existing.createdBy : operator,
    updatedAt: now,
    updatedBy: operator,
  };
  if (existing) items[items.indexOf(existing)] = goal;
  else {
    if (items.length >= SPECIAL_MAX) return { error: `特別目標は ${SPECIAL_MAX}件までです。終わった目標を削除してください` };
    items.push(goal);
  }
  await writeConfig(SPECIAL_KEY, { items, updatedAt: now, updatedBy: operator });
  return { success: true, goal };
}

async function specialDelete(id, operator) {
  const items = await readSpecial();
  const next = items.filter((g) => g.id !== String(id || ''));
  if (next.length === items.length) return { error: '特別目標が見つかりません' };
  await writeConfig(SPECIAL_KEY, { items: next, updatedAt: new Date().toISOString(), updatedBy: operator });
  return { success: true, id };
}

// ------------------------------------------------------------
// ハンドラ
// ------------------------------------------------------------
export async function goalsGet(params, staffCtx) {
  if (params.period === 'special') {
    return { items: filterSpecialForViewer(await readSpecial(), staffCtx) };
  }
  const period = periodOf(params.period);
  const month = String(params.month || '');
  const err = periodError(period, month);
  if (err) return { error: err };
  const doc = await readGoals(period, month);
  return { period, month, ...(await filterForViewer(doc, staffCtx)) };
}

export async function goalsPost(body, staffCtx) {
  const action = body.action || 'set';
  const operator = staffCtx ? (staffCtx.name || staffCtx.staffId) : '管理者';

  if (action === 'specialSet' || action === 'specialDelete') {
    if (!isAdminOrOwner(staffCtx)) return { error: '特別目標を設定できるのはオーナーのみです' };
    return action === 'specialSet' ? specialSet(body.goal || {}, operator) : specialDelete(body.id, operator);
  }

  const period = periodOf(body.period);
  const month = String(body.month || '');
  const err = periodError(period, month);
  if (err) return { error: err };

  switch (action) {
    case 'set': {
      const scope = body.scope === 'staff' ? 'staff' : body.scope === 'store' ? 'store' : '';
      const targetId = String(body.targetId || '');
      if (!scope || !targetId) return { error: 'scope と targetId が必要です' };
      if (!(await canEdit(staffCtx, scope, targetId))) return { error: 'この目標を設定する権限がありません' };
      const doc = await readGoals(period, month);
      const bucket = scope === 'store' ? doc.stores : doc.staff;
      const goal = sanitizeGoal(body.values || {});
      if (Object.keys(goal).length === 0) delete bucket[targetId];
      else bucket[targetId] = { ...goal, updatedAt: new Date().toISOString(), updatedBy: operator };
      doc.updatedAt = new Date().toISOString();
      doc.updatedBy = operator;
      await writeGoals(period, month, doc);
      return { success: true, period, month, scope, targetId, goal: bucket[targetId] || null };
    }
    case 'copyFrom': {
      // 前月（前の期）などの目標を、まだ設定されていない対象にだけコピーする
      const fromMonth = String(body.fromMonth || '');
      const fromErr = periodError(period, fromMonth, 'fromMonth');
      if (fromErr) return { error: fromErr };
      const src = await filterForViewer(await readGoals(period, fromMonth), staffCtx);
      const doc = await readGoals(period, month);
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
        await writeGoals(period, month, doc);
      }
      return { success: true, copied };
    }
    case 'splitQuarter': {
      if (period !== 'quarter') return { error: "period: 'quarter' で呼び出してください" };
      return splitQuarter(month, staffCtx, operator);
    }
    default: return { error: '不明なaction: ' + action };
  }
}
