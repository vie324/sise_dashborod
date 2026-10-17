import { useMemo, useState } from 'react';
import { useApp } from '../../app/state.jsx';
import { useSummary, useGoals, useTrend } from '../../lib/hooks.js';
import { currentAccess, role } from '../../lib/access.js';
import { Card, Modal, PageHeader, Skeleton, EmptyState, Badge, cx } from '../../ui/primitives.jsx';
import { StatTile, StatusPill, Meter } from '../../ui/stats.jsx';
import { CumulativeChart, ChartTable } from '../../ui/charts.jsx';
import Icon from '../../ui/Icon.jsx';
import { yen, yenShort, num, pct, changeRate } from '../../lib/format.js';
import { forecastMonthEnd } from '../../../shared/metrics.js';
import { dayOfMonth, formatMonthJa } from '../../../shared/dates.js';
import { ScopeBar, DataWarnings } from '../shared/ScopeBar.jsx';
import StaffDetail from '../incentives/StaffDetail.jsx';
import { ChartLegend, itemStatus } from '../incentives/parts.jsx';
import MyHome from './MyHome.jsx';
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
      <StatTile label="新規数" icon="user-plus" value={`${num(s.newCount)}名`}
        sub={[
          s.purchaseCount != null ? `契約 ${num(s.purchaseCount)}件${s.newCount ? `（${pct((s.purchaseCount / s.newCount) * 100, 0)}）` : ''}` : null,
          `3経路 ${num(s.contract3ch.visits)}名`,
        ].filter(Boolean).join('・')} />
      <StatTile label="会員数（サブスク）" icon="id-card" value={ret.memberCount != null ? `${num(ret.memberCount)}名` : '—'}
        sub={[
          `退会率 ${pct(ret.churnRatePct)}`,
          ret.avgTenureMonths != null ? `平均継続 ${num(ret.avgTenureMonths, 1)}ヶ月` : null,
        ].filter(Boolean).join('・')} />
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

/** 上位 3名はメダルの色、それ以外は番号 */
function RankNumber({ index }) {
  const medal = ['from-gold-300 to-gold-500 text-white', 'from-[#d9dde1] to-[#a9b1b8] text-white', 'from-[#e3b48a] to-[#b77a46] text-white'][index];
  if (medal) {
    return (
      <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-xs font-bold shadow-card num', medal)}
        aria-label={`${index + 1}位`}>{index + 1}</span>
    );
  }
  return <span className="flex h-7 w-7 shrink-0 items-center justify-center text-xs font-semibold text-muted num" aria-label={`${index + 1}位`}>{index + 1}</span>;
}

function RankChip({ item }) {
  return item.tierIndex >= 0
    ? <Badge tone="gold" icon="award">ランク{item.tierIndex + 1}</Badge>
    : <Badge tone="neutral">ランク外</Badge>;
}

/**
 * チームの状況: 見込み合計・ランクの分布・「あと少し」のスタッフ。
 * 店舗責任者が声をかける相手が一目で分かるようにする。
 */
function TeamStatusCard({ summary, onOpen }) {
  const rows = summary.staff;
  const tiers = summary.rules.sales.tiers;
  const totalMonth = rows.reduce((a, r) => a + r.incentive.total, 0);
  const totalPeriod = rows.reduce((a, r) => a + r.period.total, 0);
  const dist = [-1, ...tiers.map((_, i) => i)].map((ti) => ({ ti, count: rows.filter((r) => r.incentive.items[0].tierIndex === ti).length }));
  const close = rows
    .filter((r) => r.incentive.items[0].nextTier && r.incentive.items[0].nextTier.sessions <= 5)
    .sort((a, b) => a.incentive.items[0].nextTier.gap - b.incentive.items[0].nextTier.gap)
    .slice(0, 3);
  const single = summary.stores.length === 1 ? summary.stores[0] : null;
  return (
    <Card title="チームの状況" icon="users-round" subtitle={summary.period.preview ? '制度開始前の試算' : `支給期間 ${summary.period.label}`}
      actions={<button type="button" onClick={() => navigate('/incentives')} className="inline-flex items-center gap-0.5 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">内訳<Icon name="chevron-right" size={14} /></button>}>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs font-semibold text-ink-2">今月の見込み合計</div>
          <div className="mt-1 text-[22px] font-bold text-ink num">{yen(totalMonth)}</div>
        </div>
        <div>
          <div className="text-xs font-semibold text-ink-2">支給期間の合計</div>
          <div className="mt-1 text-[22px] font-bold text-ink num">{yen(totalPeriod)}</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 text-xs font-semibold text-ink-2">施術消化売上のランク分布</div>
        <div className="grid grid-cols-6 gap-1">
          {dist.map((d) => (
            <div key={d.ti} className={cx('rounded-lg px-1 py-1.5 text-center', d.count > 0 ? (d.ti >= 0 ? 'bg-gold-50 dark:bg-gold-500/15' : 'bg-surface-3') : 'bg-surface-2')}>
              <div className={cx('text-[15px] font-bold leading-tight num', d.count > 0 ? 'text-ink' : 'text-muted')}>{d.count}</div>
              <div className="text-[10px] leading-tight text-muted">{d.ti >= 0 ? `ランク${d.ti + 1}` : 'ランク外'}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-ink-2">
          <Icon name="flag" size={13} className="text-gold-600 dark:text-gold-300" />次のランクまであと少し
        </div>
        {close.length === 0 ? (
          <p className="rounded-xl bg-surface-2 px-3 py-2.5 text-xs text-muted">あと 5回以内で次のランクに届くスタッフはいません</p>
        ) : (
          <ul className="space-y-1.5">
            {close.map((r) => {
              const nt = r.incentive.items[0].nextTier;
              return (
                <li key={r.key}>
                  <button type="button" onClick={() => onOpen(r)} className="flex w-full items-center justify-between gap-2 rounded-xl border border-line px-3 py-2 text-left hover:bg-surface-2">
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-ink">{r.name}</span>
                      <span className="block text-[11px] text-muted">あと{yen(nt.gap)}・約{nt.sessions}回</span>
                    </span>
                    <Badge tone="gold" icon="arrow-up-right">{yen(nt.amount)}へ</Badge>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

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
    </Card>
  );
}

function NextRankCell({ item }) {
  if (!item.nextTier) return <Badge tone="good" icon="trophy">最上位</Badge>;
  return (
    <>
      <div className="text-ink">{yen(item.nextTier.gap)}</div>
      <div className="text-[11px] text-muted">約{item.nextTier.sessions}回で {yenShort(item.nextTier.amount)}</div>
    </>
  );
}

function StaffRanking({ summary, goals, onOpen }) {
  const rows = summary.staff;
  if (rows.length === 0) {
    return <Card title="スタッフ別" icon="users"><EmptyState compact icon="users" title="この範囲のスタッフ実績はまだありません" /></Card>;
  }
  const goalOf = (r) => (goals && goals.staff && r.staffId && goals.staff[r.staffId] ? goals.staff[r.staffId].consumedSales : null);
  return (
    <Card title="スタッフ別ランキング" icon="trophy" subtitle="施術消化売上の順。選ぶとインセンティブの内訳を表示します" pad={false}>
      {/* PC: 表 */}
      <div className="scroll-x hidden md:block">
        <table className="data-table">
          <thead>
            <tr>
              <th className="w-12 text-center">順位</th>
              <th>スタッフ</th>
              <th className="text-right">施術消化売上</th>
              <th className="w-44">次のランクまで</th>
              <th className="text-right">契約率（3経路）</th>
              <th className="text-right">今月見込み</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const sales = r.incentive.items[0];
              const nc = r.incentive.items[2];
              const goal = goalOf(r);
              return (
                <tr key={r.key} className="cursor-pointer hover:bg-surface-2" onClick={() => onOpen(r)}>
                  <td><div className="flex justify-center"><RankNumber index={i} /></div></td>
                  <td className="whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink">{r.name}</span>
                      <RankChip item={sales} />
                      {!r.linked ? <Badge tone="warn" icon="link-2-off">未連携</Badge> : null}
                    </div>
                    <div className="text-[11px] text-muted">{r.storeName}{goal ? `・目標 ${yenShort(goal)}（${pct((r.metrics.consumedSales / goal) * 100, 0)}）` : ''}</div>
                  </td>
                  <td className="num-cell"><span className="font-semibold text-ink">{yen(r.metrics.consumedSales)}</span></td>
                  <td>
                    <Meter value={sales.current} max={sales.nextTier ? sales.nextTier.min : sales.current || 1} height={6}
                      tone={sales.tierIndex >= 0 ? 'gold' : 'brand'} label={`${r.name}さんの次のランクまでの進み具合`} />
                    <div className="mt-1 flex items-baseline justify-between gap-2 text-[11px] text-muted num">
                      {sales.nextTier ? <><span>あと{yen(sales.nextTier.gap)}</span><span>約{sales.nextTier.sessions}回</span></> : <span className="text-ink-2">最上位ランク</span>}
                    </div>
                  </td>
                  <td className="num-cell">
                    {nc.visits > 0 ? <><div className="text-ink">{pct(nc.ratePct)}</div><div className="text-[11px] text-muted">{nc.contracts}/{nc.visits}名</div></> : <span className="text-muted">—</span>}
                  </td>
                  <td className="num-cell"><span className="font-bold text-ink">{yen(r.incentive.total)}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* スマホ: カード */}
      <ul className="space-y-2 px-4 pb-4 md:hidden">
        {rows.map((r, i) => {
          const sales = r.incentive.items[0];
          return (
            <li key={r.key}>
              <button type="button" onClick={() => onOpen(r)} className="flex w-full items-start gap-3 rounded-2xl border border-line p-3 text-left active:bg-surface-2">
                <RankNumber index={i} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[14px] font-bold text-ink">{r.name}</span>
                      <RankChip item={sales} />
                    </span>
                    <span className="shrink-0 text-[15px] font-bold text-ink num">{yen(r.incentive.total)}</span>
                  </span>
                  <span className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-muted">
                    <span className="truncate">{r.storeName}{!r.linked ? '・未連携' : ''}</span>
                    <span className="shrink-0 num">消化 {yen(r.metrics.consumedSales)}</span>
                  </span>
                  <Meter className="mt-2" value={sales.current} max={sales.nextTier ? sales.nextTier.min : sales.current || 1} height={6}
                    tone={sales.tierIndex >= 0 ? 'gold' : 'brand'} label={`${r.name}さんの次のランクまでの進み具合`} />
                  <span className="mt-1 block text-[11px] text-ink-2 num">
                    {sales.nextTier ? `次のランクまで あと${yen(sales.nextTier.gap)}（約${sales.nextTier.sessions}回）` : '最上位ランクに到達'}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function StoresTable({ summary }) {
  if (summary.stores.length < 2) return null;
  return (
    <Card title="店舗別" icon="store" pad={false}>
      <div className="scroll-x hidden md:block">
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
      <ul className="grid gap-2 px-4 pb-4 md:hidden">
        {summary.stores.map((s) => (
          <li key={s.storeId} className="rounded-2xl border border-line p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[14px] font-bold text-ink">{s.name}{!s.linked ? <Badge tone="warn" className="ml-2">未連携</Badge> : null}</span>
              <StatusPill {...itemStatus(s.retentionIncentive)} />
            </div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
              <div><dt className="text-muted">消化売上</dt><dd className="font-semibold text-ink num">{yenShort(s.consumedSales)}</dd></div>
              <div><dt className="text-muted">施術数</dt><dd className="font-semibold text-ink num">{num(s.treatmentCount)}</dd></div>
              <div><dt className="text-muted">新規（3経路）</dt><dd className="font-semibold text-ink num">{num(s.contract3ch.visits)}</dd></div>
              <div><dt className="text-muted">契約率</dt><dd className="font-semibold text-ink num">{s.contract3ch.ratePct != null ? pct(s.contract3ch.ratePct) : '—'}</dd></div>
              <div><dt className="text-muted">会員数</dt><dd className="font-semibold text-ink num">{s.retention ? num(s.retention.memberCount) : '—'}</dd></div>
              <div><dt className="text-muted">退会率</dt><dd className="font-semibold text-ink num">{s.retention && s.retention.churnRatePct != null ? pct(s.retention.churnRatePct) : '—'}</dd></div>
            </dl>
          </li>
        ))}
      </ul>
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
        <button type="button" onClick={() => setOpen(me)}
          className="relative flex w-full items-center gap-3 overflow-hidden rounded-[18px] bg-[linear-gradient(140deg,#21633f_0%,#184b33_60%,#0d2f20_100%)] px-4 py-3.5 text-left text-white shadow-card transition-transform active:scale-[0.995]">
          <span className="pointer-events-none absolute -right-10 -top-14 h-36 w-36 rounded-full bg-white/[0.06]" aria-hidden="true" />
          <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold-400/20 text-gold-300"><Icon name="award" size={20} /></span>
          <span className="relative min-w-0 flex-1">
            <span className="block text-xs font-semibold text-white/70">あなたの今月のインセンティブ{summary.period.preview ? '（試算）' : ''}</span>
            <span className="block text-xl font-bold num">{yen(me.incentive.total)}</span>
          </span>
          {me.incentive.items[0].nextTier ? (
            <span className="relative hidden text-right text-xs text-white/70 sm:block">
              次のランクまで<span className="block text-[13px] font-bold text-gold-200 num">あと{yen(me.incentive.items[0].nextTier.gap)}</span>
            </span>
          ) : null}
          <Icon name="chevron-right" size={18} className="relative shrink-0 text-white/60" />
        </button>
      ) : null}
      <StoreKpis summary={summary} storeGoal={storeGoal} />
      <div className="grid gap-4 lg:grid-cols-3">
        <StoreTrendCard summary={summary} storeGoal={storeGoal} />
        <TeamStatusCard summary={summary} onOpen={setOpen} />
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
  // 自己ベストの比較用（スタッフ本人のときだけ取得）
  const trend = useTrend(isStaff ? month : null, storeId, 6);
  const title = currentAccess ? `${greeting()}、${currentAccess.name}さん` : 'ダッシュボード';

  return (
    <div>
      <PageHeader title={title} subtitle={isStaff ? null : 'SalonOne の実績から、店舗とスタッフの売上・インセンティブを表示しています'} />
      <ScopeBar data={data} />
      <DataWarnings data={data} error={summary.error} preview />
      {!data ? <LoadingBlock /> : (
        <div className={cx('transition-opacity', summary.stale || summary.loading ? 'opacity-60' : '')}>
          {isStaff
            ? <MyHome summary={data} goals={goals.shown} trend={trend.shown} stale={summary.stale} />
            : <StoreHome summary={data} goals={goals.shown} />}
        </div>
      )}
    </div>
  );
}
