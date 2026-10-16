import { useCallback, useEffect, useId, useRef, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { Badge, Button, EmptyState, Field, IconButton, Input, Modal, Select, Skeleton, cx } from '../../ui/primitives.jsx';
import { confirmDialog } from '../../ui/feedback.jsx';
import { yen } from '../../lib/format.js';

// ============================================================
// メニュー・クーポン管理（追加・編集・削除・並び替え）
// ------------------------------------------------------------
// 並び替えは Pointer Events でマウスとタッチを同じ処理にしている。
// つまみ（grip）を押している間だけドラッグになり、それ以外の場所では
// 普通にスクロールできる。キーボードでは つまみ にフォーカスして ↑↓。
// ============================================================

const EMPTY_FORM = { name: '', price: '', itemType: 'menu', category: '' };

// Android で軽い振動を返す（iOS Safari は未対応で何もしない）。動きを減らす設定なら控える
function vibrate(pattern) {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    navigator.vibrate(pattern);
  } catch (_) { /* noop */ }
}

const GAP = 6; // 行の間隔（space-y-1.5）

function SortableList({ items, onReorder, onEdit, onDelete, editingId, disabled }) {
  const drag = useRef(null); // { id, from, over, startY, dy, rowH }
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);
  const rowRefs = useRef(new Map());
  const handleRefs = useRef(new Map());
  const focusAfter = useRef(null);
  const [announce, setAnnounce] = useState('');

  useEffect(() => {
    if (!focusAfter.current) return;
    const el = handleRefs.current.get(focusAfter.current);
    focusAfter.current = null;
    if (el) el.focus();
  });

  const moveItem = (from, to) => {
    if (from === to || to < 0 || to >= items.length) return;
    const ids = items.map((m) => String(m.id));
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    onReorder(ids);
    setAnnounce(`${items[from].name} を ${to + 1} 番目に移動しました`);
  };

  const onPointerDown = (e, item, index) => {
    if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    const row = rowRefs.current.get(String(item.id));
    const rowH = row ? row.getBoundingClientRect().height + GAP : 52;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
    drag.current = { id: String(item.id), from: index, over: index, startY: e.clientY, dy: 0, rowH };
    vibrate(10);
    rerender();
  };

  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    d.dy = e.clientY - d.startY;
    d.over = Math.max(0, Math.min(items.length - 1, d.from + Math.round(d.dy / d.rowH)));
    rerender();
  };

  const onPointerEnd = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.from !== d.over) {
      moveItem(d.from, d.over);
      vibrate([8, 30, 8]);
    }
    rerender();
  };

  const onKeyDown = (e, index, item) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const to = index + (e.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= items.length) return;
    focusAfter.current = String(item.id);
    moveItem(index, to);
  };

  const d = drag.current;
  return (
    <>
      <ul className="space-y-1.5">
        {items.map((item, index) => {
          const id = String(item.id);
          const dragging = !!d && d.id === id;
          let shift = 0;
          if (d && !dragging) {
            if (d.from < d.over && index > d.from && index <= d.over) shift = -d.rowH;
            else if (d.from > d.over && index < d.from && index >= d.over) shift = d.rowH;
          }
          const coupon = item.itemType === 'coupon';
          return (
            <li
              key={id}
              ref={(el) => { if (el) rowRefs.current.set(id, el); else rowRefs.current.delete(id); }}
              className={cx('relative flex items-center gap-2 rounded-xl border bg-surface py-1.5 pl-1 pr-1.5',
                dragging ? 'z-10 border-brand-400 shadow-pop' : editingId === id ? 'border-brand-300 bg-brand-50 dark:border-brand-500/40 dark:bg-brand-500/10' : 'border-line')}
              style={{
                transform: dragging ? `translateY(${d.dy}px)` : shift ? `translateY(${shift}px)` : undefined,
                transition: dragging ? 'none' : 'transform .18s cubic-bezier(.16,1,.3,1)',
              }}
            >
              <button
                type="button"
                ref={(el) => { if (el) handleRefs.current.set(id, el); else handleRefs.current.delete(id); }}
                className={cx('flex h-9 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-3 hover:text-ink',
                  dragging ? 'cursor-grabbing' : 'cursor-grab')}
                style={{ touchAction: 'none' }}
                aria-label={`${item.name}（${index + 1}番目）。ドラッグ、または上下キーで並び替え`}
                disabled={disabled}
                onPointerDown={(e) => onPointerDown(e, item, index)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerEnd}
                onPointerCancel={onPointerEnd}
                onKeyDown={(e) => onKeyDown(e, index, item)}
              >
                <Icon name="grip-vertical" size={16} />
              </button>
              <Badge tone={coupon ? 'gold' : 'brand'} icon={coupon ? 'ticket' : 'tag'}>{coupon ? 'クーポン' : 'メニュー'}</Badge>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{item.name}</span>
              <span className="shrink-0 text-sm font-bold text-ink num">{yen(item.price)}</span>
              <span className="flex shrink-0 items-center">
                <IconButton icon="pencil" label={`${item.name} を編集`} size="sm" onClick={() => onEdit(item)} disabled={disabled} />
                <IconButton icon="trash-2" label={`${item.name} を削除`} size="sm" onClick={() => onDelete(item)} disabled={disabled} className="hover:!text-[var(--text-bad)]" />
              </span>
            </li>
          );
        })}
      </ul>
      <p className="sr-only" aria-live="polite">{announce}</p>
    </>
  );
}

export default function MenuManager({ open, onClose, menu }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const idp = useId();
  const fid = (n) => `${idp}-${n}`;

  const reset = () => { setForm(EMPTY_FORM); setEditingId(null); };
  // Modal は onClose が変わるたびに初期フォーカスをやり直すので、入力のたびに作り直さない
  const close = useCallback(() => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    onClose();
  }, [onClose]);

  const price = parseInt(form.price, 10);
  const valid = form.name.trim() !== '' && form.price !== '' && Number.isFinite(price) && price >= 0;

  const submit = async (e) => {
    e.preventDefault();
    if (!valid || menu.saving) return;
    const item = { name: form.name.trim(), category: form.category || '', price, itemType: form.itemType };
    const ok = editingId ? await menu.updateItem(editingId, item) : await menu.addItem(item);
    if (ok) reset();
  };

  const startEdit = (item) => {
    setEditingId(String(item.id));
    setForm({ name: item.name || '', price: String(item.price ?? ''), itemType: item.itemType === 'coupon' ? 'coupon' : 'menu', category: item.category || '' });
  };

  const remove = async (item) => {
    const ok = await confirmDialog({
      title: 'メニューを削除',
      message: `「${item.name}」を削除しますか？\nこれまでの記録はそのまま残ります。`,
      confirmLabel: '削除',
      variant: 'danger',
    });
    if (!ok) return;
    if (await menu.deleteItem(item.id)) {
      if (editingId === String(item.id)) reset();
    }
  };

  return (
    <Modal open={open} onClose={close} title="メニュー・クーポン管理" size="md"
      footer={<Button variant="secondary" onClick={close}>閉じる</Button>}>
      <p className="mb-3 text-xs leading-relaxed text-muted">
        登録したメニューは、記帳フォームのプルダウンから選ぶだけで金額が入ります。
      </p>

      <form onSubmit={submit} className="mb-4 rounded-xl border border-line bg-surface-2 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-ink-2">
          <Icon name={editingId ? 'pencil' : 'plus'} size={14} className="text-muted" />
          {editingId ? 'メニューを編集' : 'メニューを追加'}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_7.5rem_7rem]">
          <Field label="名前" htmlFor={fid('name')} required className="col-span-2 sm:col-span-1">
            <Input id={fid('name')} placeholder="例: 全身整体 60分" value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
          </Field>
          <Field label="種別" htmlFor={fid('type')}>
            <Select id={fid('type')} value={form.itemType} onChange={(e) => setForm((p) => ({ ...p, itemType: e.target.value }))}>
              <option value="menu">メニュー</option>
              <option value="coupon">クーポン</option>
            </Select>
          </Field>
          <Field label="金額（円）" htmlFor={fid('price')} required>
            <Input id={fid('price')} type="number" inputMode="numeric" min="0" step="1" placeholder="0" className="num"
              value={form.price} onChange={(e) => setForm((p) => ({ ...p, price: e.target.value }))} />
          </Field>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          {editingId ? <Button size="sm" variant="ghost" onClick={reset}>編集をやめる</Button> : null}
          <Button size="sm" type="submit" variant="primary" icon={editingId ? 'check' : 'plus'} disabled={!valid} loading={menu.saving}>
            {editingId ? '更新する' : '追加する'}
          </Button>
        </div>
      </form>

      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold text-ink-2">登録済み（{menu.ordered.length}件）</h3>
        {menu.ordered.length > 1 ? (
          <p className="flex items-center gap-1 text-[11px] text-muted">
            <Icon name="grip-vertical" size={12} />つまみで並び替え（この端末に保存）
          </p>
        ) : null}
      </div>
      {menu.loading && menu.ordered.length === 0 ? (
        <div className="space-y-1.5"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
      ) : menu.ordered.length === 0 ? (
        <EmptyState compact icon="clipboard-list" title="メニューが登録されていません" message="上のフォームから追加できます。" />
      ) : (
        <SortableList
          items={menu.ordered}
          onReorder={menu.reorder}
          onEdit={startEdit}
          onDelete={remove}
          editingId={editingId}
          disabled={menu.saving}
        />
      )}
    </Modal>
  );
}
