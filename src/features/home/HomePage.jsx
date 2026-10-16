import { useMemo, useState } from 'react';
import { useApp } from '../../app/state.jsx';
import { useSummary, useGoals } from '../../lib/hooks.js';
import { currentAccess, role } from '../../lib/access.js';
import { Card, Modal, PageHeader, Skeleton, EmptyState, Badge, cx } from '../../ui/primitives.jsx';
import { StatTile, HeroFigure, StatusPill, Meter } from '../../ui/stats.jsx';
import { CumulativeChart, ChartTable } from '../../ui/charts.jsx';
import Icon from '../../ui/Icon.jsx';
import { yen, yenShort, num, pct, changeRate } from '../../lib/format.js';
import { forecastMonthEnd } from '../../../shared/metrics.js';
import { dayOfMonth, formatMonthJa } from '../../../shared/dates.js';
import { ScopeBar, DataWarnings } from '../shared/ScopeBar.jsx';
import StaffDetail from '../incentives/StaffDetail.jsx';
import {
  IncentiveBreakdown, SalesTierCard, NewContractCard, SnsCard, ReferralCard, RetentionCard, PeriodSummary, PreviewNote,
  ChartLegend, itemStatus, NextActions,
} from '../incentives/parts.jsx';
import { navigate } from '../../app/router.js';

function greeting() {
  const h = new Date().getHours();
  if (h < 11) return 'おはようございます';
  if (h < 18) return 'こんにちは';
  return 'おつかれさまです';
}

function LoadingBlock() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[112px] rounded-2xl" />)}
      </div>
      <Skeleton className="h-[320px] rounded-2xl" />
    </div>
  );
}

// ============================================================
// スタッフ本人のホーム
// ============================================================
function MyHome({ summary, goals }) {
  const me = summary.me;
  if (!me) {
    return (
      <Card>
        <EmptyState icon="user-x" title="あなたの実績を表示できません"
          message="SalonOne のスタッフと連携されていないか、この店舗に所属していません。管理者に「設定 > SalonOne連携」でスタッフの対応付けを依頼してください。" />
      </Card>
    );
  }
  const goal = goals && goals.staff && goals.staff[me.staffId] ? goals.staff[me.staffId].consumedSales : null;
  const items = Object.fromEntries(me.incentive.items.map((i) => [i.key, i]));
  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-5 md:grid-cols-[1fr_1.15fr] md:items-start">
          <div>
            <HeroFigure
              label={summary.period.preview ? '今月のインセンティブ（試算）' : '今月のインセンティブ見込み'}
              value={yen(me.incentive.total)}
              badge={<Badge tone="gold" icon="award">{formatMonthJa(summary.month)}</Badge>}
            />
            <PeriodSummary className="mt-4" period={summary.period} staffPeriod={me.period} />
            <NextActions className="mt-4" incentive={me.incentive} rules={summary.rules} />
          </div>
          <IncentiveBreakdown incentive={me.incentive} />
        </div>
      </Card>
      <SalesTierCard item={items.sales} daily={me.daily} progress={summary.progress} rules={summary.rules} goal={goal} />
      <div className="grid gap-4 lg:grid-cols-2">
        <NewContractCard item={items.newContract} rules={summary.rules} />
        <div className="space-y-4">
          <SnsCard item={items.sns} rules={summary.rules} />
          <ReferralCard item={items.referral} rules={summary.rules} />
        </div>
      </div>
      <RetentionCard item={items.retention} rules={summary.rules} storeName={me.storeName} />
    </div>
  );
}

// ============================================================
// 店舗（店舗責任者・本部・管理者）のホーム
// ============================================================
function StoreKpis({ summary, storeGoal }) {
  const s = summary.store;
  const p = summary.progress;
  const isCurrent = p.elapsed > 0 && p.remaining > 0;
  const forecast = isCurrent ? forecastMonthEnd(s.consumedSales, p.elapsed, p.total) : s.consumedSales;
  const prevTotal = s.prev ? s.prev.consumedSales : null;
  const ret = s.retention || {};
  const unit = s.treatmentCount > 0 ? s.consumedSales / s.treatmentCount : null;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile
        label="施術消化売上"
        icon="banknote"
        value={yen(s.consumedSales)}
        delta={changeRate(isCurrent ? forecast : s.consumedSales, prevTotal)}
        deltaSuffix={isCurrent ? '前月比(予測)' : '前月比'}
        sub={isCurrent ? `予測 ${yenShort(forecast)}` : null}
      >
        {storeGoal ? (
          <div className="mt-3">
            <Meter value={s.consumedSales} max={storeGoal} marker={isCurrent ? storeGoal * p.ratio : null} label="目標達成率" />
            <div className="mt-1 text-[11px] text-muted">目標 {yenShort(storeGoal)} の <span className="font-semibold text-ink-2">{pct((s.consumedSales / storeGoal) * 100, 0)}</span></div>
          </div>
        ) : (
          <button type="button" onClick={() => navigate('/goals')} className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:underline dark:text-brand-300">
            <Icon name="target" size={12} />目標を設定
          </button>
        )}
      </StatTile>
      <StatTile label="施術数" icon="hand-heart" value={`${num(s.treatmentCount)}回`}
        delta={changeRate(isCurrent ? forecastMonthEnd(s.treatmentCount, p.elapsed, p.total) : s.treatmentCount, s.prev ? s.prev.treatmentCount : null)}
        deltaSuffix={isCurrent ? '前月比(予測)' : '前月比'}
        sub={unit ? `1回あたり ${yen(unit)}` : null} />
      <StatTile label="新規来店（3経路）" icon="user-plus" value={`${num(s.contract3ch.visits)}名`}
        sub={s.contract3ch.ratePct != null ? `契約率 ${pct(s.contract3ch.ratePct)}（${s.contract3ch.contracts}件）` : '契約率 —'} />
      <StatTile label="会員数（サブスク）" icon="id-card" value={ret.memberCount != null ? `${num(ret.memberCount)}名` : '—'}
        sub={ret.churnRatePct != null ? `退会率 ${pct(ret.churnRatePct)}・平均継続 ${num(ret.avgTenureMonths, 1)}ヶ月` : '退会率 —'} />
    </div>
  );
}

function StoreTrendCard({ summary, storeGoal }) {
  const s = summary.store;
  const p = summary.progress;
  const isCurrent = p.elapsed > 0 && p.remaining > 0;
  const forecast = isCurrent ? forecastMonthEnd(s.consumedSales, p.elapsed, p.total) : null;
  const daily = s.daily.map((d) => ({ day: dayOfMonth(d.date), value: d.consumedSales }));
  let acc = 0;
  const rows = s.daily.map((d) => { acc += d.consumedSales; return { date: d.date, day: d.consumedSales, cum: acc, n: d.treatmentCount }; });
  return (
    <Card title="施術消化売上の推移" icon="chart-line" subtitle={`${formatMonthJa(summary.month)}・日ごとの累計`} className="lg:col-span-2">
      <CumulativeChart days={p.total} elapsed={p.elapsed || p.total} daily={daily} target={storeGoal || undefined} forecast={forecast || undefined}
        format={yenShort} height={240} ariaLabel="店舗の施術消化売上の累計推移" />
      <ChartLegend items={[
        { label: '実績（累計）', color: 'var(--chart-sales)' },
        storeGoal ? { label: '目標ペース', color: 'var(--chart-target)' } : null,
        forecast ? { label: '月末予測', color: 'var(--chart-sales)', dashed: true } : null,
      ].filter(Boolean)} />
      <ChartTable
        columns={[
          { key: 'date', label: '日付' },
          { key: 'day', label: '消化売上', align: 'right', render: (r) => yen(r.day) },
          { key: 'cum', label: '累計', align: 'right', render: (r) => yen(r.cum) },
          { key: 'n', label: '施術数', align: 'right', render: (r) => num(r.n) },
        ]}
        rows={rows}
      />
    </Card>
  );
}

function StoreIncentiveCard({ summary }) {
  const totalMonth = summary.staff.reduce((a, r) => a + r.incentive.total, 0);
  const totalPeriod = summary.staff.reduce((a, r) => a + r.period.total, 0);
  const achievers = summary.staff.filter((r) => r.incentive.items[0].achieved).length;
  const single = summary.stores.length === 1 ? summary.stores[0] : null;
  return (
    <Card title="インセンティブの状況" icon="award" subtitle={summary.period.preview ? '制度開始前の試算' : `支給期間 ${summary.period.label}`}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs font-semibold text-ink-2">今月の見込み合計</div>
          <div className="mt-1 text-2xl font-bold text-ink num">{yen(totalMonth)}</div>
        </div>
        <div>
          <div className="text-xs font-semibold text-ink-2">期間の見込み合計</div>
          <div className="mt-1 text-2xl font-bold text-ink num">{yen(totalPeriod)}</div>
        </div>
      </div>
      <p className="mt-3 text-xs text-ink-2">施術消化売上のランク到達 <span className="font-semibold text-ink">{achievers}</span> / {summary.staff.length}名</p>
      {single ? (
        <div className="mt-4 border-t border-line pt-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-ink-2">継続率インセンティブ（{single.name}）</span>
            <StatusPill {...itemStatus(single.retentionIncentive)} />
          </div>
          <ul className="space-y-1 text-xs text-ink-2">
            {single.retentionIncentive.conditions.map((c) => (
              <li key={c.key} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <Icon name={c.current == null ? 'circle-help' : c.met ? 'circle-check' : 'circle-x'} size={14}
                    className={c.current == null ? 'text-muted' : c.met ? 'text-[var(--status-good)]' : 'text-[var(--status-critical)]'} />
                  {c.label}
                </span>
                <span className="font-semibold text-ink num">
                  {c.current == null ? '—' : c.unit === '%' ? pct(c.current) : c.unit === 'ヶ月' ? `${num(c.current, 1)}ヶ月` : `${num(c.current)}${c.unit}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <button type="button" onClick={() => navigate('/incentives')} className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
        スタッフ別の内訳を見る<Icon name="chevron-right" size={14} />
      </button>
    </Card>
  );
}

function StaffRanking({ summary, goals, onOpen }) {
  const rows = summary.staff;
  if (rows.length === 0) {
    return <Card title="スタッフ別" icon="users"><EmptyState compact icon="users" title="この範囲のスタッフ実績はまだありません" /></Card>;
  }
  const maxSales = Math.max(1, ...rows.map((r) => r.metrics.consumedSales));
  return (
    <Card title="スタッフ別ランキング" icon="users" subtitle="施術消化売上の順。行をタップすると内訳を表示します" pad={false}>
      <div className="scroll-x">
        <table className="data-table">
          <thead>
            <tr>
              <th className="w-8 text-center">#</th>
              <th>スタッフ</th>
              <th className="text-right">施術消化売上</th>
              <th className="hidden text-right md:table-cell">次のランクまで</th>
              <th className="hidden text-right sm:table-cell">契約率（3経路）</th>
              <th className="text-right">今月見込み</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const sales = r.incentive.items[0];
              const nc = r.incentive.items[2];
              const goal = goals && goals.staff && r.staffId && goals.staff[r.staffId] ? goals.staff[r.staffId].consumedSales : null;
              return (
                <tr key={r.key} className="cursor-pointer hover:bg-surface-2" onClick={() => onOpen(r)}>
                  <td className="text-center text-xs font-semibold text-muted num">{i + 1}</td>
                  <td className="whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink">{r.name}</span>
                      {!r.linked ? <Badge tone="warn" icon="link-2-off">未連携</Badge> : null}
                    </div>
                    <div className="text-[11px] text-muted">{r.storeName}</div>
                  </td>
                  <td className="num-cell">
                    <div className="font-semibold text-ink">{yen(r.metrics.consumedSales)}</div>
                    <div className="ml-auto mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-surface-3">
                      <div className="h-full rounded-full bg-[var(--chart-sales)]" style={{ width: `${(r.metrics.consumedSales / maxSales) * 100}%` }} />
                    </div>
                    {goal ? <div className="mt-0.5 text-[10px] text-muted">目標 {yenShort(goal)}</div> : null}
                  </td>
                  <td className="hidden num-cell md:table-cell">
                    {sales.nextTier ? <><div className="text-ink">{yen(sales.nextTier.gap)}</div><div className="text-[11px] text-muted">約{sales.nextTier.sessions}回</div></> : <Badge tone="good" icon="trophy">最上位</Badge>}
                  </td>
                  <td className="hidden num-cell sm:table-cell">
                    {nc.visits > 0 ? <><div className="text-ink">{pct(nc.ratePct)}</div><div className="text-[11px] text-muted">{nc.contracts}/{nc.visits}名</div></> : <span className="text-muted">—</span>}
                  </td>
                  <td className="num-cell"><span className="font-bold text-ink">{yen(r.incentive.total)}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function StoresTable({ summary }) {
  if (summary.stores.length < 2) return null;
  return (
    <Card title="店舗別" icon="store" pad={false}>
      <div className="scroll-x">
        <table className="data-table">
          <thead>
            <tr>
              <th>店舗</th>
              <th className="text-right">施術消化売上</th>
              <th className="text-right">施術数</th>
              <th className="text-right">新規（3経路）</th>
              <th className="text-right">契約率</th>
              <th className="text-right">会員数</th>
              <th className="text-right">退会率</th>
              <th>継続率インセン</th>
            </tr>
          </thead>
          <tbody>
            {summary.stores.map((s) => (
              <tr key={s.storeId}>
                <td className="font-semibold text-ink">{s.name}{!s.linked ? <Badge tone="warn" className="ml-2">未連携</Badge> : null}</td>
                <td className="num-cell">{yen(s.consumedSales)}</td>
                <td className="num-cell">{num(s.treatmentCount)}</td>
                <td className="num-cell">{num(s.contract3ch.visits)}</td>
                <td className="num-cell">{s.contract3ch.ratePct != null ? pct(s.contract3ch.ratePct) : '—'}</td>
                <td className="num-cell">{s.retention ? num(s.retention.memberCount) : '—'}</td>
                <td className="num-cell">{s.retention && s.retention.churnRatePct != null ? pct(s.retention.churnRatePct) : '—'}</td>
                <td><StatusPill {...itemStatus(s.retentionIncentive)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function StoreHome({ summary, goals }) {
  const { storeId } = useApp();
  const [open, setOpen] = useState(null);
  const storeGoal = useMemo(() => {
    if (!goals || !goals.stores) return null;
    const ids = storeId === 'all' ? summary.scope.storeIds : [storeId];
    const vals = ids.map((id) => goals.stores[id] && goals.stores[id].consumedSales).filter((v) => v > 0);
    // 全店舗表示では、全店舗に目標がある時だけ合計を目標として扱う（一部だけだと達成率が過大になる）
    return vals.length && vals.length === ids.length ? vals.reduce((a, b) => a + b, 0) : null;
  }, [goals, storeId, summary.scope.storeIds]);
  const me = summary.me;

  return (
    <div className="space-y-4">
      {me ? (
        <button type="button" onClick={() => setOpen(me)} className="card card-pad flex w-full items-center justify-between gap-3 text-left hover:border-line-strong">
          <span className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gold-50 text-gold-700 dark:bg-gold-500/15 dark:text-gold-200"><Icon name="award" size={18} /></span>
            <span>
              <span className="block text-xs font-semibold text-ink-2">あなたの今月のインセンティブ見込み</span>
              <span className="block text-lg font-bold text-ink num">{yen(me.incentive.total)}</span>
            </span>
          </span>
          <Icon name="chevron-right" size={18} className="text-muted" />
        </button>
      ) : null}
      <StoreKpis summary={summary} storeGoal={storeGoal} />
      <div className="grid gap-4 lg:grid-cols-3">
        <StoreTrendCard summary={summary} storeGoal={storeGoal} />
        <StoreIncentiveCard summary={summary} />
      </div>
      <StaffRanking summary={summary} goals={goals} onOpen={setOpen} />
      <StoresTable summary={summary} />
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${open.name} さんのインセンティブ` : ''} size="lg">
        {open ? (
          <StaffDetail row={open} summary={summary}
            goal={goals && goals.staff && open.staffId && goals.staff[open.staffId] ? goals.staff[open.staffId].consumedSales : null} />
        ) : null}
      </Modal>
    </div>
  );
}

export default function HomePage() {
  const { month, storeId } = useApp();
  const summary = useSummary(month, storeId);
  const goals = useGoals(month);
  const data = summary.shown;
  const isStaff = role === 'staff';
  const title = currentAccess ? `${greeting()}、${currentAccess.name}さん` : 'ダッシュボード';

  return (
    <div>
      <PageHeader title={title} subtitle={isStaff ? 'SalonOne の実績から、今月のインセンティブと次のランクまでの距離を表示しています' : 'SalonOne の実績から、店舗とスタッフの売上・インセンティブを表示しています'} />
      <ScopeBar data={data} />
      <DataWarnings data={data} error={summary.error} />
      {data ? <PreviewNote period={data.period} rules={data.rules} /> : null}
      {!data ? <LoadingBlock /> : (
        <div className={cx('transition-opacity', summary.stale || summary.loading ? 'opacity-60' : '')}>
          {isStaff ? <MyHome summary={data} goals={goals.shown} /> : <StoreHome summary={data} goals={goals.shown} />}
        </div>
      )}
    </div>
  );
}
