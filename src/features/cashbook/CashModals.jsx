import { useId, useMemo, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { Badge, Banner, Button, Field, Input, Modal, Select, Spinner } from '../../ui/primitives.jsx';
import { showToast } from '../../ui/feedback.jsx';
import { displayName } from '../../lib/access.js';
import { useStoreCash } from '../../lib/hooks.js';
import { dateJa, signedYen, yen } from '../../lib/format.js';
import { monthOf } from '../../../shared/dates.js';
import { isManualSalesCash, isSalonOneCashEntry } from '../../../shared/cashbook.js';
import { CASH_TYPES } from './constants.js';
import { EMPTY_BALANCE } from './calc.js';

// ============================================================
// レジ金チェック / 日次締め のダイアログ
// ============================================================

const parseYen = (v) => {
  if (v === '' || v == null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

/** SalonOne の現金売上の取り込みで、出納帳がその金額になった結果（db-handlers-cashbook.js の status） */
const APPLIED = new Set(['imported', 'updated', 'unchanged', 'zero', 'removed']);

/** 実残高 − 理論残高 の表示（一致 / 多い / 少ない を文字とアイコンで） */
function DiffBadge({ diff }) {
  if (diff == null) return null;
  if (diff === 0) return <Badge tone="good" icon="circle-check">一致</Badge>;
  return diff > 0
    ? <Badge tone="warn" icon="arrow-up">{signedYen(diff)} 多い</Badge>
    : <Badge tone="bad" icon="arrow-down">{signedYen(diff)} 少ない</Badge>;
}

// ------------------------------------------------------------
// レジ金チェック: 実際に数えたレジの現金と理論残高（レジ区分）を照合し、
// 差異があれば「その他収入 / その他経費」として記録して理論残高を合わせる。
// 旧画面は金庫・小口現金も含めた合計と比べていたため、金庫に入金がある店舗では
// レジが合っていても差異が出ていた。記録先と同じレジ区分で比べる。
// SalonOne が接続済みなら、開いた時に本日の現金売上を SalonOne から読み直して理論残高に含め、
// 確定時には必ず先に取り込み直す（取り込んだ後の会計を「差異」として記録しないため。
// 金額が変わっていなければサーバーは何もしない）。
// ------------------------------------------------------------
export function CashCheckModal({ initialStoreId, stores, byStore, today, entries = [], isDayClosed, storeName, onRecord, onImport, onClose }) {
  const [storeId, setStoreId] = useState(() => initialStoreId || (stores.length === 1 ? String(stores[0].id) : ''));
  const [actual, setActual] = useState('');
  const [busy, setBusy] = useState(false);
  const idp = useId();
  const so = useTodaySalonOneCash(storeId, today, entries);
  const pendingImport = !!onImport && !!storeId && so.available && so.canImport;

  const base = storeId ? (byStore.get(storeId) || EMPTY_BALANCE).byCashType.register.balance : null;
  const theory = base != null ? base + (pendingImport ? so.pending : 0) : null;
  const actualN = parseYen(actual);
  const diff = actualN != null && theory != null ? actualN - theory : null;
  const closed = !!storeId && isDayClosed(today, storeId);
  const blocked = diff != null && diff !== 0 && closed;
  // SalonOne の金額を確かめている間は確定しない（取り込む前の売上を差異として記録しないため）
  const waiting = !!onImport && !!storeId && so.loading;

  const confirm = async (e) => {
    if (e) e.preventDefault();
    if (diff == null || busy || blocked || waiting) return;
    const name = storeName(storeId);
    setBusy(true);
    let theoryNow = theory;
    if (pendingImport && !closed) {
      const r = await onImport(storeId, [today]);
      if (!r) { setBusy(false); return; }
      // サーバーは SalonOne から読み直して取り込むので、取り込んだ金額で理論残高を計算し直す
      // （手入力の売上が入った・締められた などで取り込まなかった時は、出納帳の残高のまま）
      const res = (r.results || []).find((x) => x.date === today);
      theoryNow = res && APPLIED.has(res.status) && res.amount != null ? base - so.imported + res.amount : base;
    }
    const d = actualN - theoryNow;
    if (d === 0) {
      setBusy(false);
      showToast(`${name}：レジ金が一致しました（${yen(actualN)}）`, 'success');
      onClose();
      return;
    }
    const entry = await onRecord({
      date: today,
      type: d > 0 ? 'income' : 'expense',
      category: d > 0 ? 'その他収入' : 'その他経費',
      description: `レジ金チェック差異（${name}）実残高:${yen(actualN)} / 理論:${yen(theoryNow)}`,
      amount: Math.abs(d),
      paymentMethod: 'CASH',
      cashType: 'register',
      store: storeId,
      recorder: displayName(),
    });
    setBusy(false);
    if (entry) {
      showToast(`差異 ${signedYen(d)} を記録しました（${name}）`, 'warning');
      onClose();
    }
  };

  const formId = `${idp}-form`;
  return (
    <Modal open onClose={onClose} title="レジ金チェック" size="sm"
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>キャンセル</Button>
          <Button type="submit" form={formId} variant="primary" icon="check" loading={busy} disabled={diff == null || blocked || waiting}>
            {diff != null && diff !== 0 ? '差異を記録する' : '確定する'}
          </Button>
        </>
      )}>
      <form id={formId} onSubmit={confirm} className="space-y-4">
        <p className="text-[13px] leading-relaxed text-ink-2">レジの現金を数えて入力してください。レジの理論残高と照合します。</p>
        {stores.length > 1 ? (
          <Field label="店舗" htmlFor={`${idp}-store`} required>
            <Select id={`${idp}-store`} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="">店舗を選択</option>
              {stores.map((s) => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
            </Select>
          </Field>
        ) : null}
        <div className="rounded-xl border border-line bg-surface-2 px-3.5 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-2">
              <Icon name="banknote" size={15} className="text-muted" />レジの理論残高
            </span>
            <span className="text-lg font-bold text-ink num">{theory != null ? yen(theory) : '—'}</span>
          </div>
          {storeId && so.loading ? (
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-muted"><Spinner size={12} />SalonOne の本日の現金売上を確認しています</p>
          ) : pendingImport && so.pending !== 0 ? (
            <p className="mt-1 flex items-start gap-1 text-[11px] leading-relaxed text-ink-2">
              <Icon name="plug" size={12} className="mt-px shrink-0 text-brand-600 dark:text-brand-300" />
              まだ取り込んでいない SalonOne の本日の現金売上 {signedYen(so.pending)} を含みます。確定すると先に取り込みます。
            </p>
          ) : pendingImport ? (
            <p className="mt-1 flex items-start gap-1 text-[11px] leading-relaxed text-ink-2">
              <Icon name="plug" size={12} className="mt-px shrink-0 text-brand-600 dark:text-brand-300" />
              SalonOne の本日の現金売上（{yen(so.salon)}）は取り込み済みです。確定の前に SalonOne の最新の金額を確かめます。
            </p>
          ) : null}
          {storeId && !so.loading && so.unknown ? <UnknownCashNote unknown={so.unknown} /> : null}
        </div>
        {storeId && so.error ? (
          <Banner tone="warn" title="SalonOne の本日の現金売上を確認できませんでした">
            理論残高に、まだ取り込んでいない本日の現金売上が入っていない可能性があります。差異を記録する前に、時間をおいて開き直してください。
          </Banner>
        ) : null}
        <Field label="実際のレジ金額（円）" htmlFor={`${idp}-actual`} required>
          <Input id={`${idp}-actual`} type="number" inputMode="numeric" min="0" step="1" placeholder="例: 50000"
            className="num text-lg font-bold" value={actual} onChange={(e) => setActual(e.target.value)} disabled={!storeId} />
        </Field>
        {diff != null ? (
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-ink-2">差異</span>
            <DiffBadge diff={diff} />
          </div>
        ) : null}
        {diff != null && diff !== 0 && !closed ? (
          <p className="text-xs leading-relaxed text-muted">
            確定すると、差額を「{diff > 0 ? 'その他収入' : 'その他経費'}」としてレジに記録し、理論残高を実際の金額に合わせます。
          </p>
        ) : null}
        {blocked ? (
          <Banner tone="warn">本日（{dateJa(today)}）は締め済みのため、差異を記録できません。</Banner>
        ) : null}
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------
// 日次締め: 金庫・小口現金・レジの実残高を記録してその日をロックする。
// SalonOne が接続済みなら、その日の現金売上を取り込んでから締める（既定でオン）。
// 締めた後は取り込めないので、ここで取り込み忘れを防ぐ。
// ------------------------------------------------------------
function useTodaySalonOneCash(storeId, today, entries) {
  // ダイアログを開くたびに SalonOne から読み直す（数分前の金額だと、その後の現金の会計が「差異」に見えてしまう）
  const cash = useStoreCash(storeId ? monthOf(today) : null, storeId, { fresh: true });
  const data = cash.data;
  return useMemo(() => {
    if (!storeId) return { loading: false, available: false };
    if (!data) return { loading: cash.loading, available: false, error: cash.error };
    if (data.mode !== 'live' || !data.linked) return { loading: false, available: false, demo: data.mode !== 'live' };
    const day = (data.days || []).find((d) => d.date === today);
    const salon = day ? Number(day.cashSales) || 0 : 0;
    // 複数の決済方法で内訳が無い会計（現金の分がわからないので salon に入っていない）
    const unknown = (data.cashUnknown || []).find((d) => d.date === today) || null;
    const mine = entries.filter((e) => String(e.store) === String(storeId) && e.date === today);
    const imported = mine.filter(isSalonOneCashEntry).reduce((a, e) => a + (Number(e.amount) || 0), 0);
    const manual = mine.filter(isManualSalesCash).reduce((a, e) => a + (Number(e.amount) || 0), 0);
    // 手入力の売上がある日は取り込まない（二重になる）。それ以外は確定の前に必ず取り込み直す
    const canImport = manual === 0;
    const needsImport = canImport && salon !== imported;
    return { loading: false, available: true, salon, imported, manual, canImport, needsImport, pending: canImport ? salon - imported : 0, unknown };
  }, [data, cash.loading, cash.error, storeId, today, entries]);
}

function SalonOneCashRow({ info, checked, onChange, idp }) {
  if (info.error) {
    return (
      <Banner tone="warn" title="SalonOne の本日の現金売上を確認できませんでした">
        このまま締めると、この日の SalonOne の現金売上は後から取り込めません。時間をおいて開き直すか、出納帳 &gt; SalonOne突合 で取り込んでから締めてください。
      </Banner>
    );
  }
  if (info.loading) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-xs text-muted">
        <Spinner size={14} />SalonOne の本日の現金売上を確認しています
      </div>
    );
  }
  if (!info.available) return null;
  return (
    <div className="rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-3 dark:border-brand-500/30 dark:bg-brand-500/10">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-ink-2">
          <Icon name="plug" size={14} className="text-brand-600 dark:text-brand-300" />SalonOne の本日の現金売上
        </span>
        <span className="text-[15px] font-bold text-ink num">{yen(info.salon)}</span>
      </div>
      {info.manual > 0 ? (
        <p className="mt-1.5 text-xs leading-relaxed text-ink-2">
          手入力の現金売上（{yen(info.manual)}）があるため取り込みません。
          {info.manual !== info.salon ? <> SalonOne との差額 <b className="num">{signedYen(info.manual - info.salon)}</b> を確認してください。</> : ' 金額は一致しています。'}
        </p>
      ) : (
        <label htmlFor={`${idp}-import`} className="mt-2 flex cursor-pointer items-start gap-2 text-[13px] text-ink">
          <input id={`${idp}-import`} type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded accent-brand-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
          <span>
            {info.needsImport ? 'レジの入金として取り込んでから締める' : 'SalonOne の最新の金額を確かめてから締める'}
            <span className="block text-xs text-ink-2">
              {!info.needsImport ? `取り込み済み（${yen(info.imported)}）。締める直前の SalonOne の金額で取り込み直します`
                : info.imported > 0 ? `取り込み済みの ${yen(info.imported)} を ${yen(info.salon)} に更新します` : '会計で受け取った現金を 1件の入金として記録します'}
            </span>
          </span>
        </label>
      )}
      {info.unknown ? <UnknownCashNote unknown={info.unknown} /> : null}
    </div>
  );
}

/** 現金と他の決済方法を組み合わせた会計で、内訳が無いもの（現金の分がわからないので取り込む金額に入っていない） */
function UnknownCashNote({ unknown }) {
  return (
    <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-ink-2">
      <Icon name="triangle-alert" size={13} className="mt-px shrink-0 text-[#b07a00] dark:text-[#f6c75a]" />
      <span>
        現金とほかの決済方法を組み合わせた会計 {unknown.count}件（{yen(unknown.amount)}）は、決済の内訳が無いため含めていません。
        SalonOne の会計で内訳を登録してから開き直すと、現金の分が入ります。
      </span>
    </p>
  );
}

export function DailyCloseModal({ storeId, storeName, balance, today, entries = [], onImport, onConfirm, onClose }) {
  const [values, setValues] = useState({ safe: '', pettyCash: '', register: '' });
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [doImport, setDoImport] = useState(true);
  const idp = useId();
  const b = balance || EMPTY_BALANCE;
  const so = useTodaySalonOneCash(storeId, today, entries);
  const willImport = !!onImport && so.available && so.canImport && doImport;
  // 取り込む予定の現金売上もレジの理論残高に含めて見せる
  const theoryOf = (ct) => b.byCashType[ct].balance + (ct === 'register' && willImport ? so.pending : 0);

  // SalonOne の金額を確かめている間は締めない（締めた日は後から取り込めないため）
  const waiting = !!onImport && so.loading;

  const confirm = async (e) => {
    if (e) e.preventDefault();
    if (busy || waiting) return;
    setBusy(true);
    if (willImport) {
      const r = await onImport(storeId, [today]);
      if (!r) { setBusy(false); return; }
    }
    const ok = await onConfirm({
      safe: parseYen(values.safe) || 0,
      pettyCash: parseYen(values.pettyCash) || 0,
      register: parseYen(values.register) || 0,
    }, notes.trim());
    setBusy(false);
    if (ok) onClose();
  };

  const formId = `${idp}-form`;
  return (
    <Modal open onClose={onClose} title={`日次締め・${storeName(storeId)}`}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>キャンセル</Button>
          <Button type="submit" form={formId} variant="primary" icon="lock" loading={busy} disabled={waiting}>{willImport ? '取り込んで締める' : '締めを確定する'}</Button>
        </>
      )}>
      <form id={formId} onSubmit={confirm} className="space-y-4">
        <Banner tone="warn" title={`${dateJa(today)} を締めます`}>
          締めた後は、この日の{storeName(storeId)}の記録を追加・編集・削除できなくなります。
        </Banner>
        {onImport ? <SalonOneCashRow info={so} checked={doImport} onChange={setDoImport} idp={idp} /> : null}
        <div className="grid gap-3 sm:grid-cols-3">
          {CASH_TYPES.map((ct) => {
            const theory = theoryOf(ct.value);
            const v = parseYen(values[ct.value]);
            return (
              <Field key={ct.value} label={`${ct.label}の実残高（円）`} htmlFor={`${idp}-${ct.value}`}>
                <Input id={`${idp}-${ct.value}`} type="number" inputMode="numeric" min="0" step="1" placeholder="0" className="num font-bold"
                  value={values[ct.value]} onChange={(e) => setValues((p) => ({ ...p, [ct.value]: e.target.value }))} />
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1 text-xs text-muted">
                  <span>理論 <span className="num font-semibold text-ink-2">{yen(theory)}</span></span>
                  {v != null ? <DiffBadge diff={v - theory} /> : null}
                </div>
              </Field>
            );
          })}
        </div>
        <Field label="備考" htmlFor={`${idp}-notes`}>
          <Input id={`${idp}-notes`} placeholder="特記事項があれば入力" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <p className="text-xs text-muted">空欄の項目は 0 円として記録します。締めた人: {displayName()}</p>
      </form>
    </Modal>
  );
}
