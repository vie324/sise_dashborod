import { forwardRef } from 'react';
import { VIEW_LABELS, getTotal, isLowConfidence, scoreColor, scoreLabel, totalComment } from './scoring.js';
import { dotDate, honorific } from '../shared/labels.js';

// ============================================================
// お客様にお渡しする姿勢分析レポート（画像保存・共有・印刷用）
// ------------------------------------------------------------
// 保存した画像がテーマや端末で変わらないよう、色はすべて固定値で指定する
// （アプリのトークン色やダークモード用のクラスは使わない）。
// 旧画面の LINE 送信用メッセージと同じ内容・配色にしている。
// ============================================================

const C = {
  head: '#04342C',
  mint: '#5DCAA5',
  ink: '#1f2a24',
  text: '#333333',
  sub: '#666666',
  muted: '#888888',
  faint: '#aaaaaa',
  line: '#e8e8e8',
  foot: '#f8f7f4',
  up: '#0F6E56',
  down: '#E24B4A',
};

function Photo({ src, label, accent }) {
  if (!src) return null;
  return (
    <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', border: `1px solid ${C.line}`, background: '#111613' }}>
      <img src={src} alt={label || ''} style={{ display: 'block', width: '100%', height: 'auto' }} />
      {label ? (
        <span style={{ position: 'absolute', left: 8, top: 8, background: accent || 'rgba(0,0,0,0.55)', color: '#ffffff', fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', padding: '2px 8px', borderRadius: 999 }}>
          {label}
        </span>
      ) : null}
    </div>
  );
}

function SectionTitle({ children, color = C.head, style }) {
  return <p style={{ fontSize: 13, fontWeight: 700, color, margin: '0 0 8px', ...style }}>{children}</p>;
}

function ItemRow({ item }) {
  const low = isLowConfidence(item);
  const color = low ? C.faint : scoreColor(item.score);
  return (
    <div className="care-print-avoid" style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>{item.label}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color }}>{low ? '—' : item.score}</span>
      </div>
      <div style={{ marginTop: 4, height: 8, borderRadius: 4, background: C.line, overflow: 'hidden' }}>
        <div style={{ height: 8, borderRadius: 4, width: `${low ? 0 : Math.max(5, item.score)}%`, background: color }} />
      </div>
      <p style={{ margin: '4px 0 0', fontSize: 10.5, color: C.muted, lineHeight: 1.5 }}>
        {low ? `信頼度が低いため参考値 — ${item.value}` : `${item.detail} — ${item.value}${item.valueCm ? `（約${item.valueCm}）` : ''}`}
      </p>
      {item.reference ? (
        <p style={{ margin: '2px 0 0', fontSize: 9.5, color: C.faint }}>出典: {item.reference.authors} ({item.reference.year})</p>
      ) : null}
    </div>
  );
}

function SingleBody({ viewMode, analysis, image, advice }) {
  const total = getTotal(analysis);
  const view = VIEW_LABELS[viewMode];
  const color = scoreColor(total);
  const points = analysis.items.filter((i) => !isLowConfidence(i) && i.score < 70);
  return (
    <>
      <Photo src={image} />
      <div className="care-print-avoid" style={{ marginTop: 16, borderRadius: 16, padding: 16, textAlign: 'center', background: total >= 60 ? '#E1F5EE' : '#FAEEDA' }}>
        <p style={{ margin: 0, fontSize: 11, fontWeight: 700, color: C.sub }}>{view}総合スコア</p>
        <p style={{ margin: '4px 0 0', fontSize: 40, lineHeight: 1.1, fontWeight: 800, color }}>{total}</p>
        <p style={{ margin: '2px 0 0', fontSize: 13, fontWeight: 700, color }}>{scoreLabel(total)}</p>
        <p style={{ margin: '8px 0 0', fontSize: 11, color: '#555555', lineHeight: 1.6 }}>{totalComment(total)}</p>
      </div>

      <div style={{ marginTop: 20, borderTop: `1px solid ${C.line}`, paddingTop: 14 }}>
        <SectionTitle>各部位の分析結果</SectionTitle>
        {analysis.items.map((item) => <ItemRow key={item.key} item={item} />)}
      </div>

      {points.length ? (
        <div className="care-print-avoid" style={{ marginTop: 20, borderTop: `1px solid ${C.line}`, paddingTop: 14 }}>
          <SectionTitle color="#BA7517">改善ポイント</SectionTitle>
          {points.map((item) => (
            <p key={item.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, margin: '6px 0 0', fontSize: 12, color: '#555555', lineHeight: 1.6 }}>
              <span style={{ width: 7, height: 7, marginTop: 7, flexShrink: 0, borderRadius: 999, background: scoreColor(item.score) }} />
              <span>{item.label}：{item.detail}</span>
            </p>
          ))}
        </div>
      ) : null}

      {advice ? (
        <div className="care-print-avoid" style={{ marginTop: 20, borderRadius: 14, padding: 14, background: '#f1f8f4', border: '1px solid #d5ece2' }}>
          <SectionTitle style={{ marginBottom: 6 }}>セルフケアのアドバイス</SectionTitle>
          <p style={{ margin: 0, fontSize: 11.5, color: '#3b4a42', lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>{advice}</p>
        </div>
      ) : null}
    </>
  );
}

function PairScore({ label, total }) {
  const color = total == null ? '#999999' : scoreColor(total);
  return (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <p style={{ margin: 0, fontSize: 10, color: C.muted }}>{label}</p>
      <p style={{ margin: '2px 0 0', fontSize: 28, lineHeight: 1.15, fontWeight: 800, color }}>{total ?? '–'}</p>
      <p style={{ margin: 0, fontSize: 10, color }}>{total == null ? '–' : scoreLabel(total)}</p>
    </div>
  );
}

function PairBlock({ pair, images, first }) {
  const bTotal = getTotal(pair.before.analysis);
  const aTotal = getTotal(pair.after.analysis);
  const diff = bTotal != null && aTotal != null ? aTotal - bTotal : null;
  const up = diff != null && diff >= 0;
  return (
    <section className="care-print-avoid" style={first ? undefined : { marginTop: 22, borderTop: `1px solid ${C.line}`, paddingTop: 18 }}>
      <SectionTitle>{pair.label}分析</SectionTitle>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Photo src={images[`${pair.key}-before`] || pair.before.image} label="BEFORE" />
        <Photo src={images[`${pair.key}-after`] || pair.after.image} label="AFTER" accent="rgba(15,110,86,0.85)" />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', marginTop: 12 }}>
        <PairScore label="Before" total={bTotal} />
        <div style={{ flex: 1, textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 800, color: diff == null ? '#999999' : up ? C.up : C.down }}>
            {diff == null ? '–' : `${up ? '+' : ''}${diff}`}
          </p>
          <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: diff == null ? '#999999' : up ? C.up : C.down }}>
            {diff == null ? '–' : up ? '改善 ▲' : '低下 ▼'}
          </p>
        </div>
        <PairScore label="After" total={aTotal} />
      </div>
      <div style={{ marginTop: 10 }}>
        {pair.before.analysis.items.map((bI, i) => {
          const aI = pair.after.analysis.items[i];
          if (!aI) return null;
          const d = aI.score - bI.score;
          return (
            <div key={bI.key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, padding: '7px 10px', borderRadius: 8, background: d >= 0 ? '#E1F5EE' : '#FCEBEB' }}>
              <span style={{ flex: 4, fontSize: 11, fontWeight: 700, color: C.text }}>{bI.label}</span>
              <span style={{ flex: 3, fontSize: 11, color: C.sub, textAlign: 'right' }}>{bI.score} → {aI.score}</span>
              <span style={{ flex: 1, fontSize: 11, fontWeight: 800, textAlign: 'right', color: d >= 0 ? C.up : C.down }}>{d >= 0 ? '+' : ''}{d}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * @param {'single'|'comparison'} mode
 * @param images  合成済み画像 { single, 'front-before', ... }（無ければ元の写真）
 */
const PostureReportCard = forwardRef(function PostureReportCard({ mode, customerName, staffName, visitDate, viewMode, analysis, image, pairs = [], images = {}, advice = '' }, ref) {
  const comparison = mode === 'comparison';
  return (
    // 画面のプロポーショナル字詰め（palt）は画像化で再現されず字間が乱れるため、このカードでは使わない
    <article ref={ref} style={{ background: '#ffffff', color: C.ink, borderRadius: 20, overflow: 'hidden', border: '1px solid #e3e7e1', width: '100%', fontFeatureSettings: 'normal' }}>
      <header style={{ background: C.head, padding: '22px 20px 20px', textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: C.mint }}>si&apos;se 姿勢分析レポート</p>
        <p style={{ margin: '4px 0 0', fontSize: 10, letterSpacing: '0.12em', color: 'rgba(93,202,165,0.65)' }}>
          {comparison ? 'BEFORE / AFTER 比較' : 'POSTURE ANALYSIS REPORT'}
        </p>
        <div style={{ height: 1, background: 'rgba(93,202,165,0.2)', margin: '14px 0' }} />
        <p style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#ffffff' }}>{honorific(customerName)}</p>
        <p style={{ margin: '8px 0 0', fontSize: 11, color: C.mint }}>
          {dotDate(visitDate)}
          {!comparison ? `　${VIEW_LABELS[viewMode]}分析` : ''}
        </p>
      </header>

      <div style={{ padding: 20 }}>
        {comparison
          ? pairs.map((p, i) => <PairBlock key={p.key} pair={p} images={images} first={i === 0} />)
          : <SingleBody viewMode={viewMode} analysis={analysis} image={images.single || image} advice={advice} />}
      </div>

      <footer style={{ background: C.foot, padding: '14px 20px 16px' }}>
        <p style={{ margin: 0, fontSize: 10, color: C.muted, textAlign: 'right' }}>{staffName ? `${staffName} より` : '担当より'}</p>
        <div style={{ height: 1, background: C.line, margin: '10px 0' }} />
        <p style={{ margin: 0, fontSize: 10, color: C.faint, textAlign: 'center' }}>
          {comparison ? '施術による姿勢の変化をご確認ください' : '定期的な姿勢チェックで改善を実感しましょう'}
        </p>
        <p style={{ margin: '4px 0 0', fontSize: 9.5, color: '#bbbbbb', textAlign: 'center' }}>※スコアは査読付き学術論文の基準に基づいています</p>
      </footer>
    </article>
  );
});

export default PostureReportCard;
