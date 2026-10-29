import { useEffect, useMemo, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, Select, Skeleton, Spinner, Textarea, cx } from '../../ui/primitives.jsx';
import { showToast, confirmDialog } from '../../ui/feedback.jsx';
import { displayName } from '../../lib/access.js';
import { useCrossStore, crossStoreCandidates, saveCrossStore } from '../../lib/hooks.js';
import { dateJa, yen } from '../../lib/format.js';
import { INCENTIVE_RULES } from '../../../shared/incentive-rules.js';
import { formatMonthJa, monthOf, monthRange } from '../../../shared/dates.js';

// ============================================================
// 系列店での契約（ドミナント出店。店長以上が登録する）
// ------------------------------------------------------------
// 来店した店舗とは別の系列店で契約したお客様を登録すると、初回に来店した店舗のスタッフに 1件 2,000円。
// 契約した店舗の SalonOne の契約を選んで登録すると、その店舗の担当の新規契約からは除く（二重に数えない）。
// ============================================================

const AMOUNT = INCENTIVE_RULES.crossStore.amountPerContract;

function EntryRow({ e, closed, busy, onDelete }) {
  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gold-50 text-gold-700 dark:bg-gold-500/15 dark:text-gold-200">
        <Icon name="arrow-left-right" size={16} />
      </span>
      <div className="min-w-0 flex-1 text-[13px] leading-snug">
        <div className="font-semibold text-ink">{dateJa(e.date)} {e.customerName}様<span className="font-normal text-ink-2"> ・ {e.planName}</span></div>
        <div className="mt-0.5 text-ink-2">
          {e.contractStoreName || '（店舗なし）'}で契約 → {e.creditStoreName ? `${e.creditStoreName} ` : ''}<span className="font-semibold text-ink">{e.creditName}</span> に <span className="font-semibold text-ink num">{yen(AMOUNT)}</span>
        </div>
        <div className="mt-0.5 text-xs text-muted">
          {e.link
            ? `${e.contractStoreName}の契約（${e.link.staffName || '担当なし'}${e.link.time ? `・${e.link.time}` : ''}）を新規契約から除いています`
            : <span className="text-[#b07a00] dark:text-[#f6c75a]">SalonOne の契約と結びついていません（{e.contractStoreName}の契約数は減らしていません）</span>}
        </div>
        {e.memo ? <div className="mt-0.5 text-xs text-ink-2">メモ: {e.memo}</div> : null}
        <div className="mt-0.5 text-[11px] text-muted">登録: {e.createdBy || '—'}</div>
      </div>
      {e.editable && !closed ? (
        <Button size="sm" variant="ghost" icon="trash-2" loading={busy} onClick={() => onDelete(e)} aria-label={`${e.customerName}様の登録を削除`}>削除</Button>
      ) : null}
    </li>
  );
}

/** 契約した店舗・日の SalonOne の契約を読む（店舗・日を変えるたびに読み直す） */
function useCandidates(storeId, date) {
  const [state, setState] = useState({ loading: false, data: null, error: null });
  useEffect(() => {
    if (!storeId || !date) { setState({ loading: false, data: null, error: null }); return undefined; }
    let alive = true;
    setState({ loading: true, data: null, error: null });
    crossStoreCandidates(storeId, date)
      .then((data) => { if (alive) setState({ loading: false, data, error: null }); })
      .catch((error) => { if (alive) setState({ loading: false, data: null, error }); });
    return () => { alive = false; };
  }, [storeId, date]);
  return state;
}

function CandidateList({ cand, value, onChange, storeName }) {
  if (cand.loading) {
    return <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-3 text-xs text-muted"><Spinner size={14} />SalonOne の契約を読み込んでいます</div>;
  }
  if (cand.error) {
    return <p className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-xs text-[#8f2121] dark:text-[#f2b0b0]">SalonOne の契約を読めませんでした: {cand.error.message || String(cand.error)}</p>;
  }
  if (!cand.data) return <p className="text-xs text-muted">契約日と契約した店舗を選ぶと、その日の SalonOne の契約が出ます。</p>;
  const items = cand.data.items || [];
  const option = (key, label, sub, disabled = false) => (
    <label key={key} className={cx('flex min-h-[44px] cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2 text-[13px]',
      value === key ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/15' : 'border-line', disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-surface-2')}>
      <input type="radio" name="cross-reception" className="mt-1 h-4 w-4 shrink-0 accent-brand-600" checked={value === key} disabled={disabled} onChange={() => onChange(key)} />
      <span className="min-w-0">
        <span className="block font-semibold text-ink">{label}</span>
        {sub ? <span className="block text-xs text-ink-2">{sub}</span> : null}
      </span>
    </label>
  );
  return (
    <div className="space-y-1.5" role="radiogroup" aria-label="SalonOne の契約">
      {!cand.data.linked ? <p className="text-xs text-muted">{storeName}は SalonOne とつながっていないため、契約は選べません。</p> : null}
      {cand.data.linked && items.length === 0 ? <p className="text-xs text-muted">この日の{storeName}の契約は SalonOne に見つかりませんでした。契約日を確かめてください。</p> : null}
      {items.map((it) => option(
        it.receptionId,
        `${it.time || '—'} ${it.customerName ? `${it.customerName}様` : `顧客番号 ${it.customerNumber || '—'}`}`,
        [
          it.staffName ? `担当 ${it.staffName}` : null,
          it.plans.length ? it.plans.join('・') : it.joined ? '入会' : null,
          it.isNew ? '新規' : '既存',
          it.registered ? '登録済み' : null,
        ].filter(Boolean).join(' ・ '),
        it.registered,
      ))}
      {option('', '選ばない', `${storeName || '契約した店舗'}の契約数は減らしません`)}
    </div>
  );
}

function CrossStoreForm({ open, onClose, month, today, stores, creditOptions }) {
  const inMonth = monthOf(today) === month;
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm({ date: inMonth ? today : monthRange(month).from, contractStoreId: '', receptionId: '', customerName: '', planName: '', creditKey: '', memo: '', planAuto: true });
  }, [open, inMonth, today, month]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value, ...(k === 'planName' ? { planAuto: false } : {}) }));
  const cand = useCandidates(open ? form.contractStoreId : '', open ? form.date : '');
  const storeName = (stores.find((s) => s.id === form.contractStoreId) || {}).name || '';
  const credit = creditOptions.find((o) => o.key === form.creditKey) || null;
  const sameStore = !!credit && !!credit.storeId && credit.storeId === form.contractStoreId;
  // 店舗・日を変えたら選んだ契約を外す
  useEffect(() => { setForm((f) => ({ ...f, receptionId: '' })); }, [form.contractStoreId, form.date]);

  const chooseReception = (id) => {
    const it = cand.data && cand.data.items.find((x) => x.receptionId === id);
    setForm((f) => ({
      ...f,
      receptionId: id,
      // プラン名は選んだ契約から入れる（自分で入力した後は変えない）
      ...(it && f.planAuto && it.plans.length ? { planName: it.plans.join('・') } : {}),
      ...(it && it.customerName && !f.customerName ? { customerName: it.customerName } : {}),
    }));
  };

  const groups = useMemo(() => {
    const map = new Map();
    for (const o of creditOptions) {
      const k = o.storeName || '所属店舗なし';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(o);
    }
    return [...map.entries()];
  }, [creditOptions]);

  const missing = !form.date || !form.contractStoreId || !form.customerName || !String(form.customerName).trim()
    || !form.planName || !String(form.planName).trim() || !form.creditKey;
  const save = async (e) => {
    if (e) e.preventDefault();
    if (busy || missing || sameStore) return;
    setBusy(true);
    try {
      await saveCrossStore('crossAdd', {
        date: form.date, contractStoreId: form.contractStoreId, receptionId: form.receptionId || undefined,
        customerName: form.customerName, planName: form.planName, creditKey: form.creditKey, memo: form.memo, operator: displayName(),
      });
      showToast(`${credit ? credit.name : ''}さんに系列店での契約（${yen(AMOUNT)}）を登録しました`, 'success');
      onClose();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const formId = 'cross-store-form';
  return (
    <Modal open={open} onClose={onClose} title="系列店での契約を登録"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>キャンセル</Button>
          <Button type="submit" form={formId} variant="primary" icon="check" loading={busy} disabled={missing || sameStore}>登録する</Button>
        </>
      )}>
      <form id={formId} onSubmit={save} className="space-y-4">
        <p className="text-[13px] leading-relaxed text-ink-2">
          来店した店舗とは別の系列店で契約したお客様を登録すると、初回に来店した店舗のスタッフに <b className="text-ink">{yen(AMOUNT)}</b> が付きます（契約日の月の分）。
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="契約日" htmlFor="cross-date" required>
            <Input id="cross-date" type="date" max={today} value={form.date || ''} onChange={set('date')} />
          </Field>
          <Field label="契約した店舗（系列店）" htmlFor="cross-store" required>
            <Select id="cross-store" value={form.contractStoreId || ''} onChange={set('contractStoreId')}>
              <option value="">店舗を選択</option>
              {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="SalonOne の契約" hint="選ぶと、契約した店舗の担当の新規契約から除きます（二重に数えません）">
          <CandidateList cand={cand} value={form.receptionId || ''} onChange={chooseReception} storeName={storeName} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="お客様名" htmlFor="cross-customer" required>
            <Input id="cross-customer" value={form.customerName || ''} onChange={set('customerName')} maxLength={40} placeholder="例: 山本 さくら" autoComplete="off" />
          </Field>
          <Field label="プラン名" htmlFor="cross-plan" required>
            <Input id="cross-plan" value={form.planName || ''} onChange={set('planName')} maxLength={60} placeholder="例: 月2回プラン" autoComplete="off" />
          </Field>
        </div>
        <Field label={`${yen(AMOUNT)}を付けるスタッフ（初回に来店した店舗の担当）`} htmlFor="cross-credit" required
          error={sameStore ? '初回に来店した店舗と同じ店舗での契約は対象外です（SalonOne の新規契約として数えます）' : null}>
          <Select id="cross-credit" value={form.creditKey || ''} onChange={set('creditKey')}>
            <option value="">スタッフを選択</option>
            {groups.map(([g, list]) => (
              <optgroup key={g} label={g}>
                {list.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
              </optgroup>
            ))}
          </Select>
        </Field>
        <Field label="メモ" htmlFor="cross-memo">
          <Textarea id="cross-memo" value={form.memo || ''} onChange={set('memo')} maxLength={200} placeholder="経緯など（任意）" />
        </Field>
      </form>
    </Modal>
  );
}

/**
 * インセンティブ > スタッフ別 に出す一覧と登録（店長以上）
 * @param {{ month:string, storeId:string, today:string }} props
 */
export default function CrossStorePanel({ month, storeId, today }) {
  const res = useCrossStore(month, storeId);
  const data = res.shown && res.shown.month === month ? res.shown : null;
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState('');
  if (!data) return res.loading ? <Skeleton className="mt-4 h-32 w-full rounded-2xl" /> : null;
  if (!data.canEdit) return null;

  const remove = async (e) => {
    const ok = await confirmDialog({
      title: '登録を削除しますか？',
      message: `${dateJa(e.date)} ${e.customerName}様（${e.creditName}さんの ${yen(AMOUNT)}）を削除します。`,
      confirmLabel: '削除する',
      variant: 'danger',
    });
    if (!ok) return;
    setBusyId(e.id);
    try {
      await saveCrossStore('crossDelete', { id: e.id, month, operator: displayName() });
      showToast('削除しました', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setBusyId('');
    }
  };

  const total = data.items.length * AMOUNT;
  return (
    <Card className="mt-4" title="系列店での契約" icon="arrow-left-right"
      subtitle={`${formatMonthJa(month)}・来店した店舗とは別の系列店で契約したお客様（初回の店舗のスタッフに 1件 ${yen(AMOUNT)}）`}
      actions={!data.closed ? <Button size="sm" variant="primary" icon="plus" onClick={() => setOpen(true)}>登録する</Button> : null}>
      {data.closed ? (
        <p className="mb-3 flex items-start gap-1.5 text-xs text-muted"><Icon name="lock" size={13} className="mt-px shrink-0" />この支給期間は確定済みのため、登録・削除できません（確定を取り消すとできます）</p>
      ) : null}
      {data.items.length === 0 ? (
        <EmptyState compact icon="arrow-left-right" title="この月の登録はありません"
          message={`系列店で契約したお客様を登録すると、初回に来店した店舗のスタッフに ${yen(AMOUNT)} が付きます`} />
      ) : (
        <>
          <ul className="divide-y divide-line">
            {data.items.map((e) => <EntryRow key={e.id} e={e} closed={data.closed} busy={busyId === e.id} onDelete={remove} />)}
          </ul>
          <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-[13px]">
            <span className="text-ink-2">{data.items.length}件</span>
            <Badge tone="gold" icon="coins">{yen(total)}</Badge>
          </div>
        </>
      )}
      <CrossStoreForm open={open} onClose={() => setOpen(false)} month={month} today={today} stores={data.stores} creditOptions={data.creditOptions} />
    </Card>
  );
}
