// ============================================================
// 施術ツール（カウンセリング）の「本日のお客様」
// ------------------------------------------------------------
// SalonOne の受付履歴（/marketing/reception-history。店舗ごと）を当日分だけ取り、
// 予約の時刻・状態・担当・媒体・初回かどうか・この来店での契約を返す。
// お客様の氏名は「個人情報を含める」キーのときだけ SalonOne が返す（names: true）。
// 含めないキーでは顧客番号だけになる（画面でお呼びする名前を手入力できる）。
// 予約メモ・電話番号などは返さない。
//
// 見える範囲: スタッフ・店長・マネージャーは所属・管轄の店舗、オーナー・管理者は全店舗。
// ============================================================

import { prepare, AccessError, jstStamp } from './summary.js';
import { loadDayVisits } from './provider.js';
import { demoVisits } from './demo.js';
import { todayJst } from '../../../shared/dates.js';

const HIDDEN = new Set(['cancelled', 'no_show']);

/** 画面に返す 1行（SalonOne の顧客ID・店舗IDは返さない）。shopName は店舗の合算をしている時だけ（どちらの店舗の予約か） */
function toRow(v, shopName = null) {
  return {
    shopName,
    id: v.id,
    time: v.time,
    status: v.status,
    isNew: v.isNew,
    customerNumber: v.customerNumber || '',
    customerName: v.customerName || null,
    staffName: v.staffName || '',
    sourceName: v.isNew ? v.sourceName || '' : '',
    contracted: !!(v.joined || (v.plans && v.plans.length)),
    plans: (v.plans || []).map((p) => p.name).filter(Boolean),
  };
}

const byTime = (a, b) => (a.time || '99:99').localeCompare(b.time || '99:99') || String(a.id).localeCompare(String(b.id));

/**
 * @param {Object|null} staffCtx
 * @param {{ storeId:string, date?:string, refresh?:boolean, now?:number }} opts
 */
export async function buildVisits(staffCtx, { storeId, date, refresh = false, now = Date.now() } = {}) {
  const id = storeId && storeId !== 'all' ? String(storeId) : '';
  if (!id) throw new AccessError('店舗を選んでください', 400);
  const { appCtx, master, mapping, scope } = await prepare(staffCtx);
  if (!scope.storeIds.includes(id)) throw new AccessError('この店舗の予約を見る権限がありません');
  const day = date || todayJst(now);
  const store = appCtx.stores.find((s) => s.id === id);
  const base = { mode: master.mode, storeId: id, storeName: store ? store.name : id, date: day };

  // 店舗の合算をしている店舗（例: 大和店に titi 大和店）は、SalonOne の店舗すべての予約を合わせて出す
  const shopIds = mapping.shopsOf(id);
  if (!shopIds.length) return { ...base, linked: false, names: false, visits: [], fetchedAt: null, stale: null };

  if (master.mode === 'demo') {
    const visits = demoVisits({ shopId: shopIds[0], staff: master.staff, date: day, now });
    return { ...base, linked: true, names: true, visits: visits.sort(byTime).map((v) => toRow(v)), fetchedAt: new Date(now).toISOString(), stale: null };
  }

  const merged = shopIds.length > 1;
  const shopName = (sid) => (merged ? (master.shops.find((sh) => String(sh.id) === String(sid)) || {}).name || null : null);
  const results = await Promise.all(shopIds.map((sid) => loadDayVisits(sid, day, { refresh }).then((res) => ({ sid, res }))));
  const rows = results.flatMap(({ sid, res }) => res.value.filter((v) => !HIDDEN.has(v.status)).map((v) => ({ v, name: shopName(sid) })));
  const fetchedAt = Math.min(...results.map(({ res }) => res.fetchedAt));
  const staleOne = results.find(({ res }) => res.stale);
  return {
    ...base,
    linked: true,
    // 1件でも氏名の項目があれば「個人情報を含める」キー（予約が無い日は判断できないので false）
    names: results.some(({ res }) => res.value.some((v) => v.hasNameField)),
    visits: rows.sort((a, b) => byTime(a.v, b.v)).map(({ v, name }) => toRow(v, name)),
    fetchedAt: new Date(fetchedAt).toISOString(),
    stale: staleOne
      ? `SalonOne から最新の予約を取得できなかったため、${jstStamp(staleOne.res.fetchedAt)} 時点の予約を表示しています${staleOne.res.error ? `（${String(staleOne.res.error).replace(/^SalonOne API エラー \([^)]*\): /, '')}）` : ''}`
      : null,
  };
}
