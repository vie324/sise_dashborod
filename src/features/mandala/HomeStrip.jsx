import Icon from '../../ui/Icon.jsx';
import { cx } from '../../ui/primitives.jsx';
import { navigate } from '../../app/router.js';
import { useMandala } from './data.js';
import { STATE_LABEL } from './parts.jsx';

// ============================================================
// ダッシュボードのホームに出すマンダラの入口
//   本人   … 今週の振り返り・今日の日報の状況（タップで書く画面へ）
//   店長など … チームの週報・日報の提出状況（タップでチームの状況へ）
// マンダラが使えない時（マイグレーション前など）は何も出さない（ホームを邪魔しない）。
// ============================================================

function Tile({ icon, tone, title, sub, badge, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3 text-left shadow-card transition-colors hover:border-line-strong">
      <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', tone)}><Icon name={icon} size={18} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold text-ink">{title}</span>
        <span className="block truncate text-[11px] text-ink-2 num">{sub}</span>
      </span>
      {badge}
      <Icon name="chevron-right" size={16} className="shrink-0 text-muted" />
    </button>
  );
}

const pill = (state) => {
  const cls = state === 'submitted' ? 'bg-[#e7f6e7] text-[#0f5f12] dark:bg-[#0ca30c]/15 dark:text-[#7fe08a]'
    : state === 'draft' ? 'bg-[#fff4d6] text-[#7a5300] dark:bg-[#fab219]/15 dark:text-[#f9d27a]' : 'bg-surface-3 text-ink-2';
  return <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', cls)}>{STATE_LABEL[state]}</span>;
};

export default function MandalaHomeStrip() {
  const res = useMandala('home');
  const data = res.shown;
  if (!data) return null;
  const { me, team } = data;
  const tiles = [];
  if (me) {
    if (!me.chart) {
      tiles.push(<Tile key="chart" icon="grid-3x3" tone="bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200"
        title="マンダラチャートを作りましょう" sub="目標と毎週の行動を決めると、週報で振り返れます" onClick={() => navigate('/mandala/edit')} />);
    } else {
      const state = me.review ? (me.review.status === 'submitted' ? 'submitted' : 'draft') : 'none';
      const p = me.progress;
      tiles.push(<Tile key="review" icon="notebook-pen" tone="bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200"
        title="今週の振り返り（マンダラ）"
        sub={[me.focus.length ? `フォーカス ${me.focus.length}つ` : 'フォーカス未設定', p && p.streak > 0 ? `${p.streak}週連続で提出` : null].filter(Boolean).join('・')}
        badge={pill(state)} onClick={() => navigate('/mandala/review')} />);
    }
    if (me.daily.enabled) {
      const st = me.daily.status === 'submitted' ? 'submitted' : me.daily.status ? 'draft' : 'none';
      tiles.push(<Tile key="daily" icon="sun-medium" tone="bg-gold-50 text-gold-700 dark:bg-gold-500/15 dark:text-gold-200"
        title="今日の日報" sub={st === 'submitted' ? 'おつかれさまでした' : '業務チェックと振り返り・1〜2分'} badge={pill(st)} onClick={() => navigate('/mandala/daily')} />);
    }
  }
  if (team && team.members > 0) {
    tiles.push(<Tile key="team" icon="users-round" tone="bg-surface-3 text-ink-2"
      title="チームの週報" sub={`今週の提出 ${team.submitted}/${team.members}名${team.dailyMembers ? `・今日の日報 ${team.dailySubmitted}/${team.dailyMembers}名` : ''}`}
      onClick={() => navigate('/mandala/team')} />);
  }
  if (!tiles.length) return null;
  return <div className={cx('mb-4 grid gap-2', tiles.length > 1 ? 'sm:grid-cols-2' : '', tiles.length > 2 ? 'lg:grid-cols-3' : '')}>{tiles}</div>;
}
