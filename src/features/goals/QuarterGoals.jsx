import { useState } from 'react';
import { useApp } from '../../app/state.jsx';
import { useSummary, useGoals, useQuarterGoals } from '../../lib/hooks.js';
import { currentAccess, isManagerOrAbove, isAdminLike } from '../../lib/access.js';
import { Card, Button, EmptyState, Skeleton, cx } from '../../ui/primitives.jsx';
import { StorePicker } from '../../ui/pickers.jsx';
import { showToast, confirmDialog } from '../../ui/feedback.jsx';
import Icon from '../../ui/Icon.jsx';
import { yen, yenShort, num, pct, signedYen } from '../../lib/format.js';
import { addMonths, monthOf, monthsBetween, quarterStart, quarterMonths, quarterProgress, formatQuarterJa } from '../../../shared/dates.js';
import { INCENTIVE_RULES } from '../../../shared/incentive-rules.js';
import { DataStamp, DataWarnings } from '../shared/ScopeBar.jsx';
import { GoalRow, StoreGoalModal, StaffGoalModal, tierOf, UnlinkedBadge } from './parts.jsx';

// ============================================================
// 3ヶ月の目標（1〜3月・4〜6月・7〜9月・10〜12月）
// ------------------------------------------------------------
// 実績は 3ヶ月それぞれの集計（/api/salonone summary）を足し合わせる。
// 契約率は 3ヶ月の通算、会員数はいちばん新しい月の人数。
// ============================================================

function QuarterPicker({ value, onChange, min, max }) {
  const canPrev = !min || monthsBetween(min, value) > 0;
  const canNext = !max || monthsBetween(value, max) > 0;
  return (
    <div className="inline-flex h-10 items-center rounded-xl border border-line bg-surface shadow-card">
      <button type="button" className="flex h-full w-9 items-center justify-center rounded-l-xl text-ink-2 hover:bg-surface-2 disabled:opacity-30"
        onClick={() => onChange(addMonths(value, -3))} disabled={!canPrev} aria-label="前の 3ヶ月">
        <Icon name="chevron-left" size={16} />
      </button>
      <span className="min-w-[128px] px-1 text-center text-sm font-bold text-ink num" aria-live="polite">{formatQuarterJa(value)}</span>
      <button type="button" className="flex h-full w-9 items-center justify-center rounded-r-xl text-ink-2 hover:bg-surface-2 disabled:opacity-30"
        onClick={() => onChange(addMonths(value, 3))} disabled={!canNext} aria-label="次の 3ヶ月">
        <Icon name="chevron-right" size={16} />
      </button>
    </div>
  );
}

const mLabel = (m) => `${Number(m.slice(5))}月`;

/** 店舗の 3ヶ月の実績 */
function storeTotals(monthData, sid) {
  const out = { consumedSales: 0, depositSales: 0, visits: 0, contracts: 0, memberCount: null, byMonth: {} };
  for (const d of monthData) {
    if (!d) continue;
    const row = d.stores.find((s) => s.storeId === sid);
    if (!row) continue;
    out.consumedSales += row.consumedSales || 0;
    out.depositSales += row.depositSales || 0;
    out.visits += (row.contract3ch && row.contract3ch.visits) || 0;
    out.contracts += (row.contract3ch && row.contract3ch.contracts) || 0;
    if (row.retention && row.retention.memberCount != null) out.memberCount = row.retention.memberCount;
    out.byMonth[d.month] = row.consumedSales || 0;
  }
  out.ratePct = out.visits > 0 ? (out.contracts / out.visits) * 100 : 0;
  return out;
}

/** スタッフの 3ヶ月の実績（SalonOne のスタッフごと） */
function staffTotals(monthData) {
  const map = new Map();
  for (const d of monthData) {
    if (!d) continue;
    for (const row of d.staff) {
      const acc = map.get(row.key) || { row, consumedSales: 0, depositSales: 0, byMonth: {} };
      acc.row = row; // 名前・連携はいちばん新しい月のもの
      acc.consumedSales += row.metrics.consumedSales || 0;
      acc.depositSales += row.metrics.depositSales || 0;
      acc.byMonth[d.month] = row.metrics.consumedSales || 0;
      map.set(row.key, acc);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.consumedSales - a.consumedSales || a.row.name.localeCompare(b.row.name, 'ja'));
}

/** 月ごとの実績と単月の目標（3ヶ月の目標との差も） */
function MonthBreakdown({ months, actual, monthlyGoals, quarterTarget, thisMonth }) {
  const goalSum = months.reduce((s, m) => s + (monthlyGoals[m] || 0), 0);
  const allSet = months.every((m) => monthlyGoals[m]);
  const diff = quarterTarget && goalSum ? goalSum - quarterTarget : null;
  return (
    <div className="mt-3 rounded-xl border border-line">
      <table className="data-table text-xs">
        <thead>
          <tr><th>月</th><th className="text-right">実績</th><th className="text-right">単月の目標</th></tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m}>
              <td>{mLabel(m)}{m === thisMonth ? <span className="ml-1 text-[10px] text-muted">今月</span> : null}</td>
              <td className="num-cell">{monthsBetween(m, thisMonth) >= 0 ? yen(actual[m] || 0) : '—'}</td>
              <td className="num-cell">{monthlyGoals[m] ? yen(monthlyGoals[m]) : <span className="text-muted">未設定</span>}</td>
            </tr>
          ))}
          <tr>
            <td className="font-semibold">合計</td>
            <td className="num-cell font-semibold">{yen(months.reduce((s, m) => s + (actual[m] || 0), 0))}</td>
            <td className="num-cell font-semibold">{goalSum ? yen(goalSum) : '—'}</td>
          </tr>
        </tbody>
      </table>
      {diff != null && allSet && Math.abs(diff) >= 1000 ? (
        <p className="border-t border-line px-3 py-2 text-[11px] text-ink-2">
          単月の目標の合計が 3ヶ月の目標より <span className="font-semibold num">{signedYen(diff)}</span>{diff < 0 ? '（足りません）' : ''}
        </p>
      ) : null}
    </div>
  );
}

export default function QuarterGoals() {
  const { month, setMonth, storeId, setStoreId, stores, canSelectAll, allStoresLabel, today, storeName } = useApp();
  const thisMonth = monthOf(today);
  const start = quarterStart(month);
  const months = quarterMonths(start);
  // 期を移ったら、表示中の月もその期に合わせる（今月を含む期なら今月）
  const setStart = (s) => setMonth(quarterMonths(s).includes(thisMonth) ? thisMonth : s);
  const maxStart = quarterStart(addMonths(thisMonth, 3));

  // 3ヶ月それぞれの実績（まだ来ていない月は取らない。1ヶ月目はスタッフの一覧のため未来でも取る）
  const shownMonths = months.map((m, i) => (i === 0 || monthsBetween(m, thisMonth) >= 0 ? m : null));
  const s0 = useSummary(shownMonths[0], storeId);
  const s1 = useSummary(shownMonths[1], storeId);
  const s2 = useSummary(shownMonths[2], storeId);
  const sums = [s0, s1, s2];
  const monthData = shownMonths.map((m, i) => (m ? sums[i].data : null));
  const loading = shownMonths.some((m, i) => m && !sums[i].data);
  const latest = [...monthData].reverse().find(Boolean) || null;
  const error = sums.map((s) => s.error).find(Boolean);

  // 単月の目標（内訳の表示用）
  const g0 = useGoals(months[0]);
  const g1 = useGoals(months[1]);
  const g2 = useGoals(months[2]);
  const monthlyDocs = [g0, g1, g2].map((g) => g.shown || { stores: {}, staff: {} });
  const qRes = useQuarterGoals(start);
  const goals = qRes.shown || { stores: {}, staff: {} };

  const [editStore, setEditStore] = useState(null);
  const [editStaff, setEditStaff] = useState(null);
  const [busy, setBusy] = useState('');
  const manager = isManagerOrAbove();

  const diffStart = monthsBetween(quarterStart(thisMonth), start);
  const timing = diffStart > 0 ? 'future' : diffStart < 0 ? 'past' : 'current';
  const progress = quarterProgress(start, latest ? latest.asOf : today);
  const periodLabel = formatQuarterJa(start);

  const storeRows = latest ? latest.stores : (storeId === 'all' ? stores : stores.filter((s) => String(s.id) === storeId)).map((s) => ({ storeId: String(s.id), name: s.name }));
  const canEditStore = (sid) => isAdminLike() || (manager && currentAccess && currentAccess.storeIds.includes(sid));
  const canEditStaff = (row) => !!row.staffId && (isAdminLike() || manager || (currentAccess && row.staffId === currentAccess.staffId));
  const staff = staffTotals(monthData);

  const copyPrev = async () => {
    setBusy('copy');
    try {
      const r = await qRes.copyFrom(addMonths(start, -3));
      showToast(r.copied > 0 ? `前の 3ヶ月の目標を ${r.copied}件コピーしました` : 'コピーできる前の 3ヶ月の目標はありませんでした', r.copied > 0 ? 'success' : 'info');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };
  const split = async () => {
    const ok = await confirmDialog({
      title: '単月の目標に振り分けますか？',
      message: `${periodLabel}の目標を 3等分して、まだ目標を決めていない月に入れます（売上は 1,000円単位、端数は 3ヶ月目）。契約率は毎月同じ、会員数は 3ヶ月目の目標になります。決めてある単月の目標は変えません。`,
      confirmLabel: '振り分ける',
    });
    if (!ok) return;
    setBusy('split');
    try {
      const r = await qRes.splitToMonths();
      showToast(r.filled > 0
        ? `単月の目標を ${r.filled}件入れました${r.skipped ? `（決めてあった ${r.skipped}件はそのまま）` : ''}`
        : (r.skipped ? '単月の目標はすでに決めてあります' : '振り分けられる 3ヶ月の目標がありません'), r.filled > 0 ? 'success' : 'info');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 sm:mb-4">
        <QuarterPicker value={start} onChange={setStart} min="2025-01" max={maxStart} />
        <StorePicker value={storeId} onChange={setStoreId} stores={stores} allowAll={canSelectAll} allLabel={allStoresLabel} />
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          {latest ? <DataStamp data={latest} /> : null}
          {manager ? (
            <>
              <Button size="sm" icon="copy" onClick={copyPrev} loading={busy === 'copy'}>前の 3ヶ月をコピー</Button>
              <Button size="sm" icon="split" onClick={split} loading={busy === 'split'}>単月に振り分け</Button>
            </>
          ) : null}
        </div>
      </div>
      <DataWarnings data={latest} error={error} />
      {timing === 'future' ? (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[13px] text-ink-2">
          <Icon name="calendar-clock" size={16} className="text-muted" />{periodLabel}はまだ始まっていません。先に目標を決めておけます。
        </div>
      ) : null}

      <h2 className="mb-2 mt-2 flex items-center gap-2 text-sm font-bold text-ink"><Icon name="store" size={16} className="text-muted" />店舗の 3ヶ月の目標</h2>
      {loading && !latest ? <Skeleton className="mb-6 h-48 rounded-2xl" /> : (
        <div className={cx('mb-6 grid gap-4 lg:grid-cols-2', loading ? 'opacity-60' : '')}>
          {storeRows.map((s) => {
            const goal = goals.stores[s.storeId];
            const t = storeTotals(monthData, s.storeId);
            const monthlyGoals = Object.fromEntries(months.map((m, i) => [m, monthlyDocs[i].stores[s.storeId] && monthlyDocs[i].stores[s.storeId].consumedSales]));
            return (
              <Card key={s.storeId} title={s.name || storeName(s.storeId)} icon="store" subtitle={periodLabel}
                actions={canEditStore(s.storeId) ? <Button size="sm" icon={goal ? 'pencil' : 'plus'} onClick={() => setEditStore(s)}>{goal ? '編集' : '目標を設定'}</Button> : null}>
                {goal ? (
                  <div className="divide-y divide-line">
                    <GoalRow label="施術消化売上（3ヶ月の合計）" actual={t.consumedSales} target={goal.consumedSales} format={yen} progress={progress} timing={timing} perDayUnit={yen} />
                    {goal.depositSales ? (
                      <GoalRow label="入金売上（3ヶ月の合計）" actual={t.depositSales} target={goal.depositSales} format={yen} progress={progress} timing={timing} perDayUnit={yen} />
                    ) : null}
                    <GoalRow label="新規来店（3経路・3ヶ月の合計）" actual={t.visits} target={goal.newVisits} format={(v) => `${num(v)}名`} progress={progress} timing={timing} perDayUnit={(v) => `${num(v)}名`} />
                    {goal.contractRatePct ? (
                      <GoalRow label="契約率（3経路・3ヶ月の通算）" kind="level" actual={t.ratePct} target={goal.contractRatePct}
                        format={(v) => pct(v)} gapLabel={(g) => `${num(g, 1)}pt`} progress={progress} timing={timing} />
                    ) : null}
                    {goal.memberCount ? (
                      <GoalRow label="会員数（期末）" kind="level" actual={t.memberCount} target={goal.memberCount} format={(v) => `${num(v)}名`}
                        gapLabel={(g) => `${num(g)}名`} progress={progress} timing={timing} />
                    ) : null}
                    {goal.memo ? <p className="pt-3 text-xs leading-relaxed text-ink-2"><Icon name="sticky-note" size={13} className="mr-1 inline text-muted" />{goal.memo}</p> : null}
                  </div>
                ) : (
                  <EmptyState compact icon="target" title="3ヶ月の目標が未設定です" message={canEditStore(s.storeId) ? '3ヶ月の合計の施術消化売上・入金売上・新規来店と、契約率・期末の会員数の目標を設定できます' : '店長・マネージャー・オーナーが設定します'} />
                )}
                <MonthBreakdown months={months} actual={t.byMonth} monthlyGoals={monthlyGoals} quarterTarget={goal && goal.consumedSales} thisMonth={thisMonth} />
              </Card>
            );
          })}
        </div>
      )}

      <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-ink"><Icon name="users" size={16} className="text-muted" />{manager ? 'スタッフの 3ヶ月の目標' : 'あなたの 3ヶ月の目標'}</h2>
      {loading && !latest ? <Skeleton className="h-48 rounded-2xl" /> : staff.length === 0 ? (
        <Card><EmptyState icon="users" title="表示できるスタッフがいません" message={timing === 'future' ? 'この 3ヶ月が始まると実績が表示されます' : manager ? 'SalonOne のスタッフとダッシュボードのスタッフを連携してください（設定 > SalonOne連携）' : 'SalonOne のスタッフと連携されていません'} /></Card>
      ) : (
        <div className={cx('grid gap-3 md:grid-cols-2', loading ? 'opacity-60' : '')}>
          {staff.map(({ row, consumedSales, depositSales, byMonth }) => {
            const goal = row.staffId ? goals.staff[row.staffId] : null;
            const target = goal ? goal.consumedSales : null;
            const tier = tierOf(target, 3);
            return (
              <Card key={row.key}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-semibold text-ink">{row.name}<UnlinkedBadge row={row} /></div>
                    <div className="text-[11px] text-muted">{row.storeName}{tier ? ` ・ 毎月のランク ${yen(tier.amount)} 相当` : ''}</div>
                  </div>
                  {canEditStaff(row) ? <Button size="sm" variant={goal ? 'secondary' : 'subtle'} icon={goal ? 'pencil' : 'plus'} onClick={() => setEditStaff(row)}>{goal ? '編集' : '目標を設定'}</Button> : null}
                </div>
                <div className="mt-3">
                  <GoalRow label="施術消化売上（3ヶ月の合計）" actual={consumedSales} target={target} format={yen} progress={progress} timing={timing}
                    perDayUnit={(v) => `${yen(v)}（${(v / INCENTIVE_RULES.unitPrice).toFixed(1)}回）`} />
                </div>
                {goal && goal.depositSales ? (
                  <div className="mt-3 border-t border-line pt-3">
                    <GoalRow label="入金売上（3ヶ月の合計）" actual={depositSales} target={goal.depositSales} format={yen} progress={progress} timing={timing} perDayUnit={yen} />
                  </div>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-2">
                  {months.map((m) => (
                    <span key={m} className="num">{mLabel(m)} {monthsBetween(m, thisMonth) >= 0 ? yenShort(byMonth[m] || 0) : '—'}</span>
                  ))}
                </div>
                {goal && goal.memo ? <p className="mt-2 text-xs leading-relaxed text-ink-2"><Icon name="sticky-note" size={13} className="mr-1 inline text-muted" />{goal.memo}</p> : null}
              </Card>
            );
          })}
        </div>
      )}

      <StoreGoalModal open={!!editStore} onClose={() => setEditStore(null)} store={editStore} period="quarter" periodLabel={periodLabel}
        goal={editStore ? goals.stores[editStore.storeId] : null}
        onSave={(values) => qRes.save('store', editStore.storeId, values)} />
      <StaffGoalModal open={!!editStaff} onClose={() => setEditStaff(null)} row={editStaff} period="quarter" periodLabel={periodLabel}
        goal={editStaff && editStaff.staffId ? goals.staff[editStaff.staffId] : null}
        onSave={(values) => qRes.save('staff', editStaff.staffId, values)} />
    </div>
  );
}
