import Icon from '../../ui/Icon.jsx';
import { Badge, Button, Card, EmptyState, IconButton, Skeleton, cx } from '../../ui/primitives.jsx';
import { StatTile } from '../../ui/stats.jsx';
import { BarList } from '../../ui/charts.jsx';
import { dateJa, num, signedYen, yen } from '../../lib/format.js';
import { formatMonthJa } from '../../../shared/dates.js';
import { isSalonOneCashEntry } from '../../../shared/cashbook.js';
import { CASH_TYPES, CASH_TYPE_LABEL, PAYMENT_LABEL, categoryIcon } from './constants.js';
import { ClosedBadge, SignedAmount, StoreTag } from './parts.jsx';

// ============================================================
// 入出金記録タブ: 月の KPI / 日別の記録一覧 / カテゴリ別集計
// ============================================================

const CASH_TYPE_ICON = Object.fromEntries(CASH_TYPES.map((c) => [c.value, c.icon]));

function MonthSplit({ income, expense }) {
  const total = income + expense;
  const incomePct = total > 0 ? (income / total) * 100 : 0;
  return (
    <div className="mb-4 rounded-xl border border-line bg-surface-2 px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="flex items-center gap-1 font-semibold text-ink-2">
          <Icon name="arrow-down-left" size={13} className="text-muted" />入金（全決済）
          <SignedAmount type="income" amount={income} className="ml-1 text-[13px]" />
        </span>
        <span className="flex items-center gap-1 font-semibold text-ink-2">
          <SignedAmount type="expense" amount={expense} className="mr-1 text-[13px]" />
          出金（全決済）<Icon name="arrow-up-right" size={13} className="text-muted" />
        </span>
      </div>
      <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
        {total > 0 ? (
          <>
            <div className="h-full bg-[var(--chart-sales)]" style={{ width: `${incomePct}%` }} />
            <div className="h-full bg-[var(--status-serious)]" style={{ width: `${100 - incomePct}%` }} />
          </>
        ) : null}
      </div>
    </div>
  );
}

function EntryRow({ entry, closed, showStore, storeName, onEdit, onDelete }) {
  const income = entry.type === 'income';
  const label = `${entry.category || '記録'} ${yen(entry.amount)}`;
  const cashType = entry.paymentMethod === 'CASH' && entry.cashType && entry.cashType !== 'register' ? entry.cashType : null;
  // SalonOne から取り込んだ記録は金額を SalonOne に合わせるので、ここでは編集させない（削除はできる）
  const fromSalonOne = isSalonOneCashEntry(entry);
  return (
    <li className="flex gap-3 py-2.5">
      <span className={cx('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
        income ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200' : 'bg-[#fbe9e9] text-[#9b2525] dark:bg-[#d03b3b]/[0.18] dark:text-[#f3a3a3]')}>
        <Icon name={fromSalonOne ? 'plug' : categoryIcon(entry)} size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-ink">{entry.category || '（カテゴリなし）'}</p>
            {entry.description ? <p className="truncate text-xs text-ink-2" title={entry.description}>{entry.description}</p> : null}
          </div>
          <SignedAmount type={entry.type} amount={entry.amount} className="pt-px text-sm" />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {fromSalonOne ? <Badge tone="brand" icon="plug">SalonOne</Badge> : null}
          {entry.customerName ? <Badge tone="neutral" icon="user">{entry.customerName}</Badge> : null}
          {income && Number(entry.treatmentCount) > 0 ? <Badge tone="info">{num(entry.treatmentCount)}回</Badge> : null}
          {showStore ? <StoreTag name={storeName(entry.store)} /> : null}
          {entry.paymentMethod && entry.paymentMethod !== 'CASH' ? (
            <Badge tone="gold" icon="credit-card">{PAYMENT_LABEL[entry.paymentMethod] || entry.paymentMethod}</Badge>
          ) : null}
          {cashType ? <Badge tone="neutral" icon={CASH_TYPE_ICON[cashType]}>{CASH_TYPE_LABEL[cashType] || cashType}</Badge> : null}
          {entry.recorder && !fromSalonOne ? <span className="text-[11px] text-muted">記録: {entry.recorder}</span> : null}
          <span className="ml-auto flex items-center gap-0.5">
            {closed ? (
              <Badge tone="neutral" icon="lock">締め済み</Badge>
            ) : (
              <>
                {!fromSalonOne ? <IconButton icon="pencil" label={`${label} を編集`} size="sm" onClick={() => onEdit(entry)} /> : null}
                <IconButton icon="trash-2" label={`${label} を削除`} size="sm" onClick={() => onDelete(entry)} className="hover:!text-[var(--text-bad)]" />
              </>
            )}
          </span>
        </div>
      </div>
    </li>
  );
}

function DayGroup({ group, isDayClosed, showStore, storeName, onEdit, onDelete }) {
  const storeIds = [...new Set(group.entries.map((e) => String(e.store || '')).filter(Boolean))];
  const closedCount = storeIds.filter((id) => isDayClosed(group.date, id)).length;
  return (
    <section className="border-t border-line pt-3 first:border-t-0 first:pt-0">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-bold text-ink">{dateJa(group.date)}</h3>
          {closedCount > 0 && closedCount === storeIds.length ? <ClosedBadge /> : null}
          {closedCount > 0 && closedCount < storeIds.length ? <Badge tone="neutral" icon="lock">一部締め済み</Badge> : null}
          {group.treatments > 0 ? <Badge tone="info" icon="activity">施術 {num(group.treatments)}回</Badge> : null}
        </div>
        <div className="flex items-center gap-3 text-xs">
          {group.income > 0 ? <SignedAmount type="income" amount={group.income} /> : null}
          {group.expense > 0 ? <SignedAmount type="expense" amount={group.expense} /> : null}
        </div>
      </header>
      <ul className="divide-y divide-line">
        {group.entries.map((e) => (
          <EntryRow
            key={e.id}
            entry={e}
            closed={isDayClosed(e.date, e.store)}
            showStore={showStore}
            storeName={storeName}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </ul>
    </section>
  );
}

function CategoryColumn({ title, icon, items, total, color }) {
  return (
    <div>
      <h3 className="mb-3 flex items-center gap-1.5 text-xs font-bold text-ink-2">
        <Icon name={icon} size={14} className="text-muted" />{title}
        <span className="ml-auto text-[13px] text-ink num">{yen(total)}</span>
      </h3>
      <BarList
        items={items.map((c) => ({
          key: c.category,
          label: c.category,
          value: c.amount,
          sub: total > 0 ? `${Math.round((c.amount / total) * 100)}%` : undefined,
          color,
        }))}
        format={yen}
        emptyText="この月の記録はありません"
      />
    </div>
  );
}

export default function EntriesTab({ month, monthSummary, groups, loading, isDayClosed, showStore, storeName, onEdit, onDelete, onAdd, onOpenMenu }) {
  const s = monthSummary;
  const net = s.cashIn - s.cashOut;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="月間入金（現金）" icon="arrow-down-left" value={yen(s.cashIn)} sub={`全決済 ${yen(s.income)}`} loading={loading} />
        <StatTile label="月間出金（現金）" icon="arrow-up-right" value={yen(s.cashOut)} sub={`全決済 ${yen(s.expense)}`} loading={loading} />
        <StatTile label="月間現金収支" icon="scale" value={net === 0 ? yen(0) : signedYen(net)} sub={`${num(s.count)}件の記録`} loading={loading} />
        <StatTile label="施術回数" icon="activity" value={`${num(s.treatments)}回`} sub={`${num(s.categoryCount)}カテゴリ`} loading={loading} />
      </div>

      <Card
        title={`${formatMonthJa(month)}の記録`}
        subtitle={`${num(s.count)}件`}
        icon="list"
        actions={onOpenMenu ? <Button size="sm" variant="ghost" icon="clipboard-list" onClick={onOpenMenu}>メニュー管理</Button> : null}
      >
        {loading && groups.length === 0 ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : groups.length === 0 ? (
          <EmptyState
            icon="book-open"
            title="この月の記録はありません"
            message="「記帳する」から入金・出金を記録できます。"
            action={onAdd ? <Button variant="primary" size="sm" icon="plus" onClick={onAdd}>記帳する</Button> : null}
          />
        ) : (
          <>
            <MonthSplit income={s.income} expense={s.expense} />
            <div className="space-y-3">
              {groups.map((g) => (
                <DayGroup key={g.date} group={g} isDayClosed={isDayClosed} showStore={showStore} storeName={storeName} onEdit={onEdit} onDelete={onDelete} />
              ))}
            </div>
          </>
        )}
      </Card>

      {s.count > 0 ? (
        <Card title="カテゴリ別集計" subtitle={formatMonthJa(month)} icon="chart-pie">
          <div className="grid gap-6 md:grid-cols-2">
            <CategoryColumn title="入金" icon="arrow-down-left" items={s.categories.income} total={s.income} />
            <CategoryColumn title="出金" icon="arrow-up-right" items={s.categories.expense} total={s.expense} color="var(--status-serious)" />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
