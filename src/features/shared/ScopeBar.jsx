import { useApp } from '../../app/state.jsx';
import { MonthPicker, StorePicker } from '../../ui/pickers.jsx';
import { Badge, Banner, cx } from '../../ui/primitives.jsx';
import { addMonths } from '../../../shared/dates.js';
import { dateJa, dateTimeJa } from '../../lib/format.js';

/**
 * 画面上部の絞り込み（月・店舗）。下のすべての数字がこの範囲で計算される。
 * @param {number} [maxAhead] 当月から何ヶ月先まで選べるか（目標設定用）
 */
export function ScopeBar({ data, maxAhead = 0, showStore = true, right, className = '' }) {
  const { month, setMonth, storeId, setStoreId, stores, canSelectAll, today } = useApp();
  return (
    <div className={cx('mb-4 flex flex-wrap items-center gap-2 sm:mb-5', className)}>
      <MonthPicker value={month} onChange={setMonth} min="2025-01" max={addMonths(today.slice(0, 7), maxAhead)} />
      {showStore ? <StorePicker value={storeId} onChange={setStoreId} stores={stores} allowAll={canSelectAll} /> : null}
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
        {data ? <DataStamp data={data} /> : null}
        {right}
      </div>
    </div>
  );
}

export function DataStamp({ data }) {
  if (!data) return null;
  return (
    <span className="flex items-center gap-2 text-xs text-muted">
      {data.mode === 'demo' ? <Badge tone="gold" icon="flask-conical">デモデータ</Badge> : <Badge tone="brand" icon="plug">SalonOne連携</Badge>}
      <span className="hidden sm:inline">{dateJa(data.asOf)}時点・{dateTimeJa(data.generatedAt)}更新</span>
    </span>
  );
}

/** サーバーから返った注意事項（デモ・未連携など）を出す */
export function DataWarnings({ data, error }) {
  if (error && !data) {
    return (
      <Banner tone="bad" title="SalonOne のデータを取得できませんでした" className="mb-4">
        {error.message || String(error)}
      </Banner>
    );
  }
  if (!data || !data.warnings || data.warnings.length === 0) return null;
  return (
    <div className="mb-4 space-y-2">
      {data.warnings.map((w) => (
        <Banner key={w.code} tone={w.code === 'demo' ? 'demo' : w.code === 'db' ? 'bad' : 'warn'}>
          {w.message}
          {w.code === 'demo' ? <span className="block text-xs opacity-80">設定 &gt; SalonOne連携 の手順で APIキーを登録すると実データに切り替わります。</span> : null}
        </Banner>
      ))}
    </div>
  );
}
