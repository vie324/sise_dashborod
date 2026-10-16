import Icon from '../../ui/Icon.jsx';
import { Card, Badge, cx } from '../../ui/primitives.jsx';
import { TierMeter, StatusPill, Meter } from '../../ui/stats.jsx';
import { CumulativeChart } from '../../ui/charts.jsx';
import { yen, yenShort, num, pct } from '../../lib/format.js';
import { forecastMonthEnd } from '../../../shared/metrics.js';
import { channelLabel } from '../../../shared/channels.js';
import { dayOfMonth } from '../../../shared/dates.js';

// ============================================================
// インセンティブ表示の部品（ホーム・インセンティブ・目標画面で共通）
// ============================================================

export const INCENTIVE_META = {
  sales: { icon: 'banknote', title: '施術消化売上' },
  retention: { icon: 'repeat', title: '継続率', short: '継続率（店舗）' },
  newContract: { icon: 'user-plus', title: '新規契約' },
  sns: { icon: 'smartphone', title: 'Minimo・Threads・Instagram', short: 'SNS集客' },
  referral: { icon: 'users', title: '紹介' },
};

/** インセンティブ 1項目の状態（色だけに頼らずラベルとアイコンで示す） */
export function itemStatus(item) {
  switch (item.key) {
    case 'sales':
      if (item.achieved) return { status: 'achieved', label: `${yenShort(item.tiers[item.tierIndex].min)}突破` };
      if (item.nextTier && item.nextTier.sessions <= 5) return { status: 'close', label: `あと${item.nextTier.sessions}回` };
      return { status: 'pending', label: '未達' };
    case 'retention':
      if (!item.known) return { status: 'pending', label: 'データなし' };
      return item.eligible ? { status: 'achieved', label: '条件達成' } : { status: 'unmet', label: '条件未達' };
    case 'newContract':
      if (!item.eligible) return { status: 'unmet', label: '条件未達' };
      return item.amount > 0 ? { status: 'achieved', label: `契約率${pct(item.ratePct)}` } : { status: 'close', label: '契約率40%未満' };
    case 'sns':
      if (!item.eligible) return { status: item.gap <= 3 ? 'close' : 'unmet', label: `あと${item.gap}名` };
      return item.amount > 0 ? { status: 'achieved', label: `${item.contracts}件契約` } : { status: 'pending', label: '契約0件' };
    case 'referral':
      return item.contracts > 0 ? { status: 'achieved', label: `${item.contracts}件` } : { status: 'none', label: '0件' };
    default:
      return { status: 'pending' };
  }
}

/** 5項目の内訳（行リスト） */
export function IncentiveBreakdown({ incentive, onSelect, className = '' }) {
  if (!incentive) return null;
  return (
    <ul className={cx('divide-y divide-line', className)}>
      {incentive.items.map((item) => {
        const meta = INCENTIVE_META[item.key];
        const st = itemStatus(item);
        const Row = onSelect ? 'button' : 'div';
        return (
          <li key={item.key}>
            <Row type={onSelect ? 'button' : undefined} onClick={onSelect ? () => onSelect(item.key) : undefined}
              className={cx('flex w-full items-center gap-3 py-2.5 text-left', onSelect ? 'rounded-lg hover:bg-surface-2' : '')}>
              <span className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', item.amount > 0 ? 'bg-gold-50 text-gold-700 dark:bg-gold-500/15 dark:text-gold-200' : 'bg-surface-3 text-muted')}>
                <Icon name={meta.icon} size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-ink">{meta.title}</span>
                <StatusPill status={st.status} label={st.label} className="mt-0.5" />
              </span>
              <span className={cx('shrink-0 text-[15px] font-bold num', item.amount > 0 ? 'text-ink' : 'text-muted')}>{yen(item.amount)}</span>
            </Row>
          </li>
        );
      })}
    </ul>
  );
}

/** 「次の段階まで」の要約文 */
export function nextStepText(salesItem) {
  if (!salesItem) return '';
  if (!salesItem.nextTier) return `最上位ランク（${yen(salesItem.amount)}）に到達しています`;
  const { gap, sessions, amount } = salesItem.nextTier;
  return `あと${yen(gap)}（約${sessions}回）で ${yen(amount)} ランク`;
}

/**
 * 施術消化売上の段階カード: 段階付きメーター + 月末予測 + 1日あたり必要額 + 累計グラフ
 */
export function SalesTierCard({ item, daily, progress, rules, goal, title = '施術消化売上インセンティブ', showChart = true }) {
  const current = item.current;
  const isCurrent = progress && progress.elapsed > 0 && progress.remaining > 0;
  // 月末予測は 1,000円単位に丸める（細かい桁は精度があるように見えてしまうため）
  const forecast = isCurrent ? Math.round(forecastMonthEnd(current, progress.elapsed, progress.total) / 1000) * 1000 : null;
  const forecastTier = forecast != null ? rules.sales.tiers.filter((t) => forecast >= t.min).pop() : null;
  const steps = rules.sales.tiers.map((t) => ({ at: t.min, label: yen(t.amount) }));
  const next = item.nextTier;
  const perDay = isCurrent && next ? Math.ceil(next.gap / Math.max(1, progress.remaining)) : null;
  const goalGap = goal ? goal - current : null;

  return (
    <Card title={title} icon="banknote" subtitle={`評価基準額 1回あたり ${yen(rules.unitPrice)}（SalonOne「消化売上」）`}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <div className="text-xs font-semibold text-ink-2">今月の施術消化売上</div>
          <div className="mt-1 text-3xl font-bold tracking-tight text-ink">{yen(current)}</div>
        </div>
        <div className="text-right">
          <div className="text-xs font-semibold text-ink-2">現在のインセンティブ</div>
          <div className="mt-1 text-2xl font-bold text-ink">{yen(item.amount)}</div>
        </div>
      </div>

      <div className={cx('mt-4 rounded-xl px-3.5 py-3', next ? 'bg-gold-50 dark:bg-gold-500/10' : 'bg-brand-50 dark:bg-brand-500/10')}>
        <div className="flex items-start gap-2.5">
          <Icon name={next ? 'flag' : 'trophy'} size={18} className={next ? 'mt-0.5 text-gold-600 dark:text-gold-300' : 'mt-0.5 text-brand-600 dark:text-brand-300'} />
          <div className="min-w-0 text-[13px] leading-relaxed text-ink">
            {next ? (
              <>
                <p className="font-bold">
                  次のランクまで あと <span className="num">{yen(next.gap)}</span>（約 <span className="num">{next.sessions}</span> 回）
                </p>
                <p className="text-ink-2">
                  {yenShort(next.min)} に届くと {yen(next.amount)}
                  {item.amount > 0 ? `（+${yen(next.amount - item.amount)}）` : ''}
                  {perDay != null ? ` ・ 残り${progress.remaining}日で1日あたり ${yen(perDay)}（${(perDay / rules.unitPrice).toFixed(1)}回）` : ''}
                </p>
              </>
            ) : (
              <p className="font-bold">最上位ランク（{yen(item.amount)}）に到達しています</p>
            )}
          </div>
        </div>
      </div>

      <TierMeter className="mt-5" current={current} steps={steps} forecast={forecast} formatTick={yenShort} />

      {forecast != null ? (
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-2">
          <Icon name="trending-up" size={13} className="text-muted" />
          このペースだと月末 <span className="font-semibold text-ink num">{yen(forecast)}</span>
          {forecastTier ? <>（{yen(forecastTier.amount)} ランク）</> : '（ランク未達）'}
          {goalGap != null ? <span className="text-muted">・目標まで {goalGap > 0 ? yen(goalGap) : '達成'}</span> : null}
        </p>
      ) : null}

      {showChart && daily ? (
        <div className="mt-4">
          <CumulativeChart
            days={progress.total}
            elapsed={progress.elapsed}
            daily={daily.map((d) => ({ day: dayOfMonth(d.date), value: d.consumedSales }))}
            target={goal || undefined}
            forecast={forecast || undefined}
            refLines={next ? [{ value: next.min, label: `次 ${yenShort(next.min)}` }] : []}
            format={yenShort}
            height={200}
            ariaLabel="今月の施術消化売上の累計推移"
          />
          <ChartLegend items={[
            { label: '実績（累計）', color: 'var(--chart-sales)' },
            goal ? { label: '目標ペース', color: 'var(--chart-target)' } : null,
            forecast ? { label: '月末予測', color: 'var(--chart-sales)', dashed: true } : null,
            next ? { label: '次のランク', color: 'var(--chart-gold)' } : null,
          ].filter(Boolean)} />
        </div>
      ) : null}
    </Card>
  );
}

export function ChartLegend({ items, className = '' }) {
  return (
    <div className={cx('mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-2', className)}>
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <svg width="14" height="6" aria-hidden="true">
            <line x1="1" y1="3" x2="13" y2="3" stroke={it.color} strokeWidth="2" strokeLinecap="round" strokeDasharray={it.dashed ? '3 3' : undefined} />
          </svg>
          {it.label}
        </span>
      ))}
    </div>
  );
}

/** 条件チェックリスト */
export function ConditionList({ conditions }) {
  return (
    <ul className="space-y-2">
      {conditions.map((c) => {
        const unit = c.unit;
        const fmt = (v) => (v == null ? '—' : unit === '円' ? yen(v) : unit === '%' ? pct(v) : unit === 'ヶ月' ? `${num(v, 1)}ヶ月` : `${num(v)}${unit}`);
        return (
          <li key={c.key} className="flex items-start gap-2.5 text-[13px]">
            <Icon name={c.current == null ? 'circle-help' : c.met ? 'circle-check' : 'circle-x'} size={17}
              className={cx('mt-px', c.current == null ? 'text-muted' : c.met ? 'text-[var(--status-good)]' : 'text-[var(--status-critical)]')}
              title={c.current == null ? 'データなし' : c.met ? '達成' : '未達'} />
            <div className="min-w-0 flex-1">
              <div className="text-ink">{c.label}</div>
              <div className="text-xs text-muted">
                現在 <span className="font-semibold text-ink-2 num">{fmt(c.current)}</span>
                {' / 条件 '}{fmt(c.target)}{c.op === '<=' ? ' 以下' : ' 以上'}
                {!c.met && c.gap != null && c.gap > 0 ? <span className="ml-1 font-semibold text-ink-2">（あと{unit === '円' ? yen(c.gap) : `${num(c.gap)}${unit}`}）</span> : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function NewContractCard({ item, rules }) {
  const st = itemStatus(item);
  const steps = rules.newContract.tiers.map((t) => ({ at: t.minPct, label: yen(t.amount) }));
  return (
    <Card title="新規契約インセンティブ" icon="user-plus" actions={<StatusPill status={st.status} label={st.label} />}
      subtitle="ホットペッパー・Meta広告・ホームページの新規初回来店が対象">
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <div className="text-xs font-semibold text-ink-2">契約率（3経路）</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold tracking-tight text-ink">{item.visits > 0 ? pct(item.ratePct) : '—'}</span>
            <span className="text-sm text-ink-2 num">{item.contracts} / {item.visits}名</span>
          </div>
          <TierMeter className="mt-4" current={item.visits > 0 ? item.ratePct : 0} steps={steps} max={100} formatTick={(v) => `${v}%`}
            currentPrefix={item.eligible ? '現在' : '条件達成で'} />
          {item.nextTier && item.eligible ? (
            <p className="mt-1 text-xs text-ink-2">
              {item.nextTier.minPct}%（{yen(item.nextTier.amount)}）まで あと <span className="font-semibold text-ink num">{item.nextTier.contractsNeeded}件</span> の契約
              <span className="text-muted">（新規来店が全員契約した場合）</span>
            </p>
          ) : null}
        </div>
        <div>
          <div className="mb-2 text-xs font-semibold text-ink-2">適用条件</div>
          <ConditionList conditions={item.conditions} />
          <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2">
            <div className="mb-1 flex justify-between text-[11px] text-muted"><span>経路</span><span>契約 / 新規来店</span></div>
            {item.byChannel.map((c) => (
              <div key={c.key} className="flex items-center justify-between py-0.5 text-[13px]">
                <span className="text-ink-2">{channelLabel(c.key)}</span>
                <span className="font-semibold text-ink num">{c.contracts} / {c.visits}名</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-4 text-right text-sm font-bold text-ink">支給見込み {yen(item.amount)}</p>
    </Card>
  );
}

export function SnsCard({ item, rules }) {
  const st = itemStatus(item);
  const r = rules.sns;
  return (
    <Card title="Minimo・Threads・Instagram" icon="smartphone" actions={<StatusPill status={st.status} label={st.label} />}
      subtitle={`3媒体経由で${r.minCustomers}名以上集客した月は、契約1件につき ${yen(r.amountPerContract)}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-ink-2">3媒体経由の集客</span>
        <span className="text-sm text-ink num"><span className="text-xl font-bold">{item.customers}</span> / {r.minCustomers}名</span>
      </div>
      <Meter className="mt-2" value={item.customers} max={r.minCustomers} tone={item.eligible ? 'good' : 'brand'} label="3媒体経由の集客数" />
      <div className="mt-3 flex items-center justify-between text-[13px]">
        <span className="text-ink-2">契約 <span className="font-semibold text-ink num">{item.contracts}件</span> × {yen(r.amountPerContract)}</span>
        <span className="font-bold text-ink num">{item.eligible ? yen(item.amount) : <span className="text-muted">見込み {yen(item.potential)}</span>}</span>
      </div>
    </Card>
  );
}

export function ReferralCard({ item, rules }) {
  return (
    <Card title="紹介インセンティブ" icon="users" actions={<StatusPill {...itemStatus(item)} />}
      subtitle={`紹介したお客様が新しくサブスク契約したら1件 ${yen(rules.referral.amountPerContract)}`}>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs font-semibold text-ink-2">紹介からのサブスク契約</div>
          <div className="mt-1 text-3xl font-bold text-ink num">{item.contracts}<span className="ml-1 text-base font-semibold text-ink-2">件</span></div>
        </div>
        <div className="text-lg font-bold text-ink num">{yen(item.amount)}</div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">SalonOne の専用URL/QRコード経由の予約が対象。来店前キャンセル・既存のお客様・シェアプランは対象外です。</p>
    </Card>
  );
}

export function RetentionCard({ item, rules, storeName }) {
  const st = itemStatus(item);
  return (
    <Card title="継続率インセンティブ" icon="repeat" actions={<StatusPill status={st.status} label={st.label} />}
      subtitle={`${storeName ? `${storeName}の` : '店舗全体の'}条件をすべて満たすと、1人あたり月額 ${yen(rules.retention.amountPerPerson)}`}>
      <ConditionList conditions={item.conditions} />
    </Card>
  );
}

/**
 * 「インセンティブまで、あと何をすればいいか」を金額の大きい順に最大 4件。
 * 店舗全体の条件（継続率）は本人だけでは動かせないので最後に回す。
 */
export function buildNextActions(incentive, rules) {
  const by = Object.fromEntries(incentive.items.map((i) => [i.key, i]));
  const out = [];
  const s = by.sales;
  if (s && s.nextTier) {
    out.push({ key: 'sales', icon: 'banknote', gain: s.nextTier.amount - s.amount,
      text: `施術消化売上 あと${yen(s.nextTier.gap)}（約${s.nextTier.sessions}回）`,
      reward: `${yen(s.nextTier.amount)}ランク` });
  }
  const nc = by.newContract;
  if (nc) {
    if (!nc.eligible) {
      const unmet = nc.conditions.filter((c) => !c.met);
      const parts = unmet.map((c) => (c.key === 'existingSales' ? `既存顧客の消化売上 あと${yen(c.gap)}` : `3経路の新規 あと${c.gap}名`));
      const potential = nc.tierIndex >= 0 ? nc.tiers[nc.tierIndex].amount : rules.newContract.tiers[0].amount;
      out.push({ key: 'newContract', icon: 'user-plus', gain: potential, text: parts.join('・'), reward: `新規契約インセンティブの対象に` });
    } else if (nc.nextTier && nc.nextTier.contractsNeeded > 0) {
      out.push({ key: 'newContract', icon: 'user-plus', gain: nc.nextTier.amount - nc.amount,
        text: `新規契約 あと${nc.nextTier.contractsNeeded}件で契約率${nc.nextTier.minPct}%`, reward: yen(nc.nextTier.amount) });
    }
  }
  const sns = by.sns;
  if (sns && !sns.eligible) {
    out.push({ key: 'sns', icon: 'smartphone', gain: Math.max(sns.potential, rules.sns.amountPerContract),
      text: `Minimo・Threads・Instagram 集客 あと${sns.gap}名`, reward: sns.potential > 0 ? `見込み +${yen(sns.potential)}` : `契約1件 ${yen(rules.sns.amountPerContract)}` });
  }
  out.sort((a, b) => b.gain - a.gain);
  const ret = by.retention;
  if (ret && ret.known && !ret.eligible) {
    const unmet = ret.conditions.filter((c) => !c.met).map((c) => c.label.replace('店舗全体の', '')).join('・');
    out.push({ key: 'retention', icon: 'repeat', gain: 0, text: `店舗の継続条件（${unmet}）が未達`, reward: `達成で ${yen(rules.retention.amountPerPerson)}` });
  }
  return out.slice(0, 4);
}

export function NextActions({ incentive, rules, className = '' }) {
  const actions = buildNextActions(incentive, rules);
  if (actions.length === 0) {
    return (
      <div className={cx('flex items-center gap-2 rounded-xl bg-brand-50 px-3.5 py-3 text-[13px] font-semibold text-brand-800 dark:bg-brand-500/10 dark:text-brand-100', className)}>
        <Icon name="trophy" size={17} />今月はすべてのインセンティブで上位に届いています
      </div>
    );
  }
  return (
    <div className={className}>
      <div className="mb-2 text-xs font-semibold text-ink-2">次のインセンティブまで</div>
      <ul className="space-y-2">
        {actions.map((a) => (
          <li key={a.key} className="flex items-start gap-2.5 rounded-xl border border-line px-3 py-2.5">
            <Icon name={a.icon} size={16} className="mt-0.5 text-gold-600 dark:text-gold-300" />
            <div className="min-w-0 flex-1 text-[13px] leading-snug">
              <div className="font-semibold text-ink">{a.text}</div>
              <div className="text-xs text-ink-2">→ {a.reward}</div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 支給期間（2ヶ月）の内訳 */
export function PeriodSummary({ period, staffPeriod, className = '' }) {
  if (!period || !staffPeriod) return null;
  return (
    <div className={cx('rounded-xl border border-line bg-surface-2 px-3.5 py-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-2">
          <Icon name="calendar-range" size={14} className="text-muted" />
          支給期間 {period.label}{period.preview ? '（試算）' : ''}
        </span>
        <span className="text-sm font-bold text-ink num">{yen(staffPeriod.total)}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {staffPeriod.months.map((m) => (
          <div key={m.month} className="flex items-center justify-between rounded-lg bg-surface px-2.5 py-1.5 text-xs">
            <span className="text-ink-2">{Number(m.month.slice(5))}月</span>
            <span className="font-semibold text-ink num">{m.total == null ? <span className="text-muted">未確定</span> : yen(m.total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ChannelBadge({ channel }) {
  return <Badge tone="neutral">{channelLabel(channel)}</Badge>;
}
