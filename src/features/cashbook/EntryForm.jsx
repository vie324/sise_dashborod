import { useId, useMemo, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { Banner, Button, Field, Input, Modal, Select, cx } from '../../ui/primitives.jsx';
import { displayName, isStoreIdAllowed } from '../../lib/access.js';
import { dateJa, yen } from '../../lib/format.js';
import { isDate } from '../../../shared/dates.js';
import { SALES_CATEGORIES } from '../../../shared/cashbook.js';
import { CASH_TYPES, DEFAULT_CATEGORY } from './constants.js';
import { categoryOptions } from './calc.js';

// ============================================================
// 記帳フォーム（追加・編集）
// ------------------------------------------------------------
// session.entry があれば編集。フォームの状態はこの部品が持つので、
// メニュー管理を開いている間（open=false）も入力内容は消えない。
// ============================================================

function initialForm(session, defaultStoreId, today) {
  const e = session && session.entry;
  if (e) {
    const type = e.type === 'expense' ? 'expense' : 'income';
    return {
      date: e.date || today,
      type,
      category: e.category || DEFAULT_CATEGORY[type],
      description: e.description || '',
      amount: e.amount != null ? String(e.amount) : '',
      customerName: e.customerName || '',
      treatmentCount: String(e.treatmentCount || 0),
      paymentMethod: e.paymentMethod || 'CASH',
      cashType: e.cashType || 'register',
      store: e.store ? String(e.store) : '',
      recorder: e.recorder || '',
      notes: e.notes || '',
      selectedMenuId: '',
      pointDiscount: '',
    };
  }
  return {
    date: (session && session.date) || today,
    type: 'income',
    category: DEFAULT_CATEGORY.income,
    description: '',
    amount: '',
    customerName: '',
    treatmentCount: '1',
    paymentMethod: 'CASH',
    cashType: 'register',
    store: defaultStoreId || '',
    recorder: displayName(),
    notes: '',
    selectedMenuId: '',
    pointDiscount: '',
  };
}

const toInt = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};

function TypeToggle({ value, onChange }) {
  const opts = [
    { value: 'income', label: '入金', icon: 'arrow-down-left', active: 'border-brand-500 bg-brand-50 text-brand-800 dark:border-brand-400 dark:bg-brand-500/15 dark:text-brand-100' },
    { value: 'expense', label: '出金', icon: 'arrow-up-right', active: 'border-[#d03b3b] bg-[#fbe9e9] text-[#9b2525] dark:border-[#e66767] dark:bg-[#d03b3b]/[0.15] dark:text-[#f3a3a3]' },
  ];
  return (
    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="入金か出金か">
      {opts.map((o) => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className={cx('flex h-11 items-center justify-center gap-2 rounded-xl border-2 text-sm font-semibold transition-colors',
              on ? o.active : 'border-line text-ink-2 hover:bg-surface-2')}>
            <Icon name={o.icon} size={16} />{o.label}
            {on ? <Icon name="check" size={15} /> : null}
          </button>
        );
      })}
    </div>
  );
}

export default function EntryForm({
  open, session, onClose, stores, defaultStoreId, today, menu, customerNames,
  isDayClosed, storeName, onSubmit, onDelete, onOpenMenuManager,
}) {
  const editing = session && session.entry ? session.entry : null;
  const [form, setForm] = useState(() => initialForm(session, defaultStoreId, today));
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const idp = useId();
  const fid = (name) => `${idp}-${name}`;

  const set = (patch) => setForm((p) => ({ ...p, ...patch }));
  const income = form.type === 'income';
  const menus = menu.activeMenus;
  const coupons = menu.activeCoupons;
  const hasMenus = menus.length > 0 || coupons.length > 0;

  const amount = toInt(form.amount);
  const discount = income ? Math.max(0, toInt(form.pointDiscount)) : 0;
  const effective = income ? Math.max(0, amount - discount) : amount;
  const closed = !!form.store && isDate(form.date) && isDayClosed(form.date, form.store);
  const categories = useMemo(() => categoryOptions(form.type, form.category), [form.type, form.category]);

  const changeType = (type) => {
    if (type === form.type) return;
    set({ type, category: DEFAULT_CATEGORY[type], selectedMenuId: '', pointDiscount: '' });
  };

  // メニューを選ぶと摘要・金額・カテゴリを自動で入れる（旧画面と同じ）
  const selectMenu = (menuId) => {
    if (!menuId) {
      set({ selectedMenuId: '', description: '', amount: '' });
      return;
    }
    const item = [...menus, ...coupons].find((m) => String(m.id) === menuId);
    if (!item) return;
    set({
      selectedMenuId: menuId,
      description: item.name,
      amount: String(item.price),
      category: item.itemType === 'coupon' ? '回数券販売' : '施術売上',
    });
    setErrors((er) => ({ ...er, amount: undefined }));
  };

  const validate = () => {
    const er = {};
    if (!form.store) er.store = '店舗を選択してください';
    else if (!stores.some((s) => String(s.id) === form.store) || !isStoreIdAllowed(form.store)) er.store = 'この店舗への記帳権限がありません';
    if (!isDate(form.date)) er.date = '日付を入力してください';
    if (!(amount > 0)) er.amount = '金額を入力してください';
    if (income && discount > amount && amount > 0) er.pointDiscount = '割引が金額を超えています';
    return er;
  };

  const submit = async (ev) => {
    if (ev) ev.preventDefault();
    if (submitting) return;
    const er = validate();
    setErrors(er);
    if (Object.keys(er).length) return;
    if (closed) return;
    const description = discount > 0
      ? `${form.description || ''}（ポイント割引 -${yen(discount)}）`
      : form.description;
    const payload = {
      date: form.date,
      type: form.type,
      category: form.category,
      description,
      amount: effective,
      // 出金に顧客名・施術回数が残ると集計が狂うので、入金のときだけ送る
      customerName: income ? form.customerName.trim() : '',
      treatmentCount: income ? Math.max(0, toInt(form.treatmentCount)) : 0,
      paymentMethod: form.paymentMethod || 'CASH',
      cashType: form.cashType,
      store: form.store,
      recorder: form.recorder.trim() || displayName(),
      notes: form.notes,
    };
    setSubmitting(true);
    const ok = await onSubmit(payload, editing);
    setSubmitting(false);
    if (ok) onClose();
  };

  const formId = fid('form');
  const canSubmit = !submitting && !closed && stores.length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? '記録を編集' : '入出金を記帳'}
      footer={(
        <>
          {editing ? (
            <Button variant="ghost" icon="trash-2" className="mr-auto !text-[var(--text-bad)]" onClick={() => onDelete(editing)} disabled={submitting}>削除</Button>
          ) : null}
          <Button variant="ghost" onClick={onClose} disabled={submitting}>キャンセル</Button>
          <Button type="submit" form={formId} variant="primary" icon={editing ? 'check' : 'plus'} loading={submitting} disabled={!canSubmit}>
            {editing ? '更新する' : '記録する'}
          </Button>
        </>
      )}
    >
      <form id={formId} onSubmit={submit} noValidate className="space-y-4">
        <TypeToggle value={form.type} onChange={changeType} />

        {income && form.paymentMethod === 'CASH' && SALES_CATEGORIES.includes(form.category) ? (
          <p className="flex items-start gap-2 rounded-xl border border-brand-200 bg-brand-50 px-3 py-2.5 text-xs leading-relaxed text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-100">
            <Icon name="plug" size={14} className="mt-px shrink-0" />
            <span>SalonOne で会計した現金売上は、日次締めのときに自動で取り込まれます。二重にならないよう、SalonOne で会計した分はここに記帳しないでください。</span>
          </p>
        ) : null}

        {stores.length === 0 ? (
          <Banner tone="warn">アクセスできる店舗がありません。管理者に確認してください。</Banner>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="店舗" htmlFor={fid('store')} required error={errors.store}>
            <Select id={fid('store')} value={form.store} aria-required="true" aria-invalid={errors.store ? 'true' : undefined}
              onChange={(e) => { set({ store: e.target.value }); setErrors((er) => ({ ...er, store: undefined })); }}>
              <option value="">店舗を選択</option>
              {stores.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="日付" htmlFor={fid('date')} required error={errors.date}>
            <Input id={fid('date')} type="date" value={form.date} max="2099-12-31" aria-required="true"
              onChange={(e) => set({ date: e.target.value })} />
          </Field>
          {closed ? (
            <Banner tone="warn" title="この日は締め済みです" className="sm:col-span-2">
              {dateJa(form.date)}（{storeName(form.store)}）は日次締め済みのため、{editing ? '変更' : '記帳'}できません。別の日付を選んでください。
            </Banner>
          ) : null}

          {income && hasMenus ? (
            <div className="sm:col-span-2">
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-xs font-semibold text-ink-2" htmlFor={fid('menu')}>メニュー / クーポン</label>
                {onOpenMenuManager ? (
                  <button type="button" onClick={onOpenMenuManager} className="inline-flex items-center gap-1 rounded-md px-1 text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">
                    <Icon name="settings" size={13} />管理
                  </button>
                ) : null}
              </div>
              <Select id={fid('menu')} value={form.selectedMenuId} onChange={(e) => selectMenu(e.target.value)}>
                <option value="">手動で入力する</option>
                {menus.length ? (
                  <optgroup label="メニュー">
                    {menus.map((m) => <option key={m.id} value={String(m.id)}>{m.name}（{yen(m.price)}）</option>)}
                  </optgroup>
                ) : null}
                {coupons.length ? (
                  <optgroup label="クーポン">
                    {coupons.map((m) => <option key={m.id} value={String(m.id)}>{m.name}（{yen(m.price)}）</option>)}
                  </optgroup>
                ) : null}
              </Select>
              <p className="mt-1 text-xs text-muted">選ぶと摘要・金額・カテゴリが自動で入ります</p>
            </div>
          ) : null}

          <Field label="金額（円）" htmlFor={fid('amount')} required error={errors.amount}>
            <Input id={fid('amount')} type="number" inputMode="numeric" min="0" step="1" placeholder="0" className="num"
              value={form.amount} aria-required="true" aria-invalid={errors.amount ? 'true' : undefined}
              onChange={(e) => { set({ amount: e.target.value, selectedMenuId: '' }); setErrors((er) => ({ ...er, amount: undefined })); }} />
          </Field>

          {income ? (
            <Field label="ポイント割引 / ギフト券（円）" htmlFor={fid('discount')} error={errors.pointDiscount}
              hint={discount > 0 && amount > 0 ? `実入金額 ${yen(effective)}（${yen(amount)} − ${yen(discount)}）` : '使われた分だけ入金額から差し引きます'}>
              <Input id={fid('discount')} type="number" inputMode="numeric" min="0" step="1" placeholder="0" className="num"
                value={form.pointDiscount} onChange={(e) => set({ pointDiscount: e.target.value })} />
            </Field>
          ) : null}

          <Field label="カテゴリ" htmlFor={fid('category')} required>
            <Select id={fid('category')} value={form.category} onChange={(e) => set({ category: e.target.value })}>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>

          <Field label="現金区分" htmlFor={fid('cashType')}>
            <Select id={fid('cashType')} value={form.cashType} onChange={(e) => set({ cashType: e.target.value })}>
              {[...CASH_TYPES].reverse().map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </Field>

          {income ? (
            <>
              <Field label="顧客名" htmlFor={fid('customer')}>
                <Input id={fid('customer')} list={fid('names')} autoComplete="off" placeholder="例: 山田 花子"
                  value={form.customerName} onChange={(e) => set({ customerName: e.target.value })} />
                <datalist id={fid('names')}>
                  {customerNames.map((n) => <option key={n} value={n} />)}
                </datalist>
              </Field>
              <Field label="施術回数" htmlFor={fid('count')}>
                <Input id={fid('count')} type="number" inputMode="numeric" min="0" step="1" className="num"
                  value={form.treatmentCount} onChange={(e) => set({ treatmentCount: e.target.value })} />
              </Field>
            </>
          ) : null}

          {!income ? (
            <Field label="記録者" htmlFor={fid('recorder')} hint={editing ? '記録者は変更できません' : undefined}>
              <Input id={fid('recorder')} placeholder="スタッフ名" value={form.recorder} disabled={!!editing}
                onChange={(e) => set({ recorder: e.target.value })} />
            </Field>
          ) : null}

          <Field label="摘要・メモ" htmlFor={fid('desc')} className={income ? '' : 'sm:col-span-2'}>
            <Input id={fid('desc')} placeholder="内容を入力" value={form.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>

          {income ? (
            <Field label="記録者" htmlFor={fid('recorder')} hint={editing ? '記録者は変更できません' : undefined}>
              <Input id={fid('recorder')} placeholder="スタッフ名" value={form.recorder} disabled={!!editing}
                onChange={(e) => set({ recorder: e.target.value })} />
            </Field>
          ) : null}
        </div>

        {income && !hasMenus && !menu.loading && onOpenMenuManager ? (
          <Banner tone="info" action={<Button size="sm" variant="subtle" icon="plus" onClick={onOpenMenuManager}>メニュー登録</Button>}>
            メニューを登録すると、選ぶだけで金額が入ります。
          </Banner>
        ) : null}
      </form>
    </Modal>
  );
}
