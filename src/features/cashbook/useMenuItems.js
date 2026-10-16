import { useCallback, useEffect, useMemo, useState } from 'react';
import { dbGet, dbPost } from '../../lib/api.js';
import { showToast } from '../../ui/feedback.jsx';
import { MENU_ORDER_KEY } from './constants.js';

// ============================================================
// メニュー・クーポン（記帳フォームのプルダウン用）
// ------------------------------------------------------------
// menu_items には並び順の列が無いため、並び順は端末ごとに localStorage へ
// ID の配列で保存する（旧画面と同じキー・形式）。
// 並び順は管理画面の一覧と、記帳フォームのプルダウンの両方に効かせる。
// ============================================================

function readOrder() {
  try {
    const v = JSON.parse(localStorage.getItem(MENU_ORDER_KEY) || '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch (_) {
    return [];
  }
}

function writeOrder(ids) {
  try { localStorage.setItem(MENU_ORDER_KEY, JSON.stringify(ids)); } catch (_) { /* noop */ }
}

/** 保存した順 → 残り（未登録の新しいメニュー）は元の順で末尾に */
function applyOrder(items, order) {
  if (!order.length) return items;
  const byId = new Map(items.map((m) => [String(m.id), m]));
  const out = [];
  const seen = new Set();
  for (const id of order) {
    const it = byId.get(id);
    if (it && !seen.has(id)) { out.push(it); seen.add(id); }
  }
  for (const it of items) if (!seen.has(String(it.id))) out.push(it);
  return out;
}

export function useMenuItems() {
  const [menuItems, setMenuItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [order, setOrder] = useState(readOrder);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    const data = await dbGet('menuItems', { includeInactive: 'true' });
    if (data && Array.isArray(data.menuItems)) {
      setMenuItems(data.menuItems);
      setError(null);
    } else {
      setError((data && data.error) || 'メニューを読み込めませんでした');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchItems();
    // 画面上部の更新ボタンでメニューも読み直す
    window.addEventListener('sise:refresh', fetchItems);
    return () => window.removeEventListener('sise:refresh', fetchItems);
  }, [fetchItems]);

  const ordered = useMemo(() => applyOrder(menuItems.filter((m) => m.active), order), [menuItems, order]);
  const activeMenus = useMemo(() => ordered.filter((m) => m.itemType === 'menu'), [ordered]);
  const activeCoupons = useMemo(() => ordered.filter((m) => m.itemType === 'coupon'), [ordered]);

  const reorder = useCallback((ids) => {
    const next = ids.map(String);
    setOrder(next);
    writeOrder(next);
  }, []);

  const addItem = useCallback(async (item) => {
    setSaving(true);
    const r = await dbPost('menuItems', { action: 'addItem', item });
    setSaving(false);
    if (r && r.success && r.itemId) {
      const created = { ...item, id: r.itemId, active: item.active !== false, createdAt: new Date().toISOString() };
      setMenuItems((prev) => [...prev, created]);
      showToast(`「${item.name}」を追加しました`, 'success');
      return created;
    }
    showToast((r && r.error) || 'メニューを追加できませんでした', 'error');
    return null;
  }, []);

  const updateItem = useCallback(async (itemId, updates) => {
    setSaving(true);
    const r = await dbPost('menuItems', { action: 'updateItem', itemId, updates });
    setSaving(false);
    if (r && r.success) {
      setMenuItems((prev) => prev.map((m) => (m.id === itemId ? { ...m, ...updates } : m)));
      showToast('メニューを更新しました', 'success');
      return true;
    }
    showToast((r && r.error) || 'メニューを更新できませんでした', 'error');
    return false;
  }, []);

  // サーバーでは active=false にするだけ（過去の記録の摘要はそのまま残る）
  const deleteItem = useCallback(async (itemId) => {
    setSaving(true);
    const r = await dbPost('menuItems', { action: 'deleteItem', itemId });
    setSaving(false);
    if (r && r.success) {
      setMenuItems((prev) => prev.map((m) => (m.id === itemId ? { ...m, active: false } : m)));
      showToast('メニューを削除しました', 'success');
      return true;
    }
    showToast((r && r.error) || 'メニューを削除できませんでした', 'error');
    return false;
  }, []);

  return {
    menuItems,
    ordered,
    activeMenus,
    activeCoupons,
    loading,
    error,
    saving,
    addItem,
    updateItem,
    deleteItem,
    reorder,
    refresh: fetchItems,
  };
}
