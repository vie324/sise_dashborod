import { useState } from 'react';
import { Badge, Button, EmptyState, PageHeader, cx } from '../../ui/primitives.jsx';
import { showToast } from '../../ui/feedback.jsx';
import { ROLE_LABELS } from '../../lib/access.js';
import { useMandala, mandalaAction } from './data.js';
import ChartView from './ChartView.jsx';
import { ReviewReadOnly } from './Review.jsx';
import { DailyForm, DailyComments } from './Daily.jsx';
import { Timeline } from './Social.jsx';
import { Toggle, WeekNav, DayStrip, StateBadge, LoadingState, ErrorState, go } from './parts.jsx';
import { formatDay } from '../../../shared/mandala.js';

// ============================================================
// メンバーの詳細（店長・オーナー）: 週報 / マンダラ / 日報 / 動き
// 権限はサーバーが判定する（担当店舗のメンバーだけ）。
// ============================================================

const TABS = [
  { key: 'review', label: '週報', icon: 'notebook-pen' },
  { key: 'chart', label: 'マンダラ', icon: 'grid-3x3' },
  { key: 'daily', label: '日報', icon: 'sun-medium' },
  { key: 'activity', label: '動き', icon: 'activity' },
];

function MemberTabs({ id, tab }) {
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto rounded-xl bg-surface-3 p-1" aria-label="メンバーの詳細">
      {TABS.map((t) => (
        <a key={t.key} href={`#/mandala/member/${id}/${t.key}`} aria-current={t.key === tab ? 'page' : undefined}
          className={cx('inline-flex h-10 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[13px] font-semibold transition-colors sm:h-9',
            t.key === tab ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink')}>
          {t.label}
        </a>
      ))}
    </nav>
  );
}

function DailyTarget({ member, enabled, canManage }) {
  const [value, setValue] = useState(enabled);
  const [busy, setBusy] = useState(false);
  if (!canManage) return null;
  const toggle = async (next) => {
    setValue(next);
    setBusy(true);
    try {
      await mandalaAction('setDailyEnabled', { staffId: member.id, enabled: next });
      showToast(next ? `${member.name}さんを日報の対象にしました` : `${member.name}さんを日報の対象から外しました`, 'success');
    } catch (e) {
      setValue(!next);
      showToast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card mb-4 flex items-center justify-between gap-3 p-3.5">
      <div className="min-w-0">
        <p className="text-[13px] font-bold text-ink">日報の対象 {value ? <Badge tone="gold" className="ml-1">対象</Badge> : <Badge className="ml-1">対象外</Badge>}</p>
        <p className="mt-0.5 text-xs text-muted">対象にすると、本人のマンダラに「日報」が出て、毎日の業務チェックと振り返りを書きます。</p>
      </div>
      <Toggle checked={value} disabled={busy} onChange={toggle} label="日報の対象" />
    </div>
  );
}

function ReviewTab({ id, week }) {
  const res = useMandala('review', { staffId: id, week: week || '' });
  const data = res.shown;
  if (!data && res.error) return <ErrorState error={res.error} onRetry={res.reload} />;
  if (!data) return <LoadingState />;
  return (
    <>
      <DailyTarget key={data.member.id} member={data.member} enabled={data.dailyEnabled} canManage={data.canManage} />
      <WeekNav week={data.week} currentWeek={data.currentWeek} hrefFor={(w) => `/mandala/member/${id}/review/${w}`} />
      <div className="mb-3 flex justify-end"><StateBadge state={data.review ? (data.review.status === 'submitted' ? 'submitted' : 'draft') : 'none'} /></div>
      <ReviewReadOnly data={data} reload={res.reload} />
    </>
  );
}

function DailyTab({ id, date }) {
  const res = useMandala('daily', { staffId: id, date: date || '' });
  const data = res.shown;
  if (!data && res.error) return <ErrorState error={res.error} onRetry={res.reload} />;
  if (!data) return <LoadingState />;
  return (
    <>
      <DailyTarget key={`${data.member.id}-${data.dailyEnabled}`} member={data.member} enabled={data.dailyEnabled} canManage={data.canManage} />
      <DayStrip days={data.days} selected={data.date} statuses={data.statuses} hrefFor={(d) => `/mandala/member/${id}/daily/${d}`} />
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[13px] font-bold text-ink">{formatDay(data.date)}の日報</p>
        <StateBadge state={data.report ? (data.report.status === 'submitted' ? 'submitted' : 'draft') : 'none'} />
      </div>
      {data.report ? (
        <>
          <DailyForm key={data.date} data={data} readOnly />
          <DailyComments data={data} title="コメント" placeholder="承認のひとことや、明日へのアドバイスを送りましょう" />
        </>
      ) : (
        <div className="card"><EmptyState icon="sun-medium" title="この日の日報はまだありません" message={data.dailyEnabled ? null : 'このメンバーは日報の対象ではありません。上のスイッチで対象にできます。'} /></div>
      )}
    </>
  );
}

function ActivityTab({ id }) {
  const res = useMandala('activity', { staffId: id, days: 30 });
  const data = res.shown;
  if (!data && res.error) return <ErrorState error={res.error} onRetry={res.reload} />;
  if (!data) return <LoadingState />;
  return (
    <>
      <p className="mb-3 text-xs text-muted">直近30日・週報やチャートを日々どう進めているか</p>
      <Timeline events={data.events} />
    </>
  );
}

export default function Member({ id, tab = 'review', arg, me }) {
  // 名前・店舗はチャートの読み込みから出す（タブを変えても読み直さない）
  const head = useMandala('chart', { staffId: id });
  const member = head.shown && head.shown.member;
  if (!member && head.error) return <ErrorState error={head.error} onRetry={head.reload} />;
  return (
    <div className="pb-4">
      <PageHeader title={member ? member.name : '…'} actions={<Button size="sm" icon="chevron-left" onClick={go('/mandala/team')}>チームへ</Button>}>
        {member ? <p className="mt-1 text-[13px] text-muted">{member.storeNames.join('・') || '店舗未設定'}・{ROLE_LABELS[member.role] || member.role}</p> : null}
      </PageHeader>
      <MemberTabs id={id} tab={tab} />
      {tab === 'review' ? <ReviewTab id={id} week={arg} /> : null}
      {tab === 'chart' ? <ChartView staffId={id} embedded me={me} /> : null}
      {tab === 'daily' ? <DailyTab id={id} date={arg} /> : null}
      {tab === 'activity' ? <ActivityTab id={id} /> : null}
    </div>
  );
}
