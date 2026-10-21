import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, cx } from '../../../ui/primitives.jsx';
import Icon from '../../../ui/Icon.jsx';
import { showToast } from '../../../ui/feedback.jsx';
import { useApp } from '../../../app/state.jsx';
import { yen } from '../../../lib/format.js';
import { monthOf } from '../../../../shared/dates.js';
import {
  recommendPlans, planByKey, planPricing, mapFormConcerns, linkSheetsToVisits, visitForSheet,
} from '../../../../shared/counseling.js';
import { shareCustomerName, initialStaffName } from '../shared/prefill.js';
import { useTodayVisits, useSheetStores, useRecentSheets, fetchSheet, searchSheets } from './useCounseling.js';
import { VisitList, GuestCard, StorePicker, familyName } from './VisitPanel.jsx';
import { SheetCard, sheetKey } from './SheetPanel.jsx';
import Hearing from './Hearing.jsx';
import { primaryLineFor } from './Simulation.jsx';
import Presentation, { CHAPTERS, chapterStart } from './present/Presentation.jsx';

// ============================================================
// カウンセリング（新規のお客様）— スタッフの画面
// ------------------------------------------------------------
// 1. 本日のお客様: SalonOne の今日の予約から選ぶ（予約に無いお客様は手入力でも始められる）
//    Google フォームでカウンセリングシートを取っている店舗は、同じお名前の回答を予約に結びつけ、
//    選ぶとフォームのお悩みがチェックに入り、記入内容（施術前の確認・ご要望・目標時期など）が大きく出る
// 2. ヒアリング＆プラン診断: お悩みと施術後の評価 → 3つのおすすめプラン
// 3. お客様に説明する: 全画面のご説明（コンセプト・改善のイメージ・プラン・特典・まとめ）を
//    お客様に向けて見せる。章を選んで途中から始めることもできる
// 途中で画面が再読み込みされても戻れるよう、選んだお客様とチェックはこの端末のタブの間だけ残す。
// ============================================================

const STORE_KEY = 'sise_counseling_store';
const STATE_KEY = 'sise_counseling_state_v2';
/** フォームの回答への参照（一覧の 1行から。中身は fetchSheet で取り直す） */
const sheetRef = (row) => (row ? { index: row.index, name: row.name, submittedAt: row.submittedAt || null } : null);
// 改善のイメージで最初に見せる線（おすすめの「月4回 → 月2回に切替」と「施術1回のみ」）
const DEFAULT_LINES = { l2: true, l6: true };

function readState() {
  try {
    const s = JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null');
    return s && typeof s === 'object' ? s : {};
  } catch (_) {
    return {};
  }
}

const CHAPTER_HINTS = {
  intro: 'ごあいさつ・お悩みの確認',
  concept: 'なぜ繰り返すのか・si\'se のアプローチ',
  future: '通い方ごとの改善のイメージ',
  plan: 'おすすめプラン・料金プラン',
  offer: '会員のポイント・本日の特典',
  summary: 'お選びいただいたプラン',
};

/** 章を選んでご説明を始める */
function Launcher({ onOpen, ready }) {
  return (
    <Card title="お客様へのご説明" icon="presentation"
      subtitle="タブレットやスマホをお客様に向けて、大きな画面でご説明できます。章を選ぶと途中から始められます">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {CHAPTERS.map((c, i) => (
          <button key={c.id} type="button" onClick={() => onOpen(chapterStart(c.id))}
            className="group flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-3 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/50 dark:hover:bg-brand-500/10">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 transition-colors group-hover:bg-brand-600 group-hover:text-white dark:bg-brand-500/15 dark:text-brand-200">
              <Icon name={c.icon} size={19} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-ink"><span className="num mr-1 text-muted">{i + 1}</span>{c.label}</span>
              <span className="block truncate text-xs text-muted">{CHAPTER_HINTS[c.id]}</span>
            </span>
            <Icon name="circle-play" size={18} className="shrink-0 text-muted transition-colors group-hover:text-brand-600" />
          </button>
        ))}
      </div>
      {!ready ? (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-xs text-muted">
          <Icon name="info" size={14} />お悩みを選ぶと、ご説明の「プラン」「まとめ」がお客様に合わせた内容になります（ご説明の画面でお客様にタップしていただくこともできます）
        </p>
      ) : null}
    </Card>
  );
}

/**
 * @param {boolean} active 施術ツールでこのタブを開いているか（裏にある間は自動の読み直しを止める）
 * @param {(tool:string)=>void} [onOpenTool] 姿勢分析・施術レポートへ切り替える
 */
export default function Counseling({ active = true, onOpenTool }) {
  const { storeId: appStoreId, stores, today } = useApp();
  const saved = useMemo(readState, []);

  const [storeId, setStoreIdState] = useState(() => {
    try { return saved.storeId || localStorage.getItem(STORE_KEY) || ''; } catch (_) { return saved.storeId || ''; }
  });
  const [guest, setGuest] = useState(saved.guest || null);
  const [callName, setCallName] = useState(saved.callName || '');
  const [concerns, setConcerns] = useState(saved.concerns || {});
  const [feedbacks, setFeedbacks] = useState(saved.feedbacks || {});
  const [overrideKey, setOverrideKey] = useState(saved.overrideKey || '');
  const [activeLines, setActiveLines] = useState(saved.activeLines || DEFAULT_LINES);
  const [presentAt, setPresentAt] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  // カウンセリングシート（Google フォームの店舗だけ）
  const [appliedSheet, setAppliedSheet] = useState(saved.appliedSheet || '');
  const [sheet, setSheet] = useState(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState(null);
  const [sheetTick, setSheetTick] = useState(0);
  const [search, setSearch] = useState(null); // { q, rows }
  const [searching, setSearching] = useState(false);
  const [arrived, setArrived] = useState(() => new Set());

  // 見られない店舗が保存されていたら、ヘッダーで選んでいる店舗か最初の店舗にする
  useEffect(() => {
    if (!stores.length || stores.some((s) => String(s.id) === storeId)) return;
    const next = stores.find((s) => String(s.id) === appStoreId) || stores[0];
    setStoreIdState(String(next.id));
  }, [stores, storeId, appStoreId]);

  const ready = stores.some((s) => String(s.id) === storeId);
  const visits = useTodayVisits(ready ? storeId : null, active);
  const visitRows = useMemo(() => (visits.data && visits.data.visits) || [], [visits.data]);

  // Google フォーム（GAS）とつないでいる店舗だけ、回答を読む
  const sheetStores = useSheetStores();
  const formInfo = sheetStores.shown;
  const formLinked = !!(ready && formInfo && formInfo.configured && formInfo.stores.some((x) => x.id === storeId && x.linked));
  const recentSheets = useRecentSheets(formLinked ? storeId : null, active);
  const sheetRows = recentSheets.data ? recentSheets.data.customers : null;
  // 予約 ↔ 同じお名前の回答（3日前までの回答）
  const links = useMemo(() => (formLinked && sheetRows ? linkSheetsToVisits(visitRows, sheetRows, { today }) : {}), [formLinked, sheetRows, visitRows, today]);
  // 回答 → 結びついた今日の予約（「フォームの回答」の一覧の「今日 ◯時 予約」。予約の一覧の「シートあり」と同じ結びつき）
  const linkedVisits = useMemo(() => {
    const m = new Map();
    for (const v of visitRows) if (links[v.id]) m.set(sheetKey(links[v.id]), v);
    return m;
  }, [links, visitRows]);

  // 選んだお客様とチェックをこのタブの間だけ残す
  useEffect(() => {
    try {
      sessionStorage.setItem(STATE_KEY, JSON.stringify({ storeId, guest, callName, concerns, feedbacks, overrideKey, activeLines, appliedSheet }));
    } catch (_) { /* noop */ }
  }, [storeId, guest, callName, concerns, feedbacks, overrideKey, activeLines, appliedSheet]);

  // ---- お客様 ----
  const startWith = (g) => {
    const name = g.customerName || '';
    setGuest(g);
    setCallName(familyName(name));
    // 別のお客様に替えた時はチェックを消す
    if (!guest || guest.id !== g.id) {
      setConcerns({});
      setFeedbacks({});
      setOverrideKey('');
      setActiveLines(DEFAULT_LINES);
    }
    shareCustomerName(name);
  };
  // SalonOne からお名前が来ないお客様は、手で入れたお名前を姿勢分析・施術レポートにも渡す
  const changeCallName = (v) => {
    setCallName(v);
    if (guest && !guest.customerName) shareCustomerName(v.trim());
  };
  const selectVisit = (v) => startWith({ ...v, manual: false, sheet: sheetRef(links[v.id]) });
  // フォームの回答から選ぶ: 同じお名前の今日の予約があれば、その予約のお客様として始める（前の回答を選んだ時も）
  const selectSheet = (row) => {
    const v = linkedVisits.get(sheetKey(row)) || visitForSheet(visitRows, row);
    startWith(v
      ? { ...v, manual: false, sheet: sheetRef(row) }
      : { id: `form-${sheetKey(row)}`, manual: false, formOnly: true, customerName: row.name, isNew: true, sheet: sheetRef(row) });
  };
  const startManual = (name) => startWith({ id: `manual-${Date.now()}`, manual: true, customerName: name || null, isNew: true });
  const resetGuest = () => {
    setGuest(null);
    setCallName('');
    setConcerns({});
    setFeedbacks({});
    setOverrideKey('');
    setActiveLines(DEFAULT_LINES);
    setAppliedSheet('');
    shareCustomerName('');
  };

  // SalonOne の最新の状態（来店中・会計済み・ご契約）を選んだお客様にも映す
  const latest = guest && !guest.manual && !guest.formOnly ? visitRows.find((v) => v.id === guest.id) : null;
  const shownGuest = latest ? { ...guest, ...latest, manual: false } : guest;
  // 選んだ後に届いた、同じお名前の回答（「反映する」で結びつける）
  const pendingSheet = guest && !guest.sheet && !guest.manual ? links[guest.id] || null : null;
  const attachSheet = () => { if (pendingSheet) setGuest((g) => ({ ...g, sheet: sheetRef(pendingSheet) })); };

  // ---- カウンセリングシートの中身 ----
  // 初めて開いた回答だけ、フォームのお悩みをチェックに足す（付けたチェック・外したチェックは消さない）
  const guestSheetKey = guest && guest.sheet ? `${storeId}|${sheetKey(guest.sheet)}` : '';
  const appliedRef = useRef(appliedSheet);
  appliedRef.current = appliedSheet;
  useEffect(() => {
    if (!guestSheetKey || !guest || !guest.sheet) { setSheet(null); setSheetError(null); setSheetLoading(false); return undefined; }
    let alive = true;
    setSheetLoading(true);
    setSheetError(null);
    fetchSheet(storeId, guest.sheet).then((r) => {
      if (!alive) return;
      setSheet(r.customer);
      if (appliedRef.current !== guestSheetKey) {
        const { checked } = mapFormConcerns(r.customer.concerns);
        setConcerns((prev) => ({ ...prev, ...checked }));
        setAppliedSheet(guestSheetKey);
      }
    }).catch((e) => { if (alive) setSheetError(e); })
      .finally(() => { if (alive) setSheetLoading(false); });
    return () => { alive = false; };
  }, [guestSheetKey, sheetTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const fromForm = useMemo(() => (sheet ? mapFormConcerns(sheet.concerns).checked : {}), [sheet]);

  // ---- 新しい回答が届いたら知らせる ----
  const seenRef = useRef({ storeId: null, keys: null });
  useEffect(() => {
    if (!sheetRows) return;
    if (seenRef.current.storeId !== storeId || !seenRef.current.keys) {
      seenRef.current = { storeId, keys: new Set(sheetRows.map(sheetKey)) };
      return;
    }
    const fresh = sheetRows.filter((r) => !seenRef.current.keys.has(sheetKey(r)));
    if (fresh.length === 0) return;
    for (const r of fresh) seenRef.current.keys.add(sheetKey(r));
    setArrived((prev) => new Set([...prev, ...fresh.map(sheetKey)]));
    showToast(fresh.length === 1 ? `カウンセリングシートが届きました（${fresh[0].name} 様）` : `カウンセリングシートが${fresh.length}件届きました`, 'success', 6000);
  }, [sheetRows, storeId]);

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

  const changeStore = (id) => {
    resetGuest();
    setSearch(null);
    setArrived(new Set());
    setStoreIdState(id);
    try { localStorage.setItem(STORE_KEY, id); } catch (_) { /* noop */ }
  };

  const { refreshNow } = visits;
  const { refreshNow: refreshSheetsNow } = recentSheets;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await Promise.all([refreshNow(), formLinked ? refreshSheetsNow() : null]); } finally { setRefreshing(false); }
  }, [refreshNow, refreshSheetsNow, formLinked]);

  // 画面右上の ⟳（全体の更新）でも取り直す
  const { reload: reloadSheetStores } = sheetStores;
  useEffect(() => {
    const on = () => { reloadSheetStores(); if (ready) refresh(); };
    window.addEventListener('sise:refresh', on);
    return () => window.removeEventListener('sise:refresh', on);
  }, [ready, refresh, reloadSheetStores]);

  // ---- 診断 ----
  const recommendation = useMemo(() => recommendPlans(concerns, feedbacks), [concerns, feedbacks]);
  // 料金表から無くなったプランが残っていたら（以前の保存など）おすすめに戻す
  useEffect(() => { if (overrideKey && !planByKey(overrideKey)) setOverrideKey(''); }, [overrideKey]);
  const selectedKey = overrideKey || (recommendation ? recommendation.take.key : '');
  const selectedPlan = planByKey(selectedKey);
  const primaryLine = primaryLineFor(selectedPlan ? selectedPlan.freq : 0) || 'l2';

  // 選んだプランの通い方の線を表示する
  useEffect(() => {
    if (primaryLine) setActiveLines((prev) => (prev[primaryLine] ? prev : { ...prev, [primaryLine]: true }));
  }, [primaryLine]);

  const toggle = (setter) => (id) => setter((prev) => ({ ...prev, [id]: !prev[id] }));
  // おすすめと同じプランを選んだら「自動」に戻す（お悩みを変えた時におすすめに付いていく）
  const selectPlan = (key) => setOverrideKey(recommendation && recommendation.take.key === key ? '' : key);

  const name = callName.trim();
  const ctx = {
    guestName: name,
    honor: name ? `${name} 様` : 'お客様',
    staffName: (shownGuest && shownGuest.staffName) || initialStaffName(),
    date: today,
    startMonth: monthOf(today),
    concerns,
    onToggleConcern: toggle(setConcerns),
    recommendation,
    selectedKey,
    selectedPlan,
    onSelectPlan: selectPlan,
    activeLines,
    onToggleLine: toggle(setActiveLines),
    primaryLine,
    // お客様に見せてよい記入内容だけ（施術前の確認・年齢・住所などは渡さない）
    voice: sheet ? { concerns: sheet.concerns || [], timeline: sheet.improvementTimeline || '', request: sheet.treatmentRequest || '' } : null,
  };
  const pricing = planPricing(selectedPlan);
  const formProps = formLinked ? {
    res: recentSheets,
    rows: sheetRows,
    arrived,
    visitOf: (row) => linkedVisits.get(sheetKey(row)) || null,
    onSelect: selectSheet,
    onSearch: runSearch,
    searching,
    searchResult: search,
    onClearSearch: () => setSearch(null),
    onRefresh: refresh,
  } : null;

  return (
    <div className="space-y-4">
      <Card title="本日のお客様" icon="calendar-check"
        subtitle={guest ? null : 'SalonOne の今日の予約から、ご説明するお客様を選びます'}
        actions={(
          <>
            {visits.shown && visits.shown.mode === 'demo' ? <Badge tone="gold" icon="flask-conical">デモ</Badge> : null}
            <StorePicker stores={stores.map((s) => ({ id: String(s.id), name: s.name }))} value={storeId} onChange={changeStore} />
          </>
        )}>
        {guest ? (
          <GuestCard guest={shownGuest} callName={callName} onCallName={changeCallName} onChange={resetGuest} onOpenTool={onOpenTool}
            pendingSheet={pendingSheet} onAttachSheet={attachSheet} />
        ) : (
          <VisitList res={visits} links={links} form={formProps} onSelect={selectVisit} onManual={startManual} onRefresh={refresh} refreshing={refreshing} />
        )}
      </Card>

      {guest && guest.sheet ? (
        <SheetCard sheet={sheet} loading={sheetLoading} error={sheetError} onRetry={() => setSheetTick((n) => n + 1)} />
      ) : null}

      <Hearing concerns={concerns} feedbacks={feedbacks} fromForm={fromForm}
        onToggleConcern={toggle(setConcerns)} onToggleFeedback={toggle(setFeedbacks)}
        recommendation={recommendation} selectedKey={selectedKey} overrideKey={overrideKey} onSelectPlan={selectPlan} />

      <Launcher onOpen={setPresentAt} ready={!!recommendation} />

      {/* いつでもご説明を始められるよう、画面の下に固定する（スマホは下のメニューの上） */}
      <div className="no-print sticky bottom-[calc(76px_+_env(safe-area-inset-bottom))] z-30 lg:bottom-4">
        <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface/95 p-2 pl-3 shadow-pop backdrop-blur sm:gap-3 sm:pl-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-bold text-ink">{ctx.honor}{shownGuest && shownGuest.time ? <span className="ml-1.5 text-xs font-medium text-muted">{shownGuest.time}</span> : null}</div>
            <div className={cx('truncate text-xs', selectedPlan ? 'text-brand-700 dark:text-brand-300' : 'text-muted')}>
              {selectedPlan ? `${overrideKey ? '選択' : 'おすすめ'}: ${selectedPlan.name} ${selectedPlan.freqLabel}　${yen(pricing.price)}/月` : 'お悩みを選ぶとおすすめプランが出ます'}
            </div>
          </div>
          <Button variant="secondary" icon="tags" onClick={() => setPresentAt('plans')} className="hidden sm:inline-flex">プランから</Button>
          <Button variant="primary" size="lg" icon="presentation" onClick={() => setPresentAt('cover')} className="px-4">
            <span className="sm:hidden">説明する</span><span className="hidden sm:inline">お客様に説明する</span>
          </Button>
        </div>
      </div>

      {presentAt ? <Presentation startAt={presentAt} ctx={ctx} onClose={() => setPresentAt(null)} /> : null}
    </div>
  );
}
