import { isAdminLike, isManagerOrAbove } from '../lib/access.js';

// 画面一覧。roles で表示するロールを絞る（サーバー側でも権限は必ず確認している）
export const NAV = [
  { path: '/', label: 'ホーム', icon: 'house', mobile: true },
  { path: '/incentives', label: 'インセンティブ', icon: 'award', mobile: true },
  { path: '/goals', label: '目標', icon: 'target', mobile: true },
  // マンダラ（チャート・週報・日報）。スマホはホームのカードと「その他」から開く
  { path: '/mandala', label: 'マンダラ', icon: 'grid-3x3' },
  { path: '/sales', label: '売上分析', icon: 'chart-column', show: isManagerOrAbove },
  { path: '/cashbook', label: '出納帳', icon: 'wallet', mobile: true },
  { path: '/care', label: '施術ツール', icon: 'scan-line' },
  { path: '/settings', label: '設定', icon: 'settings', show: isAdminLike },
];

export function visibleNav() {
  return NAV.filter((n) => !n.show || n.show());
}
