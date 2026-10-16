import { useEffect, useRef, useId } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';

const cx = (...a) => a.filter(Boolean).join(' ');
export { cx };

// ------------------------------------------------------------
// Button
// ------------------------------------------------------------
const VARIANTS = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm disabled:hover:bg-brand-600',
  secondary: 'bg-surface text-ink border border-line hover:bg-surface-2 shadow-card',
  ghost: 'text-ink-2 hover:bg-surface-3 hover:text-ink',
  danger: 'bg-[#c43434] text-white hover:bg-[#a92b2b] shadow-sm',
  gold: 'bg-gold-500 text-white hover:bg-gold-600 shadow-sm',
  subtle: 'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-200 dark:hover:bg-brand-500/25',
};
const SIZES = {
  sm: 'h-8 px-3 text-xs gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-[15px] gap-2 rounded-xl',
};

export function Spinner({ size = 16, className = '' }) {
  return (
    <svg className={cx('animate-spin shrink-0', className)} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Button({ variant = 'secondary', size = 'md', icon, iconRight, loading = false, className = '', children, type = 'button', disabled, ...rest }) {
  const iconSize = size === 'sm' ? 14 : 16;
  return (
    <button
      type={type}
      className={cx(
        'inline-flex items-center justify-center font-semibold whitespace-nowrap transition-colors select-none',
        'disabled:opacity-50 disabled:cursor-not-allowed active:translate-y-px',
        VARIANTS[variant] || VARIANTS.secondary,
        SIZES[size] || SIZES.md,
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={iconSize} /> : icon ? <Icon name={icon} size={iconSize} /> : null}
      {children}
      {iconRight && !loading ? <Icon name={iconRight} size={iconSize} /> : null}
    </button>
  );
}

export function IconButton({ icon, label, size = 'md', variant = 'ghost', className = '', ...rest }) {
  const dim = size === 'sm' ? 'h-8 w-8 rounded-lg' : 'h-10 w-10 rounded-xl';
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx('inline-flex items-center justify-center transition-colors', VARIANTS[variant] || VARIANTS.ghost, dim, className)}
      {...rest}
    >
      <Icon name={icon} size={size === 'sm' ? 16 : 18} />
    </button>
  );
}

// ------------------------------------------------------------
// Card
// ------------------------------------------------------------
export function Card({ title, subtitle, icon, actions, children, className = '', bodyClassName = '', pad = true, as: Tag = 'section', ...rest }) {
  const hasHeader = title || actions;
  return (
    <Tag className={cx('card', className)} {...rest}>
      {hasHeader ? (
        <header className={cx('flex items-start justify-between gap-3', pad ? 'px-4 pt-4 sm:px-5 sm:pt-5' : 'px-4 pt-4')}>
          <div className="min-w-0">
            {title ? (
              <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink">
                {icon ? <Icon name={icon} size={17} className="text-brand-600 dark:text-brand-300" /> : null}
                <span className="truncate">{title}</span>
              </h2>
            ) : null}
            {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cx(pad ? 'card-pad' : '', hasHeader && pad ? 'pt-3 sm:pt-4' : '', bodyClassName)}>{children}</div>
    </Tag>
  );
}

// ------------------------------------------------------------
// Badge / Banner
// ------------------------------------------------------------
const TONES = {
  neutral: 'bg-surface-3 text-ink-2',
  brand: 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200',
  gold: 'bg-gold-50 text-gold-700 dark:bg-gold-500/15 dark:text-gold-200',
  good: 'bg-[#e7f6e7] text-[#0f5f12] dark:bg-[#0ca30c]/15 dark:text-[#7fe08a]',
  warn: 'bg-[#fff4d6] text-[#7a5300] dark:bg-[#fab219]/15 dark:text-[#f9d27a]',
  bad: 'bg-[#fbe9e9] text-[#9b2525] dark:bg-[#d03b3b]/18 dark:text-[#f3a3a3]',
  info: 'bg-[#e8f1fc] text-[#1f5aa6] dark:bg-[#3987e5]/15 dark:text-[#9cc3f3]',
};

export function Badge({ tone = 'neutral', icon, children, className = '' }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-5 whitespace-nowrap', TONES[tone] || TONES.neutral, className)}>
      {icon ? <Icon name={icon} size={12} strokeWidth={2.2} /> : null}
      {children}
    </span>
  );
}

const BANNER_TONES = {
  info: { cls: 'border-[#bfd6f3] bg-[#f1f6fd] text-[#1f4f8f] dark:border-[#3987e5]/30 dark:bg-[#3987e5]/10 dark:text-[#b8d3f6]', icon: 'info' },
  warn: { cls: 'border-[#f1d79a] bg-[#fffaeb] text-[#6d4a00] dark:border-[#fab219]/30 dark:bg-[#fab219]/10 dark:text-[#f6d68f]', icon: 'triangle-alert' },
  bad: { cls: 'border-[#efc0c0] bg-[#fdf2f2] text-[#8f2121] dark:border-[#d03b3b]/35 dark:bg-[#d03b3b]/10 dark:text-[#f2b0b0]', icon: 'circle-alert' },
  demo: { cls: 'border-gold-200 bg-gold-50 text-gold-800 dark:border-gold-500/30 dark:bg-gold-500/10 dark:text-gold-200', icon: 'flask-conical' },
};

export function Banner({ tone = 'info', title, children, action, className = '' }) {
  const t = BANNER_TONES[tone] || BANNER_TONES.info;
  return (
    <div className={cx('flex items-start gap-3 rounded-xl border px-3.5 py-3 text-[13px] leading-relaxed', t.cls, className)} role={tone === 'bad' ? 'alert' : 'status'}>
      <Icon name={t.icon} size={17} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={title ? 'mt-0.5 opacity-90' : ''}>{children}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

// ------------------------------------------------------------
// Segmented（タブ）
// ------------------------------------------------------------
export function Segmented({ value, onChange, options, size = 'md', className = '', ariaLabel }) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cx('inline-flex max-w-full gap-1 overflow-x-auto rounded-xl bg-surface-3 p-1', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cx(
              'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition-colors',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-[13px]',
              active ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink',
            )}
          >
            {o.icon ? <Icon name={o.icon} size={14} /> : null}
            {o.label}
            {o.count != null ? <span className="text-[11px] font-medium text-muted">{o.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------
// Form
// ------------------------------------------------------------
export function Field({ label, hint, error, children, className = '', htmlFor, required }) {
  return (
    <div className={className}>
      {label ? (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
          {required ? <span className="ml-0.5 text-[#c43434]" aria-hidden="true">*</span> : null}
        </label>
      ) : null}
      {children}
      {error ? <p className="mt-1 text-xs font-medium text-[#b42323] dark:text-[#f08a8a]">{error}</p> : hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Input({ className = '', ...rest }) {
  return <input className={cx('field', className)} {...rest} />;
}

export function Select({ className = '', children, ...rest }) {
  return (
    <select className={cx('field appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9', className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237a837d' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")" }}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Textarea({ className = '', ...rest }) {
  return <textarea className={cx('field min-h-[88px] resize-y', className)} {...rest} />;
}

// ------------------------------------------------------------
// 状態表示
// ------------------------------------------------------------
export function EmptyState({ icon = 'inbox', title, message, action, compact = false }) {
  return (
    <div className={cx('flex flex-col items-center justify-center text-center', compact ? 'py-6' : 'py-12')}>
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-3 text-muted">
        <Icon name={icon} size={22} />
      </div>
      {title ? <p className="text-sm font-semibold text-ink">{title}</p> : null}
      {message ? <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted">{message}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className = '' }) {
  return <div className={cx('animate-pulse rounded-lg bg-surface-3', className)} />;
}

export function PageHeader({ title, subtitle, actions, children }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:mb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-ink sm:text-2xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-[13px] text-muted">{subtitle}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

// ------------------------------------------------------------
// Modal（モバイルでは下から出るシート）
// ------------------------------------------------------------
export function Modal({ open, onClose, title, children, footer, size = 'md' }) {
  const titleId = useId();
  const panelRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    setTimeout(() => {
      const el = panelRef.current && panelRef.current.querySelector('input, select, textarea, button:not([data-close])');
      if (el) el.focus();
    }, 30);
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);
  if (!open) return null;
  const width = size === 'lg' ? 'sm:max-w-3xl' : size === 'sm' ? 'sm:max-w-sm' : 'sm:max-w-lg';
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="absolute inset-0 animate-fade-in bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div ref={panelRef} className={cx('relative flex max-h-[92vh] w-full animate-sheet-up flex-col rounded-t-2xl bg-surface shadow-pop sm:animate-rise-in sm:rounded-2xl', width)}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <h2 id={titleId} className="text-[15px] font-bold text-ink">{title}</h2>
          <IconButton icon="x" label="閉じる" size="sm" onClick={onClose} data-close />
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-3 sm:px-5 safe-bottom">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
