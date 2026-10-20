import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, cx } from '../../../ui/primitives.jsx';
import Icon from '../../../ui/Icon.jsx';
import { useApp } from '../../../app/state.jsx';
import { yen } from '../../../lib/format.js';
import { monthOf } from '../../../../shared/dates.js';
import { recommendPlans, planByKey, planPricing } from '../../../../shared/counseling.js';
import { shareCustomerName, initialStaffName } from '../shared/prefill.js';
import { useTodayVisits } from './useCounseling.js';
import { VisitList, GuestCard, StorePicker, familyName } from './VisitPanel.jsx';
import Hearing from './Hearing.jsx';
import { primaryLineFor } from './Simulation.jsx';
import Presentation, { CHAPTERS, chapterStart } from './present/Presentation.jsx';

// ============================================================
// カウンセリング（新規のお客様）— スタッフの画面
// ------------------------------------------------------------
// 1. 本日のお客様: SalonOne の今日の予約から選ぶ（予約に無いお客様は手入力でも始められる）
// 2. ヒアリング＆プラン診断: お悩みと施術後の評価 → 3つのおすすめプラン
// 3. お客様に説明する: 全画面のご説明（コンセプト・改善のイメージ・プラン・特典・まとめ）を
//    お客様に向けて見せる。章を選んで途中から始めることもできる
// 途中で画面が再読み込みされても戻れるよう、選んだお客様とチェックはこの端末のタブの間だけ残す。
// ============================================================

const STORE_KEY = 'sise_counseling_store';
const STATE_KEY = 'sise_counseling_state_v2';
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

  // 見られない店舗が保存されていたら、ヘッダーで選んでいる店舗か最初の店舗にする
  useEffect(() => {
    if (!stores.length || stores.some((s) => String(s.id) === storeId)) return;
    const next = stores.find((s) => String(s.id) === appStoreId) || stores[0];
    setStoreIdState(String(next.id));
  }, [stores, storeId, appStoreId]);

  const ready = stores.some((s) => String(s.id) === storeId);
  const visits = useTodayVisits(ready ? storeId : null, active);

  // 選んだお客様とチェックをこのタブの間だけ残す
  useEffect(() => {
    try {
      sessionStorage.setItem(STATE_KEY, JSON.stringify({ storeId, guest, callName, concerns, feedbacks, overrideKey, activeLines }));
    } catch (_) { /* noop */ }
  }, [storeId, guest, callName, concerns, feedbacks, overrideKey, activeLines]);

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
  const selectVisit = (v) => startWith({ ...v, manual: false });
  const startManual = (name) => startWith({ id: `manual-${Date.now()}`, manual: true, customerName: name || null, isNew: true });
  const resetGuest = () => {
    setGuest(null);
    setCallName('');
    setConcerns({});
    setFeedbacks({});
    setOverrideKey('');
    setActiveLines(DEFAULT_LINES);
    shareCustomerName('');
  };

  // SalonOne の最新の状態（来店中・会計済み・ご契約）を選んだお客様にも映す
  const latest = guest && !guest.manual && visits.data && visits.data.visits
    ? visits.data.visits.find((v) => v.id === guest.id) : null;
  const shownGuest = latest ? { ...guest, ...latest, manual: false } : guest;

  const changeStore = (id) => {
    resetGuest();
    setStoreIdState(id);
    try { localStorage.setItem(STORE_KEY, id); } catch (_) { /* noop */ }
  };

  const { refreshNow } = visits;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await refreshNow(); } finally { setRefreshing(false); }
  }, [refreshNow]);

  // 画面右上の ⟳（全体の更新）でも取り直す
  useEffect(() => {
    const on = () => { if (ready) refresh(); };
    window.addEventListener('sise:refresh', on);
    return () => window.removeEventListener('sise:refresh', on);
  }, [ready, refresh]);

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
  };
  const pricing = planPricing(selectedPlan);

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
          <GuestCard guest={shownGuest} callName={callName} onCallName={changeCallName} onChange={resetGuest} onOpenTool={onOpenTool} />
        ) : (
          <VisitList res={visits} onSelect={selectVisit} onManual={startManual} onRefresh={refresh} refreshing={refreshing} />
        )}
      </Card>

      <Hearing concerns={concerns} feedbacks={feedbacks}
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
