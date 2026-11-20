// ============================================================
// 新規台帳
// ------------------------------------------------------------
// SalonOne の新規のお客様（その月に初めて来店した人）を並べ、
// 「契約できた（プラン）／できなかった（理由のタブ・メモ）」とメニューを記録する（api/_lib/salonone/leads.js）。
// 媒体・担当・SalonOne でのプランの購入も出す。インセンティブ・新規契約の数は SalonOne のデータのまま。
// 「未契約の理由」のタブで、記録した理由の一覧と理由ごとの人数を見る（LeadReasons.jsx）
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../app/state.jsx';
import { currentQuery } from '../../app/router.js';
import { useLeads, saveLeadRecord } from '../../lib/hooks.js';
import { PageHeader, Card, Badge, Button, Select, Input, Textarea, Field, Modal, Segmented, EmptyState, Skeleton, cx } from '../../ui/primitives.jsx';
import { showToast } from '../../ui/feedback.jsx';
import Icon from '../../ui/Icon.jsx';
import { num, dateJa, dateTimeJa } from '../../lib/format.js';
import { ScopeBar, DataWarnings } from '../shared/ScopeBar.jsx';
import { LOST_REASONS } from '../../../shared/leads.js';
import LeadReasons, { ReasonTags } from './LeadReasons.jsx';

const OTHER = '__other__';

const who = (row) => row.customerName || (row.customerNumber ? `顧客番号 ${row.customerNumber}` : 'お客様');
const menuOf = (row) => (row.menus.length ? row.menus.join('・') : (row.record && row.record.menu) || '');

function OutcomeBadge({ record }) {
  if (!record) return <Badge tone="warn" icon="circle-dashed">未記録</Badge>;
  return record.outcome === 'contracted'
    ? <Badge tone="good" icon="circle-check">契約</Badge>
    : <Badge tone="bad" icon="circle-x">契約なし</Badge>;
}

function LeadCard({ row, showStore, onOpen }) {
  const rec = row.record;
  const menu = menuOf(row);
  return (
    <li>
      <button type="button" onClick={() => onOpen(row)}
        className="card flex w-full flex-col gap-2 p-3.5 text-left transition-colors hover:border-line-strong active:bg-surface-2">
        <span className="flex w-full items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block text-[11px] text-muted num">
              {dateJa(row.date)}{row.time ? ` ${row.time}` : ''}{showStore ? `・${row.storeName}` : ''}{row.shopName ? `・${row.shopName}` : ''}
            </span>
            <span className="mt-0.5 block truncate text-[15px] font-bold text-ink">{who(row)}</span>
          </span>
          <OutcomeBadge record={rec} />
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone="brand" icon="route">{row.sourceName || '媒体なし'}</Badge>
          {row.sourceName && row.channelLabel !== row.sourceName ? <span className="text-[11px] text-muted">→ {row.channelLabel}</span> : null}
          {row.staffName ? <Badge tone="neutral" icon="user">{row.staffName}</Badge> : null}
        </span>
        <span className="text-[13px] text-ink-2">
          <span className="text-muted">メニュー </span>{menu || <span className="text-muted">未記録</span>}
        </span>
        {row.salonOne.plans.length || row.salonOne.joined ? (
          <span className="text-xs text-ink-2">
            <Icon name="badge-check" size={13} className="mr-1 inline text-brand-600 dark:text-brand-300" />
            SalonOne: {row.salonOne.plans.length ? row.salonOne.plans.map((p) => `${p.name}（${dateJa(p.date, { weekday: false })}）`).join('・') : '入会'}
          </span>
        ) : null}
        {rec ? (
          <span className="rounded-xl bg-surface-2 px-3 py-2 text-[13px] text-ink">
            {rec.outcome === 'contracted' ? <>契約: <strong>{rec.plan}</strong></> : (
              <>
                <ReasonTags tags={rec.reasons} />
                {rec.reason ? <span className={cx('line-clamp-2 block whitespace-pre-line', rec.reasons && rec.reasons.length ? 'mt-1 text-ink-2' : '')}>{rec.reasons && rec.reasons.length ? '' : '理由: '}{rec.reason}</span> : null}
              </>
            )}
            <span className="mt-0.5 block text-[11px] text-muted">{rec.updatedBy ? `${rec.updatedBy}・` : ''}{dateTimeJa(rec.updatedAt)}</span>
          </span>
        ) : null}
      </button>
    </li>
  );
}

function LeadEditor({ row, data, month, onClose, onSaved }) {
  const rec = row.record;
  const firstSalonOnePlan = row.salonOne.plans.length ? row.salonOne.plans[0].name : '';
  const initialPlan = (rec && rec.plan) || firstSalonOnePlan;
  const planList = data.planOptions;
  const [outcome, setOutcome] = useState(rec ? rec.outcome : (firstSalonOnePlan ? 'contracted' : ''));
  const [planSel, setPlanSel] = useState(initialPlan && !planList.includes(initialPlan) ? OTHER : initialPlan);
  const [planText, setPlanText] = useState(initialPlan && !planList.includes(initialPlan) ? initialPlan : '');
  const [tags, setTags] = useState((rec && rec.reasons) || []);
  const [reason, setReason] = useState((rec && rec.reason) || '');
  const initialMenu = (rec && rec.menu) || '';
  const [menuSel, setMenuSel] = useState(initialMenu && !data.menuOptions.includes(initialMenu) ? OTHER : initialMenu);
  const [menuText, setMenuText] = useState(initialMenu && !data.menuOptions.includes(initialMenu) ? initialMenu : '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const plan = planSel === OTHER ? planText.trim() : planSel;
  const menu = row.menus.length ? row.menus.join('・') : (menuSel === OTHER ? menuText.trim() : menuSel);

  const submit = async (nextOutcome) => {
    const o = nextOutcome === undefined ? outcome : nextOutcome;
    if (o === 'contracted' && !plan) { setError('契約したプランを選んでください'); return; }
    if (o === 'lost' && !tags.length && !reason.trim()) { setError('契約できなかった理由を選ぶか、メモを入力してください'); return; }
    if (o === '' && nextOutcome === undefined) { setError('契約できたか・できなかったかを選んでください'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await saveLeadRecord({ month, storeId: row.storeId, rid: row.rid, outcome: o, plan, reasons: tags, reason, menu });
      onSaved(row.rid, res.record);
      showToast(o ? '記録しました' : '記録を消しました', 'success');
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`${who(row)}の記録`}
      footer={(
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          {rec ? <Button variant="ghost" icon="trash-2" onClick={() => submit('')} disabled={busy}>記録を消す</Button> : <span />}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy}>閉じる</Button>
            <Button variant="primary" icon="save" onClick={() => submit()} loading={busy}>保存</Button>
          </div>
        </div>
      )}>
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-2xl bg-surface-2 p-3 text-[13px]">
          <div><dt className="text-[11px] text-muted">来店</dt><dd className="text-ink num">{dateJa(row.date)}{row.time ? ` ${row.time}` : ''}</dd></div>
          <div><dt className="text-[11px] text-muted">担当</dt><dd className="text-ink">{row.staffName || '—'}</dd></div>
          <div><dt className="text-[11px] text-muted">媒体</dt><dd className="text-ink">{row.sourceName || '—'}{row.sourceName && row.channelLabel !== row.sourceName ? `（${row.channelLabel}）` : ''}</dd></div>
          <div><dt className="text-[11px] text-muted">SalonOne でのプランの購入</dt><dd className="text-ink">{row.salonOne.plans.length ? row.salonOne.plans.map((p) => p.name).join('・') : row.salonOne.joined ? '入会' : 'なし'}</dd></div>
          {row.menus.length ? <div className="col-span-2"><dt className="text-[11px] text-muted">メニュー（SalonOne）</dt><dd className="text-ink">{row.menus.join('・')}</dd></div> : null}
        </dl>

        <fieldset>
          <legend className="field-label">結果</legend>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="契約できたか">
            {[['contracted', '契約できた', 'circle-check'], ['lost', '契約できなかった', 'circle-x']].map(([v, label, icon]) => (
              <button key={v} type="button" role="radio" aria-checked={outcome === v} onClick={() => { setOutcome(v); setError(''); }}
                className={cx('flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border px-3 text-[14px] font-semibold transition-colors',
                  outcome === v
                    ? v === 'contracted' ? 'border-[#0ca30c] bg-[#e7f6e7] text-[#0f5f12] dark:bg-[#0ca30c]/15 dark:text-[#7fe08a]' : 'border-[#d03b3b] bg-[#fbe9e9] text-[#9b2525] dark:bg-[#d03b3b]/18 dark:text-[#f3a3a3]'
                    : 'border-line bg-surface text-ink-2 hover:bg-surface-2')}>
                <Icon name={icon} size={17} />{label}
              </button>
            ))}
          </div>
        </fieldset>

        {outcome === 'contracted' ? (
          <Field label="契約したプラン" htmlFor="lead-plan" hint={firstSalonOnePlan ? `SalonOne では「${firstSalonOnePlan}」を購入しています` : null}>
            <Select id="lead-plan" value={planSel} onChange={(e) => { setPlanSel(e.target.value); setError(''); }}>
              <option value="">選んでください</option>
              {planList.map((p) => <option key={p} value={p}>{p}</option>)}
              <option value={OTHER}>その他（入力する）</option>
            </Select>
            {planSel === OTHER ? <Input className="mt-2" value={planText} maxLength={60} onChange={(e) => setPlanText(e.target.value)} placeholder="プラン名" aria-label="プラン名" /> : null}
          </Field>
        ) : null}

        {outcome === 'lost' ? (
          <>
            <fieldset>
              <legend className="field-label">契約できなかった理由<span className="ml-1 font-normal text-muted">（当てはまるものをすべて）</span></legend>
              <div className="flex flex-wrap gap-1.5">
                {LOST_REASONS.map((c) => {
                  const on = tags.includes(c);
                  return (
                    <button key={c} type="button" aria-pressed={on}
                      onClick={() => { setTags((t) => (t.includes(c) ? t.filter((x) => x !== c) : [...t, c])); setError(''); }}
                      className={cx('inline-flex min-h-[40px] items-center gap-1 rounded-full border px-3 text-xs font-semibold transition-colors',
                        on ? 'border-brand-600 bg-brand-600 text-white dark:border-brand-400 dark:bg-brand-500' : 'border-line bg-surface text-ink-2 hover:bg-surface-2')}>
                      {on ? <Icon name="check" size={13} /> : null}{c}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <Field label="メモ（任意）" htmlFor="lead-reason">
              <Textarea id="lead-reason" value={reason} maxLength={400} onChange={(e) => { setReason(e.target.value); setError(''); }}
                placeholder="例: 結婚式が終わる来月から始めたい" />
            </Field>
          </>
        ) : null}

        {row.menus.length ? null : (
          <Field label="メニュー" htmlFor="lead-menu" hint="SalonOne からメニューが届かない時に選びます（任意）">
            <Select id="lead-menu" value={menuSel} onChange={(e) => setMenuSel(e.target.value)}>
              <option value="">選ばない</option>
              {data.menuOptions.map((m) => <option key={m} value={m}>{m}</option>)}
              <option value={OTHER}>その他（入力する）</option>
            </Select>
            {menuSel === OTHER ? <Input className="mt-2" value={menuText} maxLength={60} onChange={(e) => setMenuText(e.target.value)} placeholder="メニュー名" aria-label="メニュー名" /> : null}
          </Field>
        )}

        {error ? <p role="alert" className="flex items-center gap-1.5 text-[13px] font-medium text-[#b42323] dark:text-[#f08a8a]"><Icon name="circle-alert" size={14} />{error}</p> : null}
      </div>
    </Modal>
  );
}

const VIEWS = [{ value: 'list', label: 'お客様', icon: 'users' }, { value: 'reasons', label: '未契約の理由', icon: 'chart-bar-decreasing' }];

export default function LeadsPage() {
  const { month, storeId } = useApp();
  // #/leads?view=reasons で「未契約の理由」を開く（切り替えると URL も変える。リンクで共有できる）
  const [view, setView] = useState(() => (currentQuery().get('view') === 'reasons' ? 'reasons' : 'list'));
  useEffect(() => {
    try { window.history.replaceState(null, '', view === 'reasons' ? '#/leads?view=reasons' : '#/leads'); } catch (_) { /* noop */ }
  }, [view]);
  return (
    <div>
      <PageHeader title="新規台帳" subtitle="SalonOne の新規のお客様に、契約できたか・プラン・できなかった理由を記録します（インセンティブの数字は SalonOne のまま）" />
      <Segmented value={view} onChange={setView} options={VIEWS} ariaLabel="新規台帳の表示" className="mb-3" />
      {view === 'reasons' ? <LeadReasons month={month} storeId={storeId} /> : <LeadList month={month} storeId={storeId} />}
    </div>
  );
}

function LeadList({ month, storeId }) {
  const res = useLeads(month, storeId);
  const data = res.shown;
  const [filter, setFilter] = useState('all');
  const [open, setOpen] = useState(null);
  const [saved, setSaved] = useState({}); // rid → 保存した記録（読み直すまでの表示用）
  // 読み直した一覧には保存した記録が入っているので、手元の分は捨てる（ほかの人の変更を隠さない）
  useEffect(() => { setSaved({}); }, [data]);

  const rows = useMemo(() => (data ? data.rows.map((r) => (r.rid in saved ? { ...r, record: saved[r.rid] } : r)) : []), [data, saved]);
  const counts = useMemo(() => {
    const c = { all: rows.length, unrecorded: 0, contracted: 0, lost: 0 };
    for (const r of rows) {
      if (!r.record) c.unrecorded += 1;
      else c[r.record.outcome] += 1;
    }
    return c;
  }, [rows]);
  const shown = rows.filter((r) => (filter === 'all' ? true : filter === 'unrecorded' ? !r.record : r.record && r.record.outcome === filter));
  const showStore = !!data && data.storeIds.length > 1;

  return (
    <div>
      <ScopeBar data={data} />
      <DataWarnings data={data} error={res.error} />
      {!data ? <Skeleton className="h-[420px] rounded-2xl" /> : (
        <div className={cx('space-y-4 transition-opacity', res.stale || res.loading ? 'opacity-60' : '')}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['新規', counts.all, 'user-plus', <>SalonOne で購入 <span className="whitespace-nowrap">{num(data.counts.salonOneContracted)}名</span></>],
              ['契約', counts.contracted, 'circle-check', null],
              ['契約なし', counts.lost, 'circle-x', null],
              ['未記録', counts.unrecorded, 'circle-dashed', counts.unrecorded ? '記録をお願いします' : 'すべて記録済み'],
            ].map(([label, value, icon, sub]) => (
              <Card key={label} className="p-3.5">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-2"><Icon name={icon} size={14} className="text-muted" />{label}</div>
                <div className="mt-1 text-[22px] font-bold text-ink num">{num(value)}<span className="ml-0.5 text-sm font-semibold">名</span></div>
                {sub ? <div className="text-[11px] text-muted">{sub}</div> : null}
              </Card>
            ))}
          </div>

          <Segmented value={filter} onChange={setFilter} ariaLabel="絞り込み"
            options={[
              { value: 'all', label: 'すべて', count: counts.all },
              { value: 'unrecorded', label: '未記録', count: counts.unrecorded },
              { value: 'contracted', label: '契約', count: counts.contracted },
              { value: 'lost', label: '契約なし', count: counts.lost },
            ]} />

          {shown.length === 0 ? (
            <Card>
              <EmptyState icon="user-plus" title={rows.length ? 'この絞り込みに当てはまるお客様はいません' : 'この月の新規のお客様はまだいません'}
                message={rows.length ? null : 'SalonOne で会計が済んだ初回の来店が、ここに並びます'} />
            </Card>
          ) : (
            <ul className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {shown.map((r) => <LeadCard key={`${r.storeId}:${r.rid}`} row={r} showStore={showStore} onOpen={data.canEdit ? setOpen : () => {}} />)}
            </ul>
          )}
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted">
            <Icon name="info" size={13} className="mt-0.5 shrink-0" />
            新規はその店舗で初めて会計が済んだ来店です（売上分析の新規数と同じ）。媒体は SalonOne の来店経由、メニューは SalonOne から届く時はそのまま、届かない時は記録で選べます。
            SalonOne でのプランの購入は、初回の来店とそのあとの来店の分です。この記録はインセンティブの計算には使いません。
          </p>
        </div>
      )}
      {open && data ? (
        <LeadEditor row={rows.find((r) => r.rid === open.rid && r.storeId === open.storeId) || open} data={data} month={month}
          onClose={() => setOpen(null)} onSaved={(rid, record) => setSaved((s) => ({ ...s, [rid]: record }))} />
      ) : null}
    </div>
  );
}
