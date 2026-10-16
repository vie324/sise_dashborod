import { forwardRef } from 'react';
import { RadarChart } from '../../../ui/charts.jsx';
import { RADAR_AXES, textLines } from './reportData.js';

// ============================================================
// お客様にお渡しするアフターケアシート（画像保存・共有・印刷用）
// ------------------------------------------------------------
// 保存した画像がテーマや端末で変わらないよう、色はすべて固定値で指定する
// （アプリのトークン色やダークモード用のクラスは使わない）。
// ============================================================

const C = {
  ink: '#374151',
  body: '#4b5563',
  green: '#6ca88a',
  greenLight: '#9cc7b1',
  greenPale: '#e1efe7',
  greenWash: '#f6faf8',
  greenDeep: '#345244',
  greenMid: '#52856d',
  chip: '#c5e0d1',
};

function Heading({ children, style }) {
  return (
    <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textAlign: 'center', color: C.greenLight, ...style }}>
      {children}
    </p>
  );
}

function Lines({ text, style }) {
  return (
    <p style={{ margin: 0, ...style }}>
      {textLines(text).map((line, i) => (
        <span key={i} style={{ display: 'block' }}>{line}</span>
      ))}
    </p>
  );
}

const ReportPreviewCard = forwardRef(function ReportPreviewCard({ displayName, displayDate, menus, scores, photo, comment, stretches, customStretch, coupon, couponExpiry }, ref) {
  const custom = (customStretch || '').trim();
  const homeCareCard = { padding: 16, borderRadius: 12, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.3)' };
  return (
    // 画面のプロポーショナル字詰め（palt）は画像化で再現されず字間が乱れるため、このカードでは使わない
    <article ref={ref} style={{ background: '#ffffff', color: C.ink, borderRadius: 20, overflow: 'hidden', minHeight: 700, width: '100%', border: '1px solid #e3e7e1', fontFeatureSettings: 'normal' }}>
      <div style={{ height: 12, background: `linear-gradient(to right, ${C.greenLight}, ${C.green})` }} />

      <header style={{ padding: '24px 24px 16px', textAlign: 'center', background: C.greenWash }}>
        <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', color: C.green }}>PERSONAL AFTER CARE SHEET</p>
        <h2 style={{ margin: '0 0 4px', fontSize: 24, fontWeight: 700, color: C.ink }}>{displayName}</h2>
        <p style={{ margin: 0, fontSize: 12, fontWeight: 500, color: C.greenLight }}>{displayDate}</p>
      </header>

      <section style={{ padding: '0 24px', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 0' }}>
          <span style={{ flex: 1, height: 1, background: C.greenPale }} />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', color: C.greenLight }}>TODAY&apos;S MENU</span>
          <span style={{ flex: 1, height: 1, background: C.greenPale }} />
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10 }}>
          {menus.length === 0 ? (
            <span style={{ fontSize: 12, color: C.greenLight }}>施術内容なし</span>
          ) : menus.map((m) => (
            <span key={m} style={{ padding: '8px 16px', fontSize: 14, fontWeight: 700, borderRadius: 8, border: `2px solid ${C.chip}`, background: C.greenPale, color: C.greenDeep }}>{m}</span>
          ))}
        </div>
      </section>

      <section className="care-print-avoid" style={{ padding: '0 24px', marginBottom: 24 }}>
        <Heading>BODY BALANCE</Heading>
        <div style={{ display: 'flex', justifyContent: 'center', borderRadius: 16, padding: 6, background: C.greenWash, border: '1px solid #ecf4ef' }}>
          <RadarChart axes={RADAR_AXES} values={scores} max={5} size={240} stroke={C.green} fill="rgba(108,168,138,0.35)" grid="#d5e7dc" text={C.greenMid} />
        </div>
      </section>

      {photo ? (
        <section className="care-print-avoid" style={{ padding: '0 24px', marginBottom: 24 }}>
          <Heading>YOUR CONDITION</Heading>
          <div style={{ borderRadius: 12, overflow: 'hidden', border: `1px solid ${C.greenPale}`, background: '#f7f7f7' }}>
            <img src={photo} alt="お身体の状態" style={{ display: 'block', width: '100%', height: 'auto', maxHeight: 300, objectFit: 'contain' }} />
          </div>
        </section>
      ) : null}

      <section className="care-print-avoid" style={{ padding: '0 24px', marginBottom: 32 }}>
        <Heading style={{ marginBottom: 12 }}>FEEDBACK &amp; GOAL</Heading>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', top: -10, left: -4, fontSize: 36, lineHeight: 1, fontFamily: 'Georgia, serif', color: C.chip }}>&ldquo;</span>
          <p style={{ margin: 0, padding: '4px 0 4px 24px', borderLeft: `2px solid ${C.greenLight}`, fontSize: 14, lineHeight: 1.75, color: C.body, whiteSpace: 'pre-wrap' }}>{comment}</p>
        </div>
      </section>

      <section style={{ padding: '24px 24px 32px', minHeight: 200, color: '#ffffff', background: `linear-gradient(to bottom right, ${C.greenMid}, ${C.greenDeep})` }}>
        <p style={{ margin: '0 0 24px', textAlign: 'center', fontSize: 14, fontWeight: 700, letterSpacing: '0.2em', color: C.greenPale }}>HOME CARE</p>
        <div style={{ display: 'grid', gap: 16 }}>
          {stretches.length === 0 && !custom ? (
            <p style={{ margin: 0, textAlign: 'center', fontSize: 12, lineHeight: 1.7, color: C.greenPale, opacity: 0.75 }}>
              本日の特別な宿題はありません
              <br />
              水分をしっかり摂って休みましょう
            </p>
          ) : null}
          {stretches.map((s) => (
            <div key={`${s.cat}-${s.id}`} className="care-print-avoid" style={homeCareCard}>
              <p style={{ margin: '0 0 8px', paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.2)', fontSize: 14, fontWeight: 700, color: '#ffffff' }}>{s.title}</p>
              <Lines text={s.text} style={{ fontSize: 12, lineHeight: 1.7, color: '#f2f8f5' }} />
            </div>
          ))}
          {custom ? (
            <div className="care-print-avoid" style={homeCareCard}>
              <p style={{ margin: '0 0 8px', paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.2)', fontSize: 14, fontWeight: 700, color: '#ffffff' }}>その他の宿題</p>
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.7, color: '#f2f8f5', whiteSpace: 'pre-wrap' }}>{custom}</p>
            </div>
          ) : null}
        </div>

        {coupon ? (
          <div className="care-print-avoid" style={{ margin: '32px 8px 0' }}>
            <div style={{ position: 'relative', overflow: 'hidden', textAlign: 'center', padding: '0 16px 16px', borderRadius: 10, border: '2px solid #eab308', background: 'linear-gradient(135deg, #fffbf0 0%, #ffffff 50%, #fffbf0 100%)', color: '#1f2937' }}>
              <div style={{ height: 4, margin: '0 -16px', background: '#facc15' }} />
              <span style={{ display: 'inline-block', marginBottom: 12, padding: '2px 12px', borderRadius: '0 0 6px 6px', background: '#facc15', color: '#ffffff', fontSize: 10, fontWeight: 700, letterSpacing: '0.15em' }}>SPECIAL COUPON</span>
              <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700, lineHeight: 1.35 }}>{coupon.title}</p>
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ marginBottom: 4, fontSize: 12, color: '#9ca3af', textDecoration: 'line-through' }}>{coupon.old}</span>
                <span style={{ fontSize: 18, fontWeight: 700, color: '#ef4444' }}>→</span>
                <span style={{ fontSize: 26, fontWeight: 900, color: '#ef4444' }}>{coupon.price}</span>
              </div>
              {/* html2canvas は inline-block の中のブロック要素の文字を描かないため、幅を詰めたブロックで中央に置く */}
              <p style={{ width: 'fit-content', margin: '0 auto 8px', padding: '4px 8px', borderRadius: 4, border: '1px solid #fee2e2', background: '#fef2f2', fontSize: 10, fontWeight: 700, color: '#ef4444' }}>
                <span>有効期限: </span>
                <span style={{ fontSize: 12, color: '#dc2626' }}>{couponExpiry}</span>
                <span> まで</span>
              </p>
              <div style={{ textAlign: 'left', padding: 8, borderRadius: 4, border: '1px solid #fef9c3', background: 'rgba(255,255,255,0.6)', fontSize: 9.5, lineHeight: 1.6, color: '#6b7280' }}>
                {coupon.notes.map((n) => <span key={n} style={{ display: 'block' }}>{n}</span>)}
              </div>
            </div>
          </div>
        ) : null}

        <div style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.1)', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 10, lineHeight: 1.7, color: C.chip, opacity: 0.9 }}>
            美しさは日々の積み重ねから
            <br />
            ご不明点はLINEにていつでもご相談ください。
          </p>
        </div>
      </section>
    </article>
  );
});

export default ReportPreviewCard;
