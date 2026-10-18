import { useMemo } from 'react';
import { Card, cx } from '../../../ui/primitives.jsx';
import Icon from '../../../ui/Icon.jsx';
import { useMeasure } from '../../../ui/charts.jsx';
import { addMonths } from '../../../../shared/dates.js';

// ============================================================
// 02 改善シミュレーション（通い方ごとの改善のイメージ）
// ------------------------------------------------------------
// 以前の画面と同じ曲線。施術のたびに良くなり（山）、次までに少し戻る（谷）。
// 通う回数が多いほど早く「理想の状態」に近づき、3ヶ月目からは維持の通い方で差が出る。
// 実測値ではなく説明用の図。縦の位置は旧画面の座標（下 390 → 上 78）をそのまま使う。
// ============================================================

const Y_TOP = 78;
const Y_BASE = 390;
const Y_START = 385;
const Y_IDEAL = 100;
const Y_FEEL = 225;

// 色はチャート用のカテゴリ色を決まった順に使う（施術 1回のみはグレーの破線）
export const LINES = [
  { id: 'l1', group: '4', color: 'var(--series-1)', label: '月4回 → そのまま継続', visits: [{ freq: 4, months: 6 }], base: [385, 280, 195, 130, 108, 100, 96], amp: [40, 32, 24, 16, 12, 10, 8] },
  { id: 'l2', group: '4', color: 'var(--series-2)', label: '月4回 → 月2回に切替', visits: [{ freq: 4, months: 3 }, { freq: 2, months: 3 }], base: [385, 280, 195, 130, 120, 112, 107], amp: [40, 32, 24, 16, 14, 12, 10], switchAt: 3, switchLabel: '月2回へ', primaryFor: 4 },
  { id: 'l3', group: '4', color: 'var(--series-3)', label: '月4回 → 月1回に切替', visits: [{ freq: 4, months: 3 }, { freq: 1, months: 3 }], base: [385, 280, 195, 130, 130, 130, 130], amp: [40, 32, 24, 16, 16, 16, 16], switchAt: 3, switchLabel: '月1回で維持' },
  { id: 'l4', group: '2', color: 'var(--series-4)', label: '月2回 → そのまま継続', visits: [{ freq: 2, months: 6 }], base: [385, 325, 270, 225, 195, 170, 155], amp: [35, 28, 22, 18, 15, 13, 11], primaryFor: 2 },
  { id: 'l5', group: '2', color: 'var(--series-5)', label: '月2回 → 月1回に切替', visits: [{ freq: 2, months: 3 }, { freq: 1, months: 3 }], base: [385, 325, 270, 225, 225, 225, 225], amp: [35, 28, 22, 18, 18, 18, 18], switchAt: 3, switchLabel: '月1回で維持' },
  { id: 'l6', group: '1', color: 'var(--series-other)', label: '今日の施術結果（継続なし）', revert: true },
];

const GROUPS = [
  { key: '4', label: '月4回スタート' },
  { key: '2', label: '月2回スタート' },
  { key: '1', label: '施術1回のみ' },
];

const SCENARIOS = {
  l1: { title: '月4回 → そのまま月4回で継続（最高の結果）', desc: '週1回ペースで通い続け、最も早く理想の状態に到達。', flow: ['月4回で継続'] },
  l2: { title: '月4回 → 4ヶ月目から月2回に切替（おすすめ）', desc: '3ヶ月で土台を整え、安定期から月2回に。効果を高いまま維持しつつ通いやすいパターン。', flow: ['月4回 × 3ヶ月', '月2回で継続'] },
  l3: { title: '月4回 → 4ヶ月目から月1回に切替', desc: '3ヶ月集中後、月1回で維持。やめるよりは月1回でも継続が大切。', flow: ['月4回 × 3ヶ月', '月1回'] },
  l4: { title: '月2回 → そのまま月2回で継続', desc: 'セルフケア併用で着実に改善。無理なく続けやすいペース。', flow: ['月2回で継続', 'セルフケア'] },
  l5: { title: '月2回 → 4ヶ月目から月1回に切替', desc: '月2回で3ヶ月通い、その後は月1回に。', flow: ['月2回 × 3ヶ月', '月1回'] },
  l6: { title: '今日の施術結果（継続なし）', desc: '施術直後は改善を実感できますが、約2週間で元の状態に戻ってしまいます。継続が改善の鍵です。', flow: ['施術1回のみ', '≈2週間で元に戻る'] },
};

/** 推奨の通い方（月の回数）で最初に見せる線 */
export const primaryLineFor = (freq) => (freq >= 4 ? 'l2' : freq > 0 ? 'l4' : null);

/** 施術のたびの山と谷を滑らかにつないだ線（旧画面の genWave と同じ計算） */
function wavePath(line, mx, my, monthWidth) {
  const schedule = line.visits.flatMap((v) => Array(v.months).fill(v.freq));
  const pts = [{ x: mx(0), y: Y_START }];
  for (let m = 0; m < 6; m++) {
    const f = schedule[m] || 1;
    const w = monthWidth / f;
    const xs = mx(m);
    const [b0, b1, a0, a1] = [line.base[m], line.base[m + 1], line.amp[m], line.amp[m + 1]];
    for (let i = 0; i < f; i++) {
      const t0 = i / f;
      const t2 = (i + 1) / f;
      pts.push({ x: xs + i * w + w * 0.15, y: b0 + (b1 - b0) * t0 - (a0 + (a1 - a0) * t0) });
      pts.push({ x: xs + i * w + w * 0.85, y: b0 + (b1 - b0) * t2 + (a0 + (a1 - a0) * t2) * 0.4 });
    }
  }
  let d = `M ${pts[0].x},${my(pts[0].y)}`;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const c = pts[i];
    const cx = (p.x + c.x) / 2;
    d += ` C ${cx},${my(p.y)} ${cx},${my(c.y)} ${c.x},${my(c.y)}`;
  }
  return { d, end: { x: pts[pts.length - 1].x, y: my(pts[pts.length - 1].y) } };
}

function ImprovementChart({ active, startMonth }) {
  const [ref, width] = useMeasure();
  const W = Math.max(width, 300);
  const H = Math.round(Math.min(Math.max(W * 0.48, 250), 400));
  const pad = { l: 10, r: 14, t: 30, b: 44 };
  const monthWidth = (W - pad.l - pad.r) / 6;
  const mx = (i) => pad.l + monthWidth * i;
  const plotH = H - pad.t - pad.b;
  const my = (y) => pad.t + ((y - Y_TOP) / (Y_BASE - Y_TOP)) * plotH;
  const small = W < 520;

  const paths = useMemo(() => LINES.map((l) => {
    if (l.revert) {
      // 施術直後に上がり、約 2週間で元に戻る
      const sx = mx(0);
      const sy = my(Y_START);
      const peakX = sx + monthWidth * 0.15;
      const peakY = my(Y_START - 80);
      const endX = sx + monthWidth * 0.5;
      const d = `M ${sx},${sy} C ${sx + monthWidth * 0.03},${my(Y_START - 40)} ${peakX - monthWidth * 0.06},${peakY} ${peakX},${peakY} S ${endX - monthWidth * 0.1},${sy + 1} ${endX},${sy}`;
      return { ...l, d, end: { x: endX, y: sy } };
    }
    return { ...l, ...wavePath(l, mx, my, monthWidth) };
  }), [W, H]); // eslint-disable-line react-hooks/exhaustive-deps

  const months = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const m = addMonths(startMonth, i);
    return small ? `${Number(m.slice(5))}月` : `${m.slice(0, 4)}/${Number(m.slice(5))}月`;
  });

  return (
    <div ref={ref} className="relative w-full">
      {width > 0 ? (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="通い方ごとの改善のイメージ（6ヶ月）" className="block">
          {/* 症状不安定期（0〜3ヶ月）/ 症状安定期（3〜6ヶ月） */}
          <rect x={mx(0)} y={pad.t - 4} width={mx(3) - mx(0) - 1} height={plotH + 4} rx="8" className="fill-[#3987e5]/[0.07] dark:fill-[#3987e5]/[0.06]" />
          <rect x={mx(3) + 1} y={pad.t - 4} width={mx(6) - mx(3) - 1} height={plotH + 4} rx="8" className="fill-[#e34948]/[0.06] dark:fill-[#e66767]/[0.05]" />
          <text x={(mx(0) + mx(3)) / 2} y={pad.t - 12} textAnchor="middle" className="fill-[#1f5aa6] text-[11px] font-semibold dark:fill-[#9cc3f3]">症状不安定期</text>
          <text x={(mx(3) + mx(6)) / 2} y={pad.t - 12} textAnchor="middle" className="fill-[#9b2525] text-[11px] font-semibold dark:fill-[#f3a3a3]">症状安定期</text>

          {/* 月の区切り */}
          {[1, 2, 4, 5].map((i) => <line key={i} x1={mx(i)} x2={mx(i)} y1={pad.t} y2={my(Y_BASE)} stroke="var(--chart-grid)" strokeWidth="1" />)}
          <line x1={mx(3)} x2={mx(3)} y1={pad.t - 4} y2={my(Y_BASE)} stroke="var(--chart-axis)" strokeWidth="1" strokeDasharray="5 4" />

          {/* 目安の線 */}
          {[{ y: Y_IDEAL, label: '理想の状態' }, { y: Y_FEEL, label: '変化の実感' }].map((g) => (
            <g key={g.label}>
              <line x1={mx(0)} x2={mx(6)} y1={my(g.y)} y2={my(g.y)} stroke="var(--chart-target)" strokeWidth="1" strokeDasharray="6 4" />
              <text x={mx(6) - 4} y={my(g.y) - 5} textAnchor="end" className="fill-muted text-[10px] font-semibold">{g.label}</text>
            </g>
          ))}

          {/* 軸と月 */}
          <line x1={mx(0)} x2={mx(6)} y1={my(Y_BASE)} y2={my(Y_BASE)} stroke="var(--chart-axis)" strokeWidth="1" />
          {months.map((label, i) => (
            <text key={i} x={mx(i)} y={my(Y_BASE) + 16} textAnchor={i === 0 ? 'start' : i === 6 ? 'end' : 'middle'} className="fill-muted text-[10px]">{label}</text>
          ))}
          <text x={mx(3)} y={my(Y_BASE) + 32} textAnchor="middle" className="fill-muted text-[10px]">▲ 切替タイミング</text>

          {/* 線（選んだものだけ） */}
          {paths.map((p) => (
            <g key={p.id} style={{ opacity: active[p.id] ? 1 : 0, transition: 'opacity .35s ease' }} aria-hidden={!active[p.id]}>
              <path d={p.d} fill="none" stroke={p.color} strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={p.revert ? '6 4' : undefined} />
              <circle cx={p.end.x} cy={p.end.y} r="4" fill="var(--chart-surface)" stroke={p.color} strokeWidth="2" />
              {p.revert ? (
                <text x={p.end.x + 8} y={p.end.y - 8} className="fill-ink-2 text-[11px] font-bold">≈ 2週間で元に戻る</text>
              ) : null}
              {p.switchAt !== undefined ? (
                <>
                  <circle cx={mx(p.switchAt)} cy={my(p.base[p.switchAt])} r="5" fill="none" stroke={p.color} strokeWidth="1.5" />
                  <text x={mx(p.switchAt) + 9} y={my(p.base[p.switchAt]) + 16} className="fill-ink-2 text-[10px] font-semibold">{p.switchLabel}</text>
                </>
              ) : null}
            </g>
          ))}
          <circle cx={mx(0)} cy={my(Y_START)} r="4.5" fill="var(--chart-surface)" stroke="var(--chart-target)" strokeWidth="2" />
        </svg>
      ) : <div style={{ height: 260 }} />}
    </div>
  );
}

/**
 * @param {Object<string, boolean>} active 表示中の線
 * @param {(id:string)=>void} onToggle
 * @param {number} recFreq 選んでいるプランの月の回数（おすすめの線に印を付ける）
 */
export default function Simulation({ active, onToggle, recFreq, startMonth }) {
  const primary = primaryLineFor(recFreq);
  const shown = LINES.filter((l) => active[l.id]);
  return (
    <Card title="02 改善シミュレーション" icon="chart-spline" subtitle="通い方によって改善スピードと維持力は大きく変わります">
      <div className="mb-4 flex items-start gap-3 rounded-xl border border-gold-200 bg-gold-50 px-3.5 py-3 dark:border-gold-500/30 dark:bg-gold-500/10">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold-500 text-sm font-bold text-white">3</span>
        <p className="text-[13px] leading-relaxed text-gold-900 dark:text-gold-100">
          <strong>まずは3ヶ月の継続が最も大切です。</strong><br />どのプランでも最初の3ヶ月で身体の土台が整います。
        </p>
      </div>

      {/* 凡例を兼ねた切り替え */}
      <div className="mb-3 grid gap-3 md:grid-cols-3">
        {GROUPS.map((g) => (
          <div key={g.key}>
            <div className="mb-1.5 text-[11px] font-bold text-muted">{g.label}</div>
            <div className="flex flex-col gap-1.5">
              {LINES.filter((l) => l.group === g.key).map((l) => {
                const on = !!active[l.id];
                return (
                  <button key={l.id} type="button" role="switch" aria-checked={on} onClick={() => onToggle(l.id)}
                    className={cx('flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-xs font-medium transition-colors',
                      on ? 'border-line-strong bg-surface text-ink shadow-card' : 'border-line bg-surface-2 text-ink-2 hover:bg-surface-3')}>
                    <span className={cx('flex h-4 w-4 shrink-0 items-center justify-center rounded border', on ? 'border-transparent bg-ink text-surface' : 'border-line-strong')}>
                      {on ? <Icon name="check" size={11} strokeWidth={3} /> : null}
                    </span>
                    <svg width="18" height="6" aria-hidden="true" className="shrink-0">
                      <line x1="1" y1="3" x2="17" y2="3" stroke={l.color} strokeWidth="3" strokeLinecap="round" strokeDasharray={l.revert ? '4 3' : undefined} />
                    </svg>
                    <span className="min-w-0 flex-1">{l.label}</span>
                    {l.id === primary ? <span className="shrink-0 rounded-full bg-brand-600 px-1.5 text-[10px] font-bold leading-4 text-white">おすすめ</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <ImprovementChart active={active} startMonth={startMonth} />

      {shown.length ? (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {shown.map((l) => {
            const s = SCENARIOS[l.id];
            return (
              <div key={l.id} className="animate-rise-in rounded-xl border border-line bg-surface-2 p-3 text-xs leading-relaxed text-ink-2">
                <div className="mb-1 flex items-center gap-2">
                  <svg width="18" height="6" aria-hidden="true" className="shrink-0"><line x1="1" y1="3" x2="17" y2="3" stroke={l.color} strokeWidth="3" strokeLinecap="round" strokeDasharray={l.revert ? '4 3' : undefined} /></svg>
                  <strong className="text-[13px] text-ink">{s.title}</strong>
                </div>
                <p>{s.desc}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {s.flow.map((f, i) => (
                    <span key={f} className="inline-flex items-center gap-1.5">
                      {i > 0 ? <Icon name="arrow-right" size={12} className="text-muted" /> : null}
                      <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-ink-2">{f}</span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 text-center text-xs text-muted">上の通い方をタップすると、改善のイメージが表示されます</p>
      )}
    </Card>
  );
}
