import { useMemo, useRef, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { cx } from '../../ui/primitives.jsx';
import { TypeBadge } from './parts.jsx';
import { GRID_ORDER } from '../../../shared/mandala.js';

// ============================================================
// マンダラチャート（9×9）
// ------------------------------------------------------------
//   PC   : 9×9 をそのまま読める大きさで表示。マスを押すと下に全文
//   スマホ: 9×9 の形のまま全体を見せ、3×3 のブロックをタップで拡大。
//           拡大中は左右・上下のスワイプかミニマップで隣のブロックへ
// focusIds を渡すと、今週のフォーカスの項目を金色の枠で示す。
// ============================================================

const TONE = {
  action: 'bg-surface text-ink',
  metric: 'bg-gold-50 text-gold-900 dark:bg-gold-500/15 dark:text-gold-100',
  mindset: 'bg-surface-2 text-ink-2',
};
const CENTER = 'bg-brand-600 font-bold text-white';
const THEME = 'bg-brand-50 font-semibold text-brand-800 dark:bg-brand-500/20 dark:text-brand-100';

export default function MandalaBoard({ chart, focusIds = [] }) {
  const [zoom, setZoom] = useState(null);
  const [selected, setSelected] = useState(null);
  const touch = useRef(null);
  const themeAt = useMemo(() => new Map(chart.themes.map((t) => [t.position, t])), [chart]);
  const focus = useMemo(() => new Set(focusIds), [focusIds]);

  const themeOfBlock = (block) => (GRID_ORDER[block] === 'center' ? null : themeAt.get(GRID_ORDER[block]) || null);
  const zoomTo = (block) => { setZoom(block); setSelected(null); };
  const pick = (theme, item) => {
    if (!item || !item.content.trim()) { setSelected(null); return; }
    setSelected({ heading: (theme && theme.title) || `テーマ${theme ? theme.position : ''}`, content: item.content, type: item.itemType, trackable: item.itemType === 'action' && item.weeklyTrackable, focus: focus.has(item.id) });
  };
  const pickCenter = () => setSelected({ heading: 'センターゴール', content: chart.centerGoal });

  const onTouchEnd = (e) => {
    const start = touch.current;
    touch.current = null;
    if (!start || zoom === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 56) return;
    const row = Math.floor(zoom / 3);
    const col = zoom % 3;
    let next = zoom;
    if (Math.abs(dx) > Math.abs(dy)) {
      const c = col + (dx < 0 ? 1 : -1);
      if (c >= 0 && c <= 2) next = row * 3 + c;
    } else {
      const r = row + (dy < 0 ? 1 : -1);
      if (r >= 0 && r <= 2) next = r * 3 + col;
    }
    if (next !== zoom) zoomTo(next);
  };

  // 1 マス（全体図と拡大で大きさだけ変える）
  const cellFor = ({ base, isCenterBlock, theme, inner, onItem, onTheme }) => {
    if (inner === 'center') {
      return isCenterBlock
        ? { cls: cx(base, CENTER), text: chart.centerGoal || '（センターゴール）', onClick: pickCenter }
        : { cls: cx(base, THEME), text: (theme && theme.title) || '—', onClick: onTheme };
    }
    if (isCenterBlock) {
      const t = themeAt.get(inner);
      return { cls: cx(base, THEME), text: (t && t.title) || '—', onClick: onItem ? () => onItem(inner) : undefined };
    }
    const item = theme ? theme.items.find((i) => i.position === inner) : null;
    const filled = item && item.content.trim();
    return {
      cls: cx(base, 'relative', filled ? TONE[item.itemType] || TONE.action : 'bg-surface text-muted/40', filled && focus.has(item.id) ? 'ring-2 ring-inset ring-gold-400' : ''),
      text: filled ? item.content : '—',
      dot: filled && item.itemType === 'action' && item.weeklyTrackable,
      onClick: () => pick(theme, item),
    };
  };

  const overview = (
    <div className={cx('grid-cols-3 gap-1.5 rounded-2xl bg-surface-3 p-1.5 md:grid md:gap-2.5 md:p-2.5', zoom === null ? 'grid' : 'hidden')}>
      {GRID_ORDER.map((slot, block) => {
        const theme = themeOfBlock(block);
        const isCenterBlock = slot === 'center';
        return (
          <div key={block} className={cx('relative grid grid-cols-3 gap-px overflow-hidden rounded-lg bg-line md:gap-0.5 md:rounded-xl md:bg-transparent', isCenterBlock ? 'ring-2 ring-brand-500/50 md:ring-0' : '')}>
            {GRID_ORDER.map((inner, i) => {
              const c = cellFor({
                base: 'flex aspect-square items-center justify-center overflow-hidden p-px text-center text-[6.5px] leading-[1.2] md:rounded-md md:p-1.5 md:text-[11px] md:leading-snug md:transition-shadow md:hover:shadow-card',
                isCenterBlock, theme, inner,
              });
              return (
                <button key={i} type="button" onClick={c.onClick} className={c.cls}>
                  <span className="line-clamp-4 break-words">{c.text}</span>
                  {c.dot ? <span className="absolute right-0.5 top-0.5 h-1 w-1 rounded-full bg-brand-500 md:right-1 md:top-1 md:h-1.5 md:w-1.5" /> : null}
                </button>
              );
            })}
            {/* スマホ: ブロック全体のタップで拡大 */}
            <button type="button" aria-label={`${isCenterBlock ? '中央（センターゴールと8テーマ）' : (theme && theme.title) || 'テーマ'}を拡大`} onClick={() => zoomTo(block)} className="absolute inset-0 md:hidden" />
          </div>
        );
      })}
    </div>
  );

  let zoomed = null;
  if (zoom !== null) {
    const isCenterBlock = GRID_ORDER[zoom] === 'center';
    const theme = themeOfBlock(zoom);
    zoomed = (
      <div className="md:hidden">
        <div className="mb-3 flex items-center justify-between gap-3">
          <button type="button" onClick={() => zoomTo(null)} className="inline-flex h-10 items-center gap-0.5 rounded-full bg-surface-3 pl-2 pr-3.5 text-xs font-semibold text-ink">
            <Icon name="chevron-left" size={16} />全体
          </button>
          <p className="min-w-0 flex-1 truncate text-center text-sm font-bold text-ink">{isCenterBlock ? 'センターゴールと8テーマ' : (theme && theme.title) || 'テーマ'}</p>
          <div className="grid shrink-0 grid-cols-3 gap-[3px]" aria-label="ブロックを選ぶ">
            {GRID_ORDER.map((slot, i) => (
              <button key={i} type="button" onClick={() => zoomTo(i)}
                aria-label={slot === 'center' ? '中央' : (themeAt.get(slot) && themeAt.get(slot).title) || `テーマ${slot}`}
                className={cx('h-3.5 w-3.5 rounded-[4px] transition-colors', i === zoom ? 'bg-brand-600' : slot === 'center' ? 'bg-gold-400' : 'bg-line-strong')} />
            ))}
          </div>
        </div>
        <div key={zoom} className="grid animate-rise-in grid-cols-3 gap-1.5 rounded-2xl bg-surface-3 p-1.5"
          onTouchStart={(e) => { const t = e.touches[0]; touch.current = { x: t.clientX, y: t.clientY }; }} onTouchEnd={onTouchEnd}>
          {GRID_ORDER.map((inner, i) => {
            const c = cellFor({
              base: 'flex aspect-square items-center justify-center overflow-hidden rounded-xl p-2 text-center text-[12px] leading-snug shadow-card ring-1 ring-line transition-transform active:scale-[0.97]',
              isCenterBlock, theme, inner,
              onItem: (pos) => zoomTo(GRID_ORDER.indexOf(pos)),
              onTheme: () => zoomTo(4),
            });
            return (
              <button key={i} type="button" onClick={c.onClick} className={c.cls}>
                <span className="line-clamp-5 break-words">{c.text}</span>
                {c.dot ? <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-brand-500" /> : null}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-center text-[11px] text-muted">{isCenterBlock ? 'テーマをタップすると、その8項目を開きます' : 'スワイプで隣のテーマへ・マスをタップで全文'}</p>
      </div>
    );
  }

  return (
    <div>
      {overview}
      {zoomed}
      {zoom === null ? (
        <p className="mt-2 flex items-center justify-center gap-1 text-[11px] text-muted md:hidden"><Icon name="maximize-2" size={12} />ブロックをタップすると拡大します</p>
      ) : null}
      {selected ? (
        <div role="status" className="mt-3 animate-rise-in rounded-2xl border border-line bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-xs font-semibold text-brand-700 dark:text-brand-300">{selected.heading}</p>
            <div className="flex shrink-0 items-center gap-1.5">
              {selected.type ? <TypeBadge type={selected.type} /> : null}
              {selected.trackable ? <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-semibold text-white">週次チェック</span> : null}
              {selected.focus ? <span className="rounded-full bg-gold-100 px-2 py-0.5 text-[10px] font-semibold text-gold-800 dark:bg-gold-500/20 dark:text-gold-200">今週のフォーカス</span> : null}
            </div>
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{selected.content}</p>
        </div>
      ) : null}
    </div>
  );
}
