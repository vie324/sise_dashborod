import { useApp } from '../../app/state.jsx';
import { useSpecialGoals } from '../../lib/hooks.js';
import { Meter } from '../../ui/stats.jsx';
import Icon from '../../ui/Icon.jsx';
import { navigate } from '../../app/router.js';
import { forecastMonthEnd } from '../../../shared/metrics.js';
import { monthOf, monthsBetween } from '../../../shared/dates.js';
import { METRIC_FORMAT, deadlineLabel } from './GoalPlan.jsx';

// ============================================================
// ホームに出す特別目標（表示中の店舗のぶん・期限が来ていないもの）
// 数字は今月を表示している時だけ、ホームの集計（summary）から出す。
// タップすると目標 → 特別目標（達成までの道すじ）へ。
// ============================================================

function nowValue(goal, summary) {
  const row = summary.stores.find((s) => s.storeId === String(goal.storeId));
  if (!row) return null;
  if (goal.metric === 'memberCount') return row.retention && row.retention.memberCount != null ? row.retention.memberCount : null;
  const actual = row[goal.metric];
  const p = summary.progress;
  if (actual == null || !p.elapsed) return null;
  return forecastMonthEnd(actual, p.elapsed, p.total);
}

function openSpecialGoals() {
  try { localStorage.setItem('sise_goals_tab', 'special'); } catch (_) { /* noop */ }
  navigate('/goals');
}

export default function SpecialGoalStrip({ summary }) {
  const { today, storeName } = useApp();
  const res = useSpecialGoals();
  const thisMonth = monthOf(today);
  const scope = new Set(summary.scope.storeIds.map(String));
  const goals = (res.shown || [])
    .filter((g) => scope.has(String(g.storeId)) && monthsBetween(thisMonth, g.deadline) >= 0)
    .sort((a, b) => (a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0))
    .slice(0, 3);
  if (!goals.length) return null;
  const live = summary.month === thisMonth;
  return (
    <div className="mb-4 grid gap-2 lg:grid-cols-2">
      {goals.map((g) => {
        const format = METRIC_FORMAT[g.metric];
        const now = live ? nowValue(g, summary) : null;
        return (
          <button key={g.id} type="button" onClick={openSpecialGoals}
            className="flex w-full items-center gap-3 rounded-2xl border border-gold-200 bg-gold-50/70 px-3.5 py-3 text-left transition-colors hover:border-gold-300 dark:border-gold-500/25 dark:bg-gold-500/10">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold-100 text-gold-700 dark:bg-gold-500/20 dark:text-gold-200"><Icon name="trophy" size={18} /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-bold text-ink">{g.title}</span>
              <span className="block text-[11px] text-ink-2">{storeName(g.storeId)} ・ {deadlineLabel(g.deadline, thisMonth)}</span>
              {now != null ? (
                <>
                  <Meter className="mt-1.5" value={now} max={g.target} height={6} tone="gold" label={`${g.title}の進み具合`} />
                  <span className="mt-1 block text-[11px] text-ink-2 num">
                    {g.metric === 'memberCount' ? '今' : '今月の見込み'} <span className="font-semibold text-ink">{format(now)}</span> / 目標 {format(g.target)}
                  </span>
                </>
              ) : <span className="mt-0.5 block text-[11px] text-ink-2 num">目標 {format(g.target)}</span>}
            </span>
            <Icon name="chevron-right" size={16} className="shrink-0 text-muted" />
          </button>
        );
      })}
    </div>
  );
}
