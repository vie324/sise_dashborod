import { Badge, Banner, Button, Card, IconButton, Spinner, cx } from '../../../ui/primitives.jsx';
import Icon from '../../../ui/Icon.jsx';
import { VIEW_LABELS, VIEW_MODES, getTotal, isLowConfidence, totalComment } from './scoring.js';
import { DiffText, ScoreLegend, ScorePill, ScoreRing, scoreTone } from './ScoreBits.jsx';

// ============================================================
// 姿勢分析の画面部品（状態は PostureAnalysis.jsx が持つ）
// ============================================================

export const IDLE_HINTS = {
  front: '背面カメラでお客様の正面全身を撮影します',
  back: '背面カメラでお客様の後ろ姿全身を撮影します',
  side: '背面カメラでお客様の側面（左側）を撮影します',
  seated: '背面カメラでお客様の座位（左側面）を撮影します',
};

const CAPTURE_GUIDES = {
  front: ['お客様から約1m離れて背面カメラで撮影', '両腕は自然に体の横に下ろしてもらう', '足は肩幅に開いてリラックス', '頭頂部から足先まで全身が映るように調整'],
  back: ['お客様の後ろから約1m離れて背面カメラで撮影', '両腕は自然に体の横に下ろしてもらう', '足は肩幅に開いてリラックス', '頭頂部から足先まで全身が映るように調整'],
  side: ['お客様の左側面から背面カメラで撮影', '両腕は自然に体の横に下ろしてもらう', '普段通りの姿勢でリラックス', '頭頂部から足先まで全身が映るように調整'],
  seated: ['お客様の左側面から背面カメラで撮影', '椅子に座った普段通りの姿勢で撮影', '両手は膝の上か自然な位置に', '頭頂部から腰まで映るように調整'],
};

export const PHASE_LABELS = { before: 'Before（施術前）', after: 'After（施術後）' };

// ------------------------------------------------------------
// Before / After・撮影方向の切り替え
// ------------------------------------------------------------
export function FlowSwitch({ value, onChange, hasBefore }) {
  const items = [
    { value: 'before', icon: 'clock', active: 'text-brand-700 dark:text-brand-200' },
    { value: 'after', icon: 'circle-check', active: 'text-gold-700 dark:text-gold-300' },
  ];
  return (
    <div className="flex gap-1 rounded-xl bg-surface-3 p-1" role="tablist" aria-label="施術前・施術後">
      {items.map((it) => {
        const on = value === it.value;
        return (
          <button
            key={it.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(it.value)}
            className={cx('flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-sm font-bold transition-colors', on ? `bg-surface shadow-card ${it.active}` : 'text-muted hover:text-ink')}
          >
            <Icon name={it.icon} size={15} />
            {PHASE_LABELS[it.value]}
            {it.value === 'before' && hasBefore ? <span className="h-2 w-2 rounded-full bg-brand-400" aria-label="保存済みあり" /> : null}
          </button>
        );
      })}
    </div>
  );
}

export function ViewSwitch({ value, onChange, before, after }) {
  return (
    <div className="flex gap-1 rounded-xl bg-surface-3 p-1" role="tablist" aria-label="撮影方向">
      {VIEW_MODES.map((v) => {
        const on = value === v;
        return (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(v)}
            className={cx('relative flex-1 rounded-lg py-2 text-sm font-bold transition-colors', on ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink')}
          >
            {VIEW_LABELS[v]}
            {before[v] || after[v] ? (
              <span className="absolute right-1.5 top-1 flex gap-0.5" aria-hidden="true">
                {before[v] ? <span className="h-1.5 w-1.5 rounded-full bg-brand-400" /> : null}
                {after[v] ? <span className="h-1.5 w-1.5 rounded-full bg-gold-400" /> : null}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** 保存済みの Before 写真（撮り忘れの確認用） */
export function BeforeStrip({ before, onClear }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-2.5">
      <p className="flex shrink-0 items-center gap-1 text-xs font-bold text-brand-700 dark:text-brand-300">
        <Icon name="circle-check" size={13} />Before<br className="sm:hidden" />保存済み
      </p>
      <div className="flex min-w-0 flex-1 gap-1.5">
        {VIEW_MODES.map((v) => (before[v] ? (
          <div key={v} className="relative h-14 w-10 shrink-0 overflow-hidden rounded-lg border-2 border-brand-300 dark:border-brand-500/60">
            <img src={before[v].image} alt={`${VIEW_LABELS[v]}のBefore`} className="h-full w-full object-cover" />
            <span className="absolute inset-x-0 bottom-0 bg-black/55 text-center text-[8px] font-bold leading-[12px] text-white">{VIEW_LABELS[v]}</span>
          </div>
        ) : (
          <div key={v} className="flex h-14 w-10 shrink-0 items-center justify-center rounded-lg border-2 border-dashed border-line-strong">
            <span className="text-[9px] text-muted">{VIEW_LABELS[v]}</span>
          </div>
        )))}
      </div>
      <IconButton icon="trash-2" label="撮影データをすべて消去" size="sm" onClick={onClear} />
    </div>
  );
}

export function GuideCard({ flowPhase, viewMode }) {
  return (
    <Card title={`${PHASE_LABELS[flowPhase]} — ${VIEW_LABELS[viewMode]}撮影ガイド`} icon="camera">
      <ul className="space-y-1.5 text-[13px] leading-relaxed text-ink-2">
        {CAPTURE_GUIDES[viewMode].map((line) => (
          <li key={line} className="flex gap-2">
            <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-brand-400" />
            {line}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ------------------------------------------------------------
// 撮影結果
// ------------------------------------------------------------
function ItemList({ analysis, onReference }) {
  return (
    <ul className="space-y-2">
      {analysis.items.map((item) => {
        const low = isLowConfidence(item);
        const midConf = !low && item.confidence != null && item.confidence < 0.7;
        return (
          <li key={item.key} className={cx('rounded-xl p-3', low ? 'bg-surface-2 opacity-80' : scoreTone(item.score).soft)}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-ink">
                  {item.label}
                  {low ? <Badge tone="warn">信頼度低</Badge> : null}
                  {midConf ? <Badge tone="neutral">信頼度やや低</Badge> : null}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-2">
                  {low ? `再撮影推奨 — ${item.value}` : `${item.detail} — ${item.value}${item.valueCm ? `（約${item.valueCm}）` : ''}`}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <ScorePill score={item.score} low={low} />
                {item.reference ? <IconButton icon="book-open" label="論文根拠を表示" size="sm" onClick={() => onReference(item)} /> : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function AdviceBlock({ advice, onGenerate, onClose }) {
  if (advice.status === 'loading') {
    return (
      <div className="flex items-center justify-center gap-2.5 rounded-xl bg-brand-500/10 py-4 text-sm font-bold text-brand-700 dark:text-brand-200" role="status">
        <Spinner size={18} />AI が分析中…
      </div>
    );
  }
  if (advice.status === 'error') {
    const err = advice.error;
    return (
      <Banner
        tone={err.retry ? 'bad' : 'warn'}
        title={err.title}
        action={err.retry ? <Button size="sm" icon="refresh-cw" onClick={onGenerate}>再試行</Button> : null}
      >
        {err.message}
      </Banner>
    );
  }
  if (advice.status === 'done') {
    return (
      <div className="rounded-xl border border-brand-200 bg-brand-500/[0.06] p-4 dark:border-brand-500/30 dark:bg-brand-500/10">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-bold text-brand-800 dark:text-brand-200"><Icon name="sparkles" size={15} />AI改善アドバイス</p>
          <button type="button" onClick={onClose} className="text-[11px] text-muted underline hover:text-ink">閉じる</button>
        </div>
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{advice.text}</p>
        <p className="mt-2 text-[11px] text-muted">このアドバイスはお客様用レポートにも載ります。</p>
      </div>
    );
  }
  return <Button variant="subtle" icon="sparkles" className="w-full" onClick={onGenerate}>AIアドバイスを生成</Button>;
}

export function ResultsCard({ viewMode, flowPhase, analysis, total, advice, onGenerateAdvice, onCloseAdvice, onReference }) {
  return (
    <Card
      title={`${VIEW_LABELS[viewMode]}の分析結果`}
      icon="activity"
      actions={<Badge tone={flowPhase === 'before' ? 'brand' : 'gold'}>{flowPhase === 'before' ? 'Before' : 'After'}</Badge>}
    >
      <div className="flex items-center gap-4">
        <ScoreRing score={total} size={84} />
        <div className="min-w-0">
          <p className="text-sm font-bold text-ink">{VIEW_LABELS[viewMode]}総合スコア</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-2">{totalComment(total)}</p>
        </div>
      </div>
      <ScoreLegend className="mt-4" />
      <div className="mt-3">
        <ItemList analysis={analysis} onReference={onReference} />
      </div>
      <div className="mt-4 border-t border-line pt-4">
        <AdviceBlock advice={advice} onGenerate={onGenerateAdvice} onClose={onCloseAdvice} />
      </div>
    </Card>
  );
}

// ------------------------------------------------------------
// Before / After 比較
// ------------------------------------------------------------
const diffOf = (pair) => {
  const b = getTotal(pair.before.analysis);
  const a = getTotal(pair.after.analysis);
  return { b, a, d: b == null || a == null ? null : a - b };
};

export function ComparisonThumbs({ pairs, onOpen }) {
  return (
    <Card title="写真比較" subtitle="タップで拡大して比べられます" icon="columns-2">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 min-[1100px]:grid-cols-2 xl:grid-cols-4">
        {pairs.map((p) => {
          const { d } = diffOf(p);
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onOpen(p.key)}
              className="group overflow-hidden rounded-2xl border border-line bg-surface-2 text-left transition-shadow hover:shadow-pop active:scale-[0.98]"
              aria-label={`${p.label}のビフォーアフターを拡大`}
            >
              <div className="flex aspect-[4/3]">
                {[['Before', p.before.image], ['After', p.after.image]].map(([label, src], i) => (
                  <div key={label} className={cx('relative w-1/2 overflow-hidden', i === 0 ? 'border-r-2 border-white/80' : '')}>
                    <img src={src} alt={label} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent pb-1 pt-3 text-center text-[9px] font-bold uppercase tracking-wider text-white/90">{label}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between px-2.5 py-2">
                <span className="text-xs font-bold text-ink">{p.label}</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 text-[11px]">
                  {d != null ? <Icon name={d >= 0 ? 'trending-up' : 'trending-down'} size={12} className={d >= 0 ? 'text-[#0F6E56] dark:text-[#5fd3a8]' : 'text-[#c23b3a] dark:text-[#f29a99]'} /> : null}
                  <DiffText diff={d} />
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function TotalBox({ label, total }) {
  const tone = scoreTone(total);
  return (
    <div className={cx('flex-1 rounded-xl p-2 text-center', tone.soft)}>
      <p className="text-[10px] text-muted">{label}</p>
      <p className={cx('text-2xl font-bold num', tone.text)}>{total ?? '–'}</p>
    </div>
  );
}

export function ComparisonResults({ pairs, onClear }) {
  return (
    <Card
      title="Before / After 比較結果"
      icon="trending-up"
      actions={<Button size="sm" variant="ghost" icon="trash-2" onClick={onClear}>すべて消去</Button>}
    >
      <div className="space-y-5">
        {pairs.map((p) => {
          const { b, a, d } = diffOf(p);
          return (
            <section key={p.key}>
              <p className="mb-2 text-xs font-bold text-ink-2">{p.label}分析</p>
              <div className="mb-2 flex items-center gap-3">
                <TotalBox label="Before" total={b} />
                <div className="px-1 text-center">
                  <DiffText diff={d} className="block text-xl" />
                  <p className="text-[10px] font-bold text-muted">{d == null ? '' : d >= 0 ? '改善' : '低下'}</p>
                </div>
                <TotalBox label="After" total={a} />
              </div>
              <ul>
                {p.before.analysis.items.map((bI, i) => {
                  const aI = p.after.analysis.items[i];
                  if (!aI) return null;
                  return (
                    <li key={bI.key} className="flex items-center gap-2 border-b border-line py-1.5 text-xs last:border-0">
                      <span className="min-w-0 flex-1 font-bold text-ink-2">{bI.label}</span>
                      <span className="shrink-0 whitespace-nowrap text-right text-muted num">{bI.score} → {aI.score}</span>
                      <DiffText diff={aI.score - bI.score} className="w-10 shrink-0 text-right" />
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </Card>
  );
}
