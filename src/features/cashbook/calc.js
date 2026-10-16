import { daysInMonth } from '../../../shared/dates.js';
import { isManualSalesCash, isSalonOneCashEntry } from '../../../shared/cashbook.js';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from './constants.js';

// ============================================================
// 出納帳の集計（画面から切り離した純粋関数）
// ============================================================

const amountOf = (e) => Number(e.amount) || 0;
const isCash = (e) => e.paymentMethod === 'CASH';

function emptyBalance() {
  return {
    balance: 0,
    income: 0,
    expense: 0,
    byCashType: {
      register: { balance: 0, income: 0, expense: 0 },
      safe: { balance: 0, income: 0, expense: 0 },
      pettyCash: { balance: 0, income: 0, expense: 0 },
    },
  };
}

function addToBalance(b, e) {
  if (!isCash(e)) return;
  const a = amountOf(e);
  // 区分の無い旧データはレジ扱い（サーバーの既定値と同じ）
  const bucket = b.byCashType[e.cashType || 'register'];
  if (e.type === 'income') {
    b.income += a;
    if (bucket) bucket.income += a;
  } else if (e.type === 'expense') {
    b.expense += a;
    if (bucket) bucket.expense += a;
  }
}

function finishBalance(b) {
  b.balance = b.income - b.expense;
  for (const k of Object.keys(b.byCashType)) {
    const c = b.byCashType[k];
    c.balance = c.income - c.expense;
  }
  return b;
}

/** 現金残高（全期間の現金の入出金の差し引き）。現金区分別の内訳つき */
export function cashBalanceOf(entries) {
  const b = emptyBalance();
  for (const e of entries) addToBalance(b, e);
  return finishBalance(b);
}

/** 店舗別の現金残高（1回の走査でまとめて求める） */
export function cashBalanceByStore(entries) {
  const map = new Map();
  for (const e of entries) {
    const id = String(e.store || '');
    if (!id) continue;
    if (!map.has(id)) map.set(id, emptyBalance());
    addToBalance(map.get(id), e);
  }
  for (const b of map.values()) finishBalance(b);
  return map;
}

export const EMPTY_BALANCE = finishBalance(emptyBalance());

/**
 * 月の集計。施術回数は入金の記録だけを数える
 * （旧画面では出金にも既定の 1 回が入り、回数が多めに出ていた）
 */
export function monthSummaryOf(entries) {
  let income = 0;
  let expense = 0;
  let cashIn = 0;
  let cashOut = 0;
  let treatments = 0;
  const byCategory = { income: new Map(), expense: new Map() };
  for (const e of entries) {
    const a = amountOf(e);
    if (e.type === 'income') {
      income += a;
      if (isCash(e)) cashIn += a;
      treatments += Number(e.treatmentCount) || 0;
    } else if (e.type === 'expense') {
      expense += a;
      if (isCash(e)) cashOut += a;
    }
    const m = byCategory[e.type];
    if (m) {
      const cat = e.category || 'その他';
      m.set(cat, (m.get(cat) || 0) + a);
    }
  }
  const sorted = (m) => Array.from(m, ([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  return {
    income,
    expense,
    cashIn,
    cashOut,
    treatments,
    count: entries.length,
    categories: { income: sorted(byCategory.income), expense: sorted(byCategory.expense) },
    categoryCount: byCategory.income.size + byCategory.expense.size,
  };
}

/** カテゴリ選択肢。一覧に無い旧データのカテゴリも消えないよう末尾に足す */
export function categoryOptions(type, current) {
  const base = type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  return current && !base.includes(current) ? [...base, current] : base;
}

/** 日付ごとにまとめる（新しい日付が上、同じ日の中は記録の新しい順） */
export function groupByDate(entries) {
  const groups = new Map();
  for (const e of entries) {
    if (!groups.has(e.date)) groups.set(e.date, []);
    groups.get(e.date).push(e);
  }
  return Array.from(groups, ([date, list]) => {
    list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    let income = 0;
    let expense = 0;
    let treatments = 0;
    for (const e of list) {
      if (e.type === 'income') {
        income += amountOf(e);
        treatments += Number(e.treatmentCount) || 0;
      } else if (e.type === 'expense') {
        expense += amountOf(e);
      }
    }
    return { date, entries: list, income, expense, treatments };
  }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

/** 顧客名の入力候補（最近の記録に出てきた名前を新しい順に） */
export function recentCustomerNames(entries, limit = 300) {
  const seen = new Set();
  const sorted = [...entries].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  for (const e of sorted) {
    const name = String(e.customerName || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    if (seen.size >= limit) break;
  }
  return [...seen];
}

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * SalonOne 突合: 1店舗・1ヶ月の日別に
 *   出納帳の現金売上（SalonOne から取り込んだ記録 + 手入力の現金売上）と SalonOne の現金売上 を比べる。
 * 釣銭の補充・金庫や小口への入金・レジ金チェックの差異は売上ではないので比べない。
 * 差額 = 出納帳 − SalonOne（マイナスなら出納帳の記録が足りない）。
 * SalonOne の集計日（asOf）より後の日は「集計待ち」として判定から外す。
 *
 * 各日の source:
 *   imported … SalonOne から取り込み済み（金額が違えば stale）
 *   manual   … 手入力の現金売上がある（取り込むと二重になるので取り込まない）
 *   none     … 出納帳に現金売上の記録が無い（SalonOne 側にあれば取り込める）
 */
export function reconcileDaily({ entries, storeId, month, salonDaily, asOf }) {
  const book = new Map();
  for (const e of entries) {
    if (String(e.store) !== String(storeId)) continue;
    if (!e.date || !String(e.date).startsWith(month)) continue;
    const imported = isSalonOneCashEntry(e);
    if (!imported && !isManualSalesCash(e)) continue;
    const prev = book.get(e.date) || { amount: 0, count: 0, imported: 0, manual: 0 };
    prev.amount += amountOf(e);
    prev.count += 1;
    if (imported) prev.imported += amountOf(e);
    else prev.manual += amountOf(e);
    if (imported) prev.importedEntry = e;
    book.set(e.date, prev);
  }
  const salon = new Map();
  for (const d of salonDaily || []) {
    if (!d || !d.date) continue;
    salon.set(d.date, (salon.get(d.date) || 0) + (Number(d.cashSales) || 0));
  }

  const rows = [];
  const total = { cashbook: 0, salon: 0, diff: 0, count: 0 };
  let matchDays = 0;
  let mismatchDays = 0;
  let pendingDays = 0;
  const importable = [];
  const days = daysInMonth(month);
  for (let d = 1; d <= days; d++) {
    const date = `${month}-${pad2(d)}`;
    const b = book.get(date) || { amount: 0, count: 0, imported: 0, manual: 0 };
    const s = salon.get(date) || 0;
    const pending = !!asOf && date > asOf;
    const diff = b.amount - s;
    const status = pending ? 'pending' : diff === 0 ? 'match' : 'mismatch';
    const source = b.manual > 0 ? 'manual' : b.importedEntry ? 'imported' : 'none';
    // 取り込める日: 手入力の売上が無く、SalonOne の金額と出納帳がずれている（未取り込み・SalonOne 側の修正）
    const canImport = !pending && source !== 'manual' && diff !== 0;
    const active = b.amount !== 0 || s !== 0 || b.count > 0;
    rows.push({ date, cashbook: b.amount, count: b.count, salon: s, diff, status, active, future: pending, source, canImport });
    if (canImport) importable.push(date);
    if (!pending) {
      total.cashbook += b.amount;
      total.salon += s;
      total.count += b.count;
      if (active) {
        if (status === 'match') matchDays += 1;
        else mismatchDays += 1;
      }
    } else if (active) {
      pendingDays += 1;
    }
  }
  total.diff = total.cashbook - total.salon;
  return { rows, total, matchDays, mismatchDays, pendingDays, importable };
}
