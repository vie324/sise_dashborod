import { useCallback, useMemo, useState } from 'react';
import { useApp } from '../../app/state.jsx';
import { Banner, Button, Card, EmptyState, PageHeader, Segmented } from '../../ui/primitives.jsx';
import Icon from '../../ui/Icon.jsx';
import { MonthPicker, StorePicker } from '../../ui/pickers.jsx';
import { confirmDialog, showToast } from '../../ui/feedback.jsx';
import { isStoreIdAllowed, isManagerOrAbove } from '../../lib/access.js';
import { useStoreCash } from '../../lib/hooks.js';
import { dateJa, yen } from '../../lib/format.js';
import { monthOf, todayJst } from '../../../shared/dates.js';
import { isSalonOneCashEntry } from '../../../shared/cashbook.js';
import { useCashbook } from './useCashbook.js';
import { useMenuItems } from './useMenuItems.js';
import { EMPTY_BALANCE, cashBalanceByStore, cashBalanceOf, groupByDate, monthSummaryOf, recentCustomerNames, reconcileDaily } from './calc.js';
import { SyncStatus } from './parts.jsx';
import OverviewTab from './OverviewTab.jsx';
import EntriesTab from './EntriesTab.jsx';
import AuditLogTab from './AuditLogTab.jsx';
import ReconcileTab from './ReconcileTab.jsx';
import EntryForm from './EntryForm.jsx';
import MenuManager from './MenuManager.jsx';
import { CashCheckModal, DailyCloseModal } from './CashModals.jsx';

// ============================================================
// 出納帳: 現金の入出金・残高・日次締め・操作ログ・SalonOne との突合
// ------------------------------------------------------------
// 表示する月・店舗は画面共通の選択（useApp）を使う。管理者・本部は「全店舗」も選べる。
// ============================================================

/**
 * SalonOne の現金売上でまだ出納帳に取り込んでいない日があれば知らせる
 * （1店舗を選んでいて、SalonOne が接続済みのときだけ）。
 */
function SalonOneImportNotice({ entries, month, storeId, isDayClosed, onOpen }) {
  const data = useStoreCash(month, storeId).shown;
  const salonDaily = data ? data.days : null;
  const pending = useMemo(() => {
    if (!data || data.mode !== 'live' || !data.linked) return null;
    const r = reconcileDaily({ entries, storeId, month, salonDaily: salonDaily || [], asOf: data.asOf });
    // 当日分は締めの時に取り込むので、ここでは前日までを数える
    const days = r.rows.filter((x) => x.canImport && x.date < data.asOf && !isDayClosed(x.date, storeId));
    return days.length ? { count: days.length, amount: days.reduce((a, x) => a + x.salon, 0) } : null;
  }, [data, entries, storeId, month, salonDaily, isDayClosed]);
  if (!pending) return null;
  return (
    <Banner tone="info" className="mb-4" title={`SalonOne の現金売上で、出納帳に取り込んでいない日があります（${pending.count}日分・${yen(pending.amount)}）`}
      action={<Button size="sm" variant="secondary" icon="git-compare-arrows" onClick={onOpen}>確認する</Button>}>
      SalonOne突合 タブからまとめて取り込めます。
    </Banner>
  );
}

const TABS = [
  { value: 'overview', label: '残高総覧' },
  { value: 'entries', label: '入出金' },
  { value: 'audit', label: '操作ログ' },
  { value: 'reconcile', label: 'SalonOne突合' },
];

export default function CashbookPage() {
  const { month, setMonth, storeId, setStoreId, stores, storesLoading, storeName, canSelectAll, allStoresLabel } = useApp();
  const cb = useCashbook();
  const menu = useMenuItems();
  const [tab, setTab] = useState('overview');
  const [formSession, setFormSession] = useState(null); // { key, entry? }
  const [menuOpen, setMenuOpen] = useState(false);
  const [cashCheck, setCashCheck] = useState(null); // { key, storeId }
  const [dailyClose, setDailyClose] = useState(null); // { key, storeId }
  // メニューと価格の変更は店長以上（サーバーでも確認している）
  const canManageMenu = isManagerOrAbove();
  const openMenu = canManageMenu ? () => setMenuOpen(true) : null;

  // 日付をまたいで開きっぱなしでも「本日」がずれないよう、描画のたびに求める（60秒ごとの同期でも再描画される）
  const today = todayJst();
  const thisMonth = monthOf(today);
  const scopeLabel = storeId === 'all' ? '全店舗' : storeName(storeId);
  const scopeStores = useMemo(() => (storeId === 'all' ? stores : stores.filter((s) => String(s.id) === storeId)), [stores, storeId]);
  // 記帳フォームの店舗の初期値: 選択中の店舗 → 店舗が1つだけならそれ → 未選択
  const defaultStoreId = storeId !== 'all' && stores.some((s) => String(s.id) === storeId)
    ? storeId
    : (stores.length === 1 ? String(stores[0].id) : '');

  // 権限のある店舗の記録だけ（サーバーでも絞っているが、端末のキャッシュ由来の行もあるので画面でも確かめる）
  const visibleEntries = useMemo(
    () => cb.entries.filter((e) => !e.deleted && (!e.store || isStoreIdAllowed(e.store))),
    [cb.entries],
  );
  const scopeEntries = useMemo(
    () => (storeId === 'all' ? visibleEntries : visibleEntries.filter((e) => String(e.store) === storeId)),
    [visibleEntries, storeId],
  );
  const monthEntries = useMemo(() => scopeEntries.filter((e) => e.date && String(e.date).startsWith(month)), [scopeEntries, month]);
  const monthSummary = useMemo(() => monthSummaryOf(monthEntries), [monthEntries]);
  const groups = useMemo(() => groupByDate(monthEntries), [monthEntries]);
  const customerNames = useMemo(() => recentCustomerNames(visibleEntries), [visibleEntries]);

  const balances = useMemo(() => {
    const byStore = cashBalanceByStore(visibleEntries);
    const scope = storeId === 'all' ? cashBalanceOf(visibleEntries) : (byStore.get(storeId) || EMPTY_BALANCE);
    return { byStore, scope };
  }, [visibleEntries, storeId]);

  const recentCloses = useMemo(() => cb.dailyCloses
    .filter((c) => (storeId === 'all' ? isStoreIdAllowed(c.storeId) : String(c.storeId) === storeId))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.closedAt || '').localeCompare(String(a.closedAt || '')))
    .slice(0, 10), [cb.dailyCloses, storeId]);

  const loading = cb.loading && cb.entries.length === 0;
  // 一度も読めず端末のキャッシュも無いときは、残高を ¥0 と誤解されないよう数字を出さない
  const unavailable = !cb.loading && !!cb.syncError && cb.lastSynced == null && cb.entries.length === 0;
  const noStores = !storesLoading && stores.length === 0;

  // Modal は onClose が変わるたびに初期フォーカスをやり直すので、閉じる処理は作り直さない
  const closeForm = useCallback(() => setFormSession(null), []);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const closeCashCheck = useCallback(() => setCashCheck(null), []);
  const closeDailyClose = useCallback(() => setDailyClose(null), []);

  const openNew = () => {
    if (noStores) {
      showToast('記帳できる店舗がありません。管理者に確認してください', 'error');
      return;
    }
    setFormSession({ key: Date.now(), entry: null });
  };

  const openEdit = (entry) => {
    if (isSalonOneCashEntry(entry)) {
      showToast('SalonOne から取り込んだ記録は編集できません。SalonOne突合 タブから取り込み直してください', 'info');
      return;
    }
    if (cb.isDayClosed(entry.date, entry.store)) {
      showToast('この日は締め済みのため編集できません', 'error');
      return;
    }
    setFormSession({ key: Date.now(), entry });
  };

  const removeEntry = async (entry) => {
    if (cb.isDayClosed(entry.date, entry.store)) {
      showToast('この日は締め済みのため削除できません', 'error');
      return false;
    }
    const ok = await confirmDialog({
      title: '記録を削除',
      message: `${dateJa(entry.date)}「${entry.category || '記録'}」${yen(entry.amount)} を削除しますか？\n削除した操作は操作ログに残ります。`,
      confirmLabel: '削除',
      variant: 'danger',
    });
    if (!ok) return false;
    const done = await cb.deleteEntry(entry.id);
    if (done) showToast('記録を削除しました', 'success');
    return done;
  };

  // 編集フォームの「削除」: 消せたらフォームも閉じる
  const removeFromForm = async (entry) => {
    if (await removeEntry(entry)) setFormSession(null);
  };

  // 別の月・店舗の記録として保存したら、その月・店舗を開いて結果が見えるようにする
  const reveal = (payload) => {
    if (monthOf(payload.date) !== month) setMonth(monthOf(payload.date));
    if (storeId !== 'all' && payload.store !== storeId) setStoreId(payload.store);
  };

  const submitEntry = async (payload, editing) => {
    if (editing) {
      const ok = await cb.updateEntry(editing.id, payload);
      if (ok) {
        showToast('記録を更新しました', 'success');
        reveal(payload);
      }
      return ok;
    }
    const created = await cb.addEntry(payload);
    if (created) {
      showToast(`${payload.type === 'income' ? '入金' : '出金'} ${yen(payload.amount)} を記録しました`, 'success');
      reveal(payload);
    }
    return !!created;
  };

  const selectStoreCard = (id) => {
    if (storeId === id && canSelectAll) setStoreId('all');
    else setStoreId(id);
  };

  const confirmDailyClose = async (values, notes) => {
    const id = dailyClose.storeId;
    const ok = await cb.closeDay(today, id, values, notes);
    if (ok) showToast(`${storeName(id)}：${dateJa(today)}の日次締めが完了しました`, 'success');
    return ok;
  };

  const openCashCheck = (id) => setCashCheck({ key: Date.now(), storeId: id || '' });
  const openDailyClose = (id) => {
    if (cb.isDayClosed(today, id)) {
      showToast('本日は締め済みです', 'info');
      return;
    }
    setDailyClose({ key: Date.now(), storeId: id });
  };

  return (
    <div>
      <PageHeader
        title="出納帳"
        subtitle="現金の入出金・残高・日次締めを管理します"
        actions={<Button variant="primary" icon="plus" onClick={openNew} disabled={noStores} className="hidden sm:inline-flex">記帳する</Button>}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 sm:mb-5">
        {tab !== 'audit' ? <MonthPicker value={month} onChange={setMonth} max={thisMonth} /> : null}
        <StorePicker value={storeId} onChange={setStoreId} stores={stores} allowAll={canSelectAll} allLabel={allStoresLabel} />
        <SyncStatus
          className="ml-auto"
          lastSynced={cb.lastSynced}
          syncing={cb.syncing}
          saving={cb.saving}
          syncError={cb.syncError}
          onRefresh={() => { cb.refresh(); menu.refresh(); }}
        />
      </div>

      {cb.syncError && cb.lastSynced == null && !cb.loading && !unavailable ? (
        <Banner tone="warn" title="出納帳を読み込めませんでした" className="mb-4"
          action={<Button size="sm" variant="secondary" icon="refresh-cw" onClick={cb.refresh}>再試行</Button>}>
          この端末に保存されていた内容を表示しています。
        </Banner>
      ) : null}
      {noStores ? (
        <Banner tone="warn" className="mb-4">アクセスできる店舗がありません。管理者に確認してください。</Banner>
      ) : null}

      {storeId !== 'all' && tab !== 'reconcile' && !unavailable ? (
        <SalonOneImportNotice entries={visibleEntries} month={month} storeId={storeId} isDayClosed={cb.isDayClosed} onOpen={() => setTab('reconcile')} />
      ) : null}

      <Segmented value={tab} onChange={setTab} options={TABS} ariaLabel="出納帳の表示切り替え" className="mb-4" />

      {unavailable ? (
        <Card>
          <EmptyState
            icon="wifi-off"
            title="出納帳を表示できません"
            message={`${cb.syncError} 通信状況を確認して、もう一度お試しください。`}
            action={<Button variant="secondary" icon="refresh-cw" onClick={cb.refresh} loading={cb.syncing}>再試行</Button>}
          />
        </Card>
      ) : null}
      {!unavailable && tab === 'overview' ? (
        <OverviewTab
          balances={balances}
          scopeLabel={scopeLabel}
          month={month}
          monthSummary={monthSummary}
          stores={stores}
          scopeStores={scopeStores}
          storeId={storeId}
          onSelectStore={selectStoreCard}
          today={today}
          closeOf={cb.closeOf}
          recentCloses={recentCloses}
          storeName={storeName}
          onCashCheck={openCashCheck}
          onDailyClose={openDailyClose}
          loading={loading}
        />
      ) : null}
      {!unavailable && tab === 'entries' ? (
        <EntriesTab
          month={month}
          monthSummary={monthSummary}
          groups={groups}
          loading={loading}
          isDayClosed={cb.isDayClosed}
          showStore={storeId === 'all' && stores.length > 1}
          storeName={storeName}
          onEdit={openEdit}
          onDelete={removeEntry}
          onAdd={noStores ? null : openNew}
          onOpenMenu={openMenu}
        />
      ) : null}
      {!unavailable && tab === 'audit' ? (
        <AuditLogTab logs={cb.logs} storeId={storeId} storeName={storeName} showStore={storeId === 'all' && stores.length > 1} loading={cb.loading} />
      ) : null}
      {!unavailable && tab === 'reconcile' ? (
        <ReconcileTab entries={visibleEntries} month={month} storeId={storeId} stores={stores} storeName={storeName} onChooseStore={setStoreId}
          isDayClosed={cb.isDayClosed} onImport={cb.importSalonOneCash} />
      ) : null}

      {/* スマホは片手で押せる位置に記帳ボタンを置く（下のタブの上） */}
      <div className="h-16 sm:hidden" aria-hidden="true" />
      <button type="button" onClick={openNew} disabled={noStores}
        className="fixed right-4 z-30 flex h-14 items-center gap-2 rounded-full bg-brand-600 pl-5 pr-6 text-[15px] font-bold text-white shadow-pop transition-transform active:scale-[0.97] disabled:opacity-50 sm:hidden"
        style={{ bottom: 'calc(76px + env(safe-area-inset-bottom))' }}>
        <Icon name="plus" size={20} strokeWidth={2.4} />記帳する
      </button>

      {formSession ? (
        <EntryForm
          key={formSession.key}
          open={!menuOpen}
          session={formSession}
          onClose={closeForm}
          stores={stores}
          defaultStoreId={defaultStoreId}
          today={today}
          menu={menu}
          customerNames={customerNames}
          isDayClosed={cb.isDayClosed}
          storeName={storeName}
          onSubmit={submitEntry}
          onDelete={removeFromForm}
          onOpenMenuManager={openMenu}
        />
      ) : null}
      <MenuManager open={menuOpen} onClose={closeMenu} menu={menu} />
      {cashCheck ? (
        <CashCheckModal
          key={cashCheck.key}
          initialStoreId={cashCheck.storeId}
          stores={stores}
          byStore={balances.byStore}
          today={today}
          entries={visibleEntries}
          isDayClosed={cb.isDayClosed}
          storeName={storeName}
          onRecord={cb.addEntry}
          onImport={cb.importSalonOneCash}
          onClose={closeCashCheck}
        />
      ) : null}
      {dailyClose ? (
        <DailyCloseModal
          key={dailyClose.key}
          storeId={dailyClose.storeId}
          storeName={storeName}
          balance={balances.byStore.get(dailyClose.storeId)}
          today={today}
          entries={visibleEntries}
          onImport={cb.importSalonOneCash}
          onConfirm={confirmDailyClose}
          onClose={closeDailyClose}
        />
      ) : null}
    </div>
  );
}
