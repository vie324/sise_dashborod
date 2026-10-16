// ============================================================
// 出納帳と SalonOne の現金売上の取り込み（サーバー / ブラウザ共通）
// ------------------------------------------------------------
// SalonOne で会計した現金売上は、店舗・日ごとに 1件の入金として出納帳へ取り込む。
// 取り込んだ記録の ID は店舗と日付から決まるので、同じ日を何度取り込んでも
// 1件にまとまる（金額が変わっていれば更新）。
// ============================================================

export const SALONONE_CASH_PREFIX = 'so_';

/** 取り込んだ記録のカテゴリ（手入力の「施術売上」と同じ集計に入る） */
export const SALONONE_CASH_CATEGORY = '施術売上';

/** SalonOne の会計で受け取るはずの入金カテゴリ（突合・二重記帳の判定に使う） */
export const SALES_CATEGORIES = ['施術売上', 'サブスク月額', '回数券販売', '物販'];

export function salonOneCashEntryId(storeId, date) {
  return `${SALONONE_CASH_PREFIX}${storeId}_${date}`;
}

export function isSalonOneCashEntry(entry) {
  return !!entry && String(entry.id || '').startsWith(SALONONE_CASH_PREFIX);
}

/** 手入力の現金売上（SalonOne から取り込んだ記録を除く） */
export function isManualSalesCash(entry) {
  return !!entry
    && entry.type === 'income'
    && (entry.paymentMethod || 'CASH') === 'CASH'
    && SALES_CATEGORIES.includes(entry.category)
    && !isSalonOneCashEntry(entry);
}
