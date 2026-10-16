import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// ============================================================
// 動き（数字のカウントアップ・達成時の紙吹雪）
// ------------------------------------------------------------
// どちらも「視差効果を減らす」設定の端末では動かさず、最終状態だけを出す。
// ============================================================

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const easeOutCubic = (t) => 1 - (1 - t) ** 3;

/**
 * 値が変わったら前の値から新しい値へ数字を動かす（初回は 0 から）。
 * 金額のように「増えた」ことが伝わってほしい数字に使う。
 */
export function useCountUp(value, { duration = 800 } = {}) {
  const target = Number.isFinite(Number(value)) ? Number(value) : 0;
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? target : 0));
  const fromRef = useRef(shown);
  const frameRef = useRef(0);

  useEffect(() => {
    if (prefersReducedMotion()) { setShown(target); fromRef.current = target; return undefined; }
    const from = fromRef.current;
    if (from === target) return undefined;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const v = from + (target - from) * easeOutCubic(t);
      setShown(t < 1 ? v : target);
      fromRef.current = t < 1 ? v : target;
      if (t < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [target, duration]);

  return shown;
}

export function CountUp({ value, format = (v) => String(Math.round(v)), duration }) {
  const v = useCountUp(value, { duration });
  // 読み上げは最終値だけ（途中の数字を読み上げさせない）
  return (
    <>
      <span aria-hidden="true">{format(v)}</span>
      <span className="sr-only">{format(value)}</span>
    </>
  );
}

// ------------------------------------------------------------
// 紙吹雪（ランクアップなどの達成時に 1回だけ）
// ------------------------------------------------------------
const CONFETTI_COLORS = ['#2f8559', '#4fa277', '#aed9bf', '#c98a14', '#ecbf4f', '#f4d88c', '#ffffff'];

export function Confetti({ fire, onDone, pieces = 140 }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!fire) return undefined;
    if (prefersReducedMotion()) { onDone && onDone(); return undefined; }
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    // 画面上部の左右 2か所から打ち上げる
    const parts = Array.from({ length: pieces }, (_, i) => {
      const left = i % 2 === 0;
      const angle = (left ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.9;
      const speed = 9 + Math.random() * 8;
      return {
        x: left ? w * 0.18 : w * 0.82,
        y: h * 0.42,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 5 + Math.random() * 6,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.35,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        shape: i % 3,
      };
    });
    const start = performance.now();
    let frame = 0;
    const draw = (now) => {
      const elapsed = now - start;
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.vy += 0.32;
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, 1 - elapsed / 2600);
        ctx.fillStyle = p.color;
        if (p.shape === 0) ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        else if (p.shape === 1) { ctx.beginPath(); ctx.arc(0, 0, p.size / 2.6, 0, Math.PI * 2); ctx.fill(); }
        else { ctx.beginPath(); ctx.moveTo(0, -p.size / 2); ctx.lineTo(p.size / 2, p.size / 2); ctx.lineTo(-p.size / 2, p.size / 2); ctx.closePath(); ctx.fill(); }
        ctx.restore();
      }
      if (elapsed < 2600) frame = requestAnimationFrame(draw);
      else { ctx.clearRect(0, 0, w, h); onDone && onDone(); }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [fire]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!fire) return null;
  return createPortal(
    <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-[70] h-full w-full" aria-hidden="true" />,
    document.body,
  );
}
