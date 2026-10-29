// ============================================================
// 系列店での契約の一覧・登録・削除（店長以上が登録する。仕組みは cross.js）
// ------------------------------------------------------------
// 見える範囲:
//   オーナー・管理者 … すべて
//   店長・マネージャー … 2,000円を付けるスタッフの所属店舗か、契約した店舗が担当店舗の登録
//   スタッフ        … 自分に付いた登録だけ
// 登録・削除: オーナー・管理者と、2,000円を付けるスタッフの所属店舗の店長・マネージャー。
// 確定済みの支給期間の月は登録・削除できない（確定を取り消してから）。
// ============================================================

import { prepare, AccessError } from './summary.js';
import { loadDayVisits } from './provider.js';
import { loadCloseDoc } from './closes.js';
import { loadCrossDocs, saveCrossDoc, linkKeyOf } from './cross.js';
import { paymentPeriodOf } from '../../../shared/incentive.js';
import { isStoreManagerRole } from '../../../shared/roles.js';
import { addMonths, isDate, isMonth, monthOf, todayJst } from '../../../shared/dates.js';

const text = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const newId = () => `xs_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

async function context(staffCtx) {
  const ctx = await prepare(staffCtx);
  const { scope, mapping } = ctx;
  const manager = scope.all || isStoreManagerRole(scope.role);
  const myS1 = scope.staffId ? mapping.staffToS1.get(scope.staffId) || null : null;
  return { ...ctx, manager, myS1 };
}

function assertManager(c) {
  if (!c.manager) throw new AccessError('系列店での契約を登録できるのは店長以上です');
}

/** 2,000円を付けるスタッフの所属店舗の担当か（オーナー・管理者はすべて） */
const canEditEntry = (c, e) => c.scope.all || (c.manager && !!e.creditStoreId && c.scope.storeIds.includes(e.creditStoreId));

function canSeeEntry(c, e) {
  if (c.scope.all) return true;
  if (!c.manager) return !!c.myS1 && e.creditKey === c.myS1;
  return c.scope.storeIds.includes(e.creditStoreId) || c.scope.storeIds.includes(e.contractStoreId);
}

async function assertOpen(month) {
  const period = paymentPeriodOf(month);
  if (period.preview) return;
  const doc = await loadCloseDoc(period.months[0]);
  if (doc.current) throw new AccessError(`${period.label}のインセンティブは確定済みです。確定を取り消してから登録・削除してください`, 409);
}

async function periodClosed(month) {
  const period = paymentPeriodOf(month);
  if (period.preview) return false;
  try {
    return !!(await loadCloseDoc(period.months[0])).current;
  } catch (_) {
    return false;
  }
}

function view(c, e) {
  const storeName = (id) => (c.appCtx.stores.find((s) => s.id === id) || {}).name || '';
  return {
    id: e.id,
    date: e.date,
    customerName: e.customerName,
    planName: e.planName,
    contractStoreId: e.contractStoreId,
    contractStoreName: storeName(e.contractStoreId),
    creditKey: e.creditKey,
    creditName: e.creditName,
    creditStoreId: e.creditStoreId || null,
    creditStoreName: storeName(e.creditStoreId),
    // 契約した店舗の SalonOne の契約（新規契約の数から除いた担当・時刻）
    link: e.link ? { staffName: e.link.staffName || '', time: e.link.time || '' } : null,
    memo: e.memo || '',
    createdAt: e.createdAt,
    createdBy: e.createdBy || '',
    editable: canEditEntry(c, e),
  };
}

/** 2,000円を付けられるスタッフ（SalonOne のスタッフ。店長・マネージャーは担当店舗の所属だけ） */
function creditOptions(c) {
  if (!c.manager) return [];
  const { master, mapping, appCtx, scope } = c;
  return master.staff
    .map((s) => {
      const storeId = s.shopId ? mapping.shopToStore.get(s.shopId) || null : null;
      return { key: s.id, name: s.name || s.id, storeId, storeName: storeId ? (appCtx.stores.find((x) => x.id === storeId) || {}).name || '' : '' };
    })
    .filter((o) => scope.all || (o.storeId && scope.storeIds.includes(o.storeId)))
    .sort((a, b) => a.storeName.localeCompare(b.storeName, 'ja') || a.name.localeCompare(b.name, 'ja'));
}

/**
 * 月の登録（見られる範囲）と、登録の画面で選ぶ店舗・スタッフ
 * @param {{ month:string, storeId?:string }} opts storeId: 2,000円を付けるスタッフの所属店舗か契約した店舗で絞る
 */
export async function listCrossStore(staffCtx, { month, storeId } = {}) {
  if (!isMonth(month)) throw new AccessError('month (YYYY-MM) が必要です', 400);
  const c = await context(staffCtx);
  const doc = (await loadCrossDocs([month])).get(month);
  let items = doc.items.filter((e) => canSeeEntry(c, e));
  if (storeId && storeId !== 'all') items = items.filter((e) => e.creditStoreId === storeId || e.contractStoreId === storeId);
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.createdAt).localeCompare(String(b.createdAt))));
  return {
    month,
    closed: await periodClosed(month),
    canEdit: c.manager,
    items: items.map((e) => view(c, e)),
    stores: c.manager ? c.appCtx.stores.map((s) => ({ id: s.id, name: s.name, linked: c.mapping.storeToShop.has(s.id) })) : [],
    creditOptions: creditOptions(c),
  };
}

/**
 * 契約した店舗・日の SalonOne の契約（会計完了でサブスク・回数券の購入か入会のある受付）。
 * お客様の名前は「個人情報を含める」キーで、担当店舗の時だけ返す（他の店舗は顧客番号だけ）
 */
export async function crossStoreCandidates(staffCtx, { storeId, date } = {}) {
  const c = await context(staffCtx);
  assertManager(c);
  if (!isDate(date) || date > todayJst()) throw new AccessError('契約日を正しく選んでください（今日まで）', 400);
  const store = c.appCtx.stores.find((s) => s.id === String(storeId || ''));
  if (!store) throw new AccessError('契約した店舗を選んでください', 400);
  const shopId = c.mapping.storeToShop.get(store.id);
  if (!shopId || c.master.mode !== 'live') return { storeId: store.id, date, linked: !!shopId && c.master.mode === 'live', items: [] };
  const res = await loadDayVisits(shopId, date);
  const month = monthOf(date);
  const docs = await loadCrossDocs([addMonths(month, -1), month, addMonths(month, 1)]);
  const used = new Set([...docs.values()].flatMap((d) => d.items).map((e) => linkKeyOf(e.link)).filter(Boolean));
  const showNames = c.scope.all || c.scope.storeIds.includes(store.id);
  const items = res.value
    .filter((v) => v.status === 'completed' && v.customerId && (v.joined || (v.plans && v.plans.length)))
    .map((v) => ({
      receptionId: v.id,
      time: v.time || '',
      staffName: v.staffName || '',
      plans: (v.plans || []).map((p) => p.name).filter(Boolean),
      joined: !!v.joined,
      isNew: !!v.isNew,
      customerNumber: v.customerNumber || '',
      customerName: showNames ? v.customerName || null : null,
      registered: used.has(`${shopId}|${v.customerId}`),
    }))
    .sort((a, b) => a.time.localeCompare(b.time));
  return { storeId: store.id, date, linked: true, items };
}

/**
 * 登録する
 * @param {{ date, customerName, planName, contractStoreId, creditKey, receptionId?, memo? }} input
 */
export async function addCrossStore(staffCtx, input = {}, operator = '') {
  const c = await context(staffCtx);
  assertManager(c);
  const date = String(input.date || '');
  if (!isDate(date) || date > todayJst()) throw new AccessError('契約日を正しく入力してください（今日まで）', 400);
  const month = monthOf(date);
  const customerName = text(input.customerName, 40);
  const planName = text(input.planName, 60);
  if (!customerName) throw new AccessError('お客様名を入力してください', 400);
  if (!planName) throw new AccessError('プラン名を入力してください', 400);
  const contractStore = c.appCtx.stores.find((s) => s.id === String(input.contractStoreId || ''));
  if (!contractStore) throw new AccessError('契約した店舗を選んでください', 400);
  const s1 = c.master.staff.find((s) => s.id === String(input.creditKey || ''));
  if (!s1) throw new AccessError('インセンティブを付けるスタッフを選んでください', 400);
  const creditStoreId = s1.shopId ? c.mapping.shopToStore.get(s1.shopId) || null : null;
  if (!canEditEntry(c, { creditStoreId })) throw new AccessError('担当店舗のスタッフの分だけ登録できます');
  if (creditStoreId && creditStoreId === contractStore.id) {
    throw new AccessError('初回に来店した店舗と同じ店舗での契約は対象外です（SalonOne の新規契約として数えます）', 400);
  }
  await assertOpen(month);

  // 契約した店舗の SalonOne の契約と結びつける（その店舗の新規契約の数から除く）
  let link = null;
  if (input.receptionId) {
    const shopId = c.mapping.storeToShop.get(contractStore.id);
    if (!shopId || c.master.mode !== 'live') throw new AccessError('契約した店舗が SalonOne とつながっていないため、SalonOne の契約は選べません', 400);
    const res = await loadDayVisits(shopId, date);
    const v = res.value.find((x) => String(x.id) === String(input.receptionId));
    if (!v || v.status !== 'completed' || !v.customerId) {
      throw new AccessError('選んだ SalonOne の契約が見つかりません。契約日と店舗を確かめてください', 400);
    }
    link = { shopId, customerId: v.customerId, receptionId: v.id, staffKey: v.staffId || null, staffName: v.staffName || '', time: v.time || '' };
  }

  const docs = await loadCrossDocs([addMonths(month, -1), month, addMonths(month, 1)]);
  if (link) {
    const key = linkKeyOf(link);
    if ([...docs.values()].some((d) => d.items.some((e) => linkKeyOf(e.link) === key))) {
      throw new AccessError('この SalonOne の契約はすでに系列店での契約として登録されています', 409);
    }
  }
  const doc = docs.get(month);
  if (doc.items.length >= 300) throw new AccessError('1ヶ月に登録できるのは 300件までです', 400);
  const entry = {
    id: newId(),
    date,
    customerName,
    planName,
    contractStoreId: contractStore.id,
    creditKey: s1.id,
    creditName: s1.name || s1.id,
    creditStoreId,
    link,
    memo: text(input.memo, 200),
    createdAt: new Date().toISOString(),
    createdBy: text(operator, 60),
  };
  doc.items.push(entry);
  await saveCrossDoc(month, doc, entry.createdBy);
  return { success: true, entry: view(c, entry) };
}

/** 削除する（記録は 20件まで removed に残す） */
export async function deleteCrossStore(staffCtx, { id, month } = {}, operator = '') {
  const c = await context(staffCtx);
  assertManager(c);
  if (!isMonth(month)) throw new AccessError('month (YYYY-MM) が必要です', 400);
  const doc = (await loadCrossDocs([month])).get(month);
  const entry = doc.items.find((e) => e.id === String(id || ''));
  if (!entry) throw new AccessError('登録が見つかりません（削除された可能性があります）', 404);
  if (!canEditEntry(c, entry)) throw new AccessError('担当店舗のスタッフの分だけ削除できます');
  await assertOpen(month);
  doc.items = doc.items.filter((e) => e !== entry);
  doc.removed = [{ ...entry, removedAt: new Date().toISOString(), removedBy: text(operator, 60) }, ...doc.removed];
  await saveCrossDoc(month, doc, text(operator, 60));
  return { success: true, id: entry.id };
}
