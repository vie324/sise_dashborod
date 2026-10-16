// ============================================================
// 出納帳の定数
// ------------------------------------------------------------
// カテゴリ・現金区分は旧画面と同じ値を使う（既存データとそのまま突き合わせるため）。
// ============================================================

export const INCOME_CATEGORIES = ['施術売上', 'サブスク月額', '回数券販売', '物販', 'その他収入'];
export const EXPENSE_CATEGORIES = ['家賃', '水道光熱費', '消耗品', '広告費', '人件費', '設備', '交通費', 'その他経費'];

export const DEFAULT_CATEGORY = { income: '施術売上', expense: '消耗品' };

/** 現金区分（DB の cash_type） */
export const CASH_TYPES = [
  { value: 'safe', label: '金庫', short: '金庫', icon: 'vault', note: '本部管理' },
  { value: 'pettyCash', label: '小口現金', short: '小口', icon: 'coins', note: '日常経費用' },
  { value: 'register', label: 'レジ', short: 'レジ', icon: 'banknote', note: '店舗売上' },
];
export const CASH_TYPE_LABEL = Object.fromEntries(CASH_TYPES.map((c) => [c.value, c.label]));

/** 支払い方法。いまの記帳は現金のみだが、旧データには QR / カード / Square / 振込 が残っている */
export const PAYMENT_LABEL = { CASH: '現金', QR: 'QR', CARD: 'カード', SQUARE: 'Square', TRANSFER: '振込' };

const CATEGORY_ICON = {
  '施術売上': 'activity',
  'サブスク月額': 'repeat',
  '回数券販売': 'ticket',
  '物販': 'shopping-bag',
};

export function categoryIcon(entry) {
  return CATEGORY_ICON[entry.category] || (entry.type === 'income' ? 'arrow-down-left' : 'arrow-up-right');
}

export const TYPE_LABEL = { income: '入金', expense: '出金' };

// 旧画面と同じキー。端末に残っているデータをそのまま引き継ぐ
export const CASHBOOK_CACHE_KEY = 'sise_cashbook_cache';
export const MENU_ORDER_KEY = 'sise_menu_order_v1';

export const SYNC_INTERVAL_MS = 60 * 1000;
