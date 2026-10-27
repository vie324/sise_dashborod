import { useEffect, useState } from 'react';
import { useApp } from '../../app/state.jsx';
import { useSummary, useGoals } from '../../lib/hooks.js';
import { isManagerOrAbove } from '../../lib/access.js';
import { PageHeader, Segmented, Card, Modal, Skeleton, EmptyState, Badge, cx } from '../../ui/primitives.jsx';
import Icon from '../../ui/Icon.jsx';
import { yen } from '../../lib/format.js';
import { ScopeBar, DataWarnings } from '../shared/ScopeBar.jsx';
import StaffDetail from './StaffDetail.jsx';
import RulesView from './RulesView.jsx';
import PeriodCloseBar from './PeriodClose.jsx';
import { INCENTIVE_META } from './parts.jsx';
import { INCENTIVE_RULES } from '../../../shared/incentive-rules.js';
import { takeFocusIncentive, scrollToIncentive } from './focus.js';

const ITEM_KEYS = ['sales', 'retention', 'newContract', 'sns', 'referral'];
const goalOf = (goals, row) => (goals && goals.staff && row.staffId && goals.staff[row.staffId] ? goals.staff[row.staffId].consumedSales : null);

function Amount({ value, strong }) {
  return <span className={cx('num', value > 0 ? (strong ? 'font-bold text-ink' : 'text-ink') : 'text-muted')}>{yen(value)}</span>;
}

/** 支給期間の合計（確定済みなら確定した金額） */
const periodTotal = (r) => (r.closed ? r.closed.total : r.period.total);

function StaffTable({ summary, onOpen }) {
  const rows = summary.staff;
  if (rows.length === 0) return <Card><EmptyState icon="users" title="この範囲のスタッフ実績はまだありません" /></Card>;
  const total = (fn) => rows.reduce((a, r) => a + fn(r), 0);
  const itemAmount = (r, key) => (r.incentive.items.find((i) => i.key === key) || {}).amount || 0;
  return (
    <>
      {/* PC: 表 */}
      <Card pad={false} className="hidden md:block">
        <div className="scroll-x">
          <table className="data-table">
            <thead>
              <tr>
                <th>スタッフ</th>
                {ITEM_KEYS.map((k) => <th key={k} className="text-right">{INCENTIVE_META[k].title.replace('Minimo・Threads・Instagram', 'SNS')}</th>)}
                <th className="text-right">今月合計</th>
                <th className="text-right">支給期間の合計{summary.close ? '（確定）' : ''}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="cursor-pointer hover:bg-surface-2" onClick={() => onOpen(r)}>
                  <td className="whitespace-nowrap">
                    <div className="flex items-center gap-2 font-semibold text-ink">{r.name}{!r.linked ? <Badge tone="warn">未連携</Badge> : null}</div>
                    <div className="text-[11px] text-muted">{r.storeName}</div>
                  </td>
                  {ITEM_KEYS.map((k) => <td key={k} className="num-cell"><Amount value={itemAmount(r, k)} /></td>)}
                  <td className="num-cell"><Amount value={r.incentive.total} strong /></td>
                  <td className="num-cell">
                    <Amount value={periodTotal(r)} strong />
                    {r.closed && r.closed.total !== r.period.total ? <div className="text-[11px] text-muted">再計算 {yen(r.period.total)}</div> : null}
                  </td>
                </tr>
              ))}
              <tr className="bg-surface-2">
                <td className="font-semibold text-ink-2">合計</td>
                {ITEM_KEYS.map((k) => <td key={k} className="num-cell font-semibold"><Amount value={total((r) => itemAmount(r, k))} /></td>)}
                <td className="num-cell"><Amount value={total((r) => r.incentive.total)} strong /></td>
                <td className="num-cell"><Amount value={total(periodTotal)} strong /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
      {/* スマホ: カード */}
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={r.key}>
            <button type="button" onClick={() => onOpen(r)} className="card card-pad flex w-full flex-col gap-2 text-left">
              <span className="flex w-full items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink">{r.name}</span>
                  <span className="block text-[11px] text-muted">{r.storeName} ・ 期間合計{r.closed ? '（確定）' : ''} {yen(periodTotal(r))}</span>
                </span>
                <span className="flex items-center gap-1 text-lg font-bold text-ink num">{yen(r.incentive.total)}<Icon name="chevron-right" size={16} className="text-muted" /></span>
              </span>
              <span className="flex flex-wrap gap-1.5">
                {r.incentive.items.filter((i) => i.amount > 0).map((i) => (
                  <Badge key={i.key} tone="gold" icon={INCENTIVE_META[i.key].icon}>{yen(i.amount)}</Badge>
                ))}
                {r.incentive.items.every((i) => i.amount === 0) ? <span className="text-xs text-muted">まだ支給対象の項目はありません</span> : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function IncentivesPage() {
  const { month, storeId } = useApp();
  const summary = useSummary(month, storeId);
  const goals = useGoals(month);
  const data = summary.shown;
  const manager = isManagerOrAbove();
  const hasMe = !!(data && data.me);
  // ホームのミッションから来た時は「あなたの内訳」の該当カードを開く
  const [focus, setFocus] = useState(() => takeFocusIncentive());
  const [tab, setTab] = useState(manager && !focus ? 'staff' : 'mine');
  const [open, setOpen] = useState(null);

  useEffect(() => {
    if (!focus || tab !== 'mine' || !data || !data.me) return undefined;
    const t = setTimeout(() => { scrollToIncentive(focus); setFocus(null); }, 80);
    return () => clearTimeout(t);
  }, [focus, tab, data]);

  useEffect(() => {
    if (tab === 'mine' && data && !data.me && manager) setTab('staff');
  }, [tab, data, manager]);

  const tabs = [
    ...(manager ? [{ value: 'staff', label: 'スタッフ別', icon: 'users' }] : []),
    ...(!manager || hasMe ? [{ value: 'mine', label: 'あなたの内訳', icon: 'user' }] : []),
    { value: 'rules', label: '制度の内容', icon: 'book-open' },
  ];

  return (
    <div>
      <PageHeader title="インセンティブ" subtitle="制度（2026年11月〜・2ヶ月ごと支給）に沿って、SalonOne の実績から自動計算しています" />
      <Segmented value={tab} onChange={setTab} options={tabs} className="mb-4" ariaLabel="表示の切り替え" />
      {tab === 'rules' ? (
        <RulesView rules={(data && data.rules) || INCENTIVE_RULES} />
      ) : (
        <>
          <ScopeBar data={data} />
          <DataWarnings data={data} error={summary.error} preview />
          {!data ? <Skeleton className="h-[360px] rounded-2xl" /> : (
            <div className={cx('transition-opacity', summary.stale || summary.loading ? 'opacity-60' : '')}>
              {tab === 'staff' ? (
                <>
                  <PeriodCloseBar summary={data} />
                  <p className="mb-3 text-xs text-muted">行を選ぶと「次のランクまで」などの内訳を表示します。インセンティブは、ヘルプで入った他店舗の分も含めてスタッフごとに全店舗の実績で計算しています。</p>
                  <StaffTable summary={data} onOpen={setOpen} />
                </>
              ) : data.me ? (
                <StaffDetail row={data.me} summary={data} goal={goalOf(goals.shown, data.me)} anchors />
              ) : (
                <Card><EmptyState icon="user-x" title="あなたの実績を表示できません" message="SalonOne のスタッフと連携されていません。管理者に連携を依頼してください。" /></Card>
              )}
            </div>
          )}
        </>
      )}
      <Modal open={!!open} onClose={() => setOpen(null)} title={open ? `${open.name} さんのインセンティブ` : ''} size="lg">
        {open && data ? <StaffDetail row={open} summary={data} goal={goalOf(goals.shown, open)} /> : null}
      </Modal>
    </div>
  );
}
