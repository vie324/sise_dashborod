import { useEffect, useState } from 'react';
import { useApp } from '../../app/state.jsx';
import { useSummary, useGoals } from '../../lib/hooks.js';
import { currentAccess, isManagerOrAbove, isAdminLike } from '../../lib/access.js';
import { PageHeader, Card, Button, Modal, Field, Input, Textarea, EmptyState, Skeleton, Badge, cx } from '../../ui/primitives.jsx';
import { Meter, StatusPill } from '../../ui/stats.jsx';
import { showToast } from '../../ui/feedback.jsx';
import Icon from '../../ui/Icon.jsx';
import { yen, yenShort, num, pct } from '../../lib/format.js';
import { addMonths, formatMonthJa, monthsBetween, monthOf } from '../../../shared/dates.js';
import { forecastMonthEnd } from '../../../shared/metrics.js';
import { INCENTIVE_RULES } from '../../../shared/incentive-rules.js';
import { ScopeBar, DataWarnings } from '../shared/ScopeBar.jsx';

// ------------------------------------------------------------
// 進み具合の判定
// ------------------------------------------------------------
// kind: 'cumulative' = 月内に積み上がる数字（売上・新規数）→ ペースで判定
//       'level'      = その時点の水準（契約率・会員数）→ 目標との差で判定
function judge(actual, target, progress, timing, kind, gapLabel) {
  if (!target) return { status: 'none' };
  if (timing === 'future') return { status: 'pending', label: 'これから' };
  if (actual >= target) return { status: 'achieved' };
  if (timing === 'past') return { status: 'unmet', label: '未達' };
  if (kind === 'level') return { status: 'behind', label: gapLabel ? `あと${gapLabel(target - actual)}` : 'もう少し' };
  const forecast = forecastMonthEnd(actual, progress.elapsed, progress.total);
  if (forecast >= target) return { status: 'onTrack' };
  if (forecast >= target * 0.9) return { status: 'close' };
  return { status: 'behind' };
}

function GoalRow({ label, actual, target, format, progress, timing, perDayUnit, kind = 'cumulative', gapLabel }) {
  const st = judge(actual, target, progress, timing, kind, gapLabel);
  const remainingDays = progress.remaining;
  const gap = target ? target - actual : null;
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[13px] font-semibold text-ink">{label}</span>
        <span className="text-[13px] text-ink-2">
          <span className="text-base font-bold text-ink num">{timing === 'future' ? '—' : format(actual)}</span>
          {target ? <span className="num"> / {format(target)}</span> : <span className="text-muted"> / 目標未設定</span>}
        </span>
      </div>
      {target ? (
        <>
          <Meter className="mt-2" value={timing === 'future' ? 0 : actual} max={target}
            marker={timing === 'current' && kind === 'cumulative' ? target * progress.ratio : null}
            tone={st.status === 'achieved' ? 'good' : st.status === 'behind' || st.status === 'unmet' ? 'warn' : 'brand'} label={`${label}の達成率`} />
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-2">
            <StatusPill {...st} />
            {timing === 'current' && kind === 'cumulative' && gap > 0 && perDayUnit ? (
              <span>残り{remainingDays}日・1日あたり <span className="font-semibold text-ink num">{perDayUnit(Math.ceil(gap / Math.max(1, remainingDays)))}</span></span>
            ) : timing !== 'future' ? <span className="num">達成率 {pct((actual / target) * 100, 0)}</span> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------
// 編集モーダル
// ------------------------------------------------------------
function StoreGoalModal({ open, onClose, store, goal, month, onSave }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  // 開くたびに保存済みの目標で初期化する
  useEffect(() => {
    if (!open) return;
    setForm({
      consumedSales: goal && goal.consumedSales ? String(goal.consumedSales) : '',
      newVisits: goal && goal.newVisits ? String(goal.newVisits) : '',
      contractRatePct: goal && goal.contractRatePct ? String(goal.contractRatePct) : '',
      memberCount: goal && goal.memberCount ? String(goal.memberCount) : '',
      memo: (goal && goal.memo) || '',
    });
  }, [open, goal]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    try {
      await onSave(form);
      showToast('目標を保存しました', 'success');
      onClose();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={`${store ? store.name : ''} の目標（${formatMonthJa(month)}）`}
      footer={<><Button variant="ghost" onClick={onClose}>キャンセル</Button><Button variant="primary" onClick={save} loading={busy}>保存</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="施術消化売上（円）" hint="空欄にすると目標なし"><Input inputMode="numeric" value={form.consumedSales || ''} onChange={set('consumedSales')} placeholder="例: 4000000" /></Field>
        <Field label="新規来店・3経路（名）"><Input inputMode="numeric" value={form.newVisits || ''} onChange={set('newVisits')} placeholder="例: 30" /></Field>
        <Field label="契約率・3経路（%）"><Input inputMode="decimal" value={form.contractRatePct || ''} onChange={set('contractRatePct')} placeholder="例: 60" /></Field>
        <Field label="会員数（名）"><Input inputMode="numeric" value={form.memberCount || ''} onChange={set('memberCount')} placeholder="例: 150" /></Field>
        <Field label="メモ" className="sm:col-span-2"><Textarea value={form.memo || ''} onChange={set('memo')} maxLength={200} placeholder="重点施策など" /></Field>
      </div>
    </Modal>
  );
}

function StaffGoalModal({ open, onClose, row, goal, month, onSave }) {
  const [value, setValue] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setValue(goal && goal.consumedSales ? String(goal.consumedSales) : '');
    setMemo((goal && goal.memo) || '');
  }, [open, goal]);
  const save = async () => {
    setBusy(true);
    try {
      await onSave({ consumedSales: value, memo });
      showToast('目標を保存しました', 'success');
      onClose();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const tiers = INCENTIVE_RULES.sales.tiers;
  return (
    <Modal open={open} onClose={onClose} title={`${row ? row.name : ''} さんの目標（${formatMonthJa(month)}）`}
      footer={<><Button variant="ghost" onClick={onClose}>キャンセル</Button><Button variant="primary" onClick={save} loading={busy}>保存</Button></>}>
      <p className="mb-2 text-xs font-semibold text-ink-2">インセンティブのランクから選ぶ</p>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tiers.map((t) => (
          <button key={t.min} type="button" onClick={() => setValue(String(t.min))}
            className={cx('rounded-xl border px-3 py-2 text-left transition-colors',
              String(t.min) === value ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/15' : 'border-line hover:bg-surface-2')}>
            <div className="text-sm font-bold text-ink num">{yenShort(t.min)}</div>
            <div className="text-[11px] text-ink-2">{yen(t.amount)} ・ {Math.ceil(t.min / INCENTIVE_RULES.unitPrice)}回</div>
          </button>
        ))}
      </div>
      <Field label="施術消化売上の目標（円）" hint="自由に入力することもできます。空欄にすると目標なし">
        <Input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="例: 808000" />
      </Field>
      <Field label="メモ" className="mt-4"><Textarea value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={200} placeholder="意識すること・取り組みなど" /></Field>
    </Modal>
  );
}

// ------------------------------------------------------------
// ページ
// ------------------------------------------------------------
export default function GoalsPage() {
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
      <PageHeader title="目標" subtitle="月ごとの目標を決めて、実績の進み具合と必要なペースを確認します"
        actions={manager ? <Button icon="copy" onClick={copyPrev} loading={copying}>前月の目標をコピー</Button> : null} />
      <ScopeBar data={data} maxAhead={3} />
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
                      <GoalRow label="会員数" kind="level" actual={actualRet.memberCount || 0} target={goal.memberCount} format={(v) => `${num(v)}名`}
                        gapLabel={(g) => `${num(g)}名`} progress={progress} timing={timing} />
                    ) : null}
                    {goal.memo ? <p className="pt-3 text-xs leading-relaxed text-ink-2"><Icon name="sticky-note" size={13} className="mr-1 inline text-muted" />{goal.memo}</p> : null}
                  </div>
                ) : (
                  <EmptyState compact icon="target" title="目標が未設定です" message={canEditStore(s.storeId) ? '施術消化売上・新規来店・契約率・会員数の目標を設定できます' : '店舗責任者または本部が設定します'} />
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
            const tier = target ? INCENTIVE_RULES.sales.tiers.filter((t) => target >= t.min).pop() : null;
            return (
              <Card key={row.key}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 font-semibold text-ink">{row.name}{!row.linked ? <Badge tone="warn">未連携</Badge> : null}</div>
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

      <StoreGoalModal open={!!editStore} onClose={() => setEditStore(null)} store={editStore} month={month}
        goal={editStore ? goals.stores[editStore.storeId] : null}
        onSave={(values) => goalsRes.save('store', editStore.storeId, values)} />
      <StaffGoalModal open={!!editStaff} onClose={() => setEditStaff(null)} row={editStaff} month={month}
        goal={editStaff && editStaff.staffId ? goals.staff[editStaff.staffId] : null}
        onSave={(values) => goalsRes.save('staff', editStaff.staffId, values)} />
    </div>
  );
}
