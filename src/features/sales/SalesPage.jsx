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
  const rate = s.newCount > 0 && s.purchaseCount != null ? (s.purchaseCount / s.newCount) * 100 : null;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <StatTile label="施術消化売上" icon="banknote" value={yen(s.consumedSales)} delta={changeRate(fc(s.consumedSales), prev && prev.consumedSales)} deltaSuffix={suffix} sub="SalonOne の消化売上" />
      <StatTile label="入金売上" icon="wallet" value={yen(s.depositSales)} delta={changeRate(fc(s.depositSales), prev && prev.depositSales)} deltaSuffix={suffix} />
      <StatTile label="施術数" icon="hand-heart" value={`${num(s.treatmentCount)}回`} delta={changeRate(fc(s.treatmentCount), prev && prev.treatmentCount)} deltaSuffix={suffix}
        sub={s.treatmentCount ? `1回あたり ${yen(s.consumedSales / s.treatmentCount)}` : null} />
      <StatTile label="新規数" icon="user-plus" value={`${num(s.newCount)}名`}
        sub={s.purchaseCount != null ? `契約数 ${num(s.purchaseCount)}件・契約率 ${pct(rate)}` : null} />
      <StatTile label="既存数" icon="repeat" value={`${num(s.repeatCount)}回`} sub="2回目以降の来店" />
      <StatTile label="顧客数" icon="users" value={`${num(s.customerCount)}名`} sub={s.customerCount ? `1人あたり ${(s.treatmentCount / s.customerCount).toFixed(1)}回` : null} />
    </div>
  );
}

function TrendCard({ trend, month }) {
  if (!trend) return <Skeleton className="h-[320px] rounded-2xl" />;
  const rows = trend.months.filter((m) => !m.future);
  const data = rows.map((m) => ({ key: m.month, label: `${Number(m.month.slice(5))}月`, value: m.consumedSales, sub: `施術 ${num(m.treatmentCount)}回・新規 ${num(m.newCount)}名` }));
  return (
    <Card title="施術消化売上の推移（月別）" icon="chart-column" subtitle={`直近${rows.length}ヶ月・${formatMonthJa(month)}を強調`}>
      <ColumnChart data={data} highlightKey={month} format={yenShort} height={220} ariaLabel="月別の施術消化売上" />
      <ChartTable
        columns={[
          { key: 'month', label: '月', render: (r) => formatMonthJa(r.month) },
          { key: 'consumedSales', label: '施術消化売上', align: 'right', render: (r) => yen(r.consumedSales) },
          { key: 'depositSales', label: '入金売上', align: 'right', render: (r) => yen(r.depositSales) },
          { key: 'treatmentCount', label: '施術数', align: 'right', render: (r) => num(r.treatmentCount) },
          { key: 'newCount', label: '新規数', align: 'right', render: (r) => num(r.newCount) },
          { key: 'repeatCount', label: '既存数', align: 'right', render: (r) => num(r.repeatCount) },
          { key: 'purchaseCount', label: '契約数', align: 'right', render: (r) => (r.purchaseCount != null ? `${num(r.purchaseCount)}（${pct(r.contractRatePct, 0)}）` : '—') },
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
          { key: 'newVisits', label: '新規数', align: 'right', render: (r) => num(r.newVisits) },
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
    <Card title="経路別の新規来店と契約" icon="route" subtitle="SalonOne の「来店経由」を経路にまとめて集計（インセンティブの判定に使う数字）">
      <div className="grid gap-x-8 gap-y-5 lg:grid-cols-2">
        <div className="min-w-0">
          <BarList
            items={items.map((i) => ({ ...i, sub: `契約 ${i.contracts}件${i.value ? `（${pct((i.contracts / i.value) * 100, 0)}）` : ''}` }))}
            format={(v) => `${num(v)}名`}
            emptyText="この月の新規来店はまだありません"
          />
          {s.newCount != null && s.newVisitTotal !== s.newCount ? (
            <p className="mt-3 text-xs leading-relaxed text-muted">
              経路別は SalonOne の受付履歴の「区分」から数えているため、合計（{num(s.newVisitTotal)}名）が新規数（{num(s.newCount)}名）と少し違います（「既存顧客として扱う」にしたお客様など）。インセンティブの 3経路・SNS・紹介はこの経路別の数字で判定します。
            </p>
          ) : null}
        </div>
        {data.sources && data.sources.length > 0 ? (
          <div className="min-w-0 border-t border-line pt-4 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
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
      </div>
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
              <th className="text-right">新規数</th>
              <th className="text-right">既存数</th>
              <th className="text-right">契約数</th>
              <th className="text-right">施術数</th>
              <th className="text-right">顧客数</th>
              <th className="text-right">入金売上</th>
              <th className="text-right">うち既存顧客</th>
              <th className="text-right">1回あたり</th>
            </tr>
          </thead>
          <tbody>
            {data.staff.map((r) => {
              const m = r.metrics;
              return (
                <tr key={r.key}>
                  <td className="whitespace-nowrap"><div className="font-semibold text-ink">{r.name}</div><div className="text-[11px] text-muted">{r.storeName}</div></td>
                  <td className="num-cell font-semibold text-ink">{yen(m.consumedSales)}</td>
                  <td className="num-cell">{num(m.newCount)}</td>
                  <td className="num-cell">{num(m.repeatCount)}</td>
                  <td className="num-cell">{num(m.purchaseCount)}</td>
                  <td className="num-cell">{num(m.treatmentCount)}</td>
                  <td className="num-cell">{num(m.customerCount)}</td>
                  <td className="num-cell">{yen(m.depositSales)}</td>
                  <td className="num-cell">{yen(m.existingConsumedSales)}</td>
                  <td className="num-cell">{m.treatmentCount ? yen(m.consumedSales / m.treatmentCount) : '—'}</td>
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
      <PageHeader title="売上分析" subtitle="消化売上・入金売上・施術数・新規数・既存数・契約数は SalonOne の売上分析と同じ数字です" />
      <ScopeBar data={data} />
      <DataWarnings data={data} error={summary.error} />
      {!data ? <Skeleton className="h-[480px] rounded-2xl" /> : (
        <div className={cx('space-y-4 transition-opacity', summary.stale || summary.loading ? 'opacity-60' : '')}>
          <Kpis data={data} />
          <div className="grid gap-4 lg:grid-cols-2">
            <TrendCard trend={trend.shown} month={month} />
            <DailyCard data={data} />
          </div>
          <div className="space-y-4">
            <StaffTable data={data} />
            <ChannelCard data={data} />
          </div>
          {data.store.treatmentCount === 0 ? (
            <Card><EmptyState icon="calendar-x" title={`${formatMonthJa(month)}の実績はまだありません`} /></Card>
          ) : null}
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Icon name="info" size={13} />
            SalonOne の売上分析と同じ数字です：施術消化売上 ＝ 消化売上、既存数 ＝ リピート（2回目以降の来店）数、契約数 ＝ 購入数（新規のお客様のうち回数券・サブスクを契約した人数。後の月の契約も含む）。経路別は受付履歴から集計しています。
          </p>
        </div>
      )}
    </div>
  );
}
