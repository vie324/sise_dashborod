import { cx } from '../../../../ui/primitives.jsx';
import Icon from '../../../../ui/Icon.jsx';
import { yen, dateJa } from '../../../../lib/format.js';
import {
  CONCERN_CATEGORIES, CONCERN_ITEMS, PLAN_CARDS, ENTRY_FEE, planPricing, visitInterval,
} from '../../../../../shared/counseling.js';
import { CASCADE, SOLUTIONS, CONCEPT_MESSAGE, BENEFITS, OFFERS, TIPS } from '../content.jsx';
import { ImprovementChart, LINES, GROUPS, SCENARIOS } from '../Simulation.jsx';
import BodyMap from './BodyMap.jsx';

// ============================================================
// お客様へのご説明のスライド
// ------------------------------------------------------------
// 文字の大きさはすべて em（Presentation.jsx の .pz が画面の大きさから決める基準の文字の大きさ）。
// お客様に見せる画面なので、セラピスト用の情報（施術後の評価など）は出さない。
// ============================================================

/** si'se のロゴ（正方形の画像の中のワードマークだけを切り出す。画像 500px 中 x35〜464・y174〜318） */
export function Wordmark({ width = 8 }) {
  const img = (width * 500) / 429;
  return (
    <span className="relative block overflow-hidden" style={{ width: `${width}em`, height: `${(width * 144) / 429}em` }} aria-label="si'se" role="img">
      <img src="/images/logo.png" alt="" className="absolute max-w-none" style={{ width: `${img}em`, left: `${-(img * 35) / 500}em`, top: `${-(img * 174) / 500}em` }} />
    </span>
  );
}

function Frame({ eyebrow, title, lead, children, tone = 'brand', className = '' }) {
  return (
    <div className={cx('mx-auto flex min-h-full w-full max-w-[64em] flex-col justify-center px-[1.25em] py-[1.25em] sm:px-[2em]', className)}>
      <header className="pz-rise">
        {eyebrow ? <p className={cx('pz-eyebrow', tone === 'gold' ? 'text-gold-600' : 'text-brand-600')}>{eyebrow}</p> : null}
        {title ? <h2 className="pz-title pz-serif mt-[.35em]">{title}</h2> : null}
        {lead ? <p className="pz-lead mt-[.5em]">{lead}</p> : null}
      </header>
      <div className="mt-[1.4em]">{children}</div>
    </div>
  );
}

const Yen = ({ value, unit, className = '' }) => (
  <span className={cx('pz-num whitespace-nowrap', className)}>
    <span className="text-[.62em] font-bold">¥</span>{Number(value || 0).toLocaleString('ja-JP')}
    {unit ? <span className="ml-[.15em] text-[.42em] font-semibold text-muted">{unit}</span> : null}
  </span>
);

// 出てくる順をずらす（--d）
const delay = (i, step = 90) => ({ '--d': `${120 + i * step}ms` });

// ------------------------------------------------------------
// 1. 表紙
// ------------------------------------------------------------
export function Cover({ ctx }) {
  return (
    <div className="mx-auto flex min-h-full max-w-[52em] flex-col items-center justify-center px-[1.5em] py-[2em] text-center">
      <div className="pz-rise"><Wordmark width={11} /></div>
      <p className="pz-eyebrow pz-rise mt-[1.8em] text-gold-600" style={delay(1)}>Counseling &amp; Plan</p>
      <h1 className="pz-display pz-serif pz-rise mt-[.3em]" style={delay(2)}>
        {ctx.guestName ? <>{ctx.guestName}<span className="ml-[.25em] text-[.55em] font-semibold text-ink-2">様</span></> : <>ようこそ、si&#39;se へ</>}
      </h1>
      <p className="pz-lead pz-rise mt-[.9em]" style={delay(3)}>
        本日はご来店いただき、ありがとうございます。<br />
        これからのお身体づくりについて、ご案内いたします。
      </p>
      <p className="pz-rise mt-[1.8em] inline-flex items-center gap-[.5em] rounded-full border border-gold-200 bg-white/80 px-[1.2em] py-[.55em] text-[.95em] font-semibold text-gold-800 shadow-[0_6px_24px_-12px_rgb(133_82_17/0.35)]" style={delay(4)}>
        <Icon name="sparkles" size="1.1em" className="text-gold-500" />根本から改善し、繰り返さない身体へ
      </p>
      <p className="pz-rise mt-[2.2em] text-[.85em] text-muted" style={delay(5)}>
        {dateJa(ctx.date)}{ctx.staffName ? <>　担当 <span className="font-semibold text-ink-2">{ctx.staffName}</span></> : null}
      </p>
    </div>
  );
}

// ------------------------------------------------------------
// 1.5 ご記入いただいた内容（カウンセリングシートの回答がある時だけ）
//   お客様ご自身の言葉（お悩み・改善したい時期・ご要望）をそのまま大きく見せる。
//   施術前の確認（手術歴・治療中など）・年齢・住所は、お客様向けの画面には出さない。
// ------------------------------------------------------------
export function Voice({ ctx }) {
  const v = ctx.voice || { concerns: [], timeline: '', request: '' };
  return (
    <Frame eyebrow="Your Voice" title={`${ctx.honor}にご記入いただいた内容`} lead="カウンセリングシートに書いていただいたことを、一緒に確認させてください。">
      <div className={cx('grid gap-[1.2em]', v.timeline || v.request ? 'lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]' : '')}>
        <section className="pz-card pz-rise flex flex-col p-[1.3em]" style={delay(1)}>
          <h3 className="flex items-center gap-[.5em] text-[1.05em] font-bold text-brand-700">
            <Icon name="message-square" size="1.1em" />気になっているところ
          </h3>
          {v.concerns.length ? (
            <>
              <div className="mt-[.9em] flex flex-wrap gap-[.55em]">
                {v.concerns.map((c, i) => (
                  <span key={c} className="pz-rise rounded-full bg-brand-50 px-[1em] py-[.45em] text-[1.15em] font-bold text-brand-800 ring-1 ring-brand-200" style={delay(i + 2, 60)}>{c}</span>
                ))}
              </div>
              <p className="mt-auto flex items-center gap-[.4em] pt-[1.1em] text-[.85em] font-medium text-muted">
                <Icon name="arrow-right" size="1em" className="shrink-0" />次のページで、からだの図でも一緒に確認します
              </p>
            </>
          ) : <p className="mt-[.8em] text-[.95em] text-muted">お悩みのご記入はありませんでした。</p>}
        </section>
        {v.timeline || v.request ? (
          <div className="space-y-[1.2em]">
            {v.timeline ? (
              <section className="pz-rise rounded-[1.1em] bg-gradient-to-br from-gold-400 to-gold-500 p-[1.2em] text-white shadow-[0_14px_36px_-18px_rgb(167_108_15/0.9)]" style={delay(3)}>
                <p className="flex items-center gap-[.4em] text-[.9em] font-semibold text-white/90"><Icon name="target" size="1em" />改善したい時期</p>
                <p className="pz-serif mt-[.2em] text-[1.9em] font-bold leading-tight">{v.timeline}</p>
              </section>
            ) : null}
            {v.request ? (
              <figure className="pz-card pz-rise p-[1.2em]" style={delay(4)}>
                <figcaption className="text-[.85em] font-bold text-muted">施術のご要望</figcaption>
                <blockquote className="pz-serif mt-[.4em] whitespace-pre-wrap text-[1.2em] leading-relaxed text-ink">「{v.request}」</blockquote>
              </figure>
            ) : null}
          </div>
        ) : null}
      </div>
      <p className="pz-rise mt-[1.3em] flex items-center gap-[.6em] text-[1.05em] font-semibold text-brand-700" style={delay(5)}>
        <Icon name="circle-check" size="1.2em" className="shrink-0" />伺った内容をもとに、{ctx.honor}に合わせたケアをご提案します。
      </p>
    </Frame>
  );
}

// ------------------------------------------------------------
// 2. お悩み（からだの図 + 部位ごとのチェック。お客様にタップしていただける）
// ------------------------------------------------------------
export function Concerns({ ctx }) {
  const groups = CONCERN_CATEGORIES.map((cat) => {
    const items = CONCERN_ITEMS.filter((c) => c.cat === cat.key);
    return { ...cat, items, count: items.filter((c) => ctx.concerns[c.id]).length };
  });
  const active = Object.fromEntries(groups.map((g) => [g.key, g.count > 0]));
  const courses = groups.filter((g) => g.count > 0).map((g) => g.course);
  return (
    <Frame eyebrow="Your Body" title={`${ctx.honor}のお悩み`} lead="気になるところをタップしてください。">
      <div className="grid items-center gap-[1.5em] lg:grid-cols-[10em_minmax(0,1fr)]">
        <div className="pz-rise flex items-center justify-center gap-[1.5em] lg:flex-col" style={delay(1)}>
          <BodyMap active={active} className="h-[14em] w-auto lg:h-[21em]" />
        </div>
        <div className="grid gap-[1em] sm:grid-cols-3">
          {groups.map((g, i) => (
            <section key={g.key} className={cx('pz-card pz-rise p-[1em] transition-shadow', g.count ? 'ring-2 ring-brand-400/70' : '')} style={delay(i + 2)}>
              <header className="mb-[.7em] flex items-start gap-[.5em]">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-[.5em]">
                  <h3 className="whitespace-nowrap text-[1.15em] font-bold text-ink">{g.course}</h3>
                  <span className="whitespace-nowrap text-[.82em] text-muted">{g.area}</span>
                </div>
                {g.count ? <span className="ml-auto mt-[.15em] rounded-full bg-brand-600 px-[.6em] text-[.78em] font-bold leading-[1.7em] text-white">{g.count}</span> : null}
              </header>
              <div className="flex flex-wrap gap-[.45em] sm:flex-col">
                {g.items.map((item) => {
                  const on = !!ctx.concerns[item.id];
                  return (
                    <button key={item.id} type="button" role="checkbox" aria-checked={on} onClick={() => ctx.onToggleConcern(item.id)}
                      className={cx('pz-chip', on ? 'pz-chip-on' : '')}>
                      <span className={cx('pz-check', on ? 'pz-check-on' : '')} aria-hidden="true">{on ? <Icon name="check" size="0.8em" strokeWidth={3.2} /> : null}</span>
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
      <p className="pz-rise mt-[1.2em] flex flex-wrap items-center gap-[.5em] text-[.95em] text-ink-2" style={delay(6)}>
        {courses.length ? (
          <>
            <span className="font-semibold">必要なケア</span>
            {courses.map((c, i) => (
              <span key={c} className="inline-flex items-center gap-[.5em]">
                {i > 0 ? <span className="text-muted">＋</span> : null}
                <span className="rounded-full bg-brand-600 px-[.9em] py-[.2em] font-bold text-white">{c}</span>
              </span>
            ))}
          </>
        ) : <span className="text-muted">当てはまるお悩みを選ぶと、必要なケアが分かります。</span>}
      </p>
    </Frame>
  );
}

// ------------------------------------------------------------
// 3. なぜ不調は繰り返すのか
// ------------------------------------------------------------
export function Cause() {
  return (
    <Frame eyebrow="Why" title="なぜ、不調は繰り返すのでしょうか？">
      <ol className="w-full max-w-[46em]">
        {CASCADE.map((c, i) => (
          <li key={c.no} className="pz-rise" style={delay(i + 1, 140)}>
            {i > 0 ? <div className="flex h-[1.5em] items-center pl-[1.15em] text-muted" aria-hidden="true"><Icon name="arrow-down" size="1em" /></div> : null}
            <div className="grid items-center gap-x-[1em] gap-y-[.4em] sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <div className={cx('flex items-center gap-[.8em] rounded-[1em] border px-[1em] py-[.75em]',
                c.root ? 'border-[#efc0c0] bg-[#fdf2f2]' : 'border-line bg-white')}>
                <span className={cx('flex h-[1.8em] w-[1.8em] shrink-0 items-center justify-center rounded-full text-[.9em] font-bold',
                  c.root ? 'bg-[#c43434] text-white' : 'bg-surface-3 text-ink-2')}>{c.no}</span>
                <span className={cx('text-[1.15em] font-bold', c.root ? 'text-[#8f2121]' : 'text-ink')}>{c.text}</span>
                {c.root ? <span className="ml-auto rounded-full bg-[#c43434] px-[.7em] text-[.75em] font-bold leading-[1.8em] text-white">根本原因</span> : null}
              </div>
              {c.other ? (
                <div className="flex items-center gap-[.6em] pl-[.4em] text-[.95em] text-ink-2">
                  <Icon name="arrow-right" size="1em" className="hidden text-muted sm:block" />
                  {c.other}
                  <span className="rounded-full bg-surface-3 px-[.6em] text-[.78em] font-semibold leading-[1.7em] text-muted">一時的</span>
                </div>
              ) : <div className="hidden sm:block" />}
            </div>
          </li>
        ))}
      </ol>
      <div className="pz-rise mt-[1.4em] flex w-full max-w-[46em] items-center gap-[.8em] rounded-[1em] bg-surface-3 px-[1.2em] py-[.9em]" style={delay(6, 140)}>
        <Icon name="repeat" size="1.5em" className="shrink-0 text-ink-2" />
        <p className="text-[1.1em] text-ink-2"><strong className="text-ink">根本が変わらない限り</strong>、不調は繰り返してしまいます。</p>
      </div>
    </Frame>
  );
}

// ------------------------------------------------------------
// 4. si'se のアプローチ（悩みの連鎖のそれぞれに対応する）
// ------------------------------------------------------------
export function Approach() {
  return (
    <Frame eyebrow="Our Approach" title="si'se なら、根本からまとめてケア">
      <div className="w-full max-w-[56em] space-y-[.7em]">
        {SOLUTIONS.map((s, i) => {
          const c = CASCADE.find((x) => x.no === s.no);
          return (
            <div key={s.no} className="pz-rise grid items-center gap-[.6em] sm:grid-cols-[minmax(0,.8fr)_auto_minmax(0,1.4fr)]" style={delay(i + 1, 120)}>
              <div className="flex items-center gap-[.6em] text-[.95em] text-muted">
                <span className="flex h-[1.6em] w-[1.6em] shrink-0 items-center justify-center rounded-full bg-surface-3 text-[.85em] font-bold">{c.no}</span>
                <span className={s.root ? 'font-semibold text-[#9b2525]' : ''}>{c.text}</span>
              </div>
              <Icon name="arrow-right" size="1.2em" className="hidden text-brand-400 sm:block" />
              <div className={cx('flex items-center gap-[.8em] rounded-[1em] border px-[1em] py-[.7em]',
                s.root ? 'border-gold-300 bg-gradient-to-r from-gold-50 to-white shadow-[0_8px_24px_-16px_rgb(133_82_17/0.5)]' : 'border-brand-100 bg-white')}>
                <span className={cx('flex h-[2em] w-[2em] shrink-0 items-center justify-center rounded-full text-white', s.root ? 'bg-gold-500' : 'bg-brand-600')}>
                  <Icon name={s.root ? 'sparkles' : 'check'} size="1em" strokeWidth={2.4} />
                </span>
                {s.root ? (
                  <span className="min-w-0"><strong className="block text-[1.2em] text-ink">{s.lead}</strong><span className="text-[.92em] text-ink-2">{s.text}</span></span>
                ) : (
                  <span className="min-w-0"><span className="block text-[.85em] text-muted">{s.text}</span><strong className="text-[1.1em] text-ink">{s.lead}</strong></span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="pz-rise mt-[1.4em] w-full max-w-[56em] rounded-[1.1em] bg-brand-700 px-[1.4em] py-[1em] text-center text-white shadow-[0_16px_40px_-20px_rgb(29_87_59/0.8)]" style={delay(6, 120)}>
        <p className="pz-serif text-[1.3em] font-bold">{CONCEPT_MESSAGE.title}</p>
        <p className="mt-[.3em] text-[.9em] text-white/85">{CONCEPT_MESSAGE.text}</p>
      </div>
    </Frame>
  );
}

// ------------------------------------------------------------
// 5. 改善のイメージ
// ------------------------------------------------------------
export function Future({ ctx }) {
  const shown = LINES.filter((l) => ctx.activeLines[l.id]);
  const main = SCENARIOS[ctx.primaryLine] || null;
  // カウンセリングシートの「改善したい時期」（あれば。目標と「まずは3ヶ月」を並べて見せる）
  const goal = ctx.voice && ctx.voice.timeline ? ctx.voice.timeline : '';
  return (
    <Frame eyebrow="Your Future" title="通い方で、変わり方が違います">
      <div className="grid gap-[1.4em] lg:grid-cols-[minmax(0,1fr)_15em]">
        <div className="pz-card pz-rise p-[1em] pb-[.6em]" style={delay(1)}>
          <ImprovementChart active={ctx.activeLines} startMonth={ctx.startMonth} fontScale={ctx.chartScale} primary={ctx.primaryLine} />
          <div className="mt-[.4em] flex flex-wrap gap-[.4em]" aria-label="表示する通い方">
            {GROUPS.flatMap((g) => LINES.filter((l) => l.group === g.key)).map((l) => {
              const on = !!ctx.activeLines[l.id];
              return (
                <button key={l.id} type="button" role="switch" aria-checked={on} onClick={() => ctx.onToggleLine(l.id)}
                  className={cx('inline-flex items-center gap-[.45em] rounded-full border px-[.75em] py-[.3em] text-[.78em] font-semibold transition-colors',
                    on ? 'border-line-strong bg-white text-ink shadow-card' : 'border-transparent bg-surface-2 text-muted')}>
                  <svg width="1.4em" height=".5em" viewBox="0 0 18 6" aria-hidden="true"><line x1="1" y1="3" x2="17" y2="3" stroke={l.color} strokeWidth="3" strokeLinecap="round" strokeDasharray={l.revert ? '4 3' : undefined} style={{ opacity: on ? 1 : 0.5 }} /></svg>
                  {l.label}
                  {l.id === ctx.primaryLine ? <span className="rounded-full bg-brand-600 px-[.5em] text-[.9em] leading-[1.5em] text-white">おすすめ</span> : null}
                </button>
              );
            })}
          </div>
        </div>
        <aside className="flex flex-col gap-[1em]">
          {goal ? (
            <div className="pz-card pz-rise border-gold-200 p-[.9em]" style={delay(2)}>
              <p className="flex items-center gap-[.4em] text-[.8em] font-bold text-gold-700"><Icon name="target" size="1em" />{ctx.honor}の目標</p>
              <p className="mt-[.15em] text-[1.25em] font-bold leading-snug text-ink">{goal}</p>
            </div>
          ) : null}
          <div className="pz-rise rounded-[1.1em] bg-gradient-to-br from-gold-400 to-gold-500 p-[1.1em] text-white shadow-[0_14px_36px_-18px_rgb(167_108_15/0.9)]" style={delay(2)}>
            <p className="text-[.85em] font-semibold text-white/90">まずは</p>
            <p className="pz-num leading-none"><span className="text-[3.6em] font-bold">3</span><span className="ml-[.15em] text-[1.4em] font-bold">ヶ月</span></p>
            <p className="mt-[.5em] text-[.92em] leading-relaxed">継続が最も大切です。どのプランでも、最初の3ヶ月で身体の土台が整います。</p>
          </div>
          {shown.length ? (
            <div className="pz-rise space-y-[.6em]" style={delay(3)}>
              {(main && ctx.activeLines[ctx.primaryLine] ? [ctx.primaryLine] : []).concat(shown.map((l) => l.id).filter((id) => id !== ctx.primaryLine)).slice(0, goal ? 1 : 2).map((id) => {
                const l = LINES.find((x) => x.id === id);
                const sc = SCENARIOS[id];
                return (
                  <div key={id} className="rounded-[1em] border border-line bg-white/80 p-[.8em] text-[.82em] leading-relaxed text-ink-2">
                    <p className="mb-[.2em] flex items-center gap-[.5em] font-bold text-ink">
                      <svg width="1.4em" height=".5em" viewBox="0 0 18 6" aria-hidden="true"><line x1="1" y1="3" x2="17" y2="3" stroke={l.color} strokeWidth="3" strokeLinecap="round" strokeDasharray={l.revert ? '4 3' : undefined} /></svg>
                      {l.label}
                    </p>
                    {sc.desc}
                  </div>
                );
              })}
            </div>
          ) : null}
        </aside>
      </div>
      <p className="mt-[.8em] text-[.75em] text-muted">※ 改善のイメージです。感じ方・変化には個人差があります。</p>
    </Frame>
  );
}

// ------------------------------------------------------------
// 6. おすすめプラン（3つ。真ん中がおすすめ）
// ------------------------------------------------------------
const RANKS = [
  { key: 'matsu', label: 'しっかりコース', mark: '◆' },
  { key: 'take', label: 'おすすめ', mark: '★' },
  { key: 'ume', label: 'お手軽コース', mark: '●' },
];

function NeedConcerns({ ctx }) {
  return (
    <div className="pz-card pz-rise mx-auto max-w-[34em] p-[1.6em] text-center" style={delay(1)}>
      <Icon name="list-checks" size="2em" className="mx-auto text-brand-500" />
      <p className="mt-[.6em] text-[1.1em] font-bold text-ink">お悩みを選ぶと、{ctx.honor}に合ったプランをご提案します</p>
      <button type="button" onClick={() => ctx.go('concerns')} className="pz-btn pz-btn-primary mt-[1em]">
        <Icon name="chevron-left" size="1em" />お悩みを選ぶ
      </button>
    </div>
  );
}

export function Plans({ ctx }) {
  const rec = ctx.recommendation;
  return (
    <Frame eyebrow="Recommended Plan" title={`${ctx.honor}へのおすすめプラン`}
      lead={rec ? <>{rec.reasons.join('・')}のため、<strong className="text-ink">3つのプラン</strong>をご提案します。</> : null}>
      {rec ? (
        <div className="grid items-stretch gap-[1em] md:grid-cols-3 md:items-center">
          {RANKS.map((rank, i) => {
            const plan = rec[rank.key];
            const take = rank.key === 'take';
            const selected = ctx.selectedKey === plan.key;
            const p = planPricing(plan);
            return (
              <button key={rank.key} type="button" onClick={() => ctx.onSelectPlan(plan.key)} aria-pressed={selected}
                className={cx('pz-plan pz-rise', take ? 'pz-plan-take md:py-[1.9em]' : '', selected ? 'pz-plan-selected' : '', take ? 'order-first md:order-none' : '')} style={delay(i + 1, 110)}>
                {take ? <span className="pz-ribbon">おすすめ</span> : null}
                {selected ? <span className="absolute right-[.9em] top-[.9em] flex h-[1.7em] w-[1.7em] items-center justify-center rounded-full bg-brand-600 text-white"><Icon name="check" size="1em" strokeWidth={3} /></span> : null}
                {take ? null : (
                  <span className="inline-flex w-fit items-center gap-[.3em] rounded-full bg-surface-3 px-[.7em] text-[.78em] font-bold leading-[1.9em] text-ink-2">
                    <span aria-hidden="true">{rank.mark}</span>{rank.label}
                  </span>
                )}
                <span className={cx('pz-serif block font-bold leading-tight text-ink', take ? 'text-[1.95em]' : 'mt-[.5em] text-[1.7em]')}>{plan.name}</span>
                <span className="mt-[.1em] block text-[1.05em] font-bold text-brand-700">{plan.freqLabel}</span>
                <span className="mt-[.2em] block text-[.85em] text-muted">{plan.types}</span>
                <span className="mt-[.6em] block text-[.9em] leading-relaxed text-ink-2">{plan.desc}</span>
                <span className="mt-auto block border-t border-line pt-[.8em]">
                  <Yen value={p.price} unit="/月" className="block text-[2.1em] font-bold leading-none text-ink" />
                  <span className="mt-[.45em] flex flex-wrap items-center gap-x-[.6em] gap-y-[.3em] text-[.82em]">
                    <span className="text-ink-2">1回あたり <strong className="pz-num text-ink">{yen(p.perVisit)}</strong></span>
                    {p.savings ? <span className="rounded-full bg-gold-50 px-[.6em] font-bold leading-[1.8em] text-gold-700">毎月 {yen(p.savings)} おトク</span> : null}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : <NeedConcerns ctx={ctx} />}
      {rec ? <p className="mt-[1em] text-center text-[.8em] text-muted">カードをタップすると、プランを選べます。通常の料金は 1回の料金 × 回数です。</p> : null}
    </Frame>
  );
}

// ------------------------------------------------------------
// 7. 料金プラン（全プラン。行をタップで選べる）
// ------------------------------------------------------------
export function Prices({ ctx }) {
  const sel = ctx.selectedPlan;
  return (
    <Frame eyebrow="Price" title="料金プラン">
      <div className="pz-rise mb-[1.2em] flex flex-wrap items-center gap-[.6em] text-[.95em]" style={delay(1)}>
        <span className="rounded-full bg-white px-[1em] py-[.35em] font-semibold text-ink-2 shadow-card">初回入会費 一律 <span className="pz-num">{yen(ENTRY_FEE)}</span></span>
        <Icon name="arrow-right" size="1em" className="text-gold-500" />
        <span className="rounded-full bg-gold-500 px-[1em] py-[.35em] font-bold text-white">本日のご契約で <span className="pz-num">¥0</span></span>
      </div>
      <div className="grid gap-[1em] sm:grid-cols-2 lg:grid-cols-4">
        {PLAN_CARDS.map((card, i) => {
          const picked = sel && sel.id === card.id;
          return (
            <section key={card.id} className={cx('pz-card pz-rise flex flex-col p-[1.1em]', picked ? 'ring-2 ring-brand-500' : '')} style={delay(i + 2, 100)}>
              <header className="flex items-start justify-between gap-[.5em]">
                <h3 className="pz-serif text-[1.45em] font-bold leading-tight text-ink">{card.name}</h3>
                {card.badge ? (
                  <span className={cx('shrink-0 rounded-full px-[.6em] text-[.75em] font-bold leading-[1.8em]', card.id === 'Standard' ? 'bg-gold-50 text-gold-700' : 'bg-brand-50 text-brand-700')}>{card.badge}</span>
                ) : null}
              </header>
              <p className="mt-[.3em] text-[.85em] leading-snug text-ink-2">{card.types[0]}<strong className="text-ink">{card.types[1]}</strong></p>
              <p className="mt-[.2em] text-[.78em] text-muted">通常 1回 {yen(card.unitPrice)}</p>
              <div className="mt-auto space-y-[.45em] pt-[.8em]">
                {card.prices.map((row) => {
                  const key = `${card.id}-${row.freq}`;
                  const hit = sel && sel.key === key;
                  return (
                    <button key={row.freq} type="button" onClick={() => ctx.onSelectPlan(key)} aria-pressed={!!hit}
                      className={cx('flex w-full items-center justify-between gap-[.5em] rounded-[.8em] px-[.8em] py-[.55em] text-left transition-colors',
                        hit ? 'bg-brand-600 text-white shadow-[0_10px_24px_-14px_rgb(29_87_59/0.9)]' : 'bg-surface-2 text-ink hover:bg-surface-3')}>
                      <span className="min-w-0">
                        <span className={cx('block text-[.82em] font-bold', hit ? 'text-white' : 'text-ink-2')}>月{row.freq}回</span>
                        <span className={cx('pz-num block text-[.72em]', hit ? 'text-white/80' : 'text-muted')}>1回 {yen(Math.round(row.price / row.freq))}</span>
                      </span>
                      <span className="text-right">
                        <span className={cx('pz-num block text-[.75em] line-through', hit ? 'text-white/70' : 'text-muted')}>{yen(row.regular)}</span>
                        <span className="pz-num block text-[1.25em] font-bold leading-tight">{yen(row.price)}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </Frame>
  );
}

// ------------------------------------------------------------
// 8. サブスク会員 3つのポイント / 9. 本日の特典
// ------------------------------------------------------------
function Points({ items, tone }) {
  const gold = tone === 'gold';
  return (
    <ol className="grid gap-[1em] md:grid-cols-3">
      {items.map((b, i) => (
        <li key={i} className={cx('pz-card pz-rise flex flex-col overflow-hidden', gold ? 'border-gold-200' : '')} style={delay(i + 1, 130)}>
          <div className={cx('relative flex items-center justify-center py-[1.3em]', gold ? 'bg-gradient-to-br from-gold-50 to-gold-100' : 'bg-gradient-to-br from-brand-50 to-[#e4f2e9]')}>
            <span className={cx('flex h-[3.6em] w-[3.6em] items-center justify-center rounded-full bg-white shadow-[0_10px_24px_-14px_rgb(16_24_20/0.45)]', gold ? 'text-gold-600' : 'text-brand-600')}>
              <Icon name={b.icon} size="1.8em" strokeWidth={1.6} />
            </span>
            <span className={cx('pz-serif absolute left-[.8em] top-[.5em] text-[1.6em] font-bold', gold ? 'text-gold-300' : 'text-brand-300')} aria-hidden="true">{'①②③'[i]}</span>
          </div>
          <div className="flex flex-1 flex-col p-[1.2em]">
            <h3 className={cx('text-[1.2em] font-bold leading-snug text-ink', gold ? 'pz-mark-gold' : 'pz-mark-brand')}>{b.title}</h3>
            <p className="mt-[.55em] text-[.9em] leading-relaxed text-ink-2">{b.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function Benefits() {
  return (
    <Frame eyebrow="Member Benefits" title="サブスク会員 3つのポイント" lead="忙しい月も、ご家族とも。無理なく続けられる仕組みです。">
      <Points items={BENEFITS} />
    </Frame>
  );
}

export function Offers() {
  return (
    <Frame eyebrow="Today's Special" tone="gold" title="本日ご契約で、3つの特典" lead={<>本日ご契約いただいた方だけの特典です。</>}>
      <div className="pz-rise mb-[1.2em] flex flex-wrap items-center justify-center gap-[.8em] rounded-[1.1em] border border-gold-200 bg-white/80 px-[1.2em] py-[.8em]" style={delay(0)}>
        <span className="text-[.95em] font-semibold text-ink-2">初回入会費</span>
        <span className="pz-num text-[1.4em] font-bold text-muted line-through decoration-2">{yen(ENTRY_FEE)}</span>
        <Icon name="arrow-right" size="1.2em" className="text-gold-500" />
        <span className="pz-num text-[2.2em] font-bold leading-none text-gold-600">¥0</span>
      </div>
      <Points items={OFFERS} tone="gold" />
    </Frame>
  );
}

// ------------------------------------------------------------
// 10. まとめ（選んだプラン・本日の特典・これからの通い方）
// ------------------------------------------------------------
export function Summary({ ctx }) {
  const plan = ctx.selectedPlan;
  const p = planPricing(plan);
  const pace = plan ? visitInterval(plan.freq) : null;
  return (
    <Frame eyebrow="Your Plan" title={`${ctx.honor}のプラン`}>
      <div className="grid gap-[1.2em] md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <div className="space-y-[1em]">
          {plan ? (
            <div className="pz-rise relative overflow-hidden rounded-[1.2em] bg-gradient-to-br from-brand-600 to-brand-800 p-[1.4em] text-white shadow-[0_20px_48px_-24px_rgb(22_58_41/0.9)]" style={delay(1)}>
              <span className="pointer-events-none absolute -right-[3em] -top-[3em] h-[10em] w-[10em] rounded-full bg-white/10" aria-hidden="true" />
              <p className="text-[.85em] font-semibold text-white/80">{plan.types}</p>
              <p className="pz-serif mt-[.2em] text-[2em] font-bold leading-tight">{plan.name}<span className="ml-[.4em] text-[.55em] font-semibold">{plan.freqLabel}</span></p>
              <Yen value={p.price} unit="/月" className="mt-[.5em] block text-[2.6em] font-bold leading-none [&_.text-muted]:text-white/70" />
              <p className="mt-[.6em] flex flex-wrap gap-x-[1em] gap-y-[.3em] text-[.9em] text-white/90">
                <span>1回あたり <strong className="pz-num text-white">{yen(p.perVisit)}</strong></span>
                {p.savings ? <span>通常より毎月 <strong className="pz-num text-gold-200">{yen(p.savings)}</strong> おトク</span> : null}
              </p>
            </div>
          ) : (
            <div className="pz-card pz-rise p-[1.4em] text-center" style={delay(1)}>
              <p className="text-[1.05em] font-bold text-ink">プランをお選びください</p>
              <button type="button" onClick={() => ctx.go(ctx.recommendation ? 'plans' : 'prices')} className="pz-btn pz-btn-primary mt-[.9em]">
                <Icon name="chevron-left" size="1em" />{ctx.recommendation ? 'おすすめプランを見る' : '料金プランを見る'}
              </button>
            </div>
          )}
          <div className="pz-card pz-rise border-gold-200 p-[1.1em]" style={delay(2)}>
            <p className="mb-[.6em] flex items-center gap-[.5em] text-[.95em] font-bold text-gold-700"><Icon name="gift" size="1.1em" />本日ご契約の特典</p>
            <ul className="grid gap-[.45em]">
              {OFFERS.map((o) => (
                <li key={o.short} className="flex items-center gap-[.6em] text-[.95em] font-semibold text-ink">
                  <span className="flex h-[1.4em] w-[1.4em] shrink-0 items-center justify-center rounded-full bg-gold-500 text-white"><Icon name="check" size=".85em" strokeWidth={3} /></span>
                  {o.short}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="space-y-[1em]">
          {pace ? (
            <div className="pz-card pz-rise flex items-center gap-[1em] p-[1.1em]" style={delay(3)}>
              <span className="flex h-[2.8em] w-[2.8em] shrink-0 items-center justify-center rounded-[.9em] bg-brand-50 text-brand-600"><Icon name="calendar-check" size="1.5em" /></span>
              <span>
                <span className="block text-[.85em] text-muted">次回のご来店の目安（{pace.pace}ペース）</span>
                <span className="block text-[1.5em] font-bold text-ink">{pace.next}</span>
              </span>
            </div>
          ) : null}
          <ol className="pz-card pz-rise space-y-[.8em] p-[1.1em]" style={delay(4)}>
            {TIPS.map((t, i) => (
              <li key={t.lead} className="flex gap-[.7em]">
                <span className="flex h-[1.6em] w-[1.6em] shrink-0 items-center justify-center rounded-full bg-brand-600 text-[.85em] font-bold text-white">{i + 1}</span>
                <p className="text-[.95em] leading-relaxed text-ink-2"><strong className="text-ink">{t.lead}</strong>{t.text}</p>
              </li>
            ))}
          </ol>
          <p className="pz-serif pz-rise text-center text-[1.2em] font-bold text-brand-700" style={delay(5)}>一緒に、繰り返さない身体をつくりましょう。</p>
        </div>
      </div>
    </Frame>
  );
}
