import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { IconButton, cx } from '../../../ui/primitives.jsx';
import Icon from '../../../ui/Icon.jsx';
import { getTotal, scoreBg, scoreColor, scoreColorOnDark, scoreLabel } from './scoring.js';

// ============================================================
// Before / After の拡大比較（写真を横に並べ、項目ごとの点数差を一覧）
// 写真を見せるための画面なので、テーマに関係なく暗い背景で表示する。
// ============================================================

const diffOf = (a, b) => (a == null || b == null ? null : b - a);
const signed = (d) => (d == null ? '–' : `${d >= 0 ? '+' : ''}${d}`);

function Side({ label, entry, accent }) {
  const total = getTotal(entry.analysis);
  return (
    <figure className="relative flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center">
      <div className="relative max-h-full overflow-hidden rounded-2xl" style={{ border: `2px solid ${accent}` }}>
        <img src={entry.image} alt={label} className="block max-h-[52vh] w-auto max-w-full object-contain" />
        <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white">{label}</span>
        <div className="absolute inset-x-0 bottom-2 flex justify-center">
          <div className="flex items-center gap-2 rounded-2xl bg-black/55 px-3 py-1.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: total == null ? '#e5e5e5' : scoreBg(total) }}>
              <span className="text-base font-extrabold num" style={{ color: total == null ? '#888' : scoreColor(total) }}>{total ?? '–'}</span>
            </div>
            <div className="leading-tight">
              <div className="text-[10px] font-bold text-white/60">総合スコア</div>
              <div className="text-xs font-bold" style={{ color: scoreColorOnDark(total) }}>{total == null ? '判定不可' : scoreLabel(total)}</div>
            </div>
          </div>
        </div>
      </div>
    </figure>
  );
}

export default function ComparisonViewer({ view, pairs, onChange, onClose }) {
  const pair = pairs.find((p) => p.key === view);

  useEffect(() => {
    if (!pair) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [pair, onClose]);

  if (!pair) return null;
  const bTotal = getTotal(pair.before.analysis);
  const aTotal = getTotal(pair.after.analysis);
  const diff = diffOf(bTotal, aTotal);
  const up = diff == null || diff >= 0;

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col bg-[#0b0f0d] text-white animate-fade-in" role="dialog" aria-modal="true" aria-label={`${pair.label}のビフォーアフター比較`}>
      <div className="flex items-center justify-between gap-2 px-3 py-3 safe-top sm:px-5">
        <div className="flex min-w-0 gap-1.5 overflow-x-auto">
          {pairs.map((p) => {
            const active = p.key === view;
            const d = diffOf(getTotal(p.before.analysis), getTotal(p.after.analysis));
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => onChange(p.key)}
                className={cx('shrink-0 rounded-xl px-3.5 py-1.5 text-xs font-bold transition-colors', active ? 'bg-brand-500 text-white' : 'bg-white/10 text-white/60 hover:text-white')}
                aria-pressed={active}
              >
                {p.label}
                {active && d != null ? <span className="ml-1.5 text-[10px] opacity-90 num">{signed(d)}</span> : null}
              </button>
            );
          })}
        </div>
        <IconButton icon="x" label="閉じる" onClick={onClose} className="!text-white/80 hover:!bg-white/15 hover:!text-white" />
      </div>

      <div className="flex justify-center pb-2">
        <div className="inline-flex items-center gap-3 rounded-2xl bg-white/[0.06] px-4 py-2">
          <span className="text-xs font-bold text-white/60">{pair.label}分析</span>
          <span className="h-4 w-px bg-white/20" />
          <Icon name={up ? 'trending-up' : 'trending-down'} size={18} className={up ? 'text-[#5fd3a8]' : 'text-[#f29a99]'} />
          <span className={cx('text-xl font-extrabold num', up ? 'text-[#5fd3a8]' : 'text-[#f29a99]')}>{signed(diff)}</span>
          <span className={cx('text-[11px] font-bold', up ? 'text-[#5fd3a8]/80' : 'text-[#f29a99]/80')}>{diff == null ? '' : up ? '改善' : '低下'}</span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center gap-2 px-3 pb-2 sm:gap-4">
        <Side label="Before" entry={pair.before} accent="rgba(255,255,255,0.18)" />
        <Icon name="arrow-right" size={20} className="shrink-0 text-white/50" />
        <Side label="After" entry={pair.after} accent="rgba(79,162,119,0.55)" />
      </div>

      <div className="max-h-[30vh] overflow-y-auto px-3 pb-4 safe-bottom sm:px-5">
        <table className="mx-auto w-full max-w-2xl overflow-hidden rounded-2xl bg-white/[0.06] text-xs">
          <thead>
            <tr className="text-[10px] font-bold uppercase tracking-wider text-white/40">
              <th className="px-4 py-2 text-left">項目</th>
              <th className="w-14 py-2 text-center">Before</th>
              <th className="w-14 py-2 text-center">After</th>
              <th className="w-16 px-4 py-2 text-right">差分</th>
            </tr>
          </thead>
          <tbody>
            {pair.before.analysis.items.map((bI, i) => {
              const aI = pair.after.analysis.items[i];
              if (!aI) return null;
              const d = aI.score - bI.score;
              return (
                <tr key={bI.key} className="border-t border-white/[0.05]">
                  <td className="px-4 py-2 font-bold text-white/85">{bI.label}</td>
                  <td className="py-2 text-center font-bold num" style={{ color: scoreColorOnDark(bI.score) }}>{bI.score}</td>
                  <td className="py-2 text-center font-bold num" style={{ color: scoreColorOnDark(aI.score) }}>{aI.score}</td>
                  <td className={cx('px-4 py-2 text-right font-extrabold num', d >= 0 ? 'text-[#5fd3a8]' : 'text-[#f29a99]')}>{signed(d)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>,
    document.body,
  );
}
