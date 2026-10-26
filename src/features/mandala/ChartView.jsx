import { useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { Button, Card, EmptyState, PageHeader } from '../../ui/primitives.jsx';
import { showToast } from '../../ui/feedback.jsx';
import { navigate } from '../../app/router.js';
import MandalaBoard from './Board.jsx';
import { useMandala, mandalaAction } from './data.js';
import { Legend, FillMeter, MiniStats, progressStats, WeekChips, Thread, Toggle, LoadingState, ErrorState, MemberLine, go } from './parts.jsx';
import { summarizeChart, formatManYen, SHARING_SCOPE_LABEL } from '../../../shared/mandala.js';
import { formatMonthJa } from '../../../shared/dates.js';

// ============================================================
// マンダラチャートを見る
//   本人      … 9×9・目標・公開設定・届いた応援
//   仲間      … チャートと進捗の集計値・応援を送る（今の売上・内訳のメモは見えない）
//   店長など  … メンバー詳細のタブの中で同じものを見る（embedded）
// ============================================================

function ShareCard({ share, scope }) {
  const [value, setValue] = useState(share);
  const [busy, setBusy] = useState(false);
  const toggle = async (next) => {
    setValue(next);
    setBusy(true);
    try {
      await mandalaAction('setShare', { share: next });
      showToast(next ? 'チャートを仲間に公開しました' : 'チャートを非公開にしました', 'success');
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
        <p className="text-[13px] font-bold text-ink">仲間にチャートを公開する</p>
        <p className="mt-0.5 text-xs text-muted">
          {value ? `${SHARING_SCOPE_LABEL[scope]}の仲間が、あなたのチャートと進み具合（集計だけ）を見られます。` : 'いまは非公開です。非公開の間は仲間のチャートも見えません（店長・オーナーは見られます）。'}
        </p>
      </div>
      <Toggle checked={value} disabled={busy} onChange={toggle} label="仲間にチャートを公開する" />
    </div>
  );
}

function GoalBox({ chart }) {
  const [open, setOpen] = useState(false);
  if (!chart.targetAmount && !chart.targetBreakdown) return null;
  return (
    <div className="card mb-4 p-3.5">
      <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
        <span className="text-muted">目標</span>
        {chart.baselineAmount ? <span className="text-ink-2 num">{formatManYen(chart.baselineAmount)} →</span> : null}
        {chart.targetAmount ? <span className="text-[16px] font-bold text-ink num">月{formatManYen(chart.targetAmount)}</span> : null}
        {chart.deadlineMonth ? <span className="text-xs text-muted">（{formatMonthJa(chart.deadlineMonth.slice(0, 7))}まで）</span> : null}
      </div>
      {chart.targetBreakdown ? (
        <>
          <button type="button" onClick={() => setOpen(!open)} className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-brand-700 dark:text-brand-300">
            <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} />差分の内訳（逆算）
          </button>
          {open ? <p className="mt-1.5 whitespace-pre-wrap rounded-xl bg-surface-2 px-3 py-2 text-[13px] leading-relaxed text-ink-2">{chart.targetBreakdown}</p> : null}
        </>
      ) : null}
    </div>
  );
}

function CheerThread({ data, reload }) {
  const chart = data.chart;
  const post = async (body) => { await mandalaAction('addCheer', { chartId: chart.id, body }); reload(); };
  const remove = async (id) => { await mandalaAction('deleteCheer', { id }); reload(); };
  if (data.isSelf && data.cheers.length === 0) return null;
  return (
    <Thread className="mt-4" title={data.isSelf ? '届いた応援' : '応援'} icon="heart-handshake" items={data.cheers}
      onPost={data.canCheer ? post : null} onDelete={remove} maxLength={500} postLabel="応援を送る"
      placeholder={`${data.member.name}さんのチャートの、いいと思ったところを送りましょう`}
      emptyText="まだ応援はありません。" />
  );
}

export default function ChartView({ staffId, embedded = false }) {
  const res = useMandala('chart', staffId ? { staffId } : {});
  const data = res.shown;
  if (!data && res.error) return <ErrorState error={res.error} onRetry={res.reload} />;
  if (!data) return <LoadingState />;
  const chart = data.chart;
  const summary = chart ? summarizeChart(chart) : null;

  if (data.isSelf) {
    return (
      <div>
        <PageHeader title="マンダラチャート" subtitle={summary ? `テーマ ${summary.themeCount}/8・項目 ${summary.itemCount}/64・週次チェック ${summary.trackableCount}件` : null}
          actions={chart ? <Button variant="primary" icon="pencil" onClick={go('/mandala/edit')}>編集する</Button> : null} />
        {data.scope !== 'off' ? <ShareCard share={data.shareChart} scope={data.scope} /> : null}
        {!chart ? (
          <div className="card">
            <EmptyState icon="grid-3x3" title="チャートがまだありません" message="センターゴール・8つのテーマ・64の行動を登録すると、週次の振り返りで使えるようになります。"
              action={<Button variant="primary" icon="plus" onClick={() => navigate('/mandala/edit')}>チャートを作る</Button>} />
          </div>
        ) : (
          <>
            <GoalBox chart={chart} />
            <MandalaBoard chart={chart} focusIds={data.focusIds} />
            <div className="mt-4"><Legend showFocus={data.focusIds.length > 0} /></div>
            <CheerThread data={data} reload={res.reload} />
          </>
        )}
      </div>
    );
  }

  const p = data.progress;
  return (
    <div>
      {!embedded ? (
        <PageHeader title={`${data.member.name}さんのマンダラ`} actions={<Button size="sm" icon="chevron-left" onClick={go(data.viaPeer ? '/mandala/peers' : '/mandala/team')}>一覧へ</Button>}>
          <MemberLine member={data.member} />
        </PageHeader>
      ) : null}
      {!chart ? (
        <div className="card">
          <EmptyState icon="grid-3x3" title="チャートがまだありません" message={`${data.member.name}さんはマンダラチャートをまだ作っていません。${data.viaPeer ? '' : '作るように声をかけてみましょう。'}`} />
        </div>
      ) : (
        <>
          <Card className="mb-4">
            <p className="text-[11px] font-semibold text-brand-700 dark:text-brand-300">センターゴール</p>
            <p className="mt-0.5 text-[17px] font-bold leading-snug text-ink">{chart.centerGoal}</p>
            {chart.targetAmount ? <p className="mt-1 text-xs text-muted num">目標 月{formatManYen(chart.targetAmount)}{chart.deadlineMonth ? `（${formatMonthJa(chart.deadlineMonth.slice(0, 7))}まで）` : ''}</p> : null}
            <FillMeter summary={summary} className="mt-3" />
            <MiniStats className="mt-3" items={progressStats(p)} />
            <p className="mb-1.5 mt-3 text-[11px] font-semibold text-muted">週報の実施状況（直近{p.weeks.length}週）</p>
            <WeekChips weeks={p.weeks} hrefFor={data.viaPeer ? null : (w) => `/mandala/member/${data.member.id}/review/${w}`} />
          </Card>
          {!data.viaPeer && chart.targetBreakdown ? <GoalBox chart={{ ...chart, targetAmount: null }} /> : null}
          <MandalaBoard chart={chart} focusIds={data.focusIds} />
          <div className="mt-4"><Legend showFocus={data.focusIds.length > 0} /></div>
          {data.viaPeer ? <p className="mt-3 text-[11px] text-muted">仲間に見えるのはチャートと進み具合の集計だけです。週報の文章・AI のレビュー・コメントは見えません。</p> : null}
          <CheerThread data={data} reload={res.reload} />
        </>
      )}
    </div>
  );
}
