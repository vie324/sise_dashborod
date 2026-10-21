import { useMemo } from 'react';
import { useMeasure } from '../../../ui/charts.jsx';
import { addMonths } from '../../../../shared/dates.js';

// ============================================================
// 改善のイメージ（通い方ごとの改善の曲線）
// ------------------------------------------------------------
// 以前の画面と同じ曲線。施術のたびに良くなり（山）、次までに少し戻る（谷）。
// 通う回数が多いほど早く「理想の状態」に近づき、3ヶ月目からは維持の通い方で差が出る。
// 実測値ではなく説明用の図。縦の位置は旧画面の座標（下 390 → 上 78）をそのまま使う。
// お客様向けのご説明（present/）で大きく描く。
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

export const GROUPS = [
  { key: '4', label: '月4回スタート' },
  { key: '2', label: '月2回スタート' },
  { key: '1', label: '施術1回のみ' },
];

export const SCENARIOS = {
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

/**
 * 通い方ごとの改善のイメージ（6ヶ月）
 * @param {Object<string,boolean>} active 表示する線
 * @param {string} startMonth 'YYYY-MM'（横軸の最初の月）
 * @param {number} [fontScale=1] 文字の大きさの倍率（お客様向けは大きく）
 * @param {string} [primary] 太く描く線（おすすめの通い方）
 */
export function ImprovementChart({ active, startMonth, fontScale = 1, primary }) {
  const [ref, width] = useMeasure();
  const W = Math.max(width, 300);
  const H = Math.round(Math.min(Math.max(W * 0.46, 240), 460));
  const fs = (px) => px * fontScale;
  const pad = { l: 10, r: 14, t: Math.round(fs(30)), b: Math.round(fs(44)) };
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
  }), [W, H, fontScale]); // eslint-disable-line react-hooks/exhaustive-deps

  const months = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const m = addMonths(startMonth, i);
    return small ? `${Number(m.slice(5))}月` : `${m.slice(0, 4)}/${Number(m.slice(5))}月`;
  });
  const text = (px, weight = 600) => ({ fontSize: fs(px), fontWeight: weight });

  return (
    <div ref={ref} className="relative w-full">
      {width > 0 ? (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="通い方ごとの改善のイメージ（6ヶ月）" className="block">
          {/* 症状不安定期（0〜3ヶ月）/ 症状安定期（3〜6ヶ月） */}
          {/* 色は app.css の --sim-*（お客様向けのご説明では明るい配色に固定される） */}
          <rect x={mx(0)} y={pad.t - 4} width={mx(3) - mx(0) - 1} height={plotH + 4} rx="8" style={{ fill: 'var(--sim-early-wash)' }} />
          <rect x={mx(3) + 1} y={pad.t - 4} width={mx(6) - mx(3) - 1} height={plotH + 4} rx="8" style={{ fill: 'var(--sim-late-wash)' }} />
          <text x={(mx(0) + mx(3)) / 2} y={pad.t - fs(12)} textAnchor="middle" style={{ ...text(11), fill: 'var(--sim-early-text)' }}>症状不安定期</text>
          <text x={(mx(3) + mx(6)) / 2} y={pad.t - fs(12)} textAnchor="middle" style={{ ...text(11), fill: 'var(--sim-late-text)' }}>症状安定期</text>

          {/* 月の区切り */}
          {[1, 2, 4, 5].map((i) => <line key={i} x1={mx(i)} x2={mx(i)} y1={pad.t} y2={my(Y_BASE)} stroke="var(--chart-grid)" strokeWidth="1" />)}
          <line x1={mx(3)} x2={mx(3)} y1={pad.t - 4} y2={my(Y_BASE)} stroke="var(--chart-axis)" strokeWidth="1" strokeDasharray="5 4" />

          {/* 目安の線 */}
          {[{ y: Y_IDEAL, label: '理想の状態' }, { y: Y_FEEL, label: '変化の実感' }].map((g) => (
            <g key={g.label}>
              <line x1={mx(0)} x2={mx(6)} y1={my(g.y)} y2={my(g.y)} stroke="var(--chart-target)" strokeWidth="1" strokeDasharray="6 4" />
              <text x={mx(6) - 4} y={my(g.y) - 5} textAnchor="end" className="fill-muted" style={text(10)}>{g.label}</text>
            </g>
          ))}

          {/* 軸と月 */}
          <line x1={mx(0)} x2={mx(6)} y1={my(Y_BASE)} y2={my(Y_BASE)} stroke="var(--chart-axis)" strokeWidth="1" />
          {months.map((label, i) => (
            <text key={i} x={mx(i)} y={my(Y_BASE) + fs(16)} textAnchor={i === 0 ? 'start' : i === 6 ? 'end' : 'middle'} className="fill-muted" style={text(10, 500)}>{label}</text>
          ))}
          <text x={mx(3)} y={my(Y_BASE) + fs(32)} textAnchor="middle" className="fill-muted" style={text(10, 500)}>▲ 切替タイミング</text>

          {/* 線（選んだものだけ） */}
          {paths.map((p) => {
            const on = !!active[p.id];
            const strong = primary === p.id;
            return (
              <g key={p.id} style={{ opacity: on ? 1 : 0, transition: 'opacity .35s ease' }} aria-hidden={!on}>
                <path d={p.d} fill="none" stroke={p.color} strokeWidth={strong ? 3.25 * Math.max(1, fontScale * 0.8) : 2.25} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={p.revert ? '6 4' : undefined} />
                <circle cx={p.end.x} cy={p.end.y} r={strong ? 5 : 4} fill="var(--chart-surface)" stroke={p.color} strokeWidth="2" />
                {p.revert ? (
                  <text x={p.end.x + 8} y={p.end.y - 8} className="fill-ink-2" style={text(11, 700)}>≈ 2週間で元に戻る</text>
                ) : null}
                {p.switchAt !== undefined ? (
                  <>
                    <circle cx={mx(p.switchAt)} cy={my(p.base[p.switchAt])} r="5" fill="none" stroke={p.color} strokeWidth="1.5" />
                    <text x={mx(p.switchAt) + 9} y={my(p.base[p.switchAt]) + fs(16)} className="fill-ink-2" style={text(10)}>{p.switchLabel}</text>
                  </>
                ) : null}
              </g>
            );
          })}
          <circle cx={mx(0)} cy={my(Y_START)} r="4.5" fill="var(--chart-surface)" stroke="var(--chart-target)" strokeWidth="2" />
        </svg>
      ) : <div style={{ height: 260 }} />}
    </div>
  );
}
