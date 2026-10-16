import { useCallback, useEffect, useRef, useState } from 'react';
import { cx } from '../../../ui/primitives.jsx';
import { POSTURE_CONNECTIONS, POSTURE_LM, VIEW_LABELS, isLowConfidence, mid, scoreColor, scoreColorOnDark, scoreLabel } from './scoring.js';
import { VIEW_CONNECTIONS, VIEW_POINTS, connectionItemKey, coverBox, isVisible, itemAnchor } from './overlay.js';
import { useLiveValue } from './poseCamera.js';

// ============================================================
// カメラ映像 / 撮影写真の表示枠（9:16）と、その上の重ね表示
// ------------------------------------------------------------
// 映像は object-fit: cover で枠いっぱいに表示する。ランドマークは元画像基準の
// 座標なので、元画像全体が来る矩形（stage）を計算してその中に骨格・ラベル・
// 修正ハンドルを置く（端末のカメラ比率が 9:16 でなくても位置がずれない）。
// ============================================================

function useElementSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize((prev) => (prev.w === r.width && prev.h === r.height ? prev : { w: r.width, h: r.height }));
    };
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    // 画面回転やウィンドウサイズの変更でも重ね表示を合わせ直す
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/**
 * @param {'idle'|'loading'|'live'|'captured'} phase
 * @param {(box: {width:number,height:number}) => React.ReactNode} renderStage  元画像と同じ座標系の重ね表示
 */
export default function PoseViewport({ videoRef, phase, image, renderStage, children, className = '', style }) {
  const boxRef = useRef(null);
  const box = useElementSize(boxRef);
  const [videoSize, setVideoSize] = useState({ w: 0, h: 0 });
  const [imageSize, setImageSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const v = videoRef && videoRef.current;
    if (!v) return undefined;
    const update = () => { if (v.videoWidth) setVideoSize({ w: v.videoWidth, h: v.videoHeight }); };
    v.addEventListener('loadedmetadata', update);
    v.addEventListener('resize', update);
    update();
    return () => {
      v.removeEventListener('loadedmetadata', update);
      v.removeEventListener('resize', update);
    };
  }, [videoRef]);

  const media = phase === 'captured' ? imageSize : videoSize;
  const stage = coverBox(media.w, media.h, box.w, box.h);
  const showStage = renderStage && (phase === 'live' || phase === 'captured') && stage.width > 0;

  return (
    <div ref={boxRef} className={cx('relative overflow-hidden rounded-2xl bg-[#101512] ring-1 ring-black/5 select-none dark:ring-white/10', className)} style={{ aspectRatio: '9 / 16', ...style }}>
      <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" style={{ display: phase === 'live' ? 'block' : 'none' }} />
      {phase === 'captured' && image ? (
        <img
          src={image}
          alt="撮影した写真"
          className="absolute inset-0 h-full w-full object-cover"
          onLoad={(e) => setImageSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />
      ) : null}
      {showStage ? (
        <div className="pointer-events-none absolute" style={{ left: stage.left, top: stage.top, width: stage.width, height: stage.height }}>
          {renderStage(stage)}
        </div>
      ) : null}
      {children}
    </div>
  );
}

// ------------------------------------------------------------
// 骨格
// ------------------------------------------------------------
const LINE = 'rgba(15,110,86,0.7)';

function Dot({ x, y }) {
  return <circle cx={x} cy={y} r="5" fill="#0F6E56" stroke="#fff" strokeWidth="1.5" />;
}

/**
 * @param {boolean} full  全身の骨格を描く（施術レポートのカメラ用）。false なら分析に使う線と点だけ
 * @param analysis        撮影後は各線を対応する項目のスコア色で塗る
 */
export function SkeletonSvg({ landmarks, viewMode, analysis, width, height, full = false }) {
  if (!landmarks || !width || !height) return null;
  const P = (l) => ({ x: l.x * width, y: l.y * height });
  const els = [];

  if (full) {
    POSTURE_CONNECTIONS.forEach(([a, b]) => {
      const la = landmarks[a];
      const lb = landmarks[b];
      if (!isVisible(la) || !isVisible(lb)) return;
      els.push(<line key={`c${a}-${b}`} x1={la.x * width} y1={la.y * height} x2={lb.x * width} y2={lb.y * height} stroke={LINE} strokeWidth="2.5" strokeLinecap="round" />);
    });
    Object.values(POSTURE_LM).forEach((idx) => {
      const l = landmarks[idx];
      if (isVisible(l)) els.push(<Dot key={`p${idx}`} {...P(l)} />);
    });
  } else if (viewMode === 'back') {
    const ls = landmarks[11];
    const rs = landmarks[12];
    const lh = landmarks[23];
    const rh = landmarks[24];
    const nose = landmarks[0];
    if (ls && rs && lh && rh) {
      const sm = mid(ls, rs);
      const hm = mid(lh, rh);
      const seg = (key, a, b, color, w) => (
        <line key={key} x1={a.x * width} y1={a.y * height} x2={b.x * width} y2={b.y * height} stroke={color} strokeWidth={w} strokeLinecap="round" />
      );
      const tri = 'rgba(15,110,86,0.85)';
      const spine = 'rgba(15,110,86,0.9)';
      els.push(seg('s1', ls, sm, tri, 2.5), seg('s2', rs, sm, tri, 2.5), seg('s3', ls, rs, tri, 2.5));
      els.push(seg('h1', lh, hm, tri, 2.5), seg('h2', rh, hm, tri, 2.5), seg('h3', lh, rh, tri, 2.5));
      const noseOk = nose && nose.visibility >= 0.5;
      if (noseOk) els.push(seg('sp0', nose, sm, spine, 3));
      els.push(seg('sp1', sm, hm, spine, 3));
      const pts = [];
      if (noseOk) pts.push(nose);
      [ls, rs, lh, rh].forEach((p) => { if (p.visibility >= 0.5) pts.push(p); });
      pts.push(sm, hm);
      pts.forEach((p, i) => els.push(<Dot key={`bp${i}`} {...P(p)} />));
    }
  } else {
    (VIEW_CONNECTIONS[viewMode] || []).forEach(([a, b]) => {
      const la = landmarks[a];
      const lb = landmarks[b];
      if (!isVisible(la) || !isVisible(lb)) return;
      let color = LINE;
      if (analysis) {
        const key = connectionItemKey(viewMode, a, b);
        const item = key ? analysis.items.find((i) => i.key === key) : null;
        color = scoreColor(item ? item.score : 80);
      }
      els.push(<line key={`c${a}-${b}`} x1={la.x * width} y1={la.y * height} x2={lb.x * width} y2={lb.y * height} stroke={color} strokeWidth="2.5" strokeLinecap="round" />);
    });
    (VIEW_POINTS[viewMode] || []).forEach((idx) => {
      const l = landmarks[idx];
      if (isVisible(l)) els.push(<Dot key={`p${idx}`} {...P(l)} />);
    });
  }

  // 体軸（正面のみ破線）
  if (full || viewMode === 'front') {
    const ls = landmarks[11];
    const rs = landmarks[12];
    const lh = landmarks[23];
    const rh = landmarks[24];
    if (ls && rs && lh && rh) {
      const sm = mid(ls, rs);
      const hm = mid(lh, rh);
      els.push(<line key="axis" x1={sm.x * width} y1={sm.y * height} x2={hm.x * width} y2={hm.y * height} stroke="rgba(255,255,255,0.7)" strokeWidth="2" strokeDasharray="6 4" />);
    }
  }

  return (
    <svg className="absolute inset-0 z-[3]" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {els}
    </svg>
  );
}

/** ライブ映像用（ランドマークが毎フレーム変わるので、この部品だけ再描画する） */
export function LiveSkeleton({ live, viewMode, width, height, full = false }) {
  const landmarks = useLiveValue(live, (s) => s.landmarks);
  return <SkeletonSvg landmarks={landmarks} viewMode={viewMode} width={width} height={height} full={full} />;
}

// ------------------------------------------------------------
// スコア表示（撮影後）
// ------------------------------------------------------------
export function TotalBadge({ total, viewMode }) {
  const color = scoreColor(total);
  const text = scoreColorOnDark(total);
  return (
    <div className="pointer-events-none absolute left-2 top-2 z-[4]">
      <div className="flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5" style={{ background: 'rgba(0,0,0,0.6)' }}>
        <div className="flex h-8 w-8 items-center justify-center rounded-full" style={{ border: `3px solid ${color}`, background: 'rgba(0,0,0,0.4)' }}>
          <span className="text-[13px] font-bold" style={{ color: text }}>{total}</span>
        </div>
        <div className="leading-tight">
          <div className="text-[10px] font-bold" style={{ color: text }}>{scoreLabel(total)}</div>
          <div className="text-[8px] text-white/60">{VIEW_LABELS[viewMode]}</div>
        </div>
      </div>
    </div>
  );
}

/** 各部位の近くにスコアと計測値を出す（stage 内に置く） */
export function ScoreLabels({ analysis, landmarks, viewMode }) {
  if (!analysis || !landmarks) return null;
  return analysis.items.map((item) => {
    const pos = itemAnchor(item, viewMode, landmarks);
    if (!pos) return null;
    const low = isLowConfidence(item);
    const color = low ? '#aaaaaa' : scoreColor(item.score);
    return (
      <div
        key={item.key}
        className="absolute z-[4]"
        style={{
          left: `${pos.x * 100}%`,
          top: `${pos.y * 100}%`,
          transform: pos.align === 'center' ? 'translate(-50%, -100%)' : 'translate(0, -50%)',
        }}
      >
        <div className="whitespace-nowrap rounded-md px-1.5 py-[3px]" style={{ background: 'rgba(0,0,0,0.7)', borderLeft: `3px solid ${color}` }}>
          <div className="flex items-center gap-1">
            <span className="text-[8px] leading-none text-white/80">{item.label}</span>
            <span className="text-[11px] font-bold leading-none" style={{ color: low ? color : scoreColorOnDark(item.score) }}>{low ? '—' : item.score}</span>
          </div>
          <div className="mt-px text-[7px] leading-[1.3] text-white/55">
            {item.value}{item.valueCm && !low ? ` / ${item.valueCm}` : ''}
          </div>
        </div>
      </div>
    );
  });
}

// ------------------------------------------------------------
// 方眼（6 列 × 8 行の正方形セル。青の中心線が枠の中心と重なる）
// ------------------------------------------------------------
export function GridOverlay() {
  return (
    <svg className="pointer-events-none absolute inset-0 z-[2] h-full w-full" viewBox="0 0 900 1600" preserveAspectRatio="none" aria-hidden="true">
      <rect x="60" y="280" width="780" height="1040" fill="none" stroke="rgba(220,40,40,0.6)" strokeWidth="3" />
      {[1, 2, 3, 4, 5].map((i) => <line key={`v${i}`} x1={60 + i * 130} y1="280" x2={60 + i * 130} y2="1320" stroke="rgba(220,40,40,0.45)" strokeWidth="1.5" />)}
      {[1, 2, 3, 4, 5, 6, 7].map((i) => <line key={`h${i}`} x1="60" y1={280 + i * 130} x2="840" y2={280 + i * 130} stroke="rgba(220,40,40,0.45)" strokeWidth="1.5" />)}
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <text key={`c${i}`} x={60 + (i - 1) * 130 + 65} y="1355" textAnchor="middle" fill="rgba(220,40,40,0.8)" fontSize="28" fontWeight="700">{i}</text>
      ))}
      {['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((c, i) => (
        <text key={`r${c}`} x="30" y={280 + i * 130 + 75} textAnchor="middle" fill="rgba(220,40,40,0.8)" fontSize="28" fontWeight="700">{c}</text>
      ))}
      <line x1="450" y1="280" x2="450" y2="1320" stroke="rgba(60,140,220,0.8)" strokeWidth="2.5" />
      <line x1="60" y1="800" x2="840" y2="800" stroke="rgba(60,140,220,0.8)" strokeWidth="2.5" />
    </svg>
  );
}

// ------------------------------------------------------------
// ライブ中のバッジ（LIVE + 端末の傾き）
// ------------------------------------------------------------
export function LiveBadge({ live, showTilt = false }) {
  const tilt = useLiveValue(live, (s) => s.tilt);
  let tiltView = null;
  if (showTilt && tilt) {
    const fb = tilt.beta - 90; // 縦持ちで 0° が理想
    const lr = tilt.gamma; // 左右の傾き 0° が理想
    const ok = Math.abs(fb) <= 3 && Math.abs(lr) <= 3;
    const warn = Math.abs(fb) <= 6 && Math.abs(lr) <= 6;
    const color = ok ? '#22c55e' : warn ? '#eab308' : '#ef4444';
    const bg = ok ? 'rgba(22,163,74,0.25)' : warn ? 'rgba(234,179,8,0.25)' : 'rgba(239,68,68,0.3)';
    tiltView = (
      <div className="rounded-xl px-2.5 py-1.5" style={{ background: bg, border: `1px solid ${color}66` }}>
        <div className="flex items-center gap-2 text-[10px] font-bold text-white">
          <span style={{ color }}>傾き</span>
          <span>前後 {fb > 0 ? '+' : ''}{fb}°</span>
          <span>左右 {lr > 0 ? '+' : ''}{lr}°</span>
        </div>
        {!ok && !warn ? <div className="mt-0.5 text-[9px] text-[#fca5a5]">カメラを水平にしてください</div> : null}
      </div>
    );
  }
  return (
    <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[#f87171]" />
        <span className="text-xs font-bold text-white">LIVE</span>
      </div>
      {tiltView}
    </div>
  );
}

// ------------------------------------------------------------
// ランドマークの手動修正（stage 内に置く）
// ------------------------------------------------------------
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function EditHandles({ landmarks, points, onMove }) {
  const layerRef = useRef(null);
  const [dragging, setDragging] = useState(null);
  const toNorm = (e) => {
    const r = layerRef.current.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  };
  const nudge = (idx, lm, e) => {
    const step = e.shiftKey ? 0.02 : 0.004;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    onMove(idx, clamp01(lm.x + d[0]), clamp01(lm.y + d[1]));
  };
  return (
    <div ref={layerRef} className="absolute inset-0 z-10">
      {points.map(({ idx, label }) => {
        const lm = landmarks[idx];
        if (!lm) return null;
        const active = dragging === idx;
        return (
          <div
            key={idx}
            role="button"
            tabIndex={0}
            aria-label={`${label}の位置（ドラッグまたは矢印キーで調整）`}
            className="pointer-events-auto absolute flex h-11 w-11 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-white"
            style={{
              left: `${lm.x * 100}%`,
              top: `${lm.y * 100}%`,
              transform: 'translate(-50%, -50%)',
              zIndex: active ? 20 : 11,
              touchAction: 'none',
              cursor: active ? 'grabbing' : 'grab',
              borderRadius: '50%',
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
              setDragging(idx);
            }}
            onPointerMove={(e) => {
              if (dragging !== idx) return;
              const p = toNorm(e);
              onMove(idx, p.x, p.y);
            }}
            onPointerUp={() => setDragging(null)}
            onPointerCancel={() => setDragging(null)}
            onKeyDown={(e) => nudge(idx, lm, e)}
          >
            <span
              className="flex items-center justify-center rounded-full transition-[width,height] duration-100"
              style={{
                width: active ? 28 : 22,
                height: active ? 28 : 22,
                border: `3px solid ${active ? '#FFD700' : '#FF6B6B'}`,
                background: active ? 'rgba(255,215,0,0.3)' : 'rgba(255,107,107,0.25)',
                boxShadow: active ? '0 0 12px rgba(255,215,0,0.7)' : '0 0 8px rgba(255,107,107,0.5)',
              }}
            >
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: active ? '#FFD700' : '#FF6B6B' }} />
            </span>
            <span className="pointer-events-none absolute -top-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded px-1.5 text-[9px] font-bold text-white" style={{ background: 'rgba(0,0,0,0.75)' }}>
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------
// 手書き（お客様への説明用。保存画像には含めない）
// ------------------------------------------------------------
const DRAW_W = 1080;
const DRAW_H = 1920;

function strokePath(ctx, path) {
  if (path.points.length < 2) return;
  ctx.beginPath();
  ctx.strokeStyle = path.color;
  ctx.lineWidth = path.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.moveTo(path.points[0].x, path.points[0].y);
  for (let i = 1; i < path.points.length; i++) ctx.lineTo(path.points[i].x, path.points[i].y);
  ctx.stroke();
}

export function DrawLayer({ paths, onCommit, color, lineWidth }) {
  const canvasRef = useRef(null);
  const current = useRef(null);

  const redraw = useCallback((list) => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    list.forEach((p) => strokePath(ctx, p));
  }, []);

  // 戻す・クリア・手書きモードに戻った時に描き直す
  useEffect(() => { redraw(paths); }, [paths, redraw]);

  const pos = (e) => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  };

  return (
    <canvas
      ref={canvasRef}
      width={DRAW_W}
      height={DRAW_H}
      className="absolute inset-0 z-[8] h-full w-full"
      style={{ touchAction: 'none', cursor: 'crosshair' }}
      onPointerDown={(e) => {
        e.preventDefault();
        if (e.currentTarget.setPointerCapture) e.currentTarget.setPointerCapture(e.pointerId);
        current.current = { points: [pos(e)], color, width: lineWidth };
      }}
      onPointerMove={(e) => {
        const p = current.current;
        if (!p) return;
        p.points.push(pos(e));
        const ctx = canvasRef.current.getContext('2d');
        strokePath(ctx, { ...p, points: p.points.slice(-2) });
      }}
      onPointerUp={() => {
        if (current.current) onCommit([...paths, current.current]);
        current.current = null;
      }}
      onPointerCancel={() => {
        if (current.current) onCommit([...paths, current.current]);
        current.current = null;
      }}
    />
  );
}
