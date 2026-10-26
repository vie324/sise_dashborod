import { useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { EmptyState, PageHeader, Segmented, cx } from '../../ui/primitives.jsx';
import { showToast } from '../../ui/feedback.jsx';
import { useMandala, mandalaAction } from './data.js';
import { ChartCard, StoreFilter } from './Team.jsx';
import { Toggle, LoadingState, ErrorState } from './parts.jsx';
import { SHARING_SCOPE_LABEL, formatDateTimeJst, formatWeekShort, formatDay } from '../../../shared/mandala.js';
import { dateJa } from '../../lib/format.js';
import { useApp } from '../../app/state.jsx';

// ============================================================
// 仲間のマンダラ（共有がオンの時）と、日々の動き（店長・オーナー）
// ============================================================

export function Peers() {
  const res = useMandala('peers');
  const [busy, setBusy] = useState(false);
  const data = res.shown;
  if (!data && res.error) return <ErrorState error={res.error} onRetry={res.reload} />;
  if (!data) return <LoadingState />;
  const toggle = async (next) => {
    setBusy(true);
    try {
      await mandalaAction('setShare', { share: next });
      showToast(next ? 'チャートを公開しました' : 'チャートを非公開にしました', 'success');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <PageHeader title="仲間のマンダラ" subtitle={data.scope !== 'off' ? `${SHARING_SCOPE_LABEL[data.scope]}で共有中・${data.members.length}名` : null} />
      {data.scope === 'off' ? (
        <div className="card"><EmptyState icon="users-round" title="共有はまだオフです" message="オーナーが共有をオンにすると、仲間のマンダラと進み具合を見られるようになります。" /></div>
      ) : (
        <>
          <div className="card flex items-center justify-between gap-3 p-3.5">
            <div className="min-w-0">
              <p className="text-[13px] font-bold text-ink">自分のチャートを公開する</p>
              <p className="mt-0.5 text-xs text-muted">見せ合う機能なので、非公開の間は仲間のチャートも見えません。</p>
            </div>
            <Toggle checked={data.shareChart} disabled={busy} onChange={toggle} label="自分のチャートを公開する" />
          </div>
          <p className="px-1 text-[11px] text-muted">見えるのはチャートと進み具合（提出・行動の実行率）だけです。週報の文章・AI のレビュー・コメントは見えません。</p>
          {data.members.length === 0 ? (
            <div className="card"><EmptyState icon="users-round" title="表示できる仲間がいません" message={data.shareChart ? '共有をオンにしている仲間がいると、ここにチャートが並びます。' : '自分のチャートを公開すると、公開している仲間のチャートが見えます。'} /></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {data.members.map((m) => <ChartCard key={m.id} m={m} href={`/mandala/chart/${m.id}`} showStore={data.scope === 'all'} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const KIND = {
  review_started: { label: '週報の下書きを作成', icon: 'pencil-line', cls: 'bg-[#fff4d6] text-[#7a5300] dark:bg-[#fab219]/15 dark:text-[#f9d27a]' },
  review_updated: { label: '週報の下書きを更新', icon: 'pencil-line', cls: 'bg-[#fff4d6] text-[#7a5300] dark:bg-[#fab219]/15 dark:text-[#f9d27a]' },
  review_submitted: { label: '週報を提出', icon: 'circle-check', cls: 'bg-[#e7f6e7] text-[#0f5f12] dark:bg-[#0ca30c]/15 dark:text-[#7fe08a]' },
  chart_created: { label: 'マンダラチャートを作成', icon: 'grid-3x3', cls: 'bg-[#e8f1fc] text-[#1f5aa6] dark:bg-[#3987e5]/15 dark:text-[#9cc3f3]' },
  chart_updated: { label: 'マンダラチャートを更新', icon: 'grid-3x3', cls: 'bg-[#e8f1fc] text-[#1f5aa6] dark:bg-[#3987e5]/15 dark:text-[#9cc3f3]' },
  ai_review: { label: 'AI のレビュー', icon: 'sparkles', cls: 'bg-gold-50 text-gold-800 dark:bg-gold-500/15 dark:text-gold-200' },
  comment: { label: 'コメント', icon: 'message-circle', cls: 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200' },
  cheer: { label: '応援', icon: 'heart-handshake', cls: 'bg-[#fdecf3] text-[#a3245a] dark:bg-[#e87ba4]/15 dark:text-[#f3b3cd]' },
  daily_submitted: { label: '日報を提出', icon: 'sun-medium', cls: 'bg-gold-50 text-gold-800 dark:bg-gold-500/15 dark:text-gold-200' },
};

function linkOf(e) {
  if (e.week) return `/mandala/member/${e.subjectId}/review/${e.week}`;
  if (e.date) return `/mandala/member/${e.subjectId}/daily/${e.date}`;
  return `/mandala/member/${e.subjectId}/chart`;
}

export function Timeline({ events, linkToMember = true }) {
  if (!events.length) return <div className="card"><EmptyState icon="activity" title="この期間の動きはありません" message="週報の作成・提出やチャートの更新があると、ここに時系列で並びます。" /></div>;
  const days = [];
  for (const e of events) {
    const last = days[days.length - 1];
    if (last && last.day === e.day) last.events.push(e);
    else days.push({ day: e.day, events: [e] });
  }
  return (
    <div className="space-y-4">
      {days.map(({ day, events: list }) => (
        <section key={day}>
          <h3 className="mb-2 text-xs font-semibold text-muted">{dateJa(day)}<span className="ml-2 font-normal">{list.length}件</span></h3>
          <div className="card">
            <ul className="divide-y divide-line">
              {list.map((e) => {
                const k = KIND[e.kind] || KIND.comment;
                const self = e.actorId === e.subjectId;
                const Tag = linkToMember ? 'a' : 'div';
                return (
                  <li key={e.id}>
                    <Tag href={linkToMember ? `#${linkOf(e)}` : undefined} className={cx('flex gap-3 px-4 py-3', linkToMember ? 'hover:bg-surface-2' : '')}>
                      <span className={cx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', k.cls)}><Icon name={k.icon} size={15} /></span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] leading-snug text-ink">
                          <span className="font-semibold">{e.actorName}</span>
                          {self ? null : <span className="text-muted"> → {e.subjectName}</span>}
                          <span className="text-ink-2"> {k.label}</span>
                        </p>
                        <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted num">
                          <span>{formatDateTimeJst(e.at)}</span>
                          {e.week ? <span>{formatWeekShort(e.week)}</span> : null}
                          {e.date ? <span>{formatDay(e.date)}の日報</span> : null}
                        </p>
                        {e.note ? <p className="mt-1 line-clamp-2 rounded-lg bg-surface-2 px-2 py-1 text-xs leading-snug text-ink-2">{e.note}</p> : null}
                      </div>
                      {linkToMember ? <Icon name="chevron-right" size={16} className="mt-2 shrink-0 text-muted" /> : null}
                    </Tag>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ))}
    </div>
  );
}

export function Activity() {
  const [days, setDays] = useState(7);
  const { storeId } = useApp();
  const res = useMandala('activity', { days, storeId: storeId || 'all' });
  const data = res.shown;
  return (
    <div className="space-y-3">
      <PageHeader title="日々の動き" subtitle="提出の瞬間だけでなく、いつ書き始めたかも見えます" actions={<StoreFilter />} />
      <Segmented value={days} onChange={setDays} ariaLabel="期間" options={[{ value: 7, label: '7日' }, { value: 14, label: '14日' }, { value: 30, label: '30日' }]} />
      {!data && res.error ? <ErrorState error={res.error} onRetry={res.reload} /> : !data ? <LoadingState /> : (
        <div className={cx('transition-opacity', res.stale || res.loading ? 'opacity-70' : '')}><Timeline events={data.events} /></div>
      )}
    </div>
  );
}
