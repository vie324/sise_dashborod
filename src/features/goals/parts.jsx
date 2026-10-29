import { useEffect, useState } from 'react';
import { Button, Modal, Field, Input, Textarea, Badge, cx } from '../../ui/primitives.jsx';
import { Meter, StatusPill } from '../../ui/stats.jsx';
import { showToast } from '../../ui/feedback.jsx';
import { yen, yenShort, num, pct } from '../../lib/format.js';
import { forecastMonthEnd } from '../../../shared/metrics.js';
import { INCENTIVE_RULES } from '../../../shared/incentive-rules.js';

// ============================================================
// 目標の画面で共通の部品（単月・3ヶ月）
// ============================================================

// ------------------------------------------------------------
// 進み具合の判定
// ------------------------------------------------------------
// kind: 'cumulative' = 期間内に積み上がる数字（売上・新規数）→ ペースで判定
//       'level'      = その時点の水準（契約率・会員数）→ 目標との差で判定
// progress は単月なら月の日数、3ヶ月なら 3ヶ月分の日数で数える
export function judge(actual, target, progress, timing, kind, gapLabel) {
  if (!target) return { status: 'none' };
  if (timing === 'future') return { status: 'pending', label: 'これから' };
  // 実績がわからない（会員数の記録が無い月など）時は 0 として未達にしない
  if (actual == null) return { status: 'pending', label: 'データなし' };
  if (actual >= target) return { status: 'achieved' };
  if (timing === 'past') return { status: 'unmet', label: '未達' };
  if (kind === 'level') return { status: 'behind', label: gapLabel ? `あと${gapLabel(target - actual)}` : 'もう少し' };
  const forecast = forecastMonthEnd(actual, progress.elapsed, progress.total);
  if (forecast >= target) return { status: 'onTrack' };
  if (forecast >= target * 0.9) return { status: 'close' };
  return { status: 'behind' };
}

export function GoalRow({ label, actual, target, format, progress, timing, perDayUnit, kind = 'cumulative', gapLabel }) {
  const st = judge(actual, target, progress, timing, kind, gapLabel);
  const remainingDays = progress.remaining;
  const gap = target ? target - actual : null;
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[13px] font-semibold text-ink">{label}</span>
        <span className="text-[13px] text-ink-2">
          <span className="text-base font-bold text-ink num">{timing === 'future' || actual == null ? '—' : format(actual)}</span>
          {target ? <span className="num"> / {format(target)}</span> : <span className="text-muted"> / 目標未設定</span>}
        </span>
      </div>
      {target ? (
        <>
          <Meter className="mt-2" value={timing === 'future' || actual == null ? 0 : actual} max={target}
            marker={timing === 'current' && kind === 'cumulative' ? target * progress.ratio : null}
            tone={st.status === 'achieved' ? 'good' : st.status === 'behind' || st.status === 'unmet' ? 'warn' : 'brand'} label={`${label}の達成率`} />
          <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-2">
            <StatusPill {...st} />
            {timing === 'current' && kind === 'cumulative' && gap > 0 && perDayUnit ? (
              <span>残り{remainingDays}日・1日あたり <span className="font-semibold text-ink num">{perDayUnit(Math.ceil(gap / Math.max(1, remainingDays)))}</span></span>
            ) : timing !== 'future' && actual != null ? <span className="num">達成率 {pct((actual / target) * 100, 0)}</span> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

const toNumber = (v) => Number(String(v || '').replace(/[,，円\s]/g, ''));

// ------------------------------------------------------------
// 編集モーダル（period: 'month' = 単月 / 'quarter' = 3ヶ月）
// ------------------------------------------------------------
export function StoreGoalModal({ open, onClose, store, goal, periodLabel, period = 'month', onSave }) {
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const quarter = period === 'quarter';
  // 開くたびに保存済みの目標で初期化する
  useEffect(() => {
    if (!open) return;
    setForm({
      consumedSales: goal && goal.consumedSales ? String(goal.consumedSales) : '',
      depositSales: goal && goal.depositSales ? String(goal.depositSales) : '',
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
  // 3ヶ月の合計は月あたりの目安も出す
  const perMonth = (v, f) => (quarter && toNumber(v) > 0 ? `月あたり ${f(toNumber(v) / 3)}` : null);
  return (
    <Modal open={open} onClose={onClose} title={`${store ? store.name : ''} の目標（${periodLabel}）`}
      footer={<><Button variant="ghost" onClick={onClose}>キャンセル</Button><Button variant="primary" onClick={save} loading={busy}>保存</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={quarter ? '施術消化売上（3ヶ月の合計・円）' : '施術消化売上（円）'} hint={perMonth(form.consumedSales, yen) || '空欄にすると目標なし'}>
          <Input inputMode="numeric" value={form.consumedSales || ''} onChange={set('consumedSales')} placeholder={quarter ? '例: 12000000' : '例: 4000000'} />
        </Field>
        <Field label={quarter ? '入金売上（3ヶ月の合計・円）' : '入金売上（円）'} hint={perMonth(form.depositSales, yen) || '回数券・サブスクの販売を含む入金の合計（空欄にすると目標なし）'}>
          <Input inputMode="numeric" value={form.depositSales || ''} onChange={set('depositSales')} placeholder={quarter ? '例: 15000000' : '例: 5000000'} />
        </Field>
        <Field label={quarter ? '新規来店・3経路（3ヶ月の合計・名）' : '新規来店・3経路（名）'} hint={perMonth(form.newVisits, (v) => `${num(v, 1)}名`)}>
          <Input inputMode="numeric" value={form.newVisits || ''} onChange={set('newVisits')} placeholder={quarter ? '例: 90' : '例: 30'} />
        </Field>
        <Field label={quarter ? '契約率・3経路（3ヶ月の通算・%）' : '契約率・3経路（%）'}><Input inputMode="decimal" value={form.contractRatePct || ''} onChange={set('contractRatePct')} placeholder="例: 60" /></Field>
        <Field label={quarter ? '会員数（期末・名）' : '会員数（名）'}><Input inputMode="numeric" value={form.memberCount || ''} onChange={set('memberCount')} placeholder="例: 150" /></Field>
        <Field label="メモ" className="sm:col-span-2"><Textarea value={form.memo || ''} onChange={set('memo')} maxLength={200} placeholder="重点施策など" /></Field>
      </div>
    </Modal>
  );
}

export function StaffGoalModal({ open, onClose, row, goal, periodLabel, period = 'month', onSave }) {
  const [value, setValue] = useState('');
  const [deposit, setDeposit] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const quarter = period === 'quarter';
  const months = quarter ? 3 : 1;
  useEffect(() => {
    if (!open) return;
    setValue(goal && goal.consumedSales ? String(goal.consumedSales) : '');
    setDeposit(goal && goal.depositSales ? String(goal.depositSales) : '');
    setMemo((goal && goal.memo) || '');
  }, [open, goal]);
  const save = async () => {
    setBusy(true);
    try {
      await onSave({ consumedSales: value, depositSales: deposit, memo });
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
    <Modal open={open} onClose={onClose} title={`${row ? row.name : ''} さんの目標（${periodLabel}）`}
      footer={<><Button variant="ghost" onClick={onClose}>キャンセル</Button><Button variant="primary" onClick={save} loading={busy}>保存</Button></>}>
      <p className="mb-2 text-xs font-semibold text-ink-2">インセンティブのランクから選ぶ{quarter ? '（毎月そのランク × 3ヶ月）' : ''}</p>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tiers.map((t) => {
          const v = String(t.min * months);
          return (
            <button key={t.min} type="button" onClick={() => setValue(v)}
              className={cx('rounded-xl border px-3 py-2 text-left transition-colors',
                v === value ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/15' : 'border-line hover:bg-surface-2')}>
              <div className="text-sm font-bold text-ink num">{yenShort(t.min * months)}</div>
              <div className="text-[11px] text-ink-2">{quarter ? `月${yenShort(t.min)} ・ ` : ''}{yen(t.amount)}{quarter ? '/月' : ''} ・ {Math.ceil(t.min / INCENTIVE_RULES.unitPrice)}回{quarter ? '/月' : ''}</div>
            </button>
          );
        })}
      </div>
      <Field label={quarter ? '施術消化売上の目標（3ヶ月の合計・円）' : '施術消化売上の目標（円）'}
        hint={quarter && toNumber(value) > 0 ? `月あたり ${yen(toNumber(value) / 3)}` : '自由に入力することもできます。空欄にすると目標なし'}>
        <Input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder={quarter ? '例: 2424000' : '例: 808000'} />
      </Field>
      <Field label={quarter ? '入金売上の目標（3ヶ月の合計・円）' : '入金売上の目標（円）'} className="mt-4"
        hint={quarter && toNumber(deposit) > 0 ? `月あたり ${yen(toNumber(deposit) / 3)}` : '回数券・サブスクの販売を含む入金の合計。空欄にすると目標なし'}>
        <Input inputMode="numeric" value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder={quarter ? '例: 3000000' : '例: 1000000'} />
      </Field>
      <Field label="メモ" className="mt-4"><Textarea value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={200} placeholder="意識すること・取り組みなど" /></Field>
    </Modal>
  );
}

/** 目標ランク（インセンティブ）。3ヶ月の目標は月あたりで判定する */
export function tierOf(target, months = 1) {
  if (!target) return null;
  return INCENTIVE_RULES.sales.tiers.filter((t) => target / months >= t.min).pop() || null;
}

export function UnlinkedBadge({ row }) {
  return !row.linked ? <Badge tone="warn">未連携</Badge> : null;
}
