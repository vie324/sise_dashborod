// ============================================================
// マンダラ: 誰が見ているか（viewer）と、メンバーの名簿（directory）
// ------------------------------------------------------------
// viewer = { kind: 'staff'|'admin', staffId, name, role, storeIds }
//   staff … スタッフ URL（staffCtx。ロール・所属店舗は DB の今の値）
//   admin … スタッフ URL 無しの管理者モード（オーナーと同じ範囲。自分のチャートは持たない）
// member = { id, name, role, active, storeIds, storeNames, shareChart, dailyEnabled }
// 店舗の ID は統合（merged_into）された別名を正規の ID にそろえてから比べる。
// ============================================================

import { supabase } from '../supabase.js';
import { normalizeRole } from '../../../shared/roles.js';
import { must } from './data.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const forbidden = (msg = '権限がありません') => new HttpError(403, msg);
export const notFound = (msg = '見つかりません') => new HttpError(404, msg);
export const badRequest = (msg) => new HttpError(400, msg);

export async function loadDirectory() {
  const [staffRows, ssRows, storeRows, flagRows] = await Promise.all([
    must(supabase.from('staff').select('id, name, role, status')),
    must(supabase.from('staff_stores').select('staff_id, store_id')),
    must(supabase.from('stores').select('id, name, status, merged_into')),
    must(supabase.from('mandala_members').select('staff_id, share_chart, daily_report_enabled')),
  ]);
  const stores = new Map((storeRows || []).map((s) => [String(s.id), s]));
  const canonical = (id) => {
    const s = stores.get(String(id));
    return s && s.merged_into ? String(s.merged_into) : String(id);
  };
  const storeIdsOf = new Map();
  for (const r of ssRows || []) {
    if (!storeIdsOf.has(r.staff_id)) storeIdsOf.set(r.staff_id, new Set());
    storeIdsOf.get(r.staff_id).add(canonical(r.store_id));
  }
  const flags = new Map((flagRows || []).map((f) => [f.staff_id, f]));
  const members = new Map();
  for (const s of staffRows || []) {
    const ids = [...(storeIdsOf.get(s.id) || [])];
    const f = flags.get(s.id);
    members.set(String(s.id), {
      id: String(s.id),
      name: s.name || '',
      role: normalizeRole(s.role),
      active: s.status !== 'inactive',
      storeIds: ids,
      storeNames: ids.map((id) => (stores.get(id) ? stores.get(id).name : id)),
      shareChart: f ? f.share_chart !== false : true,
      dailyEnabled: f ? !!f.daily_report_enabled : false,
    });
  }
  const activeStores = [...stores.values()]
    .filter((s) => s.status !== 'inactive' && !s.merged_into)
    .map((s) => ({ id: String(s.id), name: s.name }));
  return { members, stores: activeStores, canonical, storeName: (id) => (stores.get(String(id)) ? stores.get(String(id)).name : String(id)) };
}

export function buildViewer(staffCtx, dir) {
  if (!staffCtx) return { kind: 'admin', staffId: null, name: '管理者', role: 'admin', storeIds: [] };
  const raw = (staffCtx.storeIds || []).map(String);
  return {
    kind: 'staff',
    staffId: String(staffCtx.staffId),
    name: staffCtx.name || '',
    role: normalizeRole(staffCtx.role),
    storeIds: [...new Set([...raw, ...raw.map(dir.canonical)])],
  };
}

/** 投稿者として記録する名前（管理者モードは「管理者」） */
export function authorOf(viewer) {
  return viewer.kind === 'staff' ? { id: viewer.staffId, name: viewer.name } : { id: null, name: '管理者' };
}
