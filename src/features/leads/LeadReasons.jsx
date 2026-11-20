// ============================================================
// 新規台帳 > 未契約の理由
// ------------------------------------------------------------
// 「契約できなかった」と記録した新規のお客様の一覧と、理由ごとの人数（1・3・6ヶ月）。
// 記録だけから作る（api/_lib/salonone/leads.js の buildLeadReasons。SalonOne は呼ばない）。
// 理由を押すと、その理由の人だけに絞り込む
// ============================================================
import { useMemo, useState } from 'react';
import { useApp } from '../../app/state.jsx';
import { useLeadReasons } from '../../lib/hooks.js';
import { Card, Badge, Segmented, EmptyState, Skeleton, Banner, cx } from '../../ui/primitives.jsx';
import Icon from '../../ui/Icon.jsx';
import { num, dateJa, dateTimeJa } from '../../lib/format.js';
import { ScopeBar } from '../shared/ScopeBar.jsx';
import { formatMonthJa } from '../../../shared/dates.js';

const SPANS = [{ value: 1, label: '1ヶ月' }, { value: 3, label: '3ヶ月' }, { value: 6, label: '6ヶ月' }];

/** 理由のタブ（記録・一覧で共通） */
export function ReasonTags({ tags, className = '' }) {
  if (!tags || !tags.length) return null;
  return (
    <span className={cx('flex flex-wrap gap-1', className)}>
      {tags.map((t) => (
        <span key={t} className="rounded-full bg-[#fbe9e9] px-2 py-0.5 text-[11px] font-semibold text-[#9b2525] dark:bg-[#d03b3b]/18 dark:text-[#f3a3a3]">{t}</span>
      ))}
    </span>
  );
}

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** 期間の表示（2026年9月〜11月。年をまたぐ時は両方に年） */
function rangeLabel(list) {
  if (!list.length) return '';
  const first = list[0];
  const last = list[list.length - 1];
  if (first === last) return formatMonthJa(first);
  return first.slice(0, 4) === last.slice(0, 4) ? `${formatMonthJa(first)}〜${Number(last.slice(5, 7))}月` : `${formatMonthJa(first)}〜${formatMonthJa(last)}`;
}

function ReasonBars({ data, picked, onPick }) {
  const lost = data.counts.lost;
  const used = data.reasons.filter((r) => r.count > 0);
  const unused = data.reasons.filter((r) => r.count === 0);
  const max = Math.max(1, ...used.map((r) => r.count));
  return (
    <Card title="理由ごとの人数" icon="chart-bar-decreasing"
      subtitle="押すと、その理由の人だけを下の一覧に出します。いくつも選んだ人は、それぞれの理由に数えます">
      {used.length === 0 ? <p className="text-[13px] text-muted">まだ理由を選んだ記録がありません</p> : (
        <ul className="space-y-1">
          {used.map((r) => {
            const on = picked === r.label;
            return (
              <li key={r.label}>
                <button type="button" onClick={() => onPick(on ? '' : r.label)} aria-pressed={on}
                  className={cx('w-full rounded-xl px-2.5 py-2 text-left transition-colors', on ? 'bg-[#fbe9e9] dark:bg-[#d03b3b]/15' : 'hover:bg-surface-2')}>
                  <span className="flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="min-w-0 font-semibold text-ink">{on ? <Icon name="filter" size={13} className="mr-1 inline text-[#b42323]" /> : null}{r.label}</span>
                    <span className="shrink-0 text-ink-2 num"><strong className="text-ink">{num(r.count)}</strong>名<span className="ml-1 text-[11px] text-muted">{pct(r.count, lost)}%</span></span>
                  </span>
                  <span className="mt-1 block h-2 overflow-hidden rounded-full bg-surface-3">
                    <span className="block h-full rounded-full bg-[#d03b3b]/80" style={{ width: `${(r.count / max) * 100}%` }} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {data.counts.memoOnly ? <p className="mt-2 text-xs text-muted">理由を選ばずメモだけ: {num(data.counts.memoOnly)}名</p> : null}
      {unused.length && used.length ? <p className="mt-1 text-xs text-muted">0名: {unused.map((r) => r.label).join('、')}</p> : null}
    </Card>
  );
}

function ReasonRow({ row, showStore }) {
  return (
    <li className="card flex flex-col gap-1.5 p-3.5">
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-[11px] text-muted num">
            {dateJa(row.date)}{showStore ? `・${row.storeName}` : ''}{row.shopName ? `・${row.shopName}` : ''}
          </span>
          <span className="mt-0.5 block truncate text-[15px] font-bold text-ink">{row.customerNumber ? `顧客番号 ${row.customerNumber}` : 'お客様'}</span>
        </span>
        <Badge tone="bad" icon="circle-x">契約なし</Badge>
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        {row.sourceName ? <Badge tone="brand" icon="route">{row.sourceName}</Badge> : null}
        {row.staffName ? <Badge tone="neutral" icon="user">{row.staffName}</Badge> : null}
      </span>
      {row.menus.length ? <span className="text-[13px] text-ink-2"><span className="text-muted">メニュー </span>{row.menus.join('・')}</span> : null}
      <span className="rounded-xl bg-surface-2 px-3 py-2 text-[13px] text-ink">
        <ReasonTags tags={row.reasons} />
        {row.reason ? <span className={cx('block whitespace-pre-line', row.reasons.length ? 'mt-1 text-ink-2' : '')}>{row.reason}</span> : null}
        <span className="mt-0.5 block text-[11px] text-muted">{row.updatedBy ? `${row.updatedBy}・` : ''}{dateTimeJa(row.updatedAt)}</span>
      </span>
    </li>
  );
}

export default function LeadReasons({ month, storeId }) {
  const { stores } = useApp();
  const [months, setMonths] = useState(1);
  const [picked, setPicked] = useState('');
  const res = useLeadReasons(month, storeId, months);
  const data = res.shown;
  const rows = useMemo(() => (data ? data.rows.filter((r) => !picked || r.reasons.includes(picked)) : []), [data, picked]);
  const showStore = !!data && data.storeIds.length > 1;
  const range = rangeLabel(data ? data.monthList : [month]);

  return (
    <div>
      <ScopeBar data={null} className="!mb-2" />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-ink-2">期間</span>
        <Segmented size="sm" value={months} onChange={(v) => { setMonths(v); setPicked(''); }} options={SPANS} ariaLabel="期間" />
        <span className="text-xs text-muted">選んだ月までの {months}ヶ月</span>
      </div>
      {res.error && !data ? <Banner tone="bad" title="未契約の理由を読み込めませんでした" className="mb-4">{res.error.message}</Banner> : null}
      {data && data.warnings.length ? <Banner tone="warn" className="mb-4">{data.warnings.map((w) => w.message).join(' / ')}</Banner> : null}
      {!data ? <Skeleton className="h-[420px] rounded-2xl" /> : (
        <div className={cx('space-y-4 transition-opacity', res.stale || res.loading ? 'opacity-60' : '')}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Card className="p-3.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-2"><Icon name="circle-x" size={14} className="text-muted" />未契約</div>
              <div className="mt-1 text-[22px] font-bold text-ink num">{num(data.counts.lost)}<span className="ml-0.5 text-sm font-semibold">名</span></div>
              <div className="text-[11px] text-muted">{range}</div>
            </Card>
            <Card className="p-3.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-2"><Icon name="clipboard-check" size={14} className="text-muted" />記録した人</div>
              <div className="mt-1 text-[22px] font-bold text-ink num">{num(data.counts.recorded)}<span className="ml-0.5 text-sm font-semibold">名</span></div>
              <div className="text-[11px] text-muted">うち契約 <span className="whitespace-nowrap">{num(data.counts.contracted)}名</span></div>
            </Card>
            <Card className="col-span-2 p-3.5 sm:col-span-1">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-2"><Icon name="percent" size={14} className="text-muted" />記録した人の未契約の割合</div>
              <div className="mt-1 text-[22px] font-bold text-ink num">{data.counts.recorded ? `${pct(data.counts.lost, data.counts.recorded)}%` : '—'}</div>
              <div className="text-[11px] text-muted">SalonOne の契約率とは別（記録した人だけ）</div>
            </Card>
          </div>

          <ReasonBars data={data} picked={picked} onPick={setPicked} />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[15px] font-bold text-ink">
              未契約のお客様 <span className="text-[13px] font-semibold text-muted num">{num(rows.length)}名</span>
            </h2>
            {picked ? (
              <button type="button" onClick={() => setPicked('')}
                className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-[#fbe9e9] px-3 text-xs font-semibold text-[#9b2525] dark:bg-[#d03b3b]/18 dark:text-[#f3a3a3]" aria-label={`${picked}の絞り込みをやめる`}>
                {picked}<Icon name="x" size={13} />
              </button>
            ) : null}
          </div>
          {rows.length === 0 ? (
            <Card>
              <EmptyState icon="clipboard-list" title={data.rows.length ? 'この理由の人はいません' : 'この期間に「契約できなかった」の記録はありません'}
                message={data.rows.length ? null : '「お客様」のタブで、契約できなかった方の理由を記録すると、ここに並びます'} />
            </Card>
          ) : (
            <ul className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {rows.map((r) => <ReasonRow key={r.id} row={r} showStore={showStore} />)}
            </ul>
          )}
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted">
            <Icon name="info" size={13} className="mt-0.5 shrink-0" />
            新規台帳に「契約できなかった」と記録したお客様の一覧です（{stores.length > 1 && !showStore ? '選んだ店舗' : '見られる店舗'}・{range}）。
            理由はいくつでも選べるので、理由ごとの人数を足すと未契約の人数より多くなることがあります。
          </p>
        </div>
      )}
    </div>
  );
}
