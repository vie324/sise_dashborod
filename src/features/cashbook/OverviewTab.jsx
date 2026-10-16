import Icon from '../../ui/Icon.jsx';
import { Badge, Button, Card, EmptyState, Skeleton, cx } from '../../ui/primitives.jsx';
import { dateJa, dateTimeJa, yen } from '../../lib/format.js';
import { formatMonthJa, formatShortDate } from '../../../shared/dates.js';
import { CASH_TYPES } from './constants.js';
import { EMPTY_BALANCE } from './calc.js';
import { ClosedBadge, SignedAmount } from './parts.jsx';

// ============================================================
// 残高総覧タブ: 現金残高（金庫・小口現金・レジ）/ 店舗別 / 本日の日次締め / 締め履歴
// ============================================================

const timeOf = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
  } catch (_) {
    return '';
  }
};

function BalanceHero({ balance, scopeLabel, month, monthSummary, loading, onCashCheck, canCheck }) {
  return (
    <section className="card">
      <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-stretch lg:gap-6">
        <div className="min-w-0 lg:w-[40%]">
          <div className="flex items-start justify-between gap-2">
            <h2 className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-ink-2">
              <Icon name="wallet" size={16} className="text-brand-600 dark:text-brand-300" />
              <span className="truncate">現金合計・{scopeLabel}</span>
            </h2>
            {canCheck ? (
              <Button size="sm" variant="subtle" icon="calculator" onClick={onCashCheck} className="-mt-1 shrink-0">レジ金チェック</Button>
            ) : null}
          </div>
          {loading ? (
            <Skeleton className="mt-3 h-10 w-48" />
          ) : (
            <p className="mt-2 text-[34px] font-bold leading-none tracking-tight text-ink num sm:text-[40px]">{yen(balance.balance)}</p>
          )}
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-2">
            <span className="text-muted">{formatMonthJa(month)}の現金</span>
            <span className="inline-flex items-center gap-1">
              <Icon name="arrow-down-left" size={13} className="text-muted" />入金
              <SignedAmount type="income" amount={monthSummary.cashIn} />
            </span>
            <span className="inline-flex items-center gap-1">
              <Icon name="arrow-up-right" size={13} className="text-muted" />出金
              <SignedAmount type="expense" amount={monthSummary.cashOut} />
            </span>
          </p>
        </div>
        <dl className="grid grid-cols-3 divide-x divide-line rounded-xl border border-line bg-surface-2 lg:flex-1">
          {CASH_TYPES.map((ct) => (
            <div key={ct.value} className="min-w-0 px-2.5 py-3 sm:px-4 lg:flex lg:flex-col lg:justify-center">
              <dt className="flex items-center gap-1 text-xs font-semibold text-ink-2">
                <Icon name={ct.icon} size={14} className="text-muted" />
                <span className="truncate">{ct.label}</span>
              </dt>
              <dd className="mt-1 text-[15px] font-bold leading-tight text-ink num sm:text-lg">
                {loading ? <Skeleton className="h-5 w-16" /> : yen(balance.byCashType[ct.value].balance)}
              </dd>
              <dd className="mt-0.5 truncate text-[11px] text-muted">{ct.note}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function StoreBalances({ stores, byStore, storeId, onSelect, closeOf, today, onCashCheck, loading }) {
  return (
    <section aria-labelledby="cb-store-balances">
      <h2 id="cb-store-balances" className="mb-2 flex items-center gap-1.5 text-[13px] font-bold text-ink-2">
        <Icon name="store" size={15} className="text-muted" />店舗別の現金残高
      </h2>
      <div className={cx('grid gap-3 sm:grid-cols-2', stores.length > 2 ? 'lg:grid-cols-3' : '')}>
        {stores.map((s) => {
          const id = String(s.id);
          const b = byStore.get(id) || EMPTY_BALANCE;
          const selected = storeId === id;
          const closed = closeOf(today, id);
          return (
            <div key={id} className={cx('card overflow-hidden transition-colors', selected ? 'border-brand-400 ring-1 ring-brand-400 dark:border-brand-500 dark:ring-brand-500' : '')}>
              <button type="button" onClick={() => onSelect(id)} aria-pressed={selected}
                className="block w-full px-4 pb-3 pt-4 text-left transition-colors hover:bg-surface-2">
                <span className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-ink">
                    <Icon name="map-pin" size={14} className="text-muted" />
                    <span className="truncate">{s.name}</span>
                  </span>
                  {closed ? <ClosedBadge label="本日締め済み" /> : <Badge tone="neutral" icon="clock">本日未締め</Badge>}
                </span>
                <span className="mt-2 block text-xl font-bold text-ink num">
                  {loading ? <Skeleton className="h-6 w-28" /> : yen(b.balance)}
                </span>
                <span className="mt-2 grid grid-cols-3 gap-1.5">
                  {CASH_TYPES.map((ct) => (
                    <span key={ct.value} className="min-w-0 rounded-lg bg-surface-3 px-2 py-1.5 text-center">
                      <span className="block text-[10px] font-semibold text-muted">{ct.short}</span>
                      <span className="block truncate text-xs font-bold text-ink num">{yen(b.byCashType[ct.value].balance)}</span>
                    </span>
                  ))}
                </span>
              </button>
              <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2">
                <span className="flex items-center gap-1 text-xs text-muted">
                  {selected ? <><Icon name="check" size={13} className="text-brand-600 dark:text-brand-300" />表示中</> : '選ぶとこの店舗で絞り込み'}
                </span>
                <Button size="sm" variant="ghost" icon="calculator" onClick={() => onCashCheck(id)}>レジ金チェック</Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TodayClose({ stores, today, closeOf, onDailyClose, className = '' }) {
  return (
    <Card title="本日の日次締め" subtitle={dateJa(today)} icon="lock" className={className}>
      {stores.length === 0 ? (
        <EmptyState compact icon="store" title="店舗がありません" />
      ) : (
        <ul className="divide-y divide-line">
          {stores.map((s) => {
            const close = closeOf(today, s.id);
            return (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{s.name}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {close
                      ? `${close.closedBy || '不明'}・${timeOf(close.closedAt)} に締めました`
                      : '締めた後は、この日の記録を編集・削除できません'}
                  </p>
                </div>
                {close ? (
                  <ClosedBadge />
                ) : (
                  <Button size="sm" variant="primary" icon="lock" onClick={() => onDailyClose(String(s.id))}>日次締め</Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function CloseHistory({ closes, showStore, storeName, className = '' }) {
  return (
    <Card title="日次締め履歴" subtitle="直近10件" icon="history" className={className} bodyClassName={closes.length ? '!px-0 !pb-1 sm:!pb-2' : ''}>
      {closes.length === 0 ? (
        <EmptyState compact icon="calendar-check" title="まだ締めた日はありません" message="「日次締め」を行うと、ここに実残高が残ります。" />
      ) : (
        <>
          {/* スマホでは表だと右の列が画面外に出るので、1件ずつ縦に積む */}
          <ul className="divide-y divide-line border-t border-line sm:hidden">
            {closes.map((c) => (
              <li key={`${c.date}:${c.storeId}`} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-ink">
                    {dateJa(c.date)}
                    {showStore ? <span className="ml-1.5 text-xs font-normal text-ink-2">{storeName(c.storeId)}</span> : null}
                  </span>
                  <span className="truncate text-xs text-muted">{c.closedBy || '—'}</span>
                </div>
                <dl className="mt-1.5 grid grid-cols-3 gap-2">
                  {[['金庫', c.safeBalance], ['小口', c.pettyCashBalance], ['レジ', c.registerBalance]].map(([label, v]) => (
                    <div key={label} className="min-w-0 rounded-lg bg-surface-2 px-2 py-1.5">
                      <dt className="text-[10px] font-semibold text-muted">{label}</dt>
                      <dd className="truncate text-[13px] font-semibold text-ink num">{yen(v)}</dd>
                    </div>
                  ))}
                </dl>
                {c.notes ? <p className="mt-1.5 text-xs text-ink-2">備考: {c.notes}</p> : null}
              </li>
            ))}
          </ul>
          <div className="scroll-x hidden sm:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="!pl-4 sm:!pl-5">日付</th>
                  {showStore ? <th>店舗</th> : null}
                  <th className="!text-right">金庫</th>
                  <th className="!text-right">小口</th>
                  <th className="!text-right">レジ</th>
                  <th className="!pr-4 sm:!pr-5">締めた人</th>
                </tr>
              </thead>
              <tbody>
                {closes.map((c) => (
                  <tr key={`${c.date}:${c.storeId}`}>
                    <td className="!pl-4 sm:!pl-5">
                      <span className="whitespace-nowrap font-semibold text-ink num">{formatShortDate(c.date)}</span>
                      {c.notes ? <span className="block max-w-[10rem] truncate text-[11px] text-muted" title={c.notes}>{c.notes}</span> : null}
                    </td>
                    {showStore ? <td className="whitespace-nowrap text-ink-2">{storeName(c.storeId)}</td> : null}
                    <td className="num-cell font-semibold text-ink">{yen(c.safeBalance)}</td>
                    <td className="num-cell font-semibold text-ink">{yen(c.pettyCashBalance)}</td>
                    <td className="num-cell font-semibold text-ink">{yen(c.registerBalance)}</td>
                    <td className="!pr-4 sm:!pr-5">
                      <span className="block whitespace-nowrap text-ink-2">{c.closedBy || '—'}</span>
                      {c.closedAt ? <span className="block whitespace-nowrap text-[11px] text-muted">{dateTimeJa(c.closedAt)}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

export default function OverviewTab({
  balances, scopeLabel, month, monthSummary, stores, scopeStores, storeId, onSelectStore,
  today, closeOf, recentCloses, storeName, onCashCheck, onDailyClose, loading,
}) {
  return (
    <div className="space-y-4">
      <BalanceHero
        balance={balances.scope}
        scopeLabel={scopeLabel}
        month={month}
        monthSummary={monthSummary}
        loading={loading}
        canCheck={stores.length > 0}
        onCashCheck={() => onCashCheck(storeId === 'all' ? '' : storeId)}
      />
      {stores.length > 1 ? (
        <StoreBalances
          stores={stores}
          byStore={balances.byStore}
          storeId={storeId}
          onSelect={onSelectStore}
          closeOf={closeOf}
          today={today}
          onCashCheck={onCashCheck}
          loading={loading}
        />
      ) : null}
      {/* 表のカードが横に広がって画面からはみ出さないよう、グリッドの子は min-w-0 にする */}
      <div className="grid gap-4 lg:grid-cols-5">
        <TodayClose stores={scopeStores} today={today} closeOf={closeOf} onDailyClose={onDailyClose} className="min-w-0 lg:col-span-2" />
        <CloseHistory closes={recentCloses} showStore={storeId === 'all' && stores.length > 1} storeName={storeName} className="min-w-0 lg:col-span-3" />
      </div>
    </div>
  );
}
