import { useEffect, useMemo, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { Card, Modal, Button, EmptyState, cx } from '../../ui/primitives.jsx';
import { StatusPill, Meter } from '../../ui/stats.jsx';
import { CumulativeChart, ChartTable } from '../../ui/charts.jsx';
import { CountUp, Confetti } from '../../ui/motion.jsx';
import { yen, yenShort, num, pct, changeRate, signedPct } from '../../lib/format.js';
import { forecastMonthEnd } from '../../../shared/metrics.js';
import { dayOfMonth } from '../../../shared/dates.js';
import { itemStatus, ChartLegend, INCENTIVE_META } from '../incentives/parts.jsx';
import { focusIncentive } from '../incentives/focus.js';

// ============================================================
// スタッフ本人のホーム
// ------------------------------------------------------------
// 開いて 3 秒で「いくらもらえそうか」「次のランクまで何回か」「今日から何をすれば
// いいか」が分かることを優先し、詳しい条件はインセンティブ画面に任せる。
// ============================================================

const byKey = (items) => Object.fromEntries(items.map((i) => [i.key, i]));
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** ランクの金額は狭い所に並べるので「万」で短く（¥5,000 / ¥3万 / ¥10万） */
function rewardShort(amount) {
  return amount >= 10000 ? `¥${num(amount / 10000, amount % 10000 ? 1 : 0)}万` : yen(amount);
}

/** ランクの境目は丸めると誤解を生むので小数 1桁まで出す（104.8万 を 105万 にしない） */
function thresholdShort(v) {
  if (v < 10000) return num(v);
  return `${(v / 10000).toFixed(1).replace(/\.0$/, '')}万`;
}

function isCurrentMonth(progress) {
  return progress && progress.elapsed > 0 && progress.remaining > 0;
}

// ------------------------------------------------------------
// 主役のカード: 今月の見込み額と次のランク
// ------------------------------------------------------------
function RankBadge({ index, count }) {
  const reached = index >= 0;
  return (
    <div className={cx('flex shrink-0 flex-col items-center rounded-2xl px-3 py-2 ring-1 ring-inset',
      reached ? 'bg-gold-400/15 ring-gold-300/40' : 'bg-white/[0.07] ring-white/15')}>
      <span className="text-[10px] font-semibold tracking-[0.16em] text-white/60">RANK</span>
      <span className={cx('mt-0.5 text-[26px] font-bold leading-none num', reached ? 'text-gold-300' : 'text-white/50')}>{reached ? index + 1 : '—'}</span>
      <span className="mt-0.5 text-[10px] text-white/50 num">/ {count}</span>
    </div>
  );
}

function RankLadder({ tiers, reached }) {
  return (
    <ol className="mt-4 grid grid-cols-5 gap-1.5" aria-label="施術消化売上のランク">
      {tiers.map((t, i) => {
        const done = i <= reached;
        const isNext = i === reached + 1;
        return (
          <li key={t.min}
            className={cx('rounded-xl px-1 py-2 text-center ring-1 ring-inset transition-colors',
              done ? 'bg-gold-400/20 ring-gold-300/40' : isNext ? 'bg-white/[0.08] ring-white/35' : 'bg-white/[0.03] ring-white/10')}
            aria-label={`ランク${i + 1}: 施術消化売上 ${thresholdShort(t.min)}以上で ${yen(t.amount)}${done ? '（達成）' : ''}`}
          >
            <div className={cx('mx-auto flex h-5 w-5 items-center justify-center rounded-full',
              done ? 'bg-gold-300 text-brand-950' : isNext ? 'border border-dashed border-white/70 text-white/80' : 'border border-white/20 text-white/40')}>
              {done ? <Icon name="check" size={12} strokeWidth={3} /> : <span className="text-[10px] font-semibold num">{i + 1}</span>}
            </div>
            <div className={cx('mt-1.5 text-[12px] font-bold leading-none num', done ? 'text-gold-200' : isNext ? 'text-white' : 'text-white/55')}>{rewardShort(t.amount)}</div>
            <div className="mt-1 text-[10px] leading-none text-white/45 num">{thresholdShort(t.min)}〜</div>
          </li>
        );
      })}
    </ol>
  );
}

function HeroWallet({ summary, me }) {
  const { rules, period } = summary;
  const sales = byKey(me.incentive.items).sales;
  const tiers = rules.sales.tiers;
  const next = sales.nextTier;
  const floor = sales.tierIndex >= 0 ? tiers[sales.tierIndex].min : 0;
  const seg = next ? clamp01((sales.current - floor) / (next.min - floor)) : 1;
  const monthNum = Number(summary.month.slice(5));
  const pm = period.months.map((m) => Number(m.slice(5)));
  return (
    <section className="relative overflow-hidden rounded-[22px] bg-[linear-gradient(140deg,#21633f_0%,#184b33_48%,#0d2f20_100%)] p-5 text-white shadow-pop sm:p-6"
      aria-label="今月のインセンティブ">
      {/* 奥行きを出すための装飾 */}
      <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-white/[0.06]" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-gold-400/[0.12] blur-2xl" aria-hidden="true" />
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-white/75">{monthNum}月のインセンティブ{period.preview ? '（試算）' : '見込み'}</p>
            <p className="mt-2 text-[44px] font-bold leading-none tracking-tight num sm:text-[52px]">
              <CountUp value={me.incentive.total} format={yen} />
            </p>
          </div>
          <RankBadge index={sales.tierIndex} count={tiers.length} />
        </div>

        {next ? (
          <div className="mt-5 rounded-2xl bg-white/[0.08] p-3.5 ring-1 ring-inset ring-white/10">
            <div className="flex items-center justify-between gap-3">
              <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold">
                <Icon name="flag" size={15} className="shrink-0 text-gold-300" />
                <span className="truncate">次のランクまで あと</span>
              </p>
              <p className="shrink-0 text-right">
                <span className="text-[19px] font-bold leading-none num">{yen(next.gap)}</span>
                <span className="ml-1.5 text-xs text-white/70">約{next.sessions}回</span>
              </p>
            </div>
            <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/15" role="meter" aria-valuemin={0} aria-valuemax={100}
              aria-valuenow={Math.round(seg * 100)} aria-label="次のランクまでの進み具合">
              <div className="h-full rounded-full bg-gradient-to-r from-gold-500 to-gold-300 transition-[width] duration-700 ease-out" style={{ width: `${seg * 100}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-white/60 num">
              <span>{floor > 0 ? thresholdShort(floor) : '0'}</span>
              <span className="rounded-full bg-gold-300/15 px-2 py-0.5 text-[11px] font-semibold text-gold-200">
                達成で {yen(next.amount)}{sales.amount > 0 ? `（+${yen(next.amount - sales.amount)}）` : ''}
              </span>
              <span>{thresholdShort(next.min)}</span>
            </div>
          </div>
        ) : (
          <div className="mt-5 flex items-center gap-2.5 rounded-2xl bg-gold-400/15 p-3.5 ring-1 ring-inset ring-gold-300/30">
            <Icon name="trophy" size={20} className="shrink-0 text-gold-300" />
            <p className="text-[13px] font-semibold">施術消化売上は最上位ランクに到達しています</p>
          </div>
        )}

        <RankLadder tiers={tiers} reached={sales.tierIndex} />

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-3.5 text-[13px]">
          <span className="flex min-w-0 items-center gap-1.5 text-white/70">
            <Icon name={me.closed ? 'lock' : 'calendar-range'} size={14} className="shrink-0" />
            <span className="truncate">支給期間（{pm[0]}〜{pm[pm.length - 1]}月）の{me.closed ? '支給額（確定）' : '合計'}</span>
          </span>
          <span className="shrink-0 font-bold num">{yen(me.closed ? me.closed.total : me.period.total)}</span>
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------
// 月末の見通し（当月だけ）/ この月の結果（過去の月）
// ------------------------------------------------------------
function MiniStat({ label, value, sub, tone }) {
  return (
    <div className="min-w-0 px-3 first:pl-0 last:pr-0">
      <div className="truncate text-[11px] font-semibold text-muted">{label}</div>
      <div className={cx('mt-1 truncate text-[17px] font-bold leading-tight num', tone === 'good' ? 'text-[var(--text-good)]' : 'text-ink')}>{value}</div>
      {sub ? <div className="mt-0.5 truncate text-[11px] text-ink-2">{sub}</div> : null}
    </div>
  );
}

function OutlookCard({ summary, me, goal }) {
  const { progress, rules } = summary;
  const sales = byKey(me.incentive.items).sales;
  const tiers = rules.sales.tiers;
  const current = sales.current;
  const prev = me.prevConsumedSales;

  if (!isCurrentMonth(progress)) {
    const delta = changeRate(current, prev);
    return (
      <Card title="この月の結果" icon="flag-triangle-right">
        <div className="grid grid-cols-3 divide-x divide-line">
          <MiniStat label="施術消化売上" value={yenShort(current)} sub={sales.tierIndex >= 0 ? `ランク${sales.tierIndex + 1}` : 'ランク外'} />
          <MiniStat label="インセンティブ" value={yen(me.incentive.total)} />
          <MiniStat label="前月比" value={delta == null ? '—' : signedPct(delta)} tone={delta > 0 ? 'good' : undefined} />
        </div>
      </Card>
    );
  }

  // 月末予測は 1,000円単位（細かい桁は精度があるように見えてしまうため）
  const forecast = Math.round(forecastMonthEnd(current, progress.elapsed, progress.total) / 1000) * 1000;
  const fIdx = tiers.filter((t) => forecast >= t.min).length - 1;
  const goalGap = goal ? goal - current : null;
  const goalPerDay = goalGap > 0 ? Math.ceil(goalGap / progress.remaining) : null;
  const next = sales.nextTier;

  let message;
  let tone = 'brand';
  if (fIdx > sales.tierIndex) {
    message = <>このペースなら月末に <strong className="num">{yen(tiers[fIdx].amount)}</strong> ランク{fIdx === tiers.length - 1 ? '（最上位）' : ''}に届く見込みです</>;
    tone = 'good';
  } else if (next) {
    const perDay = next.gap / progress.remaining / rules.unitPrice;
    message = perDay <= 1
      ? <>残り{progress.remaining}日で <strong className="num">あと{next.sessions}回</strong>。次のランクは十分ねらえます</>
      : <>1日 <strong className="num">{perDay.toFixed(1)}回</strong> ずつ施術できれば、月末に次のランクへ届きます</>;
  } else {
    message = <>最上位ランクを達成しています。このまま月末まで走りきりましょう</>;
    tone = 'good';
  }

  return (
    <Card title="月末の見通し" icon="telescope" actions={<span className="text-xs font-semibold text-ink-2 num">残り{progress.remaining}日</span>}>
      <div className="grid grid-cols-3 divide-x divide-line">
        <MiniStat label="月末予測" value={yenShort(forecast)} sub={fIdx >= 0 ? `ランク${fIdx + 1}（${rewardShort(tiers[fIdx].amount)}）` : 'ランク外'} />
        <MiniStat label="目標まで" value={goal ? (goalGap > 0 ? yenShort(goalGap) : '達成') : '—'}
          sub={goal ? (goalPerDay ? `1日 ${goalPerDay >= 10000 ? `¥${yenShort(goalPerDay)}` : yen(goalPerDay)}` : `目標 ${yenShort(goal)}`) : '目標は未設定'} tone={goal && goalGap <= 0 ? 'good' : undefined} />
        <MiniStat label="前月比（予測）" value={changeRate(forecast, prev) == null ? '—' : signedPct(changeRate(forecast, prev))}
          sub={prev ? `前月 ${yenShort(prev)}` : '前月の実績なし'} tone={changeRate(forecast, prev) > 0 ? 'good' : undefined} />
      </div>
      <p className={cx('mt-4 flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px] leading-relaxed',
        tone === 'good' ? 'bg-[#e7f6e7] text-[#0f5f12] dark:bg-[#0ca30c]/12 dark:text-[#9be5a3]' : 'bg-brand-50 text-brand-800 dark:bg-brand-500/10 dark:text-brand-100')}>
        <Icon name={tone === 'good' ? 'sparkles' : 'footprints'} size={16} className="mt-0.5 shrink-0" />
        <span>{message}</span>
      </p>
    </Card>
  );
}

// ------------------------------------------------------------
// 今月のミッション（5つのインセンティブ）
// ------------------------------------------------------------
function buildMissions(me, rules) {
  const it = byKey(me.incentive.items);
  const out = [];

  const s = it.sales;
  out.push({
    key: 'sales',
    amount: s.amount,
    progress: s.nextTier ? { value: s.current, max: s.nextTier.min } : { value: 1, max: 1 },
    detail: s.nextTier ? <>次の {yen(s.nextTier.amount)} まで あと<b className="num">{yen(s.nextTier.gap)}</b></> : '最上位ランクを達成',
  });

  const nc = it.newContract;
  if (!nc.eligible) {
    const visitsCond = nc.conditions.find((c) => c.key === 'newVisits');
    const existCond = nc.conditions.find((c) => c.key === 'existingSales');
    out.push({
      key: 'newContract',
      amount: nc.amount,
      progress: { value: visitsCond.current, max: visitsCond.target },
      detail: <>3経路の新規 <b className="num">{visitsCond.current}/{visitsCond.target}名</b>{existCond.met ? '・既存売上 OK' : `・既存売上 あと${yenShort(existCond.gap)}`}</>,
      hint: '条件を満たすと契約率に応じて ¥2,000〜¥30,000',
    });
  } else {
    const nextPct = nc.nextTier ? nc.nextTier.minPct : 100;
    out.push({
      key: 'newContract',
      amount: nc.amount,
      progress: { value: nc.ratePct, max: nextPct },
      detail: <>契約率 <b className="num">{pct(nc.ratePct, 0)}</b>（{nc.contracts}/{nc.visits}名）</>,
      hint: nc.nextTier && nc.nextTier.contractsNeeded > 0 ? `あと${nc.nextTier.contractsNeeded}件の契約で ${nc.nextTier.minPct}%（${yen(nc.nextTier.amount)}）` : null,
    });
  }

  const sns = it.sns;
  out.push({
    key: 'sns',
    amount: sns.amount,
    progress: { value: sns.customers, max: rules.sns.minCustomers },
    detail: <>集客 <b className="num">{sns.customers}/{rules.sns.minCustomers}名</b>・契約 {sns.contracts}件</>,
    hint: !sns.eligible && sns.potential > 0 ? `あと${sns.gap}名で +${yen(sns.potential)}` : null,
  });

  const ref = it.referral;
  out.push({
    key: 'referral',
    amount: ref.amount,
    progress: null,
    detail: <>紹介からのサブスク契約 <b className="num">{ref.contracts}件</b></>,
    hint: `1件ごとに ${yen(rules.referral.amountPerContract)}`,
  });

  const ret = it.retention;
  const met = ret.conditions.filter((c) => c.met).length;
  out.push({
    key: 'retention',
    amount: ret.amount,
    progress: ret.known ? { value: met, max: ret.conditions.length } : null,
    detail: ret.known ? <>店舗の条件 <b className="num">{met}/{ret.conditions.length}</b> を達成</> : '店舗の継続データがありません',
    hint: '店舗全体の退会率・平均継続・会員数',
  });
  return out;
}

function MissionRow({ m, item }) {
  const meta = INCENTIVE_META[m.key];
  const st = itemStatus(item);
  const earned = m.amount > 0;
  return (
    <li>
      <button type="button" onClick={() => focusIncentive(m.key)}
        className="group flex w-full items-start gap-3 rounded-2xl border border-line bg-surface p-3 text-left transition-colors hover:border-line-strong hover:bg-surface-2 active:bg-surface-3">
        <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
          earned ? 'bg-gold-50 text-gold-700 dark:bg-gold-500/15 dark:text-gold-200' : 'bg-surface-3 text-ink-2')}>
          <Icon name={meta.icon} size={19} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-[14px] font-bold text-ink">{meta.short || meta.title}</span>
            <span className={cx('shrink-0 text-[15px] font-bold num', earned ? 'text-ink' : 'text-muted')}>{yen(m.amount)}</span>
          </span>
          {m.progress ? (
            <Meter className="mt-2" value={m.progress.value} max={m.progress.max} height={6}
              tone={item.amount > 0 || st.status === 'achieved' ? 'gold' : 'brand'} label={`${meta.title}の進み具合`} />
          ) : null}
          <span className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusPill status={st.status} label={st.label} />
            <span className="text-xs leading-snug text-ink-2 [&_b]:font-semibold [&_b]:text-ink">{m.detail}</span>
          </span>
          {m.hint ? <span className="mt-1 block text-[11px] leading-snug text-muted">{m.hint}</span> : null}
        </span>
        <Icon name="chevron-right" size={16} className="mt-3 hidden shrink-0 text-muted transition-transform group-hover:translate-x-0.5 sm:block" />
      </button>
    </li>
  );
}

function Missions({ summary, me }) {
  const missions = buildMissions(me, summary.rules);
  const it = byKey(me.incentive.items);
  const earned = me.incentive.items.filter((i) => i.amount > 0).length;
  return (
    <Card title="今月のミッション" icon="list-checks" subtitle="タップすると条件の詳しい内容を表示します"
      actions={<span className="rounded-full bg-gold-50 px-2.5 py-1 text-xs font-bold text-gold-800 num dark:bg-gold-500/15 dark:text-gold-200">{earned}/{missions.length} 獲得</span>}>
      <ul className="space-y-2">
        {missions.map((m) => <MissionRow key={m.key} m={m} item={it[m.key]} />)}
      </ul>
    </Card>
  );
}

// ------------------------------------------------------------
// 今月の実績
// ------------------------------------------------------------
function Highlight({ icon, label, value, sub, accent }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-surface-2 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-muted">
        <Icon name={icon} size={13} className={accent ? 'text-gold-600 dark:text-gold-300' : ''} />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1.5 truncate text-[18px] font-bold leading-tight text-ink num">{value}</div>
      {sub ? <div className="mt-0.5 truncate text-[11px] text-ink-2">{sub}</div> : null}
    </div>
  );
}

function personalBest(trend, me, month) {
  if (!trend || !trend.staff) return null;
  const row = trend.staff.find((r) => r.key === me.key) || (trend.staff.length === 1 ? trend.staff[0] : null);
  if (!row) return null;
  let best = 0;
  let bestMonth = null;
  for (const [m, v] of Object.entries(row.values || {})) {
    if (m >= month) continue;
    if (v > best) { best = v; bestMonth = m; }
  }
  return best > 0 ? { value: best, month: bestMonth } : null;
}

function MonthHighlights({ summary, me, trend }) {
  const m = me.metrics;
  const store = summary.store;
  // 店舗内シェアは、表示中の店舗での自分の実績で出す（ヘルプで入った他店舗の分は店舗の合計に入っていないため）
  const inStore = me.scopeMetrics || m;
  const share = store && store.consumedSales > 0 ? (inStore.consumedSales / store.consumedSales) * 100 : null;
  const best = personalBest(trend, me, summary.month);
  const current = m.consumedSales;
  const live = isCurrentMonth(summary.progress);
  const forecast = live ? forecastMonthEnd(current, summary.progress.elapsed, summary.progress.total) : current;
  let bestTile;
  if (!best) {
    bestTile = <Highlight icon="trophy" label="自己ベスト" value="—" sub="過去の実績を集計中" />;
  } else if (current >= best.value) {
    bestTile = <Highlight icon="trophy" accent label="自己ベスト" value="更新中！" sub={`これまで ${yenShort(best.value)}（${Number(best.month.slice(5))}月）`} />;
  } else if (live && forecast >= best.value) {
    bestTile = <Highlight icon="trophy" accent label="自己ベスト" value="更新ペース" sub={`あと ${yenShort(best.value - current)} で ${yenShort(best.value)} 超え`} />;
  } else {
    bestTile = <Highlight icon="trophy" label="自己ベストまで" value={yenShort(best.value - current)} sub={`${Number(best.month.slice(5))}月の ${yenShort(best.value)}`} />;
  }
  return (
    <Card title="今月の実績" icon="sparkles">
      <div className="grid grid-cols-2 gap-2.5">
        <Highlight icon="hand-heart" label="施術数" value={`${num(m.treatmentCount)}回`} sub={`お客様 ${num(m.customerCount)}名`} />
        <Highlight icon="user-plus" label="新規数 / 契約数" value={`${num(m.newCount)}名 / ${num(m.purchaseCount)}件`} sub="SalonOne と同じ数え方" />
        <Highlight icon="store" label="店舗内シェア" value={share == null ? '—' : pct(share, 0)} sub={`${me.storeName || '店舗'}の消化売上のうち`} />
        {bestTile}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------
// 累計推移
// ------------------------------------------------------------
function MySalesChart({ summary, me, goal }) {
  const { progress, rules } = summary;
  const sales = byKey(me.incentive.items).sales;
  const live = isCurrentMonth(progress);
  const forecast = live ? Math.round(forecastMonthEnd(sales.current, progress.elapsed, progress.total) / 1000) * 1000 : null;
  const next = sales.nextTier;
  let acc = 0;
  const rows = me.daily.map((d) => { acc += d.consumedSales; return { date: d.date, day: d.consumedSales, cum: acc, n: d.treatmentCount }; });
  return (
    <Card title="施術消化売上の推移" icon="chart-line" subtitle={`1回 ${yen(rules.unitPrice)} で計算・日ごとの累計`}>
      <CumulativeChart
        days={progress.total}
        elapsed={progress.elapsed || progress.total}
        daily={me.daily.map((d) => ({ day: dayOfMonth(d.date), value: d.consumedSales }))}
        target={goal || undefined}
        forecast={forecast || undefined}
        refLines={next ? [{ value: next.min, label: `次 ${yenShort(next.min)}` }] : []}
        format={yenShort}
        height={210}
        ariaLabel="今月の施術消化売上の累計推移"
      />
      <ChartLegend items={[
        { label: '実績（累計）', color: 'var(--chart-sales)' },
        goal ? { label: '目標ペース', color: 'var(--chart-target)' } : null,
        forecast ? { label: '月末予測', color: 'var(--chart-sales)', dashed: true } : null,
        next ? { label: '次のランク', color: 'var(--chart-gold)' } : null,
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

// ------------------------------------------------------------
// 達成のお祝い（その月に新しく達成したものを 1回だけ）
// ------------------------------------------------------------
function achievementsOf(me, rules) {
  const it = byKey(me.incentive.items);
  const list = [];
  for (let i = 0; i <= it.sales.tierIndex; i += 1) {
    const t = rules.sales.tiers[i];
    list.push({ key: `sales:${i}`, weight: 100 + i, title: `ランク${i + 1} 達成`, text: `施術消化売上が ${yenShort(t.min)} を超えて、${yen(t.amount)} ランクになりました` });
  }
  if (it.newContract.amount > 0) {
    list.push({ key: `newContract:${it.newContract.tierIndex}`, weight: 60 + it.newContract.tierIndex, title: '新規契約インセンティブ獲得', text: `3経路の契約率 ${pct(it.newContract.ratePct, 0)} で ${yen(it.newContract.amount)}` });
  }
  if (it.sns.eligible) list.push({ key: 'sns', weight: 40, title: 'SNS集客 10名達成', text: 'Minimo・Threads・Instagram 経由の契約が 1件 ¥2,000 になります' });
  if (it.referral.contracts > 0) list.push({ key: `referral:${it.referral.contracts}`, weight: 30, title: '紹介インセンティブ獲得', text: `紹介からのサブスク契約 ${it.referral.contracts}件` });
  if (it.retention.eligible) list.push({ key: 'retention', weight: 20, title: '継続率インセンティブ達成', text: '店舗の継続条件をすべて満たしています' });
  return list;
}

function useCelebration(me, summary, enabled) {
  const [celebrate, setCelebrate] = useState(null);
  const storageKey = me ? `sise_celebrated_v1:${me.key}:${summary.month}` : null;
  const list = useMemo(() => (me ? achievementsOf(me, summary.rules) : []), [me, summary.rules]);
  useEffect(() => {
    if (!enabled || !storageKey || list.length === 0) return;
    let seen = [];
    try { seen = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch (_) { seen = []; }
    const fresh = list.filter((a) => !seen.includes(a.key));
    if (fresh.length === 0) return;
    try { localStorage.setItem(storageKey, JSON.stringify(list.map((a) => a.key))); } catch (_) { /* noop */ }
    fresh.sort((a, b) => b.weight - a.weight);
    setCelebrate({ main: fresh[0], others: fresh.slice(1) });
  }, [enabled, storageKey, list]);
  return [celebrate, () => setCelebrate(null)];
}

function CelebrationModal({ data, onClose }) {
  const [burst, setBurst] = useState(true);
  return (
    <>
      <Confetti fire={burst} onDone={() => setBurst(false)} />
      <Modal open onClose={onClose} title="おめでとうございます" size="sm"
        footer={<Button variant="primary" className="w-full" onClick={onClose}>この調子でいこう</Button>}>
        <div className="flex flex-col items-center py-2 text-center">
          <div className="relative mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-gold-300 to-gold-500 text-white shadow-pop">
            <Icon name="trophy" size={38} strokeWidth={1.8} />
            <span className="absolute -inset-1.5 animate-ping-slow rounded-full ring-2 ring-gold-300/60" aria-hidden="true" />
          </div>
          <p className="text-xl font-bold text-ink">{data.main.title}</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{data.main.text}</p>
          {data.others.length ? (
            <ul className="mt-4 w-full space-y-1.5 text-left">
              {data.others.map((a) => (
                <li key={a.key} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-[13px] text-ink">
                  <Icon name="circle-check" size={16} className="shrink-0 text-[var(--status-good)]" />{a.title}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Modal>
    </>
  );
}

// ------------------------------------------------------------
export default function MyHome({ summary, goals, trend, stale }) {
  const me = summary.me;
  const live = isCurrentMonth(summary.progress);
  const [celebrate, closeCelebrate] = useCelebration(me, summary, live && !stale);
  if (!me) {
    return (
      <Card>
        <EmptyState icon="user-x" title="あなたの実績を表示できません"
          message="SalonOne のスタッフと連携されていないか、この店舗に所属していません。管理者に「設定 > SalonOne連携」でスタッフの対応付けを依頼してください。" />
      </Card>
    );
  }
  const goal = goals && goals.staff && goals.staff[me.staffId] ? goals.staff[me.staffId].consumedSales : null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <div className="min-w-0 space-y-4">
          <HeroWallet summary={summary} me={me} />
          <OutlookCard summary={summary} me={me} goal={goal} />
        </div>
        <Missions summary={summary} me={me} />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <MonthHighlights summary={summary} me={me} trend={trend} />
        <MySalesChart summary={summary} me={me} goal={goal} />
      </div>
      {celebrate ? <CelebrationModal key={celebrate.main.key} data={celebrate} onClose={closeCelebrate} /> : null}
    </div>
  );
}
