import { useEffect, useMemo, useRef, useState } from 'react';
import { cx } from './primitives.jsx';

// ============================================================
// 軽量チャート（SVG）
// ------------------------------------------------------------
// データ可視化ガイドの仕様に合わせている:
//   線 2px / 面は同色 10% の塗り / 棒は最大 24px・先端 4px の角丸・基線は直角
//   グリッドと軸は 1px の実線で控えめに / 目標線はグレー / 予測だけ破線
//   ホバー（タップ）で十字線とツールチップ。値は表でも確認できるようにする
// 色は CSS 変数（--chart-*）なのでライト/ダークで自動的に切り替わる。
// ============================================================

export function useMeasure() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** 0 から始まるきりのいい目盛り */
export function niceTicks(maxValue, count = 4) {
  const max = Math.max(1, maxValue);
  const rough = max / count;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) || pow * 10;
  const ticks = [];
  for (let v = 0; v <= max + step * 0.0001; v += step) ticks.push(Math.round(v));
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function Tooltip({ x, y, width, children }) {
  // 右端・左端ではみ出さないように寄せる
  const left = Math.min(Math.max(x, 70), Math.max(70, width - 70));
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-line bg-surface px-2.5 py-2 text-[11px] leading-snug text-ink shadow-pop"
      style={{ left, top: Math.max(y, 8) }}
    >
      {children}
    </div>
  );
}

function TooltipRow({ color, dashed, label, value }) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <svg width="12" height="4" aria-hidden="true">
        <line x1="0" y1="2" x2="12" y2="2" stroke={color} strokeWidth="2" strokeDasharray={dashed ? '3 2' : undefined} strokeLinecap="round" />
      </svg>
      <span className="font-bold num">{value}</span>
      <span className="text-muted">{label}</span>
    </div>
  );
}

// ------------------------------------------------------------
// 月内の累計推移（実績・目標ペース・月末予測）
// ------------------------------------------------------------
/**
 * @param {number} days                 その月の日数
 * @param {Array<{day:number,value:number}>} daily  日別の値（累計ではない）
 * @param {number} [elapsed]            データのある日数（それ以降は描かない）
 * @param {number} [target]             月間目標（0日目→月末へ直線）
 * @param {number} [forecast]           月末予測（最終実績点から破線）
 * @param {Array<{value:number,label:string}>} [refLines] 水平の参照線（次の段階など）
 * @param {(v:number)=>string} format    値の表示
 */
export function CumulativeChart({ days, daily, elapsed, target, forecast, refLines = [], format = String, height = 220, ariaLabel }) {
  const [ref, width] = useMeasure();
  const [hover, setHover] = useState(null);
  const pad = { top: 14, right: 12, bottom: 24, left: 44 };

  const cumulative = useMemo(() => {
    const byDay = new Map((daily || []).map((d) => [d.day, d.value]));
    const out = [];
    let acc = 0;
    const last = elapsed != null ? elapsed : days;
    for (let d = 1; d <= last; d++) {
      const v = byDay.get(d) || 0;
      acc += v;
      out.push({ day: d, value: acc, daily: v });
    }
    return out;
  }, [daily, days, elapsed]);

  const lastActual = cumulative.length ? cumulative[cumulative.length - 1] : { day: 0, value: 0 };
  const yMaxRaw = Math.max(lastActual.value, target || 0, forecast || 0, ...refLines.map((r) => r.value), 1);
  const ticks = niceTicks(yMaxRaw * 1.04);
  const yMax = ticks[ticks.length - 1];
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const x = (day) => pad.left + (days > 0 ? (day / days) * innerW : 0);
  const y = (v) => pad.top + innerH - (v / yMax) * innerH;

  const linePath = cumulative.length
    ? `M${x(0)},${y(0)} ` + cumulative.map((p) => `L${x(p.day)},${y(p.value)}`).join(' ')
    : '';
  const areaPath = cumulative.length ? `${linePath} L${x(lastActual.day)},${y(0)} Z` : '';

  const onMove = (e) => {
    if (!innerW) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const day = Math.round(((px - pad.left) / innerW) * days);
    setHover(Math.max(1, Math.min(days, day)));
  };

  const xLabels = [1, Math.ceil(days / 3), Math.ceil((days * 2) / 3), days];
  const hoverPoint = hover != null ? cumulative.find((p) => p.day === hover) : null;
  const targetAt = (day) => (target ? (target * day) / days : null);

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={ariaLabel}
          onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} style={{ touchAction: 'pan-y' }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'} strokeWidth="1" />
              <text x={pad.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-[rgb(var(--muted))] text-[10px] num">{format(t)}</text>
            </g>
          ))}
          {xLabels.map((d) => (
            <text key={d} x={x(d)} y={height - 6} textAnchor="middle" className="fill-[rgb(var(--muted))] text-[10px] num">{d}日</text>
          ))}
          {refLines.map((r) => (
            <g key={r.label}>
              <line x1={pad.left} x2={width - pad.right} y1={y(r.value)} y2={y(r.value)} stroke="var(--chart-gold)" strokeWidth="1" strokeOpacity="0.7" />
              <text x={width - pad.right} y={y(r.value) - 4} textAnchor="end" className="fill-[rgb(var(--ink-2))] text-[10px] font-semibold">{r.label}</text>
            </g>
          ))}
          {target ? (
            <line x1={x(0)} y1={y(0)} x2={x(days)} y2={y(target)} stroke="var(--chart-target)" strokeWidth="1.5" strokeLinecap="round" />
          ) : null}
          {areaPath ? <path d={areaPath} fill="var(--chart-sales-wash)" /> : null}
          {linePath ? <path d={linePath} fill="none" stroke="var(--chart-sales)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" /> : null}
          {forecast && lastActual.day < days && lastActual.day > 0 ? (
            <line x1={x(lastActual.day)} y1={y(lastActual.value)} x2={x(days)} y2={y(forecast)} stroke="var(--chart-sales)" strokeWidth="2" strokeDasharray="4 4" strokeOpacity="0.55" strokeLinecap="round" />
          ) : null}
          {lastActual.day > 0 ? (
            <circle cx={x(lastActual.day)} cy={y(lastActual.value)} r="4.5" fill="var(--chart-sales)" stroke="var(--chart-surface)" strokeWidth="2" />
          ) : null}
          {hover != null ? (
            <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + innerH} stroke="rgb(var(--ink) / 0.35)" strokeWidth="1" />
          ) : null}
          {hoverPoint ? <circle cx={x(hoverPoint.day)} cy={y(hoverPoint.value)} r="4" fill="var(--chart-sales)" stroke="var(--chart-surface)" strokeWidth="2" /> : null}
        </svg>
      ) : null}
      {hover != null && width > 0 ? (
        <Tooltip x={x(hover)} y={y(hoverPoint ? hoverPoint.value : targetAt(hover) || 0) - 10} width={width}>
          <div className="mb-1 font-semibold text-ink-2">{hover}日</div>
          {hoverPoint ? <TooltipRow color="var(--chart-sales)" label="実績（累計）" value={format(hoverPoint.value)} /> : <div className="text-muted">まだ実績がありません</div>}
          {hoverPoint ? <TooltipRow color="var(--chart-sales)" label="この日" value={format(hoverPoint.daily)} /> : null}
          {target ? <TooltipRow color="var(--chart-target)" label="目標ペース" value={format(targetAt(hover))} /> : null}
        </Tooltip>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------
// 縦棒（月別推移・日別など）
// ------------------------------------------------------------
/**
 * @param {Array<{key:string,label:string,value:number,sub?:string}>} data
 * @param {string} [highlightKey]   強調する棒（それ以外は淡色）
 * @param {number} [target]         水平の目標線
 */
export function ColumnChart({ data, highlightKey, target, targetLabel = '目標', format = String, height = 200, ariaLabel, labelEvery = 1 }) {
  const [ref, width] = useMeasure();
  const [hover, setHover] = useState(null);
  const pad = { top: 16, right: 8, bottom: 24, left: 44 };
  const maxVal = Math.max(1, target || 0, ...data.map((d) => d.value || 0));
  const ticks = niceTicks(maxVal * 1.04);
  const yMax = ticks[ticks.length - 1];
  const innerW = Math.max(0, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const band = data.length ? innerW / data.length : 0;
  const barW = Math.max(3, Math.min(24, band * 0.62));
  const y = (v) => pad.top + innerH - (Math.max(0, v) / yMax) * innerH;
  const r = Math.min(4, barW / 2);

  const barPath = (cx, v) => {
    const top = y(v);
    const base = y(0);
    const h = base - top;
    if (h <= 0.5) return '';
    const rr = Math.min(r, h);
    const l = cx - barW / 2;
    const rt = cx + barW / 2;
    return `M${l},${base} L${l},${top + rr} Q${l},${top} ${l + rr},${top} L${rt - rr},${top} Q${rt},${top} ${rt},${top + rr} L${rt},${base} Z`;
  };

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {width > 0 ? (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} onPointerLeave={() => setHover(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--chart-axis)' : 'var(--chart-grid)'} strokeWidth="1" />
              <text x={pad.left - 6} y={y(t)} dy="0.32em" textAnchor="end" className="fill-[rgb(var(--muted))] text-[10px] num">{format(t)}</text>
            </g>
          ))}
          {target ? (
            <g>
              <line x1={pad.left} x2={width - pad.right} y1={y(target)} y2={y(target)} stroke="var(--chart-target)" strokeWidth="1.5" />
              <text x={width - pad.right} y={y(target) - 4} textAnchor="end" className="fill-[rgb(var(--ink-2))] text-[10px] font-semibold">{targetLabel}</text>
            </g>
          ) : null}
          {data.map((d, i) => {
            const cx = pad.left + band * i + band / 2;
            const emphasized = !highlightKey || d.key === highlightKey;
            const isHover = hover === i;
            return (
              <g key={d.key}>
                <path d={barPath(cx, d.value || 0)} fill={emphasized ? 'var(--chart-sales)' : 'var(--chart-sales)'} fillOpacity={isHover ? 1 : emphasized ? 0.95 : 0.35} />
                {i % labelEvery === 0 || i === data.length - 1 ? (
                  <text x={cx} y={height - 6} textAnchor="middle" className="fill-[rgb(var(--muted))] text-[10px]">{d.label}</text>
                ) : null}
                <rect x={cx - band / 2} y={pad.top} width={band} height={innerH} fill="transparent"
                  onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} />
              </g>
            );
          })}
        </svg>
      ) : null}
      {hover != null && data[hover] && width > 0 ? (
        <Tooltip x={pad.left + band * hover + band / 2} y={y(data[hover].value || 0) - 8} width={width}>
          <div className="font-semibold text-ink-2">{data[hover].label}</div>
          <div className="mt-0.5 text-[13px] font-bold num">{format(data[hover].value || 0)}</div>
          {data[hover].sub ? <div className="text-muted">{data[hover].sub}</div> : null}
        </Tooltip>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------
// 横棒リスト（カテゴリの大小比較）
// ------------------------------------------------------------
export function BarList({ items, format = String, max, emptyText = 'データがありません' }) {
  const top = max || Math.max(1, ...items.map((i) => i.value || 0));
  if (!items.length) return <p className="py-4 text-center text-xs text-muted">{emptyText}</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((it) => (
        <li key={it.key || it.label}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
            <span className="min-w-0 truncate text-ink">{it.label}</span>
            <span className="shrink-0 font-semibold text-ink num">
              {format(it.value)}
              {it.sub ? <span className="ml-1.5 text-xs font-medium text-muted">{it.sub}</span> : null}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(1, (it.value || 0) / top)) * 100}%`, background: it.color || 'var(--chart-sales)' }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------
// スパークライン（直近の傾向）
// ------------------------------------------------------------
export function Sparkline({ values, width = 80, height = 24 }) {
  const vals = (values || []).map((v) => Number(v) || 0);
  if (vals.length < 2) return null;
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
  const span = max - min || 1;
  const pts = vals.map((v, i) => [2 + (i / (vals.length - 1)) * (width - 4), 2 + (1 - (v - min) / span) * (height - 4)]);
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} aria-hidden="true" className="shrink-0">
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--chart-target)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill="var(--chart-sales)" />
    </svg>
  );
}

// ------------------------------------------------------------
// レーダーチャート（施術レポート用）。画像保存（html2canvas）でも崩れないよう
// 色は CSS 変数ではなく実際の色を渡す。
// ------------------------------------------------------------
export function RadarChart({ axes, values, max = 5, size = 240, stroke = '#2f8559', fill = 'rgba(47,133,89,0.18)', grid = '#d7ddd6', text = '#48514b', className = '' }) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 34;
  const angle = (i) => (Math.PI * 2 * i) / axes.length - Math.PI / 2;
  const point = (i, v) => [cx + Math.cos(angle(i)) * radius * (v / max), cy + Math.sin(angle(i)) * radius * (v / max)];
  const rings = Array.from({ length: max }, (_, i) => i + 1);
  const poly = axes.map((a, i) => point(i, Math.max(0, Math.min(max, Number(values[a.key]) || 0))).join(',')).join(' ');
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className={className} role="img" aria-label="スコアのレーダーチャート">
      {rings.map((r) => (
        <polygon key={r} points={axes.map((_, i) => point(i, r).join(',')).join(' ')} fill="none" stroke={grid} strokeWidth="1" />
      ))}
      {axes.map((a, i) => {
        const [x2, y2] = point(i, max);
        const [lx, ly] = point(i, max + 0.95);
        return (
          <g key={a.key}>
            <line x1={cx} y1={cy} x2={x2} y2={y2} stroke={grid} strokeWidth="1" />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize="11" fontWeight="600" fill={text}>{a.label}</text>
          </g>
        );
      })}
      <polygon points={poly} fill={fill} stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
      {axes.map((a, i) => {
        const [px, py] = point(i, Math.max(0, Math.min(max, Number(values[a.key]) || 0)));
        return <circle key={a.key} cx={px} cy={py} r="4" fill={stroke} stroke="#ffffff" strokeWidth="2" />;
      })}
    </svg>
  );
}

/** チャートと同じ値を表で見せる（アクセシビリティ / 正確な値の確認用） */
export function ChartTable({ columns, rows, className = '' }) {
  return (
    <details className={cx('group mt-3', className)}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-ink-2 hover:bg-surface-3">
        <span className="transition-transform group-open:rotate-90">›</span> 表で見る
      </summary>
      <div className="scroll-x mt-2 rounded-xl border border-line">
        <table className="data-table">
          <thead>
            <tr>{columns.map((c) => <th key={c.key} className={c.align === 'right' ? 'text-right' : ''}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {columns.map((c) => <td key={c.key} className={c.align === 'right' ? 'num-cell' : ''}>{c.render ? c.render(r) : r[c.key]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
