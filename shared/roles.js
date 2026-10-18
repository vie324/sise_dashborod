// ============================================================
// 権限（ロール）— サーバー / ブラウザ共通
// ------------------------------------------------------------
//   staff        スタッフ     … 自分の数字と、所属店舗の合計
//   manager      店長         … 所属店舗の全体と、所属スタッフ全員の数字
//   area_manager マネージャー … 管轄する店舗（複数可）の店長と同じ
//   owner        オーナー     … 全店舗・全スタッフ。設定の変更も
// 以前の「本部（headquarter）」はオーナーとして扱う（保存し直すと owner になる）。
// 見える範囲の最終判断は常にサーバー（api/_lib/auth.js・salonone/summary.js）が行う。
// ============================================================

export const ROLES = [
  { value: 'staff', label: 'スタッフ', desc: '自分の数字と、所属店舗の合計を見られます' },
  { value: 'manager', label: '店長', desc: '所属店舗の全体と、所属スタッフ全員の数字を見られます' },
  { value: 'area_manager', label: 'マネージャー', desc: '管轄する店舗（複数可）の店長と同じ範囲を見られます' },
  { value: 'owner', label: 'オーナー', desc: '全店舗・全スタッフを見られます。設定の変更もできます' },
];

const KEYS = new Set(ROLES.map((r) => r.value));

/** 保存されている値を 4つのロールのどれかにそろえる（不明な値はスタッフ） */
export function normalizeRole(role) {
  const r = String(role || '').trim();
  if (r === 'headquarter') return 'owner';
  if (r === 'admin') return 'manager'; // 旧データ。店舗単位の閲覧として扱う
  return KEYS.has(r) ? r : 'staff';
}

/** 保存できる値か（旧 headquarter も受け付けて owner として保存する） */
export const isKnownRole = (role) => KEYS.has(String(role || '')) || role === 'headquarter';

export function roleLabel(role) {
  const r = normalizeRole(role);
  return (ROLES.find((x) => x.value === r) || ROLES[0]).label;
}

/** オーナー（全店舗） */
export const isOwnerRole = (role) => normalizeRole(role) === 'owner';
/** 店長・マネージャー（担当店舗のスタッフ全員を見られる） */
export const isStoreManagerRole = (role) => {
  const r = normalizeRole(role);
  return r === 'manager' || r === 'area_manager';
};
