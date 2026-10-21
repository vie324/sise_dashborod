import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../../../../ui/primitives.jsx';
import Icon from '../../../../ui/Icon.jsx';
import { useMeasure } from '../../../../ui/charts.jsx';
import { Wordmark, Cover, Concerns, Cause, Approach, Future, Plans, Prices, Benefits, Offers, Summary } from './slides.jsx';

// ============================================================
// お客様へのご説明（全画面）
// ------------------------------------------------------------
// タブレットやスマホをお客様に向けて見せる画面。1枚ずつ大きく見せるスライド形式で、
// 「はじめに → コンセプト → 改善のイメージ → プラン → 特典 → まとめ」の順に進む。
//   次へ / 戻る: 下のボタン・左右のスワイプ・← → キー（Esc で閉じる）
//   章の名前を押すとその章へ移る（スタッフが説明の途中から始める時も）
// テーマに関係なく明るい配色で見せる（.theme-light）。文字の大きさは画面の大きさで決まる（.pz）。
// 開いている間は画面が暗くならないようにする（対応している端末だけ）。
// ============================================================

export const CHAPTERS = [
  { id: 'intro', label: 'はじめに', icon: 'hand-heart' },
  { id: 'concept', label: 'コンセプト', icon: 'sparkles' },
  { id: 'future', label: '改善のイメージ', short: '改善', icon: 'trending-up' },
  { id: 'plan', label: 'プラン', icon: 'tags' },
  { id: 'offer', label: '特典', icon: 'gift' },
  { id: 'summary', label: 'まとめ', icon: 'circle-check' },
];

export const SLIDES = [
  { id: 'cover', chapter: 'intro', title: 'はじめに', Component: Cover },
  { id: 'concerns', chapter: 'intro', title: 'お悩み', Component: Concerns },
  { id: 'cause', chapter: 'concept', title: 'なぜ繰り返すのか', Component: Cause },
  { id: 'approach', chapter: 'concept', title: "si'se のアプローチ", Component: Approach },
  { id: 'future', chapter: 'future', title: '改善のイメージ', Component: Future },
  { id: 'plans', chapter: 'plan', title: 'おすすめプラン', Component: Plans },
  { id: 'prices', chapter: 'plan', title: '料金プラン', Component: Prices },
  { id: 'benefits', chapter: 'offer', title: '会員のポイント', Component: Benefits },
  { id: 'offers', chapter: 'offer', title: '本日の特典', Component: Offers },
  { id: 'summary', chapter: 'summary', title: 'まとめ', Component: Summary },
];

/** 章の最初のスライド */
export const chapterStart = (chapterId) => (SLIDES.find((s) => s.chapter === chapterId) || SLIDES[0]).id;

const indexOf = (id) => Math.max(0, SLIDES.findIndex((s) => s.id === id));

const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
const canFullscreen = () => typeof document !== 'undefined' && !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);

// Safari（webkit*）は Promise を返さないので Promise.resolve で包む
function enterFullscreen(el) {
  const fn = el.requestFullscreen || el.webkitRequestFullscreen;
  return fn ? Promise.resolve(fn.call(el)) : Promise.resolve();
}
function exitFullscreen() {
  const fn = document.exitFullscreen || document.webkitExitFullscreen;
  if (!fn || !fullscreenElement()) return Promise.resolve();
  try { return Promise.resolve(fn.call(document)); } catch (e) { return Promise.reject(e); }
}

/** 開いている間は画面を消さない（Screen Wake Lock。対応していなければ何もしない） */
function useWakeLock(active) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return undefined;
    let lock = null;
    let released = false;
    const request = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
        if (released) lock.release().catch(() => {});
      } catch (_) { /* 省電力モードなどで断られたら諦める */ }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') request(); };
    request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (lock) lock.release().catch(() => {});
    };
  }, [active]);
}

const isTyping = (el) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

/**
 * @param {string} startAt 最初に見せるスライド（SLIDES の id）
 * @param {Object} ctx スライドに渡す内容（Counseling.jsx が組み立てる）
 */
export default function Presentation({ startAt = 'cover', ctx, onClose }) {
  const rootRef = useRef(null);
  const [index, setIndex] = useState(() => indexOf(startAt));
  const [dir, setDir] = useState(1);
  const [isFull, setIsFull] = useState(false);
  const [stageRef, stageWidth] = useMeasure();
  const slide = SLIDES[index];
  const last = SLIDES.length - 1;

  const goIndex = useCallback((next) => {
    setIndex((cur) => {
      const n = Math.min(last, Math.max(0, next));
      if (n !== cur) setDir(n > cur ? 1 : -1);
      return n;
    });
  }, [last]);
  const go = useCallback((id) => goIndex(indexOf(id)), [goIndex]);
  const next = useCallback(() => goIndex(index + 1), [goIndex, index]);
  const prev = useCallback(() => goIndex(index - 1), [goIndex, index]);

  // 開いた時: 背面のスクロールと操作を止め（inert）、フォーカスを移す。閉じたら元に戻す
  useEffect(() => {
    const before = document.activeElement;
    const overflow = document.body.style.overflow;
    const app = document.getElementById('root');
    document.body.style.overflow = 'hidden';
    if (app) app.inert = true;
    if (rootRef.current) rootRef.current.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
      if (app) app.inert = false;
      exitFullscreen().catch(() => {});
      if (before && before.focus) before.focus({ preventScroll: true });
    };
  }, []);

  useWakeLock(true);

  // キー操作
  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !(e.target && e.target.closest && e.target.closest('button')))) { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
      else if (e.key === 'Home') { e.preventDefault(); goIndex(0); }
      else if (e.key === 'End') { e.preventDefault(); goIndex(last); }
      else if (e.key === 'Escape' && !fullscreenElement()) { e.preventDefault(); onClose(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [next, prev, goIndex, last, onClose]);

  // 全画面の切り替え（対応している端末だけボタンを出す）
  useEffect(() => {
    const on = () => setIsFull(!!fullscreenElement());
    document.addEventListener('fullscreenchange', on);
    document.addEventListener('webkitfullscreenchange', on);
    return () => {
      document.removeEventListener('fullscreenchange', on);
      document.removeEventListener('webkitfullscreenchange', on);
    };
  }, []);
  const toggleFull = () => {
    (fullscreenElement() ? exitFullscreen() : enterFullscreen(rootRef.current)).catch(() => { /* 断られたらそのまま */ });
  };

  // スワイプ（指で左右に払う。縦のスクロールやボタンの操作とは区別する）
  const touch = useRef(null);
  const onPointerDown = (e) => {
    if (e.pointerType !== 'touch') return;
    touch.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  };
  const onPointerUp = (e) => {
    const t = touch.current;
    touch.current = null;
    if (!t || e.pointerType !== 'touch') return;
    const dx = e.clientX - t.x;
    const dy = e.clientY - t.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.4 || Date.now() - t.t > 800) return;
    if (dx < 0) next(); else prev();
  };

  const chapterIndex = CHAPTERS.findIndex((c) => c.id === slide.chapter);
  const slideCtx = { ...ctx, go, chartScale: stageWidth >= 900 ? 1.35 : stageWidth >= 640 ? 1.15 : 1 };
  const { Component } = slide;

  return createPortal(
    <div ref={rootRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="お客様へのご説明"
      className="theme-light pz fixed inset-0 z-[70] flex flex-col outline-none">
      {/* 背景のやわらかい光 */}
      <div className="pz-backdrop" aria-hidden="true" />

      <header className="relative z-10 flex items-center gap-[.8em] px-[1em] pt-[max(.6em,env(safe-area-inset-top))] sm:px-[1.5em]">
        <Wordmark width={4.6} />
        <span className="hidden h-[1.2em] w-px bg-line-strong sm:block" aria-hidden="true" />
        <span className="hidden truncate text-[.85em] font-semibold text-ink-2 sm:block">{slide.title}</span>
        <span className="ml-auto flex items-center gap-[.5em]">
          {ctx.guestName ? <span className="hidden rounded-full bg-white/80 px-[.9em] py-[.25em] text-[.82em] font-semibold text-ink-2 shadow-card md:inline">{ctx.guestName} 様</span> : null}
          <span className="pz-num text-[.8em] font-semibold text-muted" aria-live="polite">{index + 1} / {SLIDES.length}</span>
          {canFullscreen() ? (
            <button type="button" onClick={toggleFull} className="pz-icon-btn" aria-label={isFull ? '全画面を終わる' : '全画面で表示'} title={isFull ? '全画面を終わる' : '全画面で表示'}>
              <Icon name={isFull ? 'minimize' : 'maximize'} size="1.1em" />
            </button>
          ) : null}
          <button type="button" onClick={onClose} className="pz-icon-btn" aria-label="ご説明を閉じる" title="閉じる（Esc）">
            <Icon name="x" size="1.25em" />
          </button>
        </span>
      </header>

      <main ref={stageRef} className="relative z-0 min-h-0 flex-1" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { touch.current = null; }}>
        <section key={slide.id} aria-roledescription="スライド" aria-label={`${index + 1}枚目 ${slide.title}`}
          className={cx('absolute inset-0 overflow-y-auto overscroll-contain', dir > 0 ? 'pz-in-next' : 'pz-in-prev')}>
          <Component ctx={slideCtx} />
        </section>
      </main>

      <footer className="relative z-10 flex items-center gap-[.6em] px-[1em] pb-[max(.8em,env(safe-area-inset-bottom))] pt-[.4em] sm:gap-[1em] sm:px-[1.5em]">
        <button type="button" onClick={prev} disabled={index === 0} className="pz-nav-btn" aria-label="前へ">
          <Icon name="chevron-left" size="1.4em" />
        </button>
        <nav className="flex min-w-0 flex-1 items-stretch gap-[.3em]" aria-label="章">
          {CHAPTERS.map((c, i) => {
            const state = i < chapterIndex ? 'done' : i === chapterIndex ? 'current' : 'todo';
            return (
              <button key={c.id} type="button" onClick={() => go(chapterStart(c.id))} aria-current={state === 'current' ? 'step' : undefined} aria-label={c.label} title={c.label}
                className="group flex min-w-0 flex-1 flex-col items-center gap-[.35em] rounded-[.6em] px-[.2em] py-[.3em]">
                <span className={cx('h-[.32em] w-full rounded-full transition-colors duration-300',
                  state === 'todo' ? 'bg-line' : state === 'current' ? 'bg-brand-600' : 'bg-brand-300')} />
                <span className={cx('hidden max-w-full truncate text-[.72em] font-semibold md:block',
                  state === 'current' ? 'text-brand-700' : state === 'done' ? 'text-ink-2' : 'text-muted')}>
                  {c.short ? <><span className="lg:hidden">{c.short}</span><span className="hidden lg:inline">{c.label}</span></> : c.label}
                </span>
              </button>
            );
          })}
        </nav>
        {index < last ? (
          <button type="button" onClick={next} className="pz-nav-btn pz-nav-next" aria-label="次へ">
            <span className="hidden sm:inline">次へ</span><Icon name="chevron-right" size="1.4em" />
          </button>
        ) : (
          <button type="button" onClick={onClose} className="pz-nav-btn pz-nav-next" aria-label="ご説明を終わる">
            <span className="hidden sm:inline">終わる</span><Icon name="check" size="1.3em" />
          </button>
        )}
      </footer>
    </div>,
    document.body,
  );
}
