import { useApp } from '../../app/state.jsx';
import { navigate } from '../../app/router.js';
import { MonthPicker, StorePicker } from '../../ui/pickers.jsx';
import { Badge, Banner, cx } from '../../ui/primitives.jsx';
import Icon from '../../ui/Icon.jsx';
import { isAdminLike } from '../../lib/access.js';
import { addMonths } from '../../../shared/dates.js';
import { dateJa, dateTimeJa } from '../../lib/format.js';

/**
 * 画面上部の絞り込み（月・店舗）。下のすべての数字がこの範囲で計算される。
 * @param {number} [maxAhead] 当月から何ヶ月先まで選べるか（目標設定用）
 */
export function ScopeBar({ data, maxAhead = 0, showStore = true, right, className = '' }) {
  const { month, setMonth, storeId, setStoreId, stores, canSelectAll, allStoresLabel, today } = useApp();
  return (
    <div className={cx('mb-3 flex flex-wrap items-center gap-2 sm:mb-4', className)}>
      <MonthPicker value={month} onChange={setMonth} min="2025-01" max={addMonths(today.slice(0, 7), maxAhead)} />
      {showStore ? <StorePicker value={storeId} onChange={setStoreId} stores={stores} allowAll={canSelectAll} allLabel={allStoresLabel} /> : null}
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
    <span className="hidden items-center gap-2 text-xs text-muted sm:flex">
      {data.mode === 'demo' ? <Badge tone="gold" icon="flask-conical">デモ</Badge> : <Badge tone="brand" icon="plug">SalonOne</Badge>}
      <span className="hidden sm:inline">{dateJa(data.asOf)}時点・{dateTimeJa(data.generatedAt)}更新</span>
    </span>
  );
}

function openSalonOneSettings() {
  try { localStorage.setItem('sise_settings_tab', 'salonone'); } catch (_) { /* noop */ }
  navigate('/settings');
}

const NOTE_TONES = {
  demo: 'border-gold-200 bg-gold-50 text-gold-800 dark:border-gold-500/25 dark:bg-gold-500/10 dark:text-gold-200',
  info: 'border-line bg-surface text-ink-2',
  warn: 'border-[#f1d79a] bg-[#fffaeb] text-[#6d4a00] dark:border-[#fab219]/25 dark:bg-[#fab219]/10 dark:text-[#f6d68f]',
  bad: 'border-[#efc0c0] bg-[#fdf2f2] text-[#8f2121] dark:border-[#d03b3b]/30 dark:bg-[#d03b3b]/10 dark:text-[#f2b0b0]',
};

/**
 * サーバーから返った注意事項（デモ・未連携など）と制度開始前の「試算」の注意。
 * 毎回目に入るものなので 1行に収め、数字の邪魔をしないようにする。
 * @param {boolean} [preview] 制度開始前の月なら「試算」の注意も出す
 */
export function DataWarnings({ data, error, preview = false }) {
  if (error && !data) {
    return (
      <Banner tone="bad" title="SalonOne のデータを取得できませんでした" className="mb-4">
        {error.message || String(error)}
      </Banner>
    );
  }
  if (!data) return null;
  const admin = isAdminLike();
  const notes = [];
  (data.warnings || []).forEach((w, i) => {
    const key = `${w.code}-${i}`;
    if (w.code === 'demo') {
      notes.push({ key, tone: 'demo', icon: 'flask-conical', text: admin ? 'デモデータを表示中（SalonOne 未接続）' : 'デモデータを表示しています（実際の数字ではありません）', action: admin ? { label: '接続する', onClick: openSalonOneSettings } : null });
    } else if (w.code === 'db' || w.code === 'close') {
      notes.push({ key, tone: 'bad', icon: 'circle-alert', text: w.message });
    } else if (w.code === 'stale') {
      notes.push({ key, tone: 'warn', icon: 'history', text: w.message });
    } else if (w.code === 'unmappedStore' || w.code === 'unmappedShop' || w.code === 'duplicateShop' || w.code === 'unmappedMe') {
      notes.push({ key, tone: 'warn', icon: 'link-2-off', text: w.message.replace(/（設定 > SalonOne連携）。?$/, ''), action: admin && w.code !== 'unmappedMe' ? { label: '対応付ける', onClick: openSalonOneSettings } : null });
    } else {
      // 継続管理・売上分析・他の店舗の実績が取れなかった など
      notes.push({ key, tone: 'warn', icon: 'circle-alert', text: w.message, action: admin ? { label: '接続テスト', onClick: openSalonOneSettings } : null });
    }
  });
  if (preview && data.period && data.period.preview && data.rules) {
    const start = data.rules.startMonth;
    notes.push({ key: 'preview', tone: 'info', icon: 'info', text: `制度開始（${Number(start.slice(0, 4))}年${Number(start.slice(5))}月）前のため、金額は試算です` });
  }
  if (notes.length === 0) return null;
  return (
    <div className="mb-4 flex flex-col gap-1.5 lg:flex-row lg:flex-wrap">
      {notes.map((n) => (
        <div key={n.key} role={n.tone === 'bad' ? 'alert' : 'status'}
          className={cx('flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs leading-snug', NOTE_TONES[n.tone])}>
          <Icon name={n.icon} size={14} className="shrink-0" />
          <span className="min-w-0 flex-1">{n.text}</span>
          {n.action ? (
            <button type="button" onClick={n.action.onClick} className="inline-flex shrink-0 items-center gap-0.5 font-semibold underline-offset-2 hover:underline">
              {n.action.label}<Icon name="chevron-right" size={13} />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
