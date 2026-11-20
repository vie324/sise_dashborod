// ============================================================
// 新規台帳（SalonOne の新規のお客様 + 契約の結果の記録）
// ------------------------------------------------------------
// 店舗・月ごとに、その月に初めて来店した（会計完了の）お客様を SalonOne の受付履歴から並べ、
// スタッフが「契約できた（プラン）／できなかった（理由）」とメニューを記録する。
//   - 新規の判定は shared/metrics.js の findFirstVisits（新規数と同じ。店舗 × お客様の初回の来店）
//   - 媒体は来店経由（無ければ最初の予約の媒体）。ホットペッパーなどの経路にもまとめる
//   - メニューは SalonOne が受付履歴に付けて返す時だけ（無い時は、記録でダッシュボードのメニュー一覧から選ぶ）
//   - SalonOne でのプランの購入（その来店・あとの来店）も参考に出す
//   - 記録は dash_config の newcust.<月>.<店舗ID>（/api/db の dashConfig からは読み書きできない）
//       { records: { '<SalonOne の店舗ID>|<顧客ID>': Record }, updatedAt, updatedBy }
//       Record: { outcome: 'contracted' | 'lost', plan, reason, menu, receptionId, date, updatedAt, updatedBy }
//   - 画面には SalonOne の顧客ID・店舗IDを返さない（行の rid は初回の来店の受付ID）。
//     氏名は「個人情報を含める」キーの時だけ（無ければ顧客番号）
// 見る・記録する: その店舗を見られる人（スタッフは所属店舗だけ）。
// インセンティブ・新規契約の数は SalonOne のデータのまま（この記録では変えない）
// ============================================================

import { prepare, AccessError, resolveSelection, dataWarnings } from './summary.js';
import { loadDataset } from './provider.js';
import { supabase } from '../supabase.js';
import { findFirstVisits } from '../../../shared/metrics.js';
import { resolveChannel, channelLabel } from '../../../shared/channels.js';
import { addMonths, isMonth } from '../../../shared/dates.js';

export const LEADS_PREFIX = 'newcust.';
export const leadsKeyOf = (month, storeId) => `${LEADS_PREFIX}${month}.${storeId}`;
export const OUTCOMES = Object.freeze({ contracted: '契約できた', lost: '契約できなかった' });
const PLAN_MAX = 60;
const MENU_MAX = 60;
const REASON_MAX = 400;

const oneLine = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const multiLine = (v, max) => String(v == null ? '' : v).replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, max);
/** 初回の来店の受付ID（デモの受付は ID が無いので、店舗・お客様・日から作る） */
const ridOf = (r) => String(r.id || `${r.shopId}-${r.customerId}-${r.date}`);
const byNewest = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : String(b.time || '').localeCompare(String(a.time || '')));

/** 店舗ごとの記録（月） */
export async function loadLeadDocs(month, storeIds) {
  const out = new Map(storeIds.map((id) => [id, { records: {} }]));
  if (!storeIds.length) return out;
  const { data, error } = await supabase.from('dash_config').select('key, value').in('key', storeIds.map((id) => leadsKeyOf(month, id)));
  if (error) throw error;
  for (const row of data || []) {
    const storeId = String(row.key).slice(leadsKeyOf(month, '').length);
    const v = row.value && typeof row.value === 'object' ? row.value : {};
    out.set(storeId, { records: v.records && typeof v.records === 'object' ? v.records : {} });
  }
  return out;
}

async function loadMenuOptions() {
  try {
    const { data, error } = await supabase.from('menu_items').select('name, category, item_type, active');
    if (error) throw error;
    return [...new Set((data || []).filter((m) => m && m.active !== false && m.name).map((m) => oneLine(m.name, MENU_MAX)))];
  } catch (_) {
    return [];
  }
}

/** 店舗の新規のお客様（その月の初回の来店）と、SalonOne でのプランの購入 */
async function newCustomersOf(ctx, { month, storeIds, refresh }) {
  const { appCtx, master, mapping } = ctx;
  const shopToStore = new Map(storeIds.flatMap((sid) => mapping.shopsOf(sid).map((shopId) => [shopId, sid])));
  const shopIds = [...shopToStore.keys()];
  if (!shopIds.length) return { data: null, firsts: [], shopToStore };
  // 前の月（最初の予約をキャンセルして当月に来店）・次の月（2回目以降の来店での契約）の受付履歴も見る
  const data = await loadDataset(appCtx, master, {
    months: [month], receptionMonths: [addMonths(month, -1), addMonths(month, 1)], shopIds, summaries: false, retention: false, refresh,
  });
  const firsts = [...findFirstVisits(data.receptions, month).entries()]
    .filter(([, v]) => shopToStore.has(v.r.shopId))
    .map(([key, v]) => ({ key, r: v.r, sourceName: v.sourceName || '', storeId: shopToStore.get(v.r.shopId) }));
  return { data, firsts, shopToStore };
}

/**
 * 新規台帳の一覧
 * @param {Object|null} staffCtx
 * @param {{ month:string, storeId:string, refresh?:boolean }} opts storeId は 'all' で見られる店舗すべて
 */
export async function buildLeads(staffCtx, { month, storeId, refresh = false } = {}) {
  if (!isMonth(month)) throw new AccessError('month (YYYY-MM) が必要です', 400);
  const ctx = await prepare(staffCtx);
  const { appCtx, master, mapping, scope } = ctx;
  const storeIds = resolveSelection(scope, storeId);
  const [{ data, firsts }, docs, menuOptions] = await Promise.all([
    newCustomersOf(ctx, { month, storeIds, refresh }),
    appCtx.dbError ? Promise.resolve(new Map()) : loadLeadDocs(month, storeIds),
    appCtx.dbError ? Promise.resolve([]) : loadMenuOptions(),
  ]);
  const channelMap = appCtx.config['salonone.channelMap'] || {};
  const storeName = (sid) => (appCtx.stores.find((s) => s.id === sid) || {}).name || sid;
  const shopName = (id) => (master.shops.find((sh) => String(sh.id) === String(id)) || {}).name || '';
  const contracts = (data && data.contracts) || [];

  const rows = firsts.map(({ key, r, sourceName, storeId: sid }) => {
    const merged = mapping.shopsOf(sid).length > 1;
    const bought = contracts
      .filter((c) => c.customerId === r.customerId && c.shopId === r.shopId && c.startDate && c.startDate >= r.date)
      .sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
    const rec = (docs.get(sid) || { records: {} }).records[key] || null;
    const channel = resolveChannel(sourceName, channelMap);
    return {
      rid: ridOf(r),
      storeId: sid,
      storeName: storeName(sid),
      // 店舗の合算をしている店舗は、どちらの店舗の来店か
      shopName: merged ? shopName(r.shopId) || null : null,
      date: r.date,
      time: r.time || '',
      customerName: r.customerName || null,
      customerNumber: r.customerNumber || '',
      staffName: r.staffName || '',
      sourceName,
      channel,
      channelLabel: channelLabel(channel),
      menus: Array.isArray(r.menus) ? r.menus : [],
      // SalonOne でのプランの購入・入会（初回の来店と、それ以降の来店）
      salonOne: {
        plans: bought.filter((c) => c.type === 'subscription' || c.type === 'ticket').map((c) => ({ name: c.planName, date: c.startDate, kind: c.type })),
        joined: bought.some((c) => c.type === 'member'),
      },
      record: rec ? {
        outcome: rec.outcome, plan: rec.plan || null, reason: rec.reason || null, menu: rec.menu || null,
        updatedAt: rec.updatedAt || null, updatedBy: rec.updatedBy || '',
      } : null,
    };
  }).sort(byNewest);

  // プランの選択肢: この店舗で SalonOne に記録された契約（サブスク・回数券。前月〜翌月）のプラン（多い順）+ 記録にあるプラン
  const planCount = new Map();
  const shopSet = new Set(storeIds.flatMap((sid) => mapping.shopsOf(sid)));
  for (const c of contracts) {
    if (!shopSet.has(c.shopId) || !c.planName || (c.type !== 'subscription' && c.type !== 'ticket')) continue;
    planCount.set(c.planName, (planCount.get(c.planName) || 0) + 1);
  }
  for (const row of rows) if (row.record && row.record.plan && !planCount.has(row.record.plan)) planCount.set(row.record.plan, 0);
  const planOptions = [...planCount].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja')).map(([name]) => name);

  const counts = {
    total: rows.length,
    contracted: rows.filter((x) => x.record && x.record.outcome === 'contracted').length,
    lost: rows.filter((x) => x.record && x.record.outcome === 'lost').length,
    salonOneContracted: rows.filter((x) => x.salonOne.plans.length > 0 || x.salonOne.joined).length,
  };
  counts.recorded = counts.contracted + counts.lost;
  counts.unrecorded = counts.total - counts.recorded;

  const warnings = data ? dataWarnings(master, data) : [];
  if (storeIds.some((sid) => !mapping.shopsOf(sid).length)) warnings.push({ code: 'unmappedStore', message: 'SalonOne の店舗と未連携の店舗があります（設定 > SalonOne連携）。' });
  if (appCtx.dbError) warnings.push({ code: 'db', message: `Supabase に接続できません（記録は読み書きできません）: ${appCtx.dbError}` });

  return {
    mode: master.mode,
    month,
    asOf: data ? data.asOf : null,
    generatedAt: new Date().toISOString(),
    storeIds,
    names: rows.some((x) => x.customerName),
    canEdit: !appCtx.dbError,
    rows,
    counts,
    planOptions,
    menuOptions,
    warnings,
  };
}

/**
 * 1人の記録を保存する（outcome が空なら記録を消す）
 * @param {{ month, storeId, rid, outcome, plan, reason, menu }} input
 */
export async function saveLead(staffCtx, input = {}, operator = '') {
  const month = String(input.month || '');
  if (!isMonth(month)) throw new AccessError('month (YYYY-MM) が必要です', 400);
  const storeId = String(input.storeId || '');
  if (!storeId || storeId === 'all') throw new AccessError('店舗を選んでください', 400);
  const ctx = await prepare(staffCtx);
  if (ctx.appCtx.dbError) throw new AccessError(`Supabase に接続できないため記録できません: ${ctx.appCtx.dbError}`, 503);
  resolveSelection(ctx.scope, storeId); // 見られない店舗は AccessError
  const rid = String(input.rid || '');
  const { firsts } = await newCustomersOf(ctx, { month, storeIds: [storeId], refresh: false });
  const hit = firsts.find((f) => ridOf(f.r) === rid);
  if (!hit) throw new AccessError('この月の新規のお客様に見つかりません。画面を更新してください', 404);

  const outcome = input.outcome ? String(input.outcome) : '';
  let record = null;
  if (outcome) {
    if (!Object.prototype.hasOwnProperty.call(OUTCOMES, outcome)) throw new AccessError('契約できたか・できなかったかを選んでください', 400);
    const plan = outcome === 'contracted' ? oneLine(input.plan, PLAN_MAX) : '';
    const reason = outcome === 'lost' ? multiLine(input.reason, REASON_MAX) : '';
    if (outcome === 'contracted' && !plan) throw new AccessError('契約したプランを選んでください', 400);
    if (outcome === 'lost' && !reason) throw new AccessError('契約できなかった理由を入力してください', 400);
    record = {
      outcome,
      plan: plan || null,
      reason: reason || null,
      menu: oneLine(input.menu, MENU_MAX) || null,
      receptionId: rid,
      date: hit.r.date,
      updatedAt: new Date().toISOString(),
      updatedBy: oneLine(operator, 40),
    };
  }

  // 保存の直前に読み直して、この 1人の記録だけを書き換える（ほかの人が同時に書いた記録を消さない）
  const doc = (await loadLeadDocs(month, [storeId])).get(storeId);
  const records = { ...doc.records };
  if (record) records[hit.key] = record;
  else delete records[hit.key];
  const { error } = await supabase.from('dash_config').upsert({
    key: leadsKeyOf(month, storeId),
    value: { records, updatedAt: new Date().toISOString(), updatedBy: oneLine(operator, 40) },
  }, { onConflict: 'key' });
  if (error) throw error;
  return {
    rid,
    record: record ? { outcome: record.outcome, plan: record.plan, reason: record.reason, menu: record.menu, updatedAt: record.updatedAt, updatedBy: record.updatedBy } : null,
  };
}
