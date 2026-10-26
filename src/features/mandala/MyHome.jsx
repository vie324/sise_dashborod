import Icon from '../../ui/Icon.jsx';
import { Badge, Banner, Button, Card, EmptyState, PageHeader, cx } from '../../ui/primitives.jsx';
import { Meter } from '../../ui/stats.jsx';
import { yen, pct } from '../../lib/format.js';
import { navigate } from '../../app/router.js';
import { useMandala, useMySales } from './data.js';
import { FillMeter, WeekBars, LoadingState, ErrorState, StateBadge, go } from './parts.jsx';
import { formatWeekRange, formatWeekShort, formatDay, formatManYen, formatRate } from '../../../shared/mandala.js';
import { weekdayOf, formatMonthJa } from '../../../shared/dates.js';

// ============================================================
// マンダラのホーム（本人）
// ------------------------------------------------------------
// 開いてすぐ「今週の振り返りを書く」に届くように、いちばん上に置く。
// その下にチャートの記入状況・今週のフォーカス・行動の実行率の推移。
// 売上は SalonOne の数字を読んで、チャートの目標金額と並べるだけ（入力はしない）。
// ============================================================

function TeamCard({ team }) {
  if (!team || team.members === 0) return null;
  const rest = team.members - team.submitted;
  return (
    <button type="button" onClick={go('/mandala/team')} className="card mb-3 flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:border-line-strong">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200"><Icon name="users-round" size={19} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-bold text-ink">チームの今週</span>
        <span className="block text-xs text-muted num">
          週報の提出 {team.submitted}/{team.members}名{rest > 0 ? `（未提出 ${rest}名）` : '・全員提出済み'}
          {team.dailyMembers > 0 ? `・今日の日報 ${team.dailySubmitted}/${team.dailyMembers}名` : ''}
        </span>
      </span>
      <Icon name="chevron-right" size={18} className="shrink-0 text-muted" />
    </button>
  );
}

function DailyCard({ daily, today }) {
  if (!daily || !daily.enabled) return null;
  const st = daily.status;
  return (
    <button type="button" onClick={go('/mandala/daily')} className="card mb-3 flex w-full items-center gap-3 p-3.5 text-left transition-colors hover:border-line-strong">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold-50 text-gold-700 dark:bg-gold-500/15 dark:text-gold-200"><Icon name="sun-medium" size={19} /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-bold text-ink">今日の日報・{formatDay(today)}</span>
        <span className="block text-xs text-muted">{st === 'submitted' ? '提出済みです。おつかれさまでした' : st === 'draft' ? '下書きがあります。仕上げて提出しましょう' : 'まだ書いていません。1〜2分で終わります'}</span>
      </span>
      <StateBadge state={st === 'submitted' ? 'submitted' : st ? 'draft' : 'none'} />
    </button>
  );
}

/** 今週の振り返り（いちばん大きいボタン） */
function ReviewHero({ week, review, progress, hasChart }) {
  const state = review ? (review.status === 'submitted' ? 'submitted' : 'draft') : 'none';
  const current = progress && progress.current;
  const label = state === 'submitted' ? '内容を見る・書き足す' : state === 'draft' ? '続きを書く' : '振り返りを書く';
  return (
    <section className="relative mb-4 overflow-hidden rounded-[18px] bg-[linear-gradient(140deg,#21633f_0%,#184b33_60%,#0d2f20_100%)] p-4 text-white shadow-card sm:p-5">
      <span className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full bg-white/[0.06]" aria-hidden="true" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white/70">今週の振り返り</p>
          <p className="mt-0.5 text-[17px] font-bold num">{formatWeekRange(week)}</p>
        </div>
        <span className={cx('shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold', state === 'submitted' ? 'bg-gold-400 text-[#3b2a06]' : 'bg-white/15 text-white')}>
          {state === 'submitted' ? '提出済み' : state === 'draft' ? '下書き' : '未着手'}
        </span>
      </div>
      <p className="relative mt-2 text-[13px] leading-relaxed text-white/80">
        {!hasChart ? '先にマンダラチャートを作ると、毎週チェックする行動が決まります。'
          : state === 'submitted' ? 'AI のレビューと、来週のフォーカスを確かめましょう。'
            : state === 'draft' ? `できた行動 ${current ? current.checked : 0}/${current ? current.checkTotal : 0}。続きから書けます（自動で保存されます）。`
              : 'できた行動にチェックして、ひとこと振り返るだけ。1〜2分で終わります。'}
      </p>
      <button type="button" onClick={go(hasChart ? '/mandala/review' : '/mandala/edit')}
        className="relative mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white text-[15px] font-bold text-brand-800 shadow-sm transition-transform active:scale-[0.99]">
        <Icon name={hasChart ? 'notebook-pen' : 'grid-3x3'} size={18} />
        {hasChart ? label : 'マンダラチャートを作る'}
      </button>
      {progress && progress.streak > 0 ? (
        <p className="relative mt-2 flex items-center justify-center gap-1 text-xs text-gold-200"><Icon name="flame" size={13} />{progress.streak}週続けて提出中</p>
      ) : null}
    </section>
  );
}

function GoalCard({ chart }) {
  const sales = useMySales();
  const target = chart.targetAmount;
  const showSales = sales.linked && target > 0;
  const ratio = showSales ? sales.thisMonth / target : null;
  return (
    <Card title="マンダラチャート" icon="grid-3x3" className="mb-4"
      actions={<Button size="sm" variant="ghost" icon="pencil" onClick={go('/mandala/edit')}>編集</Button>}>
      <button type="button" onClick={go('/mandala/chart')} className="block w-full rounded-xl bg-brand-50 px-3.5 py-3 text-left dark:bg-brand-500/15">
        <span className="block text-[11px] font-semibold text-brand-700 dark:text-brand-200">センターゴール</span>
        <span className="mt-0.5 block text-[16px] font-bold leading-snug text-ink">{chart.centerGoal}</span>
      </button>
      <FillMeter summary={chart} className="mt-3" />
      {chart.trackableCount === 0 ? (
        <Banner tone="warn" className="mt-3" action={<Button size="sm" onClick={go('/mandala/edit/5/1')}>選ぶ</Button>}>
          毎週チェックする行動がまだありません。⑤分類で「毎週チェックする」を選びましょう。
        </Banner>
      ) : null}
      {target ? (
        <div className="mt-4 rounded-xl border border-line p-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs font-semibold text-ink-2">目標 月{formatManYen(target)}{chart.deadlineMonth ? `（${formatMonthJa(chart.deadlineMonth.slice(0, 7))}まで）` : ''}</span>
            {showSales ? <span className="text-xs font-bold text-ink num">{pct(ratio * 100, 0)}</span> : null}
          </div>
          {showSales ? (
            <>
              <Meter className="mt-2" value={sales.thisMonth} max={target} marker={sales.progress && sales.progress.remaining > 0 ? target * sales.progress.ratio : null} label="目標に対する今月の施術消化売上" />
              <p className="mt-1.5 text-[11px] text-muted num">
                今月の施術消化売上 {yen(sales.thisMonth)}（SalonOne{sales.demo ? '・デモ' : ''}）
                {sales.progress && sales.progress.remaining > 0 ? '・縦線は今日までのペース' : ''}
              </p>
            </>
          ) : (
            <p className="mt-1 text-[11px] text-muted">売上の実績はホームとインセンティブの画面（SalonOne）で見られます。</p>
          )}
        </div>
      ) : null}
      <div className="mt-3 flex gap-2">
        <Button className="flex-1" icon="grid-3x3" onClick={go('/mandala/chart')}>チャートを見る</Button>
        <Button className="flex-1" variant="ghost" icon="pencil" onClick={go('/mandala/edit')}>編集する</Button>
      </div>
    </Card>
  );
}

function FocusCard({ focus, week }) {
  return (
    <Card title="今週のフォーカス" icon="target" className="mb-4" subtitle="今週いちばん集中する行動（3つまで）">
      {focus.length === 0 ? (
        <div className="rounded-xl bg-surface-2 p-3 text-[13px] text-ink-2">
          まだ決めていません。週報の画面で、チャートの行動から自分で選べます（提出すると AI も提案します）。
          <div className="mt-2"><Button size="sm" variant="subtle" icon="plus" onClick={go(`/mandala/review/${week}?focus=1`)}>フォーカスを選ぶ</Button></div>
        </div>
      ) : (
        <ul className="space-y-2">
          {focus.map((f, i) => (
            <li key={f.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2.5">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold-100 text-[11px] font-bold text-gold-800 dark:bg-gold-500/20 dark:text-gold-200 num">{i + 1}</span>
              <span className="min-w-0 flex-1 text-[14px] leading-snug text-ink">{f.label}</span>
              {f.source === 'ai' ? <Badge tone="info" icon="sparkles">AI提案</Badge> : null}
              {f.achieved === true ? <Icon name="circle-check" size={18} className="text-[var(--status-good)]" title="達成" /> : f.achieved === false ? <Icon name="circle-x" size={18} className="text-[var(--status-critical)]" title="未達成" /> : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RatesCard({ progress, lastWeek }) {
  return (
    <Card title="行動の実行率" icon="activity"
      actions={<span className="text-xs text-muted num">先週 {lastWeek.total > 0 ? formatRate(lastWeek.done / lastWeek.total) : '—'}</span>}>
      {progress ? <WeekBars weeks={progress.weeks} hrefFor={(w) => `/mandala/review/${w}`} /> : null}
      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold text-ink-2">先週のテーマ別（{formatWeekShort(lastWeek.week)}）</p>
        {lastWeek.rates.length === 0 ? (
          <p className="text-[13px] text-muted">{lastWeek.status ? '先週は週次チェックの対象がありませんでした。' : '先週の週報はありません。'}</p>
        ) : (
          <ul className="space-y-2.5">
            {lastWeek.rates.map((r) => (
              <li key={r.theme}>
                <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
                  <span className="truncate text-ink">{r.theme}</span>
                  <span className="shrink-0 text-xs text-muted num">{r.done}/{r.total}</span>
                </div>
                <Meter value={r.done} max={r.total || 1} height={6} label={`${r.theme}の実行率`} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

export default function MyHome({ me }) {
  const res = useMandala('home');
  const data = res.shown;
  if (!data && res.error) return <ErrorState error={res.error} onRetry={res.reload} />;
  if (!data) return <LoadingState />;
  const mine = data.me;
  // 週のはじめ（月・火）に先週の振り返りが出ていなければ知らせる
  const nudgeLastWeek = mine && mine.chart && mine.lastWeek.status !== 'submitted' && [1, 2].includes(weekdayOf(data.today));
  return (
    <div>
      <PageHeader title={`${me.viewer.name}さんのマンダラ`} subtitle="チャート・週報・日報で、毎日の行動が回っているかを確かめます" />
      <TeamCard team={data.team} />
      {nudgeLastWeek ? (
        <Banner tone="warn" className="mb-3" action={<Button size="sm" onClick={go(`/mandala/review/${mine.lastWeek.week}`)}>書く</Button>}>
          先週（{formatWeekShort(mine.lastWeek.week)}）の振り返りがまだです。
        </Banner>
      ) : null}
      {mine ? (
        <>
          <DailyCard daily={mine.daily} today={data.today} />
          <ReviewHero week={data.week} review={mine.review} progress={mine.progress} hasChart={!!mine.chart} />
          {mine.chart ? <GoalCard chart={mine.chart} /> : (
            <div className="card mb-4">
              <EmptyState icon="grid-3x3" title="マンダラチャートがまだありません"
                message="センターゴールと8つのテーマ・64の行動を書くと、毎週の振り返りと進み具合が見られるようになります。スマホで少しずつ進められます。"
                action={<Button variant="primary" icon="plus" onClick={() => navigate('/mandala/edit')}>チャートを作る</Button>} />
            </div>
          )}
          {mine.chart ? <FocusCard focus={mine.focus} week={data.week} /> : null}
          {mine.chart ? <RatesCard progress={mine.progress} lastWeek={mine.lastWeek} /> : null}
        </>
      ) : null}
    </div>
  );
}
