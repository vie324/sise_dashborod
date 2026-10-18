import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Banner, Button, Card, Select, cx } from '../../../ui/primitives.jsx';
import Icon from '../../../ui/Icon.jsx';
import { showToast } from '../../../ui/feedback.jsx';
import { useApp } from '../../../app/state.jsx';
import { monthOf } from '../../../../shared/dates.js';
import { mapFormConcerns, recommendPlans, PLAN_CATALOG } from '../../../../shared/counseling.js';
import { shareCustomerName } from '../shared/prefill.js';
import { useCounselingStores, useRecentSheets, fetchSheet, searchSheets } from './useCounseling.js';
import { SheetList, CustomerSheet, NotConnected, sheetKey } from './SheetPanel.jsx';
import Hearing from './Hearing.jsx';
import Simulation, { primaryLineFor } from './Simulation.jsx';
import { ConceptPanel, PlanPrices, MemberBenefits, TodayOffers, PlanTips } from './PlanGuide.jsx';

// ============================================================
// カウンセリング（新規のお客様）
// ------------------------------------------------------------
// お客様が来店時に答えた Google フォームのカウンセリングシートを一覧に出し、
// 選ぶとお悩みがチェックに反映される（新しい回答は 30秒ごとに自動で届く）。
// ヒアリング → 改善シミュレーション → プラン選択 の順にお客様と一緒に見ていく。
// 途中で画面が再読み込みされても戻れるよう、選択とチェックはこの端末のタブの間だけ残す。
// ============================================================

const STORE_KEY = 'sise_counseling_store';
const STATE_KEY = 'sise_counseling_state_v1';
// 改善シミュレーションで最初に見せる線（おすすめの「月4回 → 月2回に切替」）
const DEFAULT_LINES = { l2: true };

function readState() {
  try {
    const s = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null');
    return s && typeof s === 'object' ? s : {};
  } catch (_) {
    return {};
  }
}

const STEPS = [
  { no: 1, label: 'ヒアリング', target: 'cs-hearing' },
  { no: 2, label: 'シミュレーション', target: 'cs-simulation' },
  { no: 3, label: 'プラン選択', target: 'cs-plans' },
];

function StepBar({ done, onReset }) {
  const go = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return (
    <div className="flex items-center gap-2">
      <ol className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-2xl border border-line bg-surface p-1.5 shadow-card">
        {STEPS.map((s, i) => {
          const state = done ? (s.no < 3 ? 'done' : 'active') : (s.no === 1 ? 'active' : 'todo');
          return (
            // スマホでは今のステップだけ名前を出す（3つとも出すと切れて読めない）
            <li key={s.no} className={cx('flex min-w-0 items-center gap-1', state === 'active' ? 'flex-1' : 'sm:flex-1')}>
              {i > 0 ? <span className={cx('h-px w-3 shrink-0 sm:w-6', done ? 'bg-brand-400' : 'bg-line')} aria-hidden="true" /> : null}
              <button type="button" onClick={() => go(s.target)} aria-current={state === 'active' ? 'step' : undefined} aria-label={`${s.no} ${s.label}`}
                className={cx('flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-1.5 text-xs font-semibold transition-colors',
                  state === 'active' ? 'bg-brand-600 text-white' : state === 'done' ? 'text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-500/15' : 'text-muted hover:bg-surface-2')}>
                <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
                  state === 'active' ? 'bg-white/25' : state === 'done' ? 'bg-brand-100 dark:bg-brand-500/25' : 'bg-surface-3')}>
                  {state === 'done' ? <Icon name="check" size={12} strokeWidth={3} /> : s.no}
                </span>
                <span className={cx('truncate', state !== 'active' && 'hidden sm:inline')}>{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <Button variant="ghost" size="sm" icon="rotate-ccw" onClick={onReset} className="shrink-0" aria-label="最初から">
        <span className="hidden sm:inline">最初から</span>
      </Button>
    </div>
  );
}

/**
 * @param {boolean} active 施術ツールでこのタブを開いているか（裏にある間は自動の読み直しを止める）
 * @param {(tool:string)=>void} [onOpenTool] 姿勢分析・施術レポートへ切り替える
 */
export default function Counseling({ active = true, onOpenTool }) {
  const { storeId: appStoreId, today } = useApp();
  const saved = useMemo(readState, []);
  const storesRes = useCounselingStores();
  const info = storesRes.shown;
  const linked = useMemo(() => (info ? info.stores.filter((s) => s.linked) : []), [info]);

  const [storeId, setStoreIdState] = useState(() => {
    try { return saved.storeId || localStorage.getItem(STORE_KEY) || ''; } catch (_) { return saved.storeId || ''; }
  });
  const [selected, setSelected] = useState(saved.selected || null); // { index, name }
  const [sheet, setSheet] = useState(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState(null);
  const [concerns, setConcerns] = useState(saved.concerns || {});
  const [feedbacks, setFeedbacks] = useState(saved.feedbacks || {});
  const [fromForm, setFromForm] = useState(saved.fromForm || {});
  const [overrideKey, setOverrideKey] = useState(saved.overrideKey || '');
  const [activeLines, setActiveLines] = useState(saved.activeLines || DEFAULT_LINES);
  const [showConcept, setShowConcept] = useState(false);
  const [search, setSearch] = useState(null); // { q, rows }
  const [searching, setSearching] = useState(false);
  const [arrived, setArrived] = useState(() => new Set());
  const [refreshing, setRefreshing] = useState(false);

  // 見られない店舗が保存されていたら、ヘッダーで選んでいる店舗か最初の店舗にする
  useEffect(() => {
    if (!info || linked.some((s) => s.id === storeId)) return;
    const next = linked.find((s) => s.id === appStoreId) || linked[0];
    setStoreIdState(next ? next.id : '');
  }, [info, linked, storeId, appStoreId]);

  const ready = !!(info && info.configured && linked.some((s) => s.id === storeId));
  const recent = useRecentSheets(ready ? storeId : null, active);
  const rows = recent.data ? recent.data.customers : null;

  // 選択・チェックをこのタブの間だけ残す
  useEffect(() => {
    try {
      sessionStorage.setItem(STATE_KEY, JSON.stringify({ storeId, selected, concerns, feedbacks, fromForm, overrideKey, activeLines }));
    } catch (_) { /* noop */ }
  }, [storeId, selected, concerns, feedbacks, fromForm, overrideKey, activeLines]);

  // ---- 選択 ----
  const requestRef = useRef(0);
  const loadSheet = useCallback(async (row, { keepChecks = false } = {}) => {
    const req = ++requestRef.current;
    setSelected({ index: row.index, name: row.name });
    setSheetError(null);
    setSheetLoading(true);
    if (!keepChecks) setSheet(null);
    try {
      const r = await fetchSheet(storeId, row);
      if (req !== requestRef.current) return;
      const { checked } = mapFormConcerns(r.customer.concerns);
      setSheet(r.customer);
      setFromForm(checked);
      if (!keepChecks) {
        // フォームのお悩みをチェックに反映（施術後の評価とプランの選び直しは消す）
        setConcerns(checked);
        setFeedbacks({});
        setOverrideKey('');
      }
      shareCustomerName(r.customer.name);
    } catch (e) {
      if (req === requestRef.current) setSheetError(e);
    } finally {
      if (req === requestRef.current) setSheetLoading(false);
    }
  }, [storeId]);

  const clearSelection = () => {
    requestRef.current += 1;
    setSelected(null);
    setSheet(null);
    setSheetError(null);
    setSheetLoading(false);
  };

  const resetAll = () => {
    clearSelection();
    setConcerns({});
    setFeedbacks({});
    setFromForm({});
    setOverrideKey('');
    setActiveLines(DEFAULT_LINES);
    setSearch(null);
    shareCustomerName('');
  };

  // 再読み込みの後: 選んでいたお客様を取り直す（チェックは残っているものを使う）
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !ready) return;
    restored.current = true;
    if (!selected) return;
    if (saved.storeId === storeId) loadSheet(selected, { keepChecks: true });
    else clearSelection();
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeStore = (id) => {
    resetAll();
    setArrived(new Set());
    setStoreIdState(id);
    try { localStorage.setItem(STORE_KEY, id); } catch (_) { /* noop */ }
  };

  // ---- 新しい回答が届いたら知らせる ----
  const seenRef = useRef({ storeId: null, keys: null });
  useEffect(() => {
    if (!rows) return;
    if (seenRef.current.storeId !== storeId || !seenRef.current.keys) {
      seenRef.current = { storeId, keys: new Set(rows.map(sheetKey)) };
      return;
    }
    const fresh = rows.filter((r) => !seenRef.current.keys.has(sheetKey(r)));
    if (fresh.length === 0) return;
    for (const r of fresh) seenRef.current.keys.add(sheetKey(r));
    setArrived((prev) => new Set([...prev, ...fresh.map(sheetKey)]));
    showToast(fresh.length === 1 ? `新しいカウンセリングシートが届きました（${fresh[0].name} 様）` : `新しいカウンセリングシートが${fresh.length}件届きました`, 'success', 6000);
  }, [rows, storeId]);

  // ---- 検索・読み直し ----
  const runSearch = async (q) => {
    setSearching(true);
    try {
      const r = await searchSheets(storeId, q);
      setSearch({ q, rows: r.customers });
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSearching(false);
    }
  };

  const { refreshNow } = recent;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await refreshNow(); } finally { setRefreshing(false); }
  }, [refreshNow]);

  // 画面右上の ⟳（全体の更新）でも取り直す
  const { reload: reloadStores } = storesRes;
  useEffect(() => {
    const on = () => { reloadStores(); if (ready) refresh(); };
    window.addEventListener('sise:refresh', on);
    return () => window.removeEventListener('sise:refresh', on);
  }, [ready, refresh, reloadStores]);

  // ---- 診断 ----
  const recommendation = useMemo(() => recommendPlans(concerns, feedbacks), [concerns, feedbacks]);
  useEffect(() => { if (!recommendation && overrideKey) setOverrideKey(''); }, [recommendation, overrideKey]);
  const selectedKey = overrideKey || (recommendation ? recommendation.take.key : '');
  const selectedPlan = PLAN_CATALOG.find((p) => p.key === selectedKey) || null;
  const recFreq = selectedPlan ? selectedPlan.freq : 0;

  // 選んだプランの通い方の線を表示する
  useEffect(() => {
    const id = primaryLineFor(recFreq);
    if (id) setActiveLines((prev) => (prev[id] ? prev : { ...prev, [id]: true }));
  }, [recFreq]);

  const toggle = (setter) => (id) => setter((prev) => ({ ...prev, [id]: !prev[id] }));

  // ---- 表示 ----
  const errorCode = recent.error && recent.error.code;
  const storeName = (linked.find((s) => s.id === storeId) || {}).name;
  let sheetBody;
  if (!info) {
    sheetBody = storesRes.error ? <Banner tone="bad" title="読み込めませんでした">{storesRes.error.message}</Banner> : <div className="h-24 animate-pulse rounded-xl bg-surface-3" />;
  } else if (!info.configured) {
    sheetBody = <NotConnected canConfigure={info.canConfigure} />;
  } else if (linked.length === 0 || errorCode === 'not_linked') {
    sheetBody = <NotConnected canConfigure={info.canConfigure} reason="not_linked" />;
  } else if (selected) {
    sheetBody = (
      <>
        {sheetError ? (
          <Banner tone="bad" title="シートを開けませんでした" className="mb-3"
            action={<Button size="sm" icon="refresh-cw" onClick={() => loadSheet(selected, { keepChecks: true })}>もう一度</Button>}>
            {sheetError.message}
          </Banner>
        ) : null}
        <CustomerSheet sheet={sheet} loading={sheetLoading} onChange={clearSelection} onOpenTool={onOpenTool} />
        {!sheet && sheetError ? <Button size="sm" variant="ghost" icon="arrow-left" onClick={clearSelection}>一覧に戻る</Button> : null}
      </>
    );
  } else {
    sheetBody = (
      <SheetList rows={rows} loading={recent.loading} error={recent.error} arrived={arrived}
        onSelect={(row) => loadSheet(row)} onSearch={runSearch} searching={searching} searchResult={search} onClearSearch={() => setSearch(null)}
        fetchedAt={recent.data ? recent.data.fetchedAt : null} onRefresh={refresh} refreshing={refreshing} />
    );
  }

  return (
    <div className="space-y-4">
      <Card title="カウンセリングシート" icon="clipboard-check"
        subtitle={selected ? null : 'お客様が Google フォームで答えた内容が届きます。選ぶとお悩みがチェックに反映されます'}
        actions={linked.length > 1 ? (
          <Select value={storeId} onChange={(e) => changeStore(e.target.value)} aria-label="店舗" className="h-9 w-auto max-w-[11rem] py-1 text-[13px]">
            {linked.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        ) : storeName ? <Badge tone="brand" icon="store">{storeName}</Badge> : null}>
        {sheetBody}
      </Card>

      <StepBar done={!!recommendation} onReset={resetAll} />

      <div id="cs-hearing" className="scroll-mt-20">
        <Hearing concerns={concerns} feedbacks={feedbacks} fromForm={fromForm}
          onToggleConcern={toggle(setConcerns)} onToggleFeedback={toggle(setFeedbacks)}
          recommendation={recommendation} selectedKey={selectedKey} overrideKey={overrideKey} onSelectPlan={setOverrideKey} />
      </div>

      <div className="flex justify-end">
        <Button variant={showConcept ? 'subtle' : 'ghost'} size="sm" icon="circle-help" onClick={() => setShowConcept((v) => !v)} aria-expanded={showConcept}>
          コンセプト説明
        </Button>
      </div>
      {showConcept ? <ConceptPanel /> : null}

      <div id="cs-simulation" className="scroll-mt-20">
        <Simulation active={activeLines} onToggle={toggle(setActiveLines)} recFreq={recFreq} startMonth={monthOf(today)} />
      </div>

      <div id="cs-plans" className="scroll-mt-20">
        <PlanPrices recommended={selectedPlan ? { id: selectedPlan.id, freq: selectedPlan.freq } : null} />
      </div>
      <MemberBenefits />
      <TodayOffers />
      <PlanTips />
    </div>
  );
}
