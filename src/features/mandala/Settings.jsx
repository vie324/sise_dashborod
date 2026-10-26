import { useMemo, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Segmented, Select, cx } from '../../ui/primitives.jsx';
import { showToast } from '../../ui/feedback.jsx';
import { ROLE_LABELS } from '../../lib/access.js';
import { useMandala, mandalaAction } from './data.js';
import { Toggle, LoadingState, ErrorState } from './parts.jsx';
import { DAILY_SECTIONS, SHARING_SCOPES, SHARING_SCOPE_LABEL, SHARING_SCOPE_DESCRIPTION, formatDateTimeJst } from '../../../shared/mandala.js';

// ============================================================
// マンダラの設定（店長・オーナー）
//   共有の範囲（オーナー）/ 日報の対象 / 日報のチェック項目（全店舗共通はオーナー、店舗の項目は店長も）
// ============================================================

function ScopeCard({ data }) {
  const [scope, setScope] = useState(data.scope);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await mandalaAction('setSharingScope', { scope });
      showToast(`共有の範囲を「${SHARING_SCOPE_LABEL[scope]}」にしました`, 'success');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="仲間との共有" icon="users-round" subtitle={data.canEditScope ? 'メンバー同士でマンダラと進み具合を見せ合えるようにします' : '共有の範囲はオーナーが決めます'}>
      {!data.canEditScope ? (
        <p className="rounded-xl border border-line px-3 py-2.5 text-[13px] text-ink">いまは<span className="mx-1 font-bold">{SHARING_SCOPE_LABEL[data.scope]}</span>です。<span className="block text-xs text-muted">{SHARING_SCOPE_DESCRIPTION[data.scope]}</span></p>
      ) : (
      <fieldset className="space-y-2">
        <legend className="sr-only">共有の範囲</legend>
        {SHARING_SCOPES.map((v) => (
          <label key={v} className={cx('flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3', scope === v ? 'border-brand-400 bg-brand-50/60 dark:border-brand-500/50 dark:bg-brand-500/10' : 'border-line')}>
            <input type="radio" name="scope" value={v} checked={scope === v} onChange={() => setScope(v)} className="mt-0.5 h-4 w-4 shrink-0 accent-[#236c48]" />
            <span className="min-w-0">
              <span className="block text-[13px] font-bold text-ink">{SHARING_SCOPE_LABEL[v]}</span>
              <span className="mt-0.5 block text-xs text-muted">{SHARING_SCOPE_DESCRIPTION[v]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      )}
      {data.canEditScope ? (
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="text-[11px] text-muted">{data.settingsUpdatedAt ? `${formatDateTimeJst(data.settingsUpdatedAt)} 更新` : ''}</span>
          <Button variant="primary" loading={busy} disabled={scope === data.scope} onClick={save}>保存</Button>
        </div>
      ) : null}
      <div className="mt-4 grid gap-3 rounded-xl bg-surface-2 p-3 text-xs sm:grid-cols-2">
        <div>
          <p className="font-semibold text-[var(--text-good)]">仲間に見えるもの</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-muted">
            <li>マンダラチャート（センターゴール・8テーマ・64項目）</li>
            <li>チャートの記入状況</li>
            <li>週報の提出状況・行動の実行率・フォーカスの達成率</li>
            <li>お互いに送った応援</li>
          </ul>
        </div>
        <div>
          <p className="font-semibold text-ink-2">仲間には見えないもの</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-muted">
            <li>週報の文章（よかったこと・課題）</li>
            <li>AI のレビュー・コメントのやりとり</li>
            <li>日報・今の売上・目標の内訳のメモ</li>
          </ul>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted">店長・オーナーが見られる範囲はこの設定では変わりません（店長は担当店舗、オーナーは全員）。各自が自分の公開・非公開を切り替えられます。</p>
    </Card>
  );
}

function MembersCard({ members }) {
  const [state, setState] = useState(() => Object.fromEntries(members.map((m) => [m.id, m.dailyEnabled])));
  const [busy, setBusy] = useState(null);
  const toggle = async (m, next) => {
    setState((s) => ({ ...s, [m.id]: next }));
    setBusy(m.id);
    try {
      await mandalaAction('setDailyEnabled', { staffId: m.id, enabled: next }, { refresh: false });
    } catch (e) {
      setState((s) => ({ ...s, [m.id]: !next }));
      showToast(e.message, 'error');
    } finally {
      setBusy(null);
    }
  };
  const optedOut = members.filter((m) => !m.shareChart);
  return (
    <Card title="日報の対象" icon="sun-medium" subtitle="対象にしたメンバーは、毎日の業務チェックと振り返りを書きます（若手のメンバー向け）">
      {members.length === 0 ? <p className="text-[13px] text-muted">メンバーがいません。</p> : (
        <ul className="divide-y divide-line">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
              <a href={`#/mandala/member/${m.id}`} className="min-w-0">
                <span className="block truncate text-[14px] font-semibold text-ink">{m.name}</span>
                <span className="block truncate text-[11px] text-muted">{m.storeNames.join('・') || '店舗未設定'}・{ROLE_LABELS[m.role] || m.role}</span>
              </a>
              <Toggle checked={!!state[m.id]} disabled={busy === m.id} onChange={(on) => toggle(m, on)} label={`${m.name}さんを日報の対象にする`} />
            </li>
          ))}
        </ul>
      )}
      {optedOut.length ? <p className="mt-3 text-[11px] text-muted">仲間にチャートを非公開にしている人: {optedOut.map((m) => m.name).join('、')}</p> : null}
    </Card>
  );
}

function ItemEditor({ open, onClose, item, stores, canManageCommon, defaultStore }) {
  const [v, setV] = useState(null);
  const [busy, setBusy] = useState(false);
  const init = item || { storeId: defaultStore, section: 'during', label: '', sortOrder: 0, isActive: true };
  const cur = v || init;
  const set = (k) => (e) => setV({ ...cur, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const close = () => { setV(null); onClose(); };
  const save = async () => {
    setBusy(true);
    try {
      await mandalaAction('saveCheckItem', { id: item ? item.id : undefined, storeId: cur.storeId || null, section: cur.section, label: cur.label, sortOrder: cur.sortOrder, isActive: cur.isActive });
      showToast(item ? '項目を保存しました' : '項目を追加しました', 'success');
      close();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={close} title={item ? 'チェック項目を編集' : 'チェック項目を追加'}
      footer={<><Button variant="ghost" onClick={close}>キャンセル</Button><Button variant="primary" loading={busy} disabled={!String(cur.label || '').trim()} onClick={save}>保存</Button></>}>
      <div className="space-y-4">
        <Field label="項目" htmlFor="ci-label" required>
          <Input id="ci-label" value={cur.label} maxLength={200} onChange={set('label')} placeholder="例: 当日の予約確認" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="区分" htmlFor="ci-section">
            <Select id="ci-section" value={cur.section} onChange={set('section')}>
              {DAILY_SECTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
          </Field>
          <Field label="並び順" htmlFor="ci-order" hint="小さいほど上">
            <Input id="ci-order" type="number" inputMode="numeric" value={cur.sortOrder} onChange={set('sortOrder')} />
          </Field>
        </div>
        <Field label="使う店舗" htmlFor="ci-store">
          <Select id="ci-store" value={cur.storeId || ''} onChange={(e) => setV({ ...cur, storeId: e.target.value || null })}>
            {canManageCommon ? <option value="">全店舗共通</option> : null}
            {stores.map((s) => <option key={s.id} value={s.id}>{s.name}だけ</option>)}
          </Select>
        </Field>
        {item ? (
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" checked={cur.isActive} onChange={set('isActive')} className="h-4 w-4 accent-[#236c48]" />
            使う（外すと日報に出なくなります。過去の記録は残ります）
          </label>
        ) : null}
      </div>
    </Modal>
  );
}

function CheckItemsCard({ data }) {
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState(null); // item | 'new' | null
  const items = useMemo(() => data.checkItems.filter((i) => filter === 'all' || (filter === 'common' ? !i.storeId : i.storeId === filter)), [data.checkItems, filter]);
  const options = [{ value: 'all', label: 'すべて' }, { value: 'common', label: '全店舗共通' }, ...data.stores.map((s) => ({ value: s.id, label: s.name }))];
  const defaultStore = data.canManageCommon ? null : (data.stores[0] && data.stores[0].id) || null;
  return (
    <Card title="日報のチェック項目" icon="list-checks" subtitle="紙の業務チェックリストと同じ「出勤時・勤務中・退勤前」の3つに分けて並びます"
      actions={<Button size="sm" variant="primary" icon="plus" onClick={() => setEditing('new')} disabled={!data.canManageCommon && !data.stores.length}>追加</Button>}>
      <Segmented value={filter} onChange={setFilter} options={options} size="sm" className="mb-3" ariaLabel="店舗で絞り込む" />
      {items.length === 0 ? <EmptyState compact icon="list-checks" title="項目がありません" /> : (
        <div className="space-y-4">
          {DAILY_SECTIONS.map((sec, idx) => {
            const list = items.filter((i) => i.section === sec.key);
            if (!list.length) return null;
            return (
              <section key={sec.key}>
                <h3 className="mb-1.5 flex items-baseline gap-2 text-[13px] font-bold text-ink"><span className="text-gold-600 num dark:text-gold-300">0{idx + 1}</span>{sec.label}<span className="text-[11px] font-normal text-muted">{list.length}件</span></h3>
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {list.map((i) => (
                    <li key={i.id}>
                      <button type="button" disabled={!i.canEdit} onClick={() => setEditing(i)} className={cx('flex w-full items-center gap-2 px-3 py-2.5 text-left disabled:cursor-default', i.isActive ? '' : 'opacity-50')}>
                        <span className="min-w-0 flex-1 text-[13px] leading-snug text-ink">{i.label}</span>
                        {i.storeId ? <Badge tone="info">{i.storeName}</Badge> : null}
                        {!i.isActive ? <Badge>使わない</Badge> : null}
                        {i.canEdit ? <Icon name="pencil" size={14} className="shrink-0 text-muted" /> : <Icon name="lock" size={13} className="shrink-0 text-muted" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {!data.canManageCommon ? <p className="mt-3 text-[11px] text-muted">鍵のマークの項目（全店舗共通）はオーナーが決めます。担当の店舗だけの項目は追加・変更できます。</p> : null}
      <ItemEditor key={editing && editing !== 'new' ? editing.id : 'new'} open={!!editing} onClose={() => setEditing(null)} item={editing && editing !== 'new' ? editing : null}
        stores={data.stores} canManageCommon={data.canManageCommon} defaultStore={defaultStore} />
    </Card>
  );
}

export default function Settings() {
  const res = useMandala('settings');
  const data = res.shown;
  if (!data && res.error) return <ErrorState error={res.error} onRetry={res.reload} />;
  if (!data) return <LoadingState />;
  return (
    <div className="space-y-4">
      <PageHeader title="マンダラの設定" subtitle="共有の範囲・日報の対象・日報のチェック項目" />
      <ScopeCard key={data.scope} data={data} />
      <MembersCard members={data.members} />
      <CheckItemsCard data={data} />
    </div>
  );
}
