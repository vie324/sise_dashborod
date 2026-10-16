import { useApp } from '../../app/state.jsx';
import { useSummary, useTrend } from '../../lib/hooks.js';
import { isAdminLike } from '../../lib/access.js';
import { PageHeader, Card, Skeleton, EmptyState, Badge, cx } from '../../ui/primitives.jsx';
import { StatTile } from '../../ui/stats.jsx';
import { ColumnChart, BarList, ChartTable } from '../../ui/charts.jsx';
import Icon from '../../ui/Icon.jsx';
import { yen, yenShort, num, pct, changeRate } from '../../lib/format.js';
import { CHANNELS, channelLabel } from '../../../shared/channels.js';
import { formatMonthJa, dayOfMonth, weekdayOf } from '../../../shared/dates.js';
import { forecastMonthEnd } from '../../../shared/metrics.js';
import { ScopeBar, DataWarnings } from '../shared/ScopeBar.jsx';
import { navigate } from '../../app/router.js';

const WD = ['日', '月', '火', '水', '木', '金', '土'];

function Kpis({ data }) {
  const s = data.store;
  const prev = s.prev;
  const p = data.progress;
  const isCurrent = p.elapsed > 0 && p.remaining > 0;
  const fc = (v) => (isCurrent ? forecastMonthEnd(v, p.elapsed, p.total) : v);
  const suffix = isCurrent ? '前月比(予測)' : '前月比';
  const allNew = s.newVisitTotal;
  const allRate = allNew > 0 ? (s.newContractTotal / allNew) * 100 : null;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <StatTile label="施術消化売上" icon="banknote" value={yen(s.consumedSales)} delta={changeRate(fc(s.consumedSales), prev && prev.consumedSales)} deltaSuffix={suffix} />
      <StatTile label="入金売上" icon="wallet" value={yen(s.depositSales)} delta={changeRate(fc(s.depositSales), prev && prev.depositSales)} deltaSuffix={suffix} />
      <StatTile label="施術数" icon="hand-heart" value={`${num(s.treatmentCount)}回`} delta={changeRate(fc(s.treatmentCount), prev && prev.treatmentCount)} deltaSuffix={suffix} />
      <StatTile label="1回あたりの消化売上" icon="receipt" value={s.treatmentCount ? yen(s.consumedSales / s.treatmentCount) : '—'} sub={`評価基準額 ${yen(data.rules.unitPrice)}`} />
      <StatTile label="新規来店（全経路）" icon="user-plus" value={`${num(allNew)}名`} sub={allRate != null ? `契約率 ${pct(allRate)}（${s.newContractTotal}件）` : '契約率 —'} />
      <StatTile label="来店したお客様" icon="users" value={`${num(s.customerCount)}名`} sub={s.customerCount ? `1人あたり ${(s.treatmentCount / s.customerCount).toFixed(1)}回` : null} />
    </div>
  );
}

function TrendCard({ trend, month }) {
  if (!trend) return <Skeleton className="h-[320px] rounded-2xl" />;
  const rows = trend.months.filter((m) => !m.future);
  const data = rows.map((m) => ({ key: m.month, label: `${Number(m.month.slice(5))}月`, value: m.consumedSales, sub: `施術 ${num(m.treatmentCount)}回・新規 ${num(m.newVisitTotal)}名` }));
  return (
    <Card title="施術消化売上の推移（月別）" icon="chart-column" subtitle={`直近${rows.length}ヶ月・${formatMonthJa(month)}を強調`}>
      <ColumnChart data={data} highlightKey={month} format={yenShort} height={220} ariaLabel="月別の施術消化売上" />
      <ChartTable
        columns={[
          { key: 'month', label: '月', render: (r) => formatMonthJa(r.month) },
          { key: 'consumedSales', label: '施術消化売上', align: 'right', render: (r) => yen(r.consumedSales) },
          { key: 'depositSales', label: '入金売上', align: 'right', render: (r) => yen(r.depositSales) },
          { key: 'treatmentCount', label: '施術数', align: 'right', render: (r) => num(r.treatmentCount) },
          { key: 'newVisitTotal', label: '新規', align: 'right', render: (r) => num(r.newVisitTotal) },
          { key: 'contract3chRatePct', label: '契約率（3経路）', align: 'right', render: (r) => (r.contract3chRatePct != null ? pct(r.contract3chRatePct) : '—') },
          { key: 'memberCount', label: '会員数', align: 'right', render: (r) => num(r.memberCount) },
          { key: 'churnRatePct', label: '退会率', align: 'right', render: (r) => (r.churnRatePct != null ? pct(r.churnRatePct) : '—') },
        ]}
        rows={rows}
      />
    </Card>
  );
}

function DailyCard({ data }) {
  const days = data.progress.total;
  const byDay = new Map(data.store.daily.map((d) => [dayOfMonth(d.date), d]));
  const series = Array.from({ length: days }, (_, i) => {
    const d = byDay.get(i + 1);
    const date = `${data.month}-${String(i + 1).padStart(2, '0')}`;
    return { key: date, label: `${i + 1}`, value: d ? d.consumedSales : 0, sub: `${WD[weekdayOf(date)]}曜・施術 ${d ? d.treatmentCount : 0}回` };
  });
  return (
    <Card title="日別の施術消化売上" icon="calendar-days" subtitle={formatMonthJa(data.month)}>
      <ColumnChart data={series} format={yenShort} height={200} labelEvery={5} ariaLabel="日別の施術消化売上" />
      <ChartTable
        columns={[
          { key: 'date', label: '日付' },
          { key: 'consumedSales', label: '施術消化売上', align: 'right', render: (r) => yen(r.consumedSales) },
          { key: 'depositSales', label: '入金売上', align: 'right', render: (r) => yen(r.depositSales) },
          { key: 'treatmentCount', label: '施術数', align: 'right', render: (r) => num(r.treatmentCount) },
          { key: 'newVisits', label: '新規', align: 'right', render: (r) => num(r.newVisits) },
          { key: 'cashSales', label: '現金売上', align: 'right', render: (r) => yen(r.cashSales) },
        ]}
        rows={data.store.daily}
      />
    </Card>
  );
}

function ChannelCard({ data }) {
  const s = data.store;
  const items = CHANNELS.map((c) => ({
    key: c.key,
    label: c.label,
    value: s.newVisits[c.key] || 0,
    contracts: s.newContracts[c.key] || 0,
  })).filter((i) => i.value > 0 || ['hotpepper', 'meta', 'homepage'].includes(i.key))
    .sort((a, b) => b.value - a.value);
  return (
    <Card title="経路別の新規来店と契約" icon="route" subtitle="SalonOne の「来店経由」を経路にまとめて集計">
      <BarList
        items={items.map((i) => ({ ...i, sub: `契約 ${i.contracts}件${i.value ? `（${pct((i.contracts / i.value) * 100, 0)}）` : ''}` }))}
        format={(v) => `${num(v)}名`}
        emptyText="この月の新規来店はまだありません"
      />
      {data.sources && data.sources.length > 0 ? (
        <div className="mt-5 border-t border-line pt-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-ink-2">来店経由（SalonOne）→ 経路</span>
            {isAdminLike() ? (
              <button type="button" onClick={() => navigate('/settings')} className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">対応付けを変更</button>
            ) : null}
          </div>
          <ul className="space-y-1 text-[13px]">
            {data.sources.map((src) => (
              <li key={src.name} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-ink">{src.name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge tone={src.channel === 'other' ? 'neutral' : 'brand'}>{channelLabel(src.channel)}</Badge>
                  <span className="w-14 text-right text-ink-2 num">{src.newVisits}名</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function StaffTable({ data }) {
  if (data.staff.length === 0) return null;
  return (
    <Card title="スタッフ別" icon="users" pad={false}>
      <div className="scroll-x">
        <table className="data-table">
          <thead>
            <tr>
              <th>スタッフ</th>
              <th className="text-right">施術消化売上</th>
              <th className="text-right">うち既存顧客</th>
              <th className="text-right">入金売上</th>
              <th className="text-right">施術数</th>
              <th className="text-right">1回あたり</th>
              <th className="text-right">お客様</th>
              <th className="text-right">新規</th>
              <th className="text-right">契約</th>
            </tr>
          </thead>
          <tbody>
            {data.staff.map((r) => {
              const m = r.metrics;
              return (
                <tr key={r.key}>
                  <td className="whitespace-nowrap"><div className="font-semibold text-ink">{r.name}</div><div className="text-[11px] text-muted">{r.storeName}</div></td>
                  <td className="num-cell font-semibold text-ink">{yen(m.consumedSales)}</td>
                  <td className="num-cell">{yen(m.existingConsumedSales)}</td>
                  <td className="num-cell">{yen(m.depositSales)}</td>
                  <td className="num-cell">{num(m.treatmentCount)}</td>
                  <td className="num-cell">{m.treatmentCount ? yen(m.consumedSales / m.treatmentCount) : '—'}</td>
                  <td className="num-cell">{num(m.customerCount)}</td>
                  <td className="num-cell">{num(m.newVisitTotal)}</td>
                  <td className="num-cell">{num(m.newContractTotal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function SalesPage() {
  const { month, storeId } = useApp();
  const summary = useSummary(month, storeId);
  // 6ヶ月（SalonOne の受付履歴は店舗・月ごとに取得するため、1分 60回の上限に収まる範囲）
  const trend = useTrend(month, storeId, 6);
  const data = summary.shown;
  return (
    <div>
      <PageHeader title="売上分析" subtitle="SalonOne の受付履歴から、消化売上・施術数・新規と契約の動きを集計しています" />
      <ScopeBar data={data} />
      <DataWarnings data={data} error={summary.error} />
      {!data ? <Skeleton className="h-[480px] rounded-2xl" /> : (
        <div className={cx('space-y-4 transition-opacity', summary.stale || summary.loading ? 'opacity-60' : '')}>
          <Kpis data={data} />
          <div className="grid gap-4 lg:grid-cols-2">
            <TrendCard trend={trend.shown} month={month} />
            <DailyCard data={data} />
          </div>
          <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
            <ChannelCard data={data} />
            <StaffTable data={data} />
          </div>
          {data.store.treatmentCount === 0 ? (
            <Card><EmptyState icon="calendar-x" title={`${formatMonthJa(month)}の実績はまだありません`} /></Card>
          ) : null}
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Icon name="info" size={13} />
            施術消化売上 = 会計完了した予約の「消化額」の合計（SalonOne の受付履歴と同じ）。入金売上は会計金額（サブスク・回数券の購入を含む）です。
          </p>
        </div>
      )}
    </div>
  );
}
