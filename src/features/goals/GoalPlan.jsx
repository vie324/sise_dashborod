import { useMemo, useState } from 'react';
import { useTrend } from '../../lib/hooks.js';
import { isManagerOrAbove } from '../../lib/access.js';
import { Badge, Banner, EmptyState, Skeleton, cx } from '../../ui/primitives.jsx';
import { ColumnChart, ChartTable } from '../../ui/charts.jsx';
import Icon from '../../ui/Icon.jsx';
import { yen, yenShort, num, pct } from '../../lib/format.js';
import { navigate } from '../../app/router.js';
import { buildGoalPlan, monthFrequency, CONTRACT_VISITS } from '../../../shared/goal-plan.js';
import { monthOf, monthProgress, formatMonthJa, monthsBetween } from '../../../shared/dates.js';

// ============================================================
// 特別目標の「達成までの道すじ」
// ------------------------------------------------------------
// 店舗の月別推移（直近 12ヶ月）から shared/goal-plan.js で逆算し、
//   1. どの手段で伸ばすか（バランス・新規・契約率・来店頻度・単価）
//   2. 売上のしくみ（KPI ツリー）で、今 → 目標の月 にどう変わるか
//   3. 毎月の行動目標と月ごとの目安
//   4. 過去の実績（グラフと表）
// を表示する。
// ============================================================

const mLabel = (m) => `${Number(m.slice(5))}月`;
const pctOf = (rate, digits = 0) => (rate == null ? '—' : pct(rate * 100, digits));
const times = (v, digits = 2) => (v == null ? '—' : `${num(v, digits)}回`);
const persons = (v, digits = 0) => (v == null ? '—' : `${num(v, digits)}名`);
const cases = (v) => (v == null ? '—' : `${num(v, 1)}件`);

/** 月の数字の書式（目標の指標ごと） */
export const METRIC_FORMAT = {
  consumedSales: (v) => yen(v),
  newCount: (v) => `${num(Math.round(v))}名`,
  memberCount: (v) => `${num(Math.round(v))}名`,
};

/** 特別目標 1件ぶんの推移と道すじ */
export function useGoalPlan(goal, today) {
  const thisMonth = monthOf(today);
  const trend = useTrend(goal ? thisMonth : null, goal ? goal.storeId : null, 12);
  const t = trend.data;
  const plan = useMemo(() => {
    if (!goal || !t) return null;
    const rows = t.months.filter((m) => !m.future);
    return buildGoalPlan({
      history: rows.filter((m) => m.month < thisMonth),
      current: rows.find((m) => m.month === thisMonth) || null,
      progress: monthProgress(thisMonth, t.asOf),
      metric: goal.metric,
      target: goal.target,
      deadline: goal.deadline,
      currentMonth: thisMonth,
      startMonth: goal.startMonth,
    });
  }, [goal, t, thisMonth]);
  return { plan, trend: t, loading: trend.loading && !t, error: trend.error };
}

const FEASIBILITY = {
  reached: { tone: 'good', label: '過去に達成あり' },
  stretch: { tone: 'gold', label: '過去最高を少し超える' },
  hard: { tone: 'warn', label: '過去最高を大きく超える' },
  impossible: { tone: 'bad', label: 'この手段だけでは届かない' },
};

function FeasibilityBadge({ value }) {
  const f = FEASIBILITY[value];
  return f ? <Badge tone={f.tone}>{f.label}</Badge> : null;
}

/** 手段の中でいちばん厳しい判定（ボタンに出す） */
const RANK = { impossible: 3, hard: 2, stretch: 1, reached: 0 };
function worstOf(changes) {
  return (changes || []).reduce((w, c) => (c.feasibility && (w == null || RANK[c.feasibility] > RANK[w]) ? c.feasibility : w), null);
}

const KPI_TEXT = {
  newCount: (c) => `新規 ${num(c.from, 0)}→${num(c.to, 0)}名`,
  contractRate: (c) => `契約率 ${pctOf(c.from)}→${pctOf(c.to)}`,
  frequency: (c) => `来店 ${num(c.from, 2)}→${num(c.to, 2)}回`,
  unitPrice: (c) => `単価 ${yenShort(c.from)}→${yenShort(c.to)}`,
  churnRate: (c) => `退会率 ${pctOf(c.from, 1)}→${pctOf(c.to, 1)}`,
};

function LeverPicker({ plan, value, onChange }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5" role="radiogroup" aria-label="どの指標で伸ばすか">
      {plan.order.map((key) => {
        const l = plan.levers[key];
        const active = key === value;
        const worst = l.available ? worstOf(l.changes) : null;
        return (
          <button key={key} type="button" role="radio" aria-checked={active} disabled={!l.available} onClick={() => onChange(key)}
            className={cx('flex min-w-0 flex-col gap-1 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              active ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/15' : 'border-line hover:bg-surface-2')}>
            <span className="flex items-center gap-1.5 text-[13px] font-bold text-ink">
              <Icon name={l.icon} size={15} className={active ? 'text-brand-600 dark:text-brand-300' : 'text-muted'} />{l.label}
            </span>
            {l.available ? (
              <>
                <span className="text-[11px] leading-snug text-ink-2 num">{l.changes.map((c) => KPI_TEXT[c.kpi](c)).join('・')}</span>
                {worst ? <span><FeasibilityBadge value={worst} /></span> : null}
              </>
            ) : <span className="text-[11px] text-muted">{l.reason || 'データが足りません'}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------
// KPI ツリー
// ------------------------------------------------------------
function Node({ label, sub, from, to, format, lever, feasibility, children, top = false }) {
  const changed = from != null && to != null && Math.abs(to - from) > Math.max(1e-6, Math.abs(from) * 0.001);
  const up = changed && to > from;
  return (
    <li className={cx('relative', top ? '' : 'pl-3 before:absolute before:left-0 before:top-[19px] before:w-2.5 before:border-t before:border-line-strong')}>
      <div className={cx('flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl px-3 py-2',
        lever ? 'bg-brand-50 ring-1 ring-brand-500/40 dark:bg-brand-500/15' : top ? 'bg-surface-2' : '')}>
        <div className="min-w-0">
          <div className={cx('flex items-center gap-1.5 font-semibold text-ink', top ? 'text-sm' : 'text-[13px]')}>
            {lever ? <Icon name="arrow-big-up-dash" size={14} className="text-brand-600 dark:text-brand-300" /> : null}
            {label}
          </div>
          {sub ? <div className="text-[11px] text-muted">{sub}</div> : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-right">
          {lever && feasibility ? <FeasibilityBadge value={feasibility} /> : null}
          <span className="text-[13px] text-ink-2 num">
            {format(from)}
            <Icon name="arrow-right" size={13} className="mx-1 inline text-muted" />
            <span className={cx('font-bold', changed ? (up ? 'text-brand-700 dark:text-brand-200' : 'text-ink') : 'text-ink')}>{format(to)}</span>
          </span>
        </div>
      </div>
      {children ? <ul className="ml-3 mt-1 space-y-1 border-l border-line-strong">{children}</ul> : null}
    </li>
  );
}

function SalesTree({ plan, leverKey }) {
  const b = plan.base;
  const l = plan.levers[leverKey];
  const p = l.projection;
  const feas = Object.fromEntries(l.changes.map((c) => [c.kpi, c.feasibility]));
  const isLever = (kpi) => kpi in feas;
  const added = (p.contracts - b.contracts) * plan.weight;
  return (
    <ul className="space-y-1">
      <Node top label={`月の施術消化売上（${mLabel(plan.deadline)}）`} sub="= 施術数 × 1回あたりの単価" from={b.sales} to={p.sales} format={yen}>
        <Node label="施術数" sub="= 新規の来店 + 既存のお客様の来店" from={b.treatments} to={p.treatments} format={(v) => times(v, 0)}>
          <Node label="新規の来店" from={b.newCount} to={p.newCount} format={(v) => persons(v)} lever={isLever('newCount')} feasibility={feas.newCount} />
          <Node label="既存のお客様の来店" sub="= 既存のお客様の数 × 来店頻度 + 契約で増えたお客様 × 月2回" from={b.repeat} to={p.repeat} format={(v) => times(v, 0)}>
            <Node label="来店頻度" sub="既存のお客様 1人あたり・月" from={b.frequency} to={p.frequency} format={(v) => times(v)} lever={isLever('frequency')} feasibility={feas.frequency} />
            <Node label="既存のお客様の数" sub={added > 0.05 ? `契約で 約${num(added, 0)}名増える（${plan.buildMonths}ヶ月分・退会を引いて）` : null}
              from={b.existingCustomers} to={p.existing} format={(v) => persons(v)}>
              <Node label="毎月の契約" sub="= 新規 × 契約率" from={b.contracts} to={p.contracts} format={cases}>
                <Node label="契約率" from={b.contractRate} to={p.contractRate} format={(v) => pctOf(v)} lever={isLever('contractRate')} feasibility={feas.contractRate} />
              </Node>
            </Node>
          </Node>
        </Node>
        <Node label="1回あたりの単価" from={b.unitPrice} to={p.unitPrice} format={yen} lever={isLever('unitPrice')} feasibility={feas.unitPrice} />
      </Node>
    </ul>
  );
}

function MemberTree({ plan, leverKey }) {
  const b = plan.base;
  const l = plan.levers[leverKey];
  const p = l.projection;
  const feas = Object.fromEntries(l.changes.map((c) => [c.kpi, c.feasibility]));
  const isLever = (kpi) => kpi in feas;
  const churnTo = p.churnRate != null ? p.churnRate : b.churnRate;
  return (
    <ul className="space-y-1">
      <Node top label={`会員数（${mLabel(plan.deadline)}末）`} sub={`= 前の月の会員数 − 退会 + 毎月の契約（${plan.months}ヶ月分）`} from={b.memberCount} to={plan.target} format={(v) => persons(v)}>
        <Node label="毎月の契約" sub="= 新規 × 契約率" from={b.contracts} to={p.contracts} format={cases}>
          <Node label="新規" from={b.newCount} to={p.newCount} format={(v) => persons(v)} lever={isLever('newCount')} feasibility={feas.newCount} />
          <Node label="契約率" from={b.contractRate} to={p.contractRate} format={(v) => pctOf(v)} lever={isLever('contractRate')} feasibility={feas.contractRate} />
        </Node>
        <Node label="毎月の退会率" from={b.churnRate} to={churnTo} format={(v) => pctOf(v, 1)} lever={isLever('churnRate')} feasibility={feas.churnRate} />
      </Node>
    </ul>
  );
}

// ------------------------------------------------------------
// 毎月の行動目標・月ごとの目安
// ------------------------------------------------------------
function ActionChips({ items }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.filter(Boolean).map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-1.5 text-xs text-ink-2">
          <Icon name={it.icon} size={14} className="text-brand-600 dark:text-brand-300" />{it.label}
          <span className="text-sm font-bold text-ink num">{it.value}</span>
        </span>
      ))}
    </div>
  );
}

function MilestoneTable({ plan, columns }) {
  const thisMonth = plan.currentMonth;
  return (
    <div className="scroll-x rounded-xl border border-line">
      <table className="data-table text-xs">
        <thead>
          <tr><th>月</th>{columns.map((c) => <th key={c.label} className="text-right">{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {plan.milestones.map((m) => (
            <tr key={m.month}>
              <td className="whitespace-nowrap">{formatMonthJa(m.month)}{m.month === thisMonth ? <span className="ml-1 text-[10px] text-muted">今月</span> : null}{m.month === plan.deadline ? <Icon name="flag" size={12} className="ml-1 inline text-gold-600" /> : null}</td>
              {columns.map((c) => <td key={c.label} className="num-cell whitespace-nowrap">{c.render(m)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------
// 過去の実績
// ------------------------------------------------------------
function HistoryBlock({ plan, trend, goal }) {
  const thisMonth = plan.currentMonth;
  const rows = trend.months.filter((m) => !m.future);
  const basis = plan.base ? plan.base.frequencyBasis : 'default';
  const baseMonths = new Set(plan.base ? plan.base.months : []);
  const metric = goal.metric;
  const short = metric === 'consumedSales' ? yenShort : (v) => num(v);
  const chart = rows.filter((m) => m[metric] != null).map((m) => ({
    key: m.month,
    label: m.month === thisMonth ? `${Number(m.month.slice(5))}月*` : `${Number(m.month.slice(5))}月`,
    value: m[metric],
    sub: m.month === thisMonth ? '今月（途中まで）' : baseMonths.has(m.month) ? '直近3ヶ月の平均に使用' : null,
  }));
  return (
    <div>
      <ColumnChart data={chart} target={goal.target} targetLabel="目標" format={short} height={190} ariaLabel={`月別の${metric === 'consumedSales' ? '施術消化売上' : metric === 'newCount' ? '新規数' : '会員数'}と目標`} />
      <p className="mt-1 text-[11px] text-muted">* 今月は途中までの実績。横線が目標です。</p>
      <ChartTable
        columns={[
          { key: 'month', label: '月', render: (r) => <span className="whitespace-nowrap">{formatMonthJa(r.month)}{baseMonths.has(r.month) ? ' ●' : ''}</span> },
          { key: 'consumedSales', label: '施術消化売上', align: 'right', render: (r) => yen(r.consumedSales) },
          { key: 'treatmentCount', label: '施術数', align: 'right', render: (r) => num(r.treatmentCount) },
          { key: 'unit', label: '単価', align: 'right', render: (r) => (r.treatmentCount ? yen(r.consumedSales / r.treatmentCount) : '—') },
          { key: 'newCount', label: '新規', align: 'right', render: (r) => num(r.newCount) },
          { key: 'purchaseCount', label: '契約', align: 'right', render: (r) => num(r.purchaseCount) },
          { key: 'rate', label: '契約率', align: 'right', render: (r) => (r.contractRatePct != null ? pct(r.contractRatePct, 0) : '—') },
          { key: 'freq', label: '来店頻度', align: 'right', render: (r) => { const f = monthFrequency(r, basis); return f != null ? num(f, 2) : '—'; } },
          { key: 'memberCount', label: '会員数', align: 'right', render: (r) => num(r.memberCount) },
          { key: 'churn', label: '退会率', align: 'right', render: (r) => (r.churnRatePct != null ? pct(r.churnRatePct) : '—') },
        ]}
        rows={[...rows].reverse()}
      />
    </div>
  );
}

function Assumptions({ plan }) {
  const b = plan.base;
  if (!b) return null;
  const span = b.months.length > 1 ? `${mLabel(b.months[0])}〜${mLabel(b.lastMonth)}` : mLabel(b.lastMonth);
  const freq = b.frequencyBasis === 'customers'
    ? '来店頻度 = 既存のお客様の来店回数 ÷ 既存のお客様の数（顧客数 − 新規数）。'
    : b.frequencyBasis === 'members' ? '来店頻度は会員 1人あたりで計算しています。' : '来店頻度のデータが無いため月2回として計算しています。';
  return (
    <p className="text-[11px] leading-relaxed text-muted">
      <Icon name="info" size={12} className="mr-1 inline" />
      直近{b.months.length}ヶ月（{span}）の平均をもとに、今のペースが続くと仮定した目安です。
      契約したお客様は月{CONTRACT_VISITS}回来店し、毎月 退会率{b.churnRate != null ? `（平均 ${pctOf(b.churnRate, 1)}）` : ''}の分だけ減るとして計算しています。{freq}
      毎月の目安は今の水準から目標の月へまっすぐ近づけた値です。
    </p>
  );
}

// ------------------------------------------------------------
// 道すじ（状態ごと）
// ------------------------------------------------------------
function SalesPlan({ plan }) {
  const [leverKey, setLeverKey] = useState('balanced');
  const key = plan.levers[leverKey] && plan.levers[leverKey].available ? leverKey : plan.order.find((k) => plan.levers[k].available);
  if (!key) return <EmptyState compact icon="circle-help" title="逆算に必要なデータが足りません" />;
  const l = plan.levers[key];
  const p = l.projection;
  const b = plan.base;
  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed text-ink-2">
        直近3ヶ月の平均は <span className="font-bold text-ink num">{yen(b.sales)}</span>/月。目標まで
        <span className="mx-1 font-bold text-ink num">あと {yen(plan.gap)}/月</span>
        （施術 約{num(Math.ceil(plan.gapTreatments))}回ぶん）です。どの指標で伸ばすかを選んでください。
      </p>
      <LeverPicker plan={plan} value={key} onChange={setLeverKey} />
      <div>
        <h4 className="mb-2 text-xs font-bold text-ink-2">売上のしくみ（今 → {formatMonthJa(plan.deadline)}）</h4>
        <SalesTree plan={plan} leverKey={key} />
      </div>
      <div>
        <h4 className="mb-2 text-xs font-bold text-ink-2">今月から毎月の行動目標</h4>
        <ActionChips items={[
          { icon: 'user-plus', label: '新規', value: persons(p.newCount) },
          { icon: 'handshake', label: '契約', value: `${num(p.contracts, 1)}件（${pctOf(p.contractRate)}）` },
          { icon: 'repeat', label: '既存のお客様の来店', value: `月${num(p.frequency, 2)}回` },
          p.unitPrice > b.unitPrice + 1 ? { icon: 'tag', label: '単価', value: yen(p.unitPrice) } : null,
        ]} />
      </div>
      <MilestoneTable plan={plan} columns={[
        { label: '月売上の目安', render: (m) => yen(m.value) },
        { label: '今月の見込み', render: (m) => (m.month === plan.currentMonth && plan.now ? yen(plan.now.value) : '') },
      ]} />
    </div>
  );
}

function MemberPlan({ plan }) {
  const [leverKey, setLeverKey] = useState('balanced');
  const key = plan.levers[leverKey] && plan.levers[leverKey].available ? leverKey : plan.order.find((k) => plan.levers[k].available);
  const b = plan.base;
  const churnCount = (b.memberCount || 0) * (b.churnRate || 0);
  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed text-ink-2">
        {formatMonthJa(b.lastMonth)}末は <span className="font-bold text-ink num">{persons(b.memberCount)}</span>。
        {b.churnRate ? <>毎月 約{num(churnCount, 0)}名（退会率 {pctOf(b.churnRate, 1)}）の退会があるため、</> : null}
        {formatMonthJa(plan.deadline)}末に {persons(plan.target)} にするには
        <span className="mx-1 font-bold text-ink num">毎月 約{num(plan.neededContracts, 1)}件</span>
        の契約が必要です（今は 約{num(b.contracts, 1)}件）。
      </p>
      {key ? (
        <>
          <LeverPicker plan={plan} value={key} onChange={setLeverKey} />
          <div>
            <h4 className="mb-2 text-xs font-bold text-ink-2">会員数のしくみ（今 → {formatMonthJa(plan.deadline)}末）</h4>
            <MemberTree plan={plan} leverKey={key} />
          </div>
        </>
      ) : null}
      <MilestoneTable plan={plan} columns={[
        { label: '会員数の目安（月末）', render: (m) => persons(m.value) },
        { label: '今の会員数', render: (m) => (m.month === plan.currentMonth && plan.now ? persons(plan.now.value) : '') },
      ]} />
      <p className="text-[11px] text-muted">契約はサブスクの入会になるとして計算しています（回数券だけの契約は会員数に入りません）。</p>
    </div>
  );
}

function NewCountPlan({ plan }) {
  const b = plan.base;
  const r = b.contractRate || 0;
  return (
    <div className="space-y-4">
      <p className="text-[13px] leading-relaxed text-ink-2">
        直近3ヶ月の平均は <span className="font-bold text-ink num">{persons(b.newCount, 1)}</span>/月。
        {formatMonthJa(plan.deadline)}に {persons(plan.target)} にするには <span className="font-bold text-ink num">あと {persons(plan.gap, 1)}/月</span>、
        1週間あたり 約{num(plan.target / 4.35, 1)}名のペースです。
      </p>
      <ActionChips items={[
        { icon: 'user-plus', label: '新規', value: `月${persons(plan.target)}` },
        r ? { icon: 'handshake', label: '契約の見込み', value: `月${num(plan.target * r, 1)}件（${pctOf(r)}）` } : null,
      ]} />
      {plan.effect && r ? (
        <Banner tone="info" title="売上への効果">
          この新規数が続くと契約が毎月 約{num(plan.effect.contracts, 1)}件増え、{plan.effect.months}ヶ月後には月の施術消化売上が 約{yen(plan.effect.sales)} 増える見込みです（契約率 {pctOf(r)}・月{CONTRACT_VISITS}回来店で計算）。
        </Banner>
      ) : null}
      <MilestoneTable plan={plan} columns={[
        { label: '新規の目安', render: (m) => persons(m.value) },
        { label: '契約の見込み', render: (m) => (r ? cases(m.value * r) : '—') },
        { label: '今月の見込み', render: (m) => (m.month === plan.currentMonth && plan.now ? persons(plan.now.value) : '') },
      ]} />
      {isManagerOrAbove() ? (
        <button type="button" onClick={() => navigate('/sales')} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
          <Icon name="route" size={13} />経路別の新規と契約を売上分析で見る<Icon name="chevron-right" size={13} />
        </button>
      ) : null}
    </div>
  );
}

/** 道すじの本体（特別目標カードの下半分） */
export function GoalPlanView({ goal, plan, trend, loading, error }) {
  if (loading) return <Skeleton className="h-64 rounded-xl" />;
  if (error && !trend) return <Banner tone="bad" title="過去の実績を取得できませんでした">{error.message || String(error)}</Banner>;
  if (!plan || !trend) return null;
  const format = METRIC_FORMAT[goal.metric];
  let body = null;
  if (plan.status === 'noData') {
    body = <EmptyState compact icon="chart-no-axes-column" title="過去の実績が無いため、道すじを計算できません" message="SalonOne の店舗の対応付け（設定 > SalonOne連携）を確認してください" />;
  } else if (plan.status === 'ended') {
    body = plan.result == null
      ? <p className="text-[13px] text-ink-2">{formatMonthJa(plan.deadline)}の実績は表示できる期間（直近12ヶ月）の外です。</p>
      : (
        <Banner tone={plan.achieved ? 'info' : 'warn'} title={plan.achieved ? '目標を達成しました' : '目標に届きませんでした'}>
          {formatMonthJa(plan.deadline)}の実績 {format(plan.result)} / 目標 {format(plan.target)}（{pct((plan.result / plan.target) * 100, 0)}）
        </Banner>
      );
  } else if (plan.status === 'reached') {
    body = (
      <Banner tone="info" title="今の水準で目標に届いています">
        直近3ヶ月の平均（{format(plan.baseValue)}）がすでに目標の水準です。この水準を{formatMonthJa(plan.deadline)}まで保てば達成できます。
      </Banner>
    );
  } else if (plan.status === 'onPace') {
    body = (
      <Banner tone="info" title="今の契約ペースで届く見込みです">
        今の契約ペース（毎月 約{num(plan.base.contracts, 1)}件）を続ければ、{formatMonthJa(plan.deadline)}末に {format(plan.target)} に届く見込みです（必要なのは毎月 約{num(plan.neededContracts, 1)}件）。
      </Banner>
    );
  } else if (goal.metric === 'consumedSales') body = <SalesPlan plan={plan} />;
  else if (goal.metric === 'memberCount') body = <MemberPlan plan={plan} />;
  else body = <NewCountPlan plan={plan} />;

  // 終わった目標は結果だけ
  const showHistory = plan.status !== 'noData' && plan.status !== 'ended';
  return (
    <div className="space-y-5">
      {body}
      {showHistory ? (
        <div>
          <h4 className="mb-2 flex items-center gap-1.5 text-xs font-bold text-ink-2"><Icon name="history" size={14} className="text-muted" />過去の実績（● は直近3ヶ月の平均に使った月）</h4>
          <HistoryBlock plan={plan} trend={trend} goal={goal} />
        </div>
      ) : null}
      {plan.status === 'plan' || plan.status === 'reached' || plan.status === 'onPace' ? <Assumptions plan={plan} /> : null}
    </div>
  );
}

/** 期限までの月数の表示 */
export function deadlineLabel(deadline, thisMonth) {
  const left = monthsBetween(thisMonth, deadline);
  if (left < 0) return '終了';
  if (left === 0) return '今月まで';
  return `あと${left}ヶ月`;
}
