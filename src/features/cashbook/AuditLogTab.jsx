import Icon from '../../ui/Icon.jsx';
import { Badge, Card, EmptyState, Skeleton, cx } from '../../ui/primitives.jsx';
import { dateTimeJa, yen } from '../../lib/format.js';
import { CASH_TYPE_LABEL, PAYMENT_LABEL, TYPE_LABEL } from './constants.js';

// ============================================================
// 操作ログ（監査証跡）
// ------------------------------------------------------------
// サーバーは記録の追加・編集・削除ごとに cashbook_log へ before / after
// （DB の列名のままの JSON）を残している。編集は変わった項目だけを並べる。
// ============================================================

const ACTIONS = {
  create: { label: '追加', icon: 'plus', tone: 'good' },
  add: { label: '追加', icon: 'plus', tone: 'good' },
  update: { label: '編集', icon: 'pencil', tone: 'info' },
  delete: { label: '削除', icon: 'trash-2', tone: 'bad' },
  dailyClose: { label: '日次締め', icon: 'lock', tone: 'gold' },
  bulkSave: { label: '一括保存', icon: 'file-text', tone: 'neutral' },
};

const FIELDS = [
  ['date', '日付'],
  ['type', '区分'],
  ['category', 'カテゴリ'],
  ['amount', '金額'],
  ['description', '摘要'],
  ['customer_name', '顧客名'],
  ['treatment_count', '施術回数'],
  ['payment_method', '支払い'],
  ['cash_type', '現金区分'],
  ['store_id', '店舗'],
  ['notes', '備考'],
];

function parse(json) {
  if (!json) return null;
  if (typeof json === 'object') return json;
  try { return JSON.parse(json); } catch (_) { return null; }
}

function fieldText(key, value, storeName) {
  if (value === null || value === undefined || value === '') return '（なし）';
  switch (key) {
    case 'amount': return yen(value);
    case 'type': return TYPE_LABEL[value] || String(value);
    case 'cash_type': return CASH_TYPE_LABEL[value] || String(value);
    case 'payment_method': return PAYMENT_LABEL[value] || String(value);
    case 'store_id': return storeName(value);
    case 'treatment_count': return `${value}回`;
    default: return String(value);
  }
}

function summaryOf(row) {
  if (!row) return '';
  const parts = [TYPE_LABEL[row.type] || '', row.category || '', row.amount != null ? yen(row.amount) : ''];
  if (row.customer_name) parts.push(row.customer_name);
  return parts.filter(Boolean).join('・');
}

/** ログ1件を「何が起きたか」が読める形にする */
function describeLog(log, storeName) {
  const before = parse(log.before);
  const after = parse(log.after);
  if (log.action === 'dailyClose' && after) {
    const summary = `金庫 ${yen(after.safe_balance)}・小口 ${yen(after.petty_balance)}・レジ ${yen(after.register_balance)}`;
    return { summary, changes: [], date: after.date };
  }
  if (log.action === 'update' && before && after) {
    const changes = FIELDS
      .filter(([k]) => k in after && String(after[k] ?? '') !== String(before[k] ?? ''))
      .map(([k, label]) => ({ key: k, label, from: fieldText(k, before[k], storeName), to: fieldText(k, after[k], storeName) }));
    return { summary: summaryOf(before), changes, date: before.date };
  }
  const row = after || before;
  return { summary: summaryOf(row), changes: [], date: row ? row.date : '' };
}

function LogItem({ log, storeName, showStore }) {
  const a = ACTIONS[log.action] || { label: log.action || '操作', icon: 'file-text', tone: 'neutral' };
  const d = describeLog(log, storeName);
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <span className={cx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
        a.tone === 'bad' ? 'bg-[#fbe9e9] text-[#9b2525] dark:bg-[#d03b3b]/[0.18] dark:text-[#f3a3a3]'
          : a.tone === 'info' ? 'bg-[#e8f1fc] text-[#1f5aa6] dark:bg-[#3987e5]/15 dark:text-[#9cc3f3]'
            : a.tone === 'good' ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200'
              : a.tone === 'gold' ? 'bg-gold-50 text-gold-700 dark:bg-gold-500/15 dark:text-gold-200'
                : 'bg-surface-3 text-ink-2')}>
        <Icon name={a.icon} size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge tone={a.tone}>{a.label}</Badge>
          <span className="text-[13px] font-semibold text-ink">{log.operator || '不明'}</span>
          {showStore && log.storeId ? <Badge tone="neutral" icon="store">{storeName(log.storeId)}</Badge> : null}
          <span className="ml-auto whitespace-nowrap text-[11px] text-muted num">{dateTimeJa(log.timestamp)}</span>
        </div>
        {d.summary ? (
          <p className="mt-1 truncate text-xs text-ink-2">
            {d.date ? <span className="num">{String(d.date).slice(5).replace('-', '/')}・</span> : null}{d.summary}
          </p>
        ) : null}
        {d.changes.length ? (
          <ul className="mt-1.5 space-y-0.5">
            {d.changes.map((c) => (
              <li key={c.key} className="flex flex-wrap items-baseline gap-x-1.5 text-xs">
                <span className="font-semibold text-ink-2">{c.label}</span>
                <span className="text-muted line-through decoration-1">{c.from}</span>
                <Icon name="arrow-right" size={12} className="self-center text-muted" />
                <span className="font-semibold text-ink">{c.to}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {log.entryId ? <p className="mt-1 truncate text-[10px] text-muted">ID: {log.entryId}</p> : null}
      </div>
    </li>
  );
}

export default function AuditLogTab({ logs, storeId, storeName, showStore, loading }) {
  const list = storeId === 'all' ? logs : logs.filter((l) => !l.storeId || String(l.storeId) === storeId);
  return (
    <Card
      title="操作ログ（監査証跡）"
      subtitle="出納帳の追加・編集・削除を、誰がいつ行ったか記録しています（直近100件）"
      icon="shield-check"
    >
      {loading && list.length === 0 ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon="shield" title="操作ログはまだありません" message="記録の追加・編集・削除を行うと、ここに残ります。" />
      ) : (
        <ul className="divide-y divide-line">
          {list.map((log, i) => <LogItem key={`${log.timestamp}:${log.entryId}:${i}`} log={log} storeName={storeName} showStore={showStore} />)}
        </ul>
      )}
    </Card>
  );
}
