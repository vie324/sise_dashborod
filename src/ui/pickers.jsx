import Icon from './Icon.jsx';
import { cx, Select } from './primitives.jsx';
import { addMonths, formatMonthJa, monthsBetween } from '../../shared/dates.js';

export function MonthPicker({ value, onChange, min, max, className = '' }) {
  const canPrev = !min || monthsBetween(min, value) > 0;
  const canNext = !max || monthsBetween(value, max) > 0;
  return (
    <div className={cx('inline-flex h-10 items-center rounded-xl border border-line bg-surface shadow-card', className)}>
      <button type="button" className="flex h-full w-9 items-center justify-center rounded-l-xl text-ink-2 hover:bg-surface-2 disabled:opacity-30"
        onClick={() => onChange(addMonths(value, -1))} disabled={!canPrev} aria-label="前の月">
        <Icon name="chevron-left" size={16} />
      </button>
      <span className="min-w-[96px] px-1 text-center text-sm font-bold text-ink num" aria-live="polite">{formatMonthJa(value)}</span>
      <button type="button" className="flex h-full w-9 items-center justify-center rounded-r-xl text-ink-2 hover:bg-surface-2 disabled:opacity-30"
        onClick={() => onChange(addMonths(value, 1))} disabled={!canNext} aria-label="次の月">
        <Icon name="chevron-right" size={16} />
      </button>
    </div>
  );
}

export function StorePicker({ value, onChange, stores, allowAll, className = '' }) {
  if (!stores || (stores.length <= 1 && !allowAll)) {
    const only = stores && stores[0];
    return only ? (
      <span className={cx('inline-flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-semibold text-ink shadow-card', className)}>
        <Icon name="store" size={15} className="text-muted" />{only.name}
      </span>
    ) : null;
  }
  return (
    <div className={cx('relative', className)}>
      <Icon name="store" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <Select value={value} onChange={(e) => onChange(e.target.value)} className="h-10 !py-0 pl-9 font-semibold shadow-card" aria-label="店舗">
        {allowAll ? <option value="all">全店舗</option> : null}
        {stores.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
      </Select>
    </div>
  );
}
