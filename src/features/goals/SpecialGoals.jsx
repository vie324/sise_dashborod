import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../app/state.jsx';
import { useTrend } from '../../lib/hooks.js';
import { isAdminLike } from '../../lib/access.js';
import { Card, Button, Modal, Field, Input, Select, Textarea, EmptyState, Skeleton, Badge, cx } from '../../ui/primitives.jsx';
import { Meter, StatusPill } from '../../ui/stats.jsx';
import { MonthPicker, StorePicker } from '../../ui/pickers.jsx';
import { showToast, confirmDialog } from '../../ui/feedback.jsx';
import Icon from '../../ui/Icon.jsx';
import { yen, num } from '../../lib/format.js';
import { addMonths, formatMonthJa, monthOf, monthsBetween } from '../../../shared/dates.js';
import { SPECIAL_METRICS, specialMetric, defaultSpecialTitle, goalBaseline } from '../../../shared/goal-plan.js';
import { INCENTIVE_RULES } from '../../../shared/incentive-rules.js';
import { useGoalPlan, GoalPlanView, METRIC_FORMAT, deadlineLabel } from './GoalPlan.jsx';

// ============================================================
// 特別目標（1店舗だけの期限付きの目標。例: 12月までに月売上100万円！）
// 設定・変更・削除はオーナー（と管理者）だけ。その店舗を見られる人は全員見られる。
// ============================================================

const TRACK = {
  achieved: { status: 'achieved', label: '目標の水準に到達' },
  onTrack: { status: 'onTrack', label: '目安より上' },
  close: { status: 'close', label: '目安まであと少し' },
  behind: { status: 'behind', label: '目安より下' },
};

// ------------------------------------------------------------
// 編集モーダル
// ------------------------------------------------------------
function SpecialGoalModal({ open, onClose, goal, onSave }) {
  const { stores, storeId, today } = useApp();
  const thisMonth = monthOf(today);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const firstStore = storeId !== 'all' ? storeId : (stores[0] ? String(stores[0].id) : '');
    setForm({
      storeId: goal ? goal.storeId : firstStore,
      metric: goal ? goal.metric : 'consumedSales',
      target: goal ? String(goal.target) : '',
      deadline: goal ? goal.deadline : addMonths(thisMonth, 2),
      title: goal ? goal.title : '',
      memo: goal ? goal.memo || '' : '',
    });
  }, [open, goal, storeId, stores, thisMonth]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const metric = specialMetric(form.metric);
  const targetNum = Number(String(form.target || '').replace(/[,，円名\s]/g, ''));
  const placeholderTitle = targetNum > 0 ? defaultSpecialTitle(form.metric, targetNum, form.deadline, thisMonth) : '例: 12月までに月売上100万円！';

  // 参考: その店舗の直近3ヶ月の平均と過去最高
  const trend = useTrend(open && form.storeId ? thisMonth : null, form.storeId || null, 12);
  const base = useMemo(() => (trend.data ? goalBaseline(trend.data.months.filter((m) => !m.future && m.month < thisMonth)) : null), [trend.data, thisMonth]);
  const reference = (() => {
    if (!base) return null;
    const format = METRIC_FORMAT[form.metric];
    if (form.metric === 'consumedSales') return `直近3ヶ月の平均 ${format(base.sales)}/月・過去最高 ${format(base.best.sales)}`;
    if (form.metric === 'newCount') return base.newCount != null ? `直近3ヶ月の平均 ${num(base.newCount, 1)}名/月・過去最高 ${format(base.best.newCount)}` : null;
    return base.memberCount != null ? `${formatMonthJa(base.lastMonth)}末 ${format(base.memberCount)}・過去最高 ${format(base.best.memberCount)}` : null;
  })();

  const save = async () => {
    setBusy(true);
    try {
      await onSave({ ...form, id: goal ? goal.id : undefined });
      showToast(goal ? '特別目標を保存しました' : '特別目標を追加しました', 'success');
      onClose();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={goal ? '特別目標を編集' : '特別目標を追加'}
      footer={<><Button variant="ghost" onClick={onClose}>キャンセル</Button><Button variant="primary" onClick={save} loading={busy}>保存</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="店舗" required>
          <Select value={form.storeId || ''} onChange={set('storeId')}>
            {stores.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="期限（この月に達成する）" required>
          <MonthPicker value={form.deadline || thisMonth} onChange={(v) => setForm((f) => ({ ...f, deadline: v }))}
            min={goal && monthsBetween(goal.deadline, thisMonth) > 0 ? goal.deadline : thisMonth} max={addMonths(thisMonth, 24)} className="w-full justify-between" />
        </Field>
        <div className="sm:col-span-2">
          <span className="field-label">目標にする指標</span>
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="目標にする指標">
            {SPECIAL_METRICS.map((m) => (
              <button key={m.key} type="button" role="radio" aria-checked={form.metric === m.key} onClick={() => setForm((f) => ({ ...f, metric: m.key }))}
                className={cx('rounded-xl border px-3 py-2 text-left text-[13px] font-semibold transition-colors',
                  form.metric === m.key ? 'border-brand-500 bg-brand-50 text-ink dark:bg-brand-500/15' : 'border-line text-ink-2 hover:bg-surface-2')}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <Field label={`目標の値（${metric.unit === 'yen' ? '円' : '名'}）`} required className="sm:col-span-2"
          hint={[
            targetNum > 0 && form.metric === 'consumedSales' ? `施術 約${num(Math.ceil(targetNum / INCENTIVE_RULES.unitPrice))}回/月（1回 ${yen(INCENTIVE_RULES.unitPrice)}）` : null,
            reference ? `参考: ${reference}` : null,
          ].filter(Boolean).join(' ・ ') || null}>
          <Input inputMode="numeric" value={form.target || ''} onChange={set('target')} placeholder={metric.unit === 'yen' ? '例: 1000000' : '例: 150'} />
        </Field>
        <Field label="タイトル" hint="空欄なら自動で付けます" className="sm:col-span-2">
          <Input value={form.title || ''} onChange={set('title')} maxLength={60} placeholder={placeholderTitle} />
        </Field>
        <Field label="メモ" className="sm:col-span-2">
          <Textarea value={form.memo || ''} onChange={set('memo')} maxLength={200} placeholder="達成したらのご褒美・重点施策など" />
        </Field>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------
// 1件ぶん
// ------------------------------------------------------------
function SpecialGoalCard({ goal, canEdit, onEdit, onDelete, compact = false }) {
  const { today, storeName } = useApp();
  const thisMonth = monthOf(today);
  const { plan, trend, loading, error } = useGoalPlan(goal, today);
  const metric = specialMetric(goal.metric);
  const format = METRIC_FORMAT[goal.metric];
  const ended = monthsBetween(thisMonth, goal.deadline) < 0;
  const now = plan && plan.now;
  const milestone = plan && plan.milestones && plan.milestones[0];
  const track = plan && plan.track ? TRACK[plan.track] : null;
  return (
    <Card className={ended ? 'opacity-90' : ''}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', ended ? 'bg-surface-3 text-muted' : 'bg-gold-50 text-gold-600 dark:bg-gold-500/15 dark:text-gold-300')}>
            <Icon name="trophy" size={20} />
          </span>
          <div className="min-w-0">
            <h3 className="text-base font-bold leading-snug text-ink sm:text-lg">{goal.title}</h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
              <Badge tone="brand" icon="store">{storeName(goal.storeId)}</Badge>
              <span className="num">{metric.label} {format(goal.target)}</span>
              <span>・ 期限 {formatMonthJa(goal.deadline)}</span>
              <Badge tone={ended ? 'neutral' : 'gold'} icon="flag">{deadlineLabel(goal.deadline, thisMonth)}</Badge>
            </div>
          </div>
        </div>
        {canEdit ? (
          <div className="flex shrink-0 gap-1">
            <Button size="sm" variant="ghost" icon="pencil" onClick={onEdit} aria-label="編集">{compact ? null : '編集'}</Button>
            <Button size="sm" variant="ghost" icon="trash-2" onClick={onDelete} aria-label="削除" />
          </div>
        ) : null}
      </div>

      {!compact && !ended ? (
        <div className="mt-4 rounded-xl bg-surface-2 px-4 py-3">
          {loading ? <Skeleton className="h-16" /> : now ? (
            <>
              <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
                <div>
                  <div className="text-[11px] font-semibold text-ink-2">{now.kind === 'forecast' ? '今月の見込み（日割り）' : '今の会員数'}</div>
                  <div className="text-2xl font-bold leading-tight text-ink num">{format(now.value)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] font-semibold text-ink-2">目標（{formatMonthJa(goal.deadline)}）</div>
                  <div className="text-lg font-bold leading-tight text-ink num">{format(goal.target)}</div>
                </div>
              </div>
              <Meter className="mt-2" value={now.value} max={goal.target} height={10}
                marker={milestone && plan.status === 'plan' ? milestone.value : null}
                tone={plan.track === 'achieved' ? 'good' : plan.track === 'behind' ? 'warn' : 'brand'} label="目標までの進み具合" />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-2">
                {track ? <StatusPill status={track.status} label={track.label} /> : <span />}
                <span className="num">
                  {[
                    plan.start ? `スタート（${Number(plan.start.month.slice(5))}月）${format(plan.start.value)}` : null,
                    milestone && plan.status === 'plan' ? `今月の目安 ${format(milestone.value)}` : null,
                  ].filter(Boolean).join(' ・ ')}
                </span>
              </div>
            </>
          ) : <p className="text-xs text-muted">今月の実績はまだありません</p>}
        </div>
      ) : null}
      {goal.memo ? <p className="mt-3 text-xs leading-relaxed text-ink-2"><Icon name="sticky-note" size={13} className="mr-1 inline text-muted" />{goal.memo}</p> : null}

      <div className="mt-4 border-t border-line pt-4">
        {!compact ? <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink"><Icon name="route" size={16} className="text-brand-600 dark:text-brand-300" />{ended ? '結果' : '達成までの道すじ'}</h3> : null}
        <GoalPlanView goal={goal} plan={plan} trend={trend} loading={loading} error={error} />
      </div>
    </Card>
  );
}

// ------------------------------------------------------------
// 一覧
// ------------------------------------------------------------
export default function SpecialGoals({ goalsRes }) {
  const { storeId, setStoreId, stores, canSelectAll, allStoresLabel, today, storeName } = useApp();
  const thisMonth = monthOf(today);
  const owner = isAdminLike();
  const [editing, setEditing] = useState(null); // null: 閉じる / {}: 追加 / goal: 編集
  const visible = new Set(stores.map((s) => String(s.id)));
  const items = (goalsRes.shown || []).filter((g) => visible.has(String(g.storeId)) && (storeId === 'all' || String(g.storeId) === storeId));
  const active = items.filter((g) => monthsBetween(thisMonth, g.deadline) >= 0).sort((a, b) => (a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0));
  const ended = items.filter((g) => monthsBetween(thisMonth, g.deadline) < 0).sort((a, b) => (a.deadline > b.deadline ? -1 : 1));

  const remove = async (goal) => {
    const ok = await confirmDialog({ title: '特別目標を削除しますか？', message: `「${goal.title}」（${storeName(goal.storeId)}）を削除します。元に戻せません。`, confirmLabel: '削除', variant: 'danger' });
    if (!ok) return;
    try {
      await goalsRes.remove(goal.id);
      showToast('特別目標を削除しました', 'success');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 sm:mb-4">
        <StorePicker value={storeId} onChange={setStoreId} stores={stores} allowAll={canSelectAll} allLabel={allStoresLabel} />
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          {owner
            ? <Button variant="primary" icon="plus" onClick={() => setEditing({})}>特別目標を追加</Button>
            : <span className="inline-flex items-center gap-1 text-xs text-muted"><Icon name="lock" size={13} />特別目標はオーナーが設定します</span>}
        </div>
      </div>
      <p className="mb-4 text-[13px] leading-relaxed text-ink-2">
        1店舗だけの期限付きの目標です（例: 12月までに月売上100万円！）。過去の契約率・来店頻度などから、どの指標をどれだけ伸ばせば届くかを計算して表示します。
      </p>

      {goalsRes.error && !goalsRes.shown ? (
        <Card><EmptyState icon="circle-alert" title="特別目標を読み込めませんでした" message={goalsRes.error.message} /></Card>
      ) : !goalsRes.shown ? <Skeleton className="h-64 rounded-2xl" /> : active.length === 0 ? (
        <Card>
          <EmptyState icon="trophy" title={storeId === 'all' ? '特別目標はまだありません' : `${storeName(storeId)}の特別目標はまだありません`}
            message={owner ? '「12月までに月売上100万円！」のような、店舗の期限付きの目標を決められます' : 'オーナーが設定すると、ここに達成までの道すじが表示されます'}
            action={owner ? <Button variant="primary" icon="plus" onClick={() => setEditing({})}>特別目標を追加</Button> : null} />
        </Card>
      ) : (
        <div className="space-y-4">
          {active.map((g) => (
            <SpecialGoalCard key={g.id} goal={g} canEdit={owner} onEdit={() => setEditing(g)} onDelete={() => remove(g)} />
          ))}
        </div>
      )}

      {ended.length > 0 ? (
        <details className="group mt-6">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-ink-2 hover:bg-surface-3">
            <span className="transition-transform group-open:rotate-90">›</span> 終わった特別目標（{ended.length}件）
          </summary>
          <div className="mt-3 space-y-3">
            {ended.map((g) => (
              <SpecialGoalCard key={g.id} goal={g} compact canEdit={owner} onEdit={() => setEditing(g)} onDelete={() => remove(g)} />
            ))}
          </div>
        </details>
      ) : null}

      {owner ? (
        <SpecialGoalModal open={!!editing} onClose={() => setEditing(null)} goal={editing && editing.id ? editing : null}
          onSave={(values) => goalsRes.save(values)} />
      ) : null}
    </div>
  );
}
