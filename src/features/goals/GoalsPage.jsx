import { useState } from 'react';
import { useApp } from '../../app/state.jsx';
import { useSummary, useGoals, useSpecialGoals } from '../../lib/hooks.js';
import { currentAccess, isManagerOrAbove, isAdminLike } from '../../lib/access.js';
import { PageHeader, Card, Button, EmptyState, Skeleton, Segmented } from '../../ui/primitives.jsx';
import { showToast } from '../../ui/feedback.jsx';
import Icon from '../../ui/Icon.jsx';
import { yen, num, pct } from '../../lib/format.js';
import { addMonths, formatMonthJa, monthsBetween, monthOf } from '../../../shared/dates.js';
import { INCENTIVE_RULES } from '../../../shared/incentive-rules.js';
import { ScopeBar, DataWarnings } from '../shared/ScopeBar.jsx';
import { GoalRow, StoreGoalModal, StaffGoalModal, tierOf, UnlinkedBadge } from './parts.jsx';
import QuarterGoals from './QuarterGoals.jsx';
import SpecialGoals from './SpecialGoals.jsx';

// ホームの特別目標（SpecialGoalStrip）からも 'special' を入れて開く
const GOALS_TAB_KEY = 'sise_goals_tab';

// ------------------------------------------------------------
// 単月
// ------------------------------------------------------------
function MonthlyGoals() {
  const { month, storeId, today, stores, storeName } = useApp();
  const summary = useSummary(month, storeId);
  const goalsRes = useGoals(month);
  const data = summary.shown;
  const goals = goalsRes.shown || { stores: {}, staff: {} };
  const [editStore, setEditStore] = useState(null);
  const [editStaff, setEditStaff] = useState(null);
  const [copying, setCopying] = useState(false);
  const manager = isManagerOrAbove();

  const diff = monthsBetween(monthOf(today), month);
  const timing = diff > 0 ? 'future' : diff < 0 ? 'past' : 'current';
  const progress = (data && data.progress) || { total: 30, elapsed: 0, remaining: 30, ratio: 0 };

  const storeRows = data ? data.stores : (storeId === 'all' ? stores : stores.filter((s) => String(s.id) === storeId)).map((s) => ({ storeId: String(s.id), name: s.name }));
  const canEditStore = (sid) => isAdminLike() || (manager && currentAccess && currentAccess.storeIds.includes(sid));
  const canEditStaff = (row) => !!row.staffId && (isAdminLike() || manager || (currentAccess && row.staffId === currentAccess.staffId));

  const copyPrev = async () => {
    setCopying(true);
    try {
      const r = await goalsRes.copyFrom(addMonths(month, -1));
      showToast(r.copied > 0 ? `前月の目標を ${r.copied}件コピーしました` : 'コピーできる前月の目標はありませんでした', r.copied > 0 ? 'success' : 'info');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setCopying(false);
    }
  };

  return (
    <div>
      <ScopeBar data={data} maxAhead={3}
        right={manager ? <Button size="sm" icon="copy" onClick={copyPrev} loading={copying}>前月の目標をコピー</Button> : null} />
      <DataWarnings data={data} error={summary.error} />
      {timing === 'future' ? (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[13px] text-ink-2">
          <Icon name="calendar-clock" size={16} className="text-muted" />{formatMonthJa(month)}はまだ始まっていません。先に目標を決めておけます。
        </div>
      ) : null}

      <h2 className="mb-2 mt-2 flex items-center gap-2 text-sm font-bold text-ink"><Icon name="store" size={16} className="text-muted" />店舗の目標</h2>
      {!data && summary.loading ? <Skeleton className="mb-6 h-48 rounded-2xl" /> : (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          {storeRows.map((s) => {
            const goal = goals.stores[s.storeId];
            const actualRet = s.retention || {};
            return (
              <Card key={s.storeId} title={s.name || storeName(s.storeId)} icon="store"
                actions={canEditStore(s.storeId) ? <Button size="sm" icon={goal ? 'pencil' : 'plus'} onClick={() => setEditStore(s)}>{goal ? '編集' : '目標を設定'}</Button> : null}>
                {goal ? (
                  <div className="divide-y divide-line">
                    <GoalRow label="施術消化売上" actual={s.consumedSales || 0} target={goal.consumedSales} format={yen} progress={progress} timing={timing} perDayUnit={yen} />
                    <GoalRow label="新規来店（3経路）" actual={(s.contract3ch && s.contract3ch.visits) || 0} target={goal.newVisits} format={(v) => `${num(v)}名`} progress={progress} timing={timing} perDayUnit={(v) => `${num(v)}名`} />
                    {goal.contractRatePct ? (
                      <GoalRow label="契約率（3経路）" kind="level" actual={s.contract3ch && s.contract3ch.ratePct != null ? s.contract3ch.ratePct : 0} target={goal.contractRatePct}
                        format={(v) => pct(v)} gapLabel={(g) => `${num(g, 1)}pt`} progress={progress} timing={timing} />
                    ) : null}
                    {goal.memberCount ? (
                      <GoalRow label="会員数" kind="level" actual={actualRet.memberCount ?? null} target={goal.memberCount} format={(v) => `${num(v)}名`}
                        gapLabel={(g) => `${num(g)}名`} progress={progress} timing={timing} />
                    ) : null}
                    {goal.memo ? <p className="pt-3 text-xs leading-relaxed text-ink-2"><Icon name="sticky-note" size={13} className="mr-1 inline text-muted" />{goal.memo}</p> : null}
                  </div>
                ) : (
                  <EmptyState compact icon="target" title="目標が未設定です" message={canEditStore(s.storeId) ? '施術消化売上・新規来店・契約率・会員数の目標を設定できます' : '店長・マネージャー・オーナーが設定します'} />
                )}
              </Card>
            );
          })}
        </div>
      )}

      <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-ink"><Icon name="users" size={16} className="text-muted" />{manager ? 'スタッフの目標' : 'あなたの目標'}</h2>
      {!data ? <Skeleton className="h-48 rounded-2xl" /> : data.staff.length === 0 ? (
        <Card><EmptyState icon="users" title="表示できるスタッフがいません" message={manager ? 'SalonOne のスタッフとダッシュボードのスタッフを連携してください（設定 > SalonOne連携）' : 'SalonOne のスタッフと連携されていません'} /></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.staff.map((row) => {
            const goal = row.staffId ? goals.staff[row.staffId] : null;
            const target = goal ? goal.consumedSales : null;
            const tier = tierOf(target);
            return (
              <Card key={row.key}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-semibold text-ink">{row.name}<UnlinkedBadge row={row} /></div>
                    <div className="text-[11px] text-muted">{row.storeName}{tier ? ` ・ 目標ランク ${yen(tier.amount)}` : ''}</div>
                  </div>
                  {canEditStaff(row) ? <Button size="sm" variant={goal ? 'secondary' : 'subtle'} icon={goal ? 'pencil' : 'plus'} onClick={() => setEditStaff(row)}>{goal ? '編集' : '目標を設定'}</Button> : null}
                </div>
                <div className="mt-3">
                  <GoalRow label="施術消化売上" actual={row.metrics.consumedSales} target={target} format={yen} progress={progress} timing={timing}
                    perDayUnit={(v) => `${yen(v)}（${(v / INCENTIVE_RULES.unitPrice).toFixed(1)}回）`} />
                </div>
                {goal && goal.memo ? <p className="mt-2 text-xs leading-relaxed text-ink-2"><Icon name="sticky-note" size={13} className="mr-1 inline text-muted" />{goal.memo}</p> : null}
              </Card>
            );
          })}
        </div>
      )}

      <StoreGoalModal open={!!editStore} onClose={() => setEditStore(null)} store={editStore} periodLabel={formatMonthJa(month)}
        goal={editStore ? goals.stores[editStore.storeId] : null}
        onSave={(values) => goalsRes.save('store', editStore.storeId, values)} />
      <StaffGoalModal open={!!editStaff} onClose={() => setEditStaff(null)} row={editStaff} periodLabel={formatMonthJa(month)}
        goal={editStaff && editStaff.staffId ? goals.staff[editStaff.staffId] : null}
        onSave={(values) => goalsRes.save('staff', editStaff.staffId, values)} />
    </div>
  );
}

// ------------------------------------------------------------
// ページ（単月・3ヶ月・特別目標）
// ------------------------------------------------------------
export default function GoalsPage() {
  const { today, stores } = useApp();
  const [tab, setTabState] = useState(() => {
    try { return localStorage.getItem(GOALS_TAB_KEY) || 'month'; } catch (_) { return 'month'; }
  });
  const setTab = (t) => {
    setTabState(t);
    try { localStorage.setItem(GOALS_TAB_KEY, t); } catch (_) { /* noop */ }
  };
  // 期限が来ていない特別目標の数（見られる店舗のぶん）
  const special = useSpecialGoals();
  const thisMonth = monthOf(today);
  const visible = new Set(stores.map((s) => String(s.id)));
  const activeSpecial = (special.shown || []).filter((g) => visible.has(String(g.storeId)) && monthsBetween(thisMonth, g.deadline) >= 0).length;
  return (
    <div>
      <PageHeader title="目標" subtitle="単月・3ヶ月の目標と、店舗ごとの特別目標を決めて、進み具合と必要なペースを確認します" />
      <Segmented
        className="mb-4"
        value={tab}
        onChange={setTab}
        ariaLabel="目標の期間"
        options={[
          { value: 'month', label: '単月', icon: 'calendar' },
          { value: 'quarter', label: '3ヶ月', icon: 'calendar-range' },
          { value: 'special', label: '特別目標', icon: 'trophy', count: activeSpecial || null },
        ]}
      />
      {tab === 'quarter' ? <QuarterGoals /> : tab === 'special' ? <SpecialGoals goalsRes={special} /> : <MonthlyGoals />}
    </div>
  );
}
