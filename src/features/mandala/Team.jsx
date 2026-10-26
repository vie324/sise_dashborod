import { useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { Badge, Button, Card, EmptyState, PageHeader, Select, cx } from '../../ui/primitives.jsx';
import { StatTile, Meter } from '../../ui/stats.jsx';
import { StorePicker } from '../../ui/pickers.jsx';
import { showToast } from '../../ui/feedback.jsx';
import { useApp } from '../../app/state.jsx';
import { mandalaGet } from '../../lib/api.js';
import { useMandala } from './data.js';
import { StateBadge, WeekNav, FillMeter, MiniStats, progressStats, LoadingState, ErrorState, go } from './parts.jsx';
import { formatMd, formatWeekRange, formatRate, chartFillRate } from '../../../shared/mandala.js';

// ============================================================
// チームの状況（店長 = 担当店舗 / オーナー = 全員）
// ------------------------------------------------------------
// 見るのは「チャートが書けているか」「週報・日報が回っているか」だけ。
// 売上は ホーム・売上分析（SalonOne）で見る。
// ============================================================

const CELL = {
  submitted: 'bg-[var(--chart-sales)] text-white',
  draft: 'bg-[#f6d68f] text-[#5c3d00] dark:bg-[#fab219]/40 dark:text-[#ffe9b0]',
  none: 'bg-surface-3 text-muted',
};
const MARK = { submitted: '済', draft: '書', none: '・' };

export function useTeam(week) {
  const { storeId } = useApp();
  return useMandala('team', { week: week || '', storeId: storeId || 'all' });
}

export function StoreFilter() {
  const { storeId, setStoreId, stores, canSelectAll, allStoresLabel } = useApp();
  return <StorePicker value={storeId} onChange={setStoreId} stores={stores} allowAll={canSelectAll} allLabel={allStoresLabel} />;
}

function CsvButton() {
  const { storeId } = useApp();
  const [weeks, setWeeks] = useState('12');
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const r = await mandalaGet('csv', { weeks, storeId: storeId || 'all' });
      const blob = new Blob([r.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = r.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-1.5">
      <Select value={weeks} onChange={(e) => setWeeks(e.target.value)} className="h-10 w-[96px] !py-0 text-[13px]" aria-label="CSV の期間">
        {['4', '8', '12', '26', '52'].map((w) => <option key={w} value={w}>{w}週分</option>)}
      </Select>
      <Button icon="download" loading={busy} onClick={download}>CSV</Button>
    </div>
  );
}

function Heatmap({ members, weeks }) {
  return (
    <Card title="週報の実施状況" icon="calendar-check" subtitle={`直近${weeks.length}週・マスを押すとその週の週報`} pad={false}>
      <div className="scroll-x px-4 pb-4">
        <table className="w-full min-w-[440px] border-separate border-spacing-y-1 text-xs">
          <thead>
            <tr className="text-[10px] text-muted">
              <th className="sticky left-0 z-10 bg-surface pr-2 text-left font-semibold">メンバー</th>
              {weeks.map((w) => <th key={w} className="px-0.5 text-center font-semibold num">{formatMd(w)}</th>)}
              <th className="pl-2 text-right font-semibold">連続</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <th className="sticky left-0 z-10 max-w-[96px] truncate bg-surface pr-2 text-left text-[12px] font-semibold text-ink">
                  <a href={`#/mandala/member/${m.id}`} className="hover:underline">{m.name}</a>
                </th>
                {m.weeks.map((w) => {
                  const label = `${m.name}・${formatWeekRange(w.week)}・${w.state === 'submitted' ? '提出済み' : w.state === 'draft' ? '下書き' : '未作成'}`;
                  return (
                    <td key={w.week} className="px-0.5 text-center">
                      <a href={`#/mandala/member/${m.id}/review/${w.week}`} title={label} aria-label={label}
                        className={cx('mx-auto flex h-7 w-7 items-center justify-center rounded-md text-[10px] font-bold', CELL[w.state])}>{MARK[w.state]}</a>
                    </td>
                  );
                })}
                <td className="pl-2 text-right text-muted num">{m.streak > 0 ? `${m.streak}週` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-muted">
          {['submitted', 'draft', 'none'].map((s) => (
            <span key={s} className="flex items-center gap-1"><span className={cx('flex h-4 w-4 items-center justify-center rounded text-[8px] font-bold', CELL[s])}>{MARK[s]}</span>{s === 'submitted' ? '提出済み' : s === 'draft' ? '下書き' : '未作成'}</span>
          ))}
        </p>
      </div>
    </Card>
  );
}

function DailyToday({ daily }) {
  if (!daily.members.length) return null;
  const done = daily.members.filter((m) => m.status === 'submitted').length;
  return (
    <Card title="今日の日報" icon="sun-medium" actions={<span className="text-xs text-muted num">{done}/{daily.members.length} 提出</span>}>
      <ul className="flex flex-wrap gap-1.5">
        {daily.members.map((m) => (
          <li key={m.id}>
            <a href={`#/mandala/member/${m.id}/daily/${daily.today}`}
              className={cx('inline-flex h-10 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold sm:h-8',
                m.status === 'submitted' ? 'border-brand-300 bg-brand-50 text-brand-800 dark:border-brand-500/40 dark:bg-brand-500/15 dark:text-brand-100'
                  : m.status === 'draft' ? 'border-dashed border-line-strong text-ink-2' : 'border-dashed border-line text-muted')}>
              {m.name}
              <span className="text-[10px]">{m.status === 'submitted' ? '済' : m.status === 'draft' ? '書きかけ' : '未'}</span>
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function StoresCard({ stores }) {
  if (stores.length < 2) return null;
  return (
    <Card title="店舗別" icon="store">
      <ul className="space-y-3">
        {stores.map((s) => (
          <li key={s.storeId}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
              <span className="truncate font-semibold text-ink">{s.name}</span>
              <span className="shrink-0 text-[11px] text-muted num">提出 {s.submittedCount}/{s.memberCount}・チャート {s.chartCount}/{s.memberCount}・実行率 {formatRate(s.checkRate)}</span>
            </div>
            <Meter value={s.submittedCount} max={s.memberCount || 1} height={6} label={`${s.name}の今週の提出`} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ChartBadge({ chart }) {
  if (!chart) return <Badge tone="neutral" icon="circle-dashed">チャート未作成</Badge>;
  return <Badge tone="brand" icon="grid-3x3">テーマ {chart.themeCount}/8・項目 {chart.itemCount}/64</Badge>;
}

function MemberCard({ m, week }) {
  return (
    <div className="card card-pad">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <a href={`#/mandala/member/${m.id}`} className="block truncate text-[15px] font-bold text-ink hover:underline">{m.name}</a>
          <p className="mt-0.5 truncate text-xs text-muted">{m.storeNames.join('・') || '店舗未設定'}・{(m.chart && m.chart.centerGoal) || 'センターゴール未設定'}</p>
        </div>
        <StateBadge state={m.current.state} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 empty:hidden">
        {!m.chart ? <ChartBadge chart={null} /> : null}
        {m.dailyEnabled ? <Badge tone="gold" icon="sun-medium">日報</Badge> : null}
        {!m.shareChart ? <Badge tone="neutral" icon="eye-off">仲間に非公開</Badge> : null}
      </div>
      {m.chart ? <FillMeter summary={m.chart} className="mt-3" /> : null}
      <MiniStats className="mt-3" items={progressStats(m).filter((x) => x.label !== '連続提出')} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" icon="notebook-pen" onClick={go(`/mandala/member/${m.id}/review/${week}`)}>週報</Button>
        <Button size="sm" variant="ghost" icon="grid-3x3" onClick={go(`/mandala/member/${m.id}/chart`)}>マンダラ</Button>
        {m.dailyEnabled ? <Button size="sm" variant="ghost" icon="sun-medium" onClick={go(`/mandala/member/${m.id}/daily`)}>日報</Button> : null}
      </div>
    </div>
  );
}

export default function Team({ week: weekParam }) {
  const res = useTeam(weekParam);
  const data = res.shown;
  if (!data && res.error) return <ErrorState error={res.error} onRetry={res.reload} />;
  const header = <PageHeader title="チームの状況" subtitle="チャートが書けているか、週報・日報が回っているかを見ます（売上はホーム・売上分析で）" actions={<><StoreFilter /><CsvButton /></>} />;
  if (!data) return <div>{header}<LoadingState /></div>;
  const { members, totals } = data;
  const notSubmitted = totals.members - totals.submitted;
  const noChart = totals.members - totals.withChart;
  return (
    <div className={cx('space-y-4 transition-opacity', res.stale || res.loading ? 'opacity-70' : '')}>
      {header}
      <WeekNav week={data.week} currentWeek={data.currentWeek} hrefFor={(w) => `/mandala/team/${w}`} className="!mb-0" />
      {members.length === 0 ? (
        <div className="card"><EmptyState icon="users" title="メンバーがいません" message="設定 → スタッフ で店舗を割り当てると、ここに表示されます。" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="メンバー" icon="users" value={`${totals.members}名`} />
            <StatTile label="この週の提出" icon="notebook-pen" value={`${totals.submitted}/${totals.members}`} sub={notSubmitted > 0 ? `未提出 ${notSubmitted}名` : '全員提出済み'} />
            <StatTile label="チャート作成" icon="grid-3x3" value={`${totals.withChart}/${totals.members}`} sub={noChart > 0 ? `未作成 ${noChart}名` : '全員作成済み'} />
            <StatTile label={`直近${data.weeks.length}週で未提出`} icon="circle-alert" value={`${totals.inactive}名`} sub="一度も週報を出していない" />
          </div>
          <DailyToday daily={data.daily} />
          <Heatmap members={members} weeks={data.weeks} />
          <StoresCard stores={data.stores} />
          <h2 className="flex items-center gap-2 pt-1 text-sm font-bold text-ink"><Icon name="users-round" size={16} className="text-muted" />メンバーごと</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {members.map((m) => <MemberCard key={m.id} m={m} week={data.week} />)}
          </div>
        </>
      )}
    </div>
  );
}

/** みんなのマンダラ（チャートの一覧） */
export function ChartCard({ m, href, showStore = true }) {
  const chart = m.chart;
  return (
    <div className="card card-pad">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold text-ink">{m.name}</p>
          {showStore ? <p className="mt-0.5 truncate text-xs text-muted">{m.storeNames.join('・') || '店舗未設定'}</p> : null}
        </div>
        <StateBadge state={m.current.state} prefix="今週 " />
      </div>
      {chart ? (
        <>
          <button type="button" onClick={go(href)} className="mt-3 block w-full rounded-xl bg-brand-50 px-3 py-2 text-left text-[14px] font-bold leading-snug text-ink dark:bg-brand-500/15">{chart.centerGoal || '（センターゴール未入力）'}</button>
          <ul className="mt-2 flex flex-wrap gap-1">
            {chart.themes.map((t) => (
              <li key={t.position} title={`${t.title || '未入力'}・項目 ${t.filled}/8`}
                className={cx('inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px]', t.title.trim() ? 'bg-surface-3 text-ink-2' : 'border border-dashed border-line text-muted')}>
                <span className="truncate">{t.title || '未入力'}</span><span className="shrink-0 text-muted num">{t.filled}/8</span>
              </li>
            ))}
          </ul>
          <FillMeter summary={chart} className="mt-3" />
          <MiniStats className="mt-3" items={progressStats(m).filter((x) => x.label !== 'フォーカス達成')} />
          <div className="mt-3"><Button size="sm" icon="grid-3x3" onClick={go(href)}>チャートを見る</Button></div>
        </>
      ) : <p className="mt-3 rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-muted">マンダラチャートはまだ作られていません。</p>}
    </div>
  );
}

export function Charts() {
  const res = useTeam(null);
  const data = res.shown;
  if (!data && res.error) return <ErrorState error={res.error} onRetry={res.reload} />;
  if (!data) return <LoadingState />;
  const withChart = data.members.filter((m) => m.chart).sort((a, b) => chartFillRate(b.chart) - chartFillRate(a.chart));
  const without = data.members.filter((m) => !m.chart);
  return (
    <div className="space-y-3">
      <PageHeader title="みんなのマンダラ" subtitle={`${data.members.length}名中 ${withChart.length}名がチャートを作成済み`} actions={<StoreFilter />} />
      {without.length ? (
        <div className="card card-pad">
          <p className="text-[13px] font-bold text-ink">チャート未作成 {without.length}名</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {without.map((m) => <li key={m.id} className="rounded-full border border-dashed border-line-strong px-2.5 py-1 text-xs text-ink-2">{m.name}</li>)}
          </ul>
          <p className="mt-2 text-xs text-muted">作ると、週報でチェックする行動とフォーカスが使えるようになります。声をかけてみましょう。</p>
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        {withChart.map((m) => <ChartCard key={m.id} m={m} href={`/mandala/member/${m.id}/chart`} />)}
      </div>
    </div>
  );
}
