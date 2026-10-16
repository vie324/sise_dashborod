import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';
import { Button, cx } from './primitives.jsx';

// ============================================================
// トースト通知: showToast('保存しました', 'success')
// ============================================================
let toasts = [];
const toastListeners = new Set();
const emitToasts = () => toastListeners.forEach((fn) => fn([...toasts]));

export function showToast(message, type = 'info', duration = 3200) {
  const id = Date.now() + Math.random();
  toasts = [...toasts, { id, message: String(message || ''), type }].slice(-4);
  emitToasts();
  setTimeout(() => dismissToast(id), duration);
  return id;
}

export function dismissToast(id) {
  toasts = toasts.filter((t) => t.id !== id);
  emitToasts();
}

const TOAST_STYLE = {
  success: { icon: 'circle-check', cls: 'text-[#0f7a14] dark:text-[#5fd36a]' },
  error: { icon: 'circle-alert', cls: 'text-[#c43434] dark:text-[#f08a8a]' },
  warning: { icon: 'triangle-alert', cls: 'text-[#b07a00] dark:text-[#f6c75a]' },
  info: { icon: 'info', cls: 'text-brand-600 dark:text-brand-300' },
};

export function Toaster() {
  const [list, setList] = useState(toasts);
  useEffect(() => {
    toastListeners.add(setList);
    return () => toastListeners.delete(setList);
  }, []);
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-[84px] z-[70] flex flex-col items-center gap-2 px-4 lg:bottom-6" aria-live="polite">
      {list.map((t) => {
        const s = TOAST_STYLE[t.type] || TOAST_STYLE.info;
        return (
          <div key={t.id} className="pointer-events-auto flex max-w-md animate-rise-in items-start gap-2.5 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[13px] font-medium text-ink shadow-pop">
            <Icon name={s.icon} size={17} className={cx('mt-px', s.cls)} />
            <span className="min-w-0 flex-1 leading-relaxed">{t.message}</span>
            <button type="button" className="-mr-1 rounded p-0.5 text-muted hover:text-ink" onClick={() => dismissToast(t.id)} aria-label="閉じる">
              <Icon name="x" size={14} />
            </button>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}

// ============================================================
// 確認ダイアログ: if (await confirmDialog({ title, message })) { ... }
// ============================================================
let confirmState = null;
const confirmListeners = new Set();

export function confirmDialog({ title = '確認', message = '', confirmLabel = 'OK', cancelLabel = 'キャンセル', variant = 'primary' } = {}) {
  return new Promise((resolve) => {
    confirmState = { title, message, confirmLabel, cancelLabel, variant, resolve };
    confirmListeners.forEach((fn) => fn(confirmState));
  });
}

export function ConfirmHost() {
  const [state, setState] = useState(confirmState);
  useEffect(() => {
    confirmListeners.add(setState);
    return () => confirmListeners.delete(setState);
  }, []);
  useEffect(() => {
    if (!state) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
  if (!state) return null;
  const close = (result) => {
    const s = state;
    confirmState = null;
    setState(null);
    s.resolve(result);
  };
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="alertdialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade-in bg-black/40" onClick={() => close(false)} />
      <div className="relative w-full max-w-sm animate-rise-in rounded-2xl bg-surface p-5 shadow-pop">
        <h2 className="text-[15px] font-bold text-ink">{state.title}</h2>
        {state.message ? <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-ink-2">{state.message}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => close(false)}>{state.cancelLabel}</Button>
          <Button variant={state.variant === 'danger' ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
            {state.confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
