import { Badge, Card, cx } from '../../../ui/primitives.jsx';
import Icon from '../../../ui/Icon.jsx';
import { yen } from '../../../lib/format.js';
import { ENTRY_FEE, PLAN_CARDS } from '../../../../shared/counseling.js';

// ============================================================
// お客様に見せる説明（コンセプト・料金表・会員のポイント・当日特典）
// 文言と金額は以前の画面と同じ。金額は shared/counseling.js の PLAN_CARDS。
// ============================================================

// ------------------------------------------------------------
// コンセプト説明（なぜ不調は繰り返すのか → si'se なら）
// ------------------------------------------------------------
const CASCADE = [
  { no: '1', text: '日常の姿勢・癖', root: true },
  { no: '2', text: '骨格の歪み', other: '整体院で対処' },
  { no: '3', text: '筋肉の硬化・コリ', other: 'マッサージで対処' },
  { no: '4', text: 'インナーマッスル低下', other: 'エステ・ジムで対処' },
];

const SOLUTIONS = [
  { no: '✦', lead: '正しい姿勢指導', text: '根本から改善し繰り返さない身体へ', root: true },
  { no: '2', lead: '安心安全な骨格矯正', text: 'ソフトな手技で' },
  { no: '3', lead: 'ボディケア', text: '矯正精度を上げる' },
  { no: '4', lead: '自身で身体のケア', text: 'セルフケア指導で' },
];

export function ConceptPanel() {
  return (
    <Card className="animate-rise-in" pad>
      <div className="mb-4 flex items-center gap-3">
        {/* ヘッダーのロゴと同じ切り取り方（正方形の画像の中央のワードマークだけ見せる） */}
        <div className="h-9 w-[92px] shrink-0 overflow-hidden" aria-label="si'se">
          <img src="/images/logo.png" alt="si'se" className="-mt-[28px] w-[92px] max-w-none dark:[filter:invert(1)_hue-rotate(180deg)]" />
        </div>
        <span className="h-px flex-1 bg-gradient-to-r from-brand-200 to-transparent dark:from-brand-500/40" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-surface-2 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-ink">なぜ不調は繰り返すのか？</h3>
            <Badge tone="bad">悩みの連鎖</Badge>
          </div>
          <ol className="space-y-1.5">
            {CASCADE.map((c, i) => (
              <li key={c.no}>
                {i > 0 ? <div className="py-0.5 pl-5 text-xs text-muted" aria-hidden="true">↓</div> : null}
                <div className="flex flex-wrap items-center gap-2">
                  <div className={cx('flex min-w-[11rem] items-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-semibold',
                    c.root ? 'border-[#efc0c0] bg-[#fdf2f2] text-[#8f2121] dark:border-[#d03b3b]/35 dark:bg-[#d03b3b]/10 dark:text-[#f2b0b0]' : 'border-line bg-surface text-ink')}>
                    <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold', c.root ? 'bg-[#c43434] text-white' : 'bg-surface-3 text-ink-2')}>{c.no}</span>
                    {c.text}
                    {c.root ? <span className="ml-auto text-[10px] font-bold">根本原因</span> : null}
                  </div>
                  {c.other ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
                      <Icon name="arrow-right" size={12} className="text-muted" />{c.other}
                      <span className="rounded-full bg-surface-3 px-1.5 text-[10px] font-semibold text-muted">一時的</span>
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex items-center gap-2 rounded-xl bg-surface-3 px-3 py-2 text-xs text-ink-2">
            <Icon name="repeat" size={15} className="text-muted" />
            <span><em className="font-bold not-italic text-ink">根本が変わらない限り</em>繰り返す</span>
          </div>
        </section>
        <section className="rounded-2xl border border-brand-200 bg-brand-50/60 p-4 dark:border-brand-500/30 dark:bg-brand-500/10">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-ink">si'se なら、すべて解決</h3>
            <Badge tone="brand">ワンストップで対応</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {SOLUTIONS.map((s) => (
              <div key={s.no} className={cx('rounded-xl border bg-surface p-3 text-xs leading-relaxed text-ink-2', s.root ? 'col-span-2 border-brand-300 dark:border-brand-500/40' : 'border-line')}>
                <span className={cx('mb-1 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold', s.root ? 'bg-gold-500 text-white' : 'bg-brand-600 text-white')}>{s.no}</span>
                {s.root ? <><strong className="text-[13px] text-ink">{s.lead}</strong><br />{s.text}</> : <>{s.text}<br /><strong className="text-[13px] text-ink">{s.lead}</strong></>}
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="mt-4 rounded-xl bg-brand-600 px-4 py-3 text-center text-white">
        <div className="text-sm font-bold">どの段階のお悩みでも、根本から改善し維持できる</div>
        <div className="mt-0.5 text-xs opacity-90">一般的なサロンは各段階の「対処」だけ。si'seは全段階＋根本原因をまとめてケアします。</div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------
// 03 プラン選択（料金表）
// ------------------------------------------------------------
/**
 * @param {{ id:string, freq:number }|null} recommended 診断で選んでいるプラン（料金表で強調する）
 */
export function PlanPrices({ recommended }) {
  return (
    <Card title="03 プラン選択" icon="tags" subtitle="ヒアリング結果に基づいたおすすめプランがハイライトされています">
      <div className="mb-4 text-center">
        <span className="inline-block rounded-full bg-brand-50 px-5 py-1.5 text-[13px] font-semibold text-brand-800 dark:bg-brand-500/15 dark:text-brand-100">
          初回入会費一律：{yen(ENTRY_FEE)}
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {PLAN_CARDS.map((p) => {
          const rec = recommended && recommended.id === p.id;
          return (
            <div key={p.id} className={cx('relative rounded-2xl border p-4 transition-shadow',
              rec ? 'border-brand-500 bg-brand-50/50 shadow-pop ring-1 ring-brand-500 dark:bg-brand-500/10' : 'border-line bg-surface')}>
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                {rec ? <Badge tone="brand" icon="sparkles">診断おすすめ</Badge> : null}
                {p.badge ? <Badge tone={p.id === 'Standard' ? 'gold' : 'info'}>{p.badge}{p.id === 'Standard' ? ' ★' : ''}</Badge> : null}
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-lg font-bold text-ink">{p.name}</h3>
                <span className="text-xs text-muted">1回 {yen(p.unitPrice)}</span>
              </div>
              <p className="mt-0.5 text-xs text-ink-2">{p.types[0]}<strong className="text-ink">{p.types[1]}</strong></p>
              <div className="mt-3 space-y-1.5">
                {p.prices.map((row) => {
                  const hit = rec && recommended.freq === row.freq;
                  return (
                    <div key={row.freq} className={cx('flex items-center justify-between gap-2 rounded-xl px-3 py-2',
                      hit ? 'bg-brand-600 text-white' : 'bg-surface-2')}>
                      <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-bold', hit ? 'bg-white/20' : 'bg-surface-3 text-ink-2')}>月{row.freq}回</span>
                      <span className="flex items-baseline gap-2">
                        <span className={cx('text-xs line-through', hit ? 'text-white/70' : 'text-muted')}>{yen(row.regular)}</span>
                        <Icon name="chevron-right" size={12} className={hit ? 'text-white/70' : 'text-muted'} />
                        <span className={cx('num text-lg font-bold', hit ? 'text-white' : 'text-ink')}>{yen(row.price)}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------
// サブスク会員 3つのポイント / 当日契約で3つの特典 / プラン選びのポイント
// ------------------------------------------------------------
const BENEFITS = [
  { title: <>通えなかった回数は<mark>翌月まで繰越可能！</mark></>, text: '「たまたま忙しい月が、、、」そんな時もお客様が損しない設計を目指しています！' },
  { title: <>効果を高める<mark>セルフケア指導！</mark></>, text: <>日常生活動作やセルフケアに関する事を<strong>サブスク会員限定</strong>で指導付き◎</> },
  { title: <>加入プラン分の回数を<mark>シェアも可能！</mark></>, text: 'ご家族・ご友人と回数のシェアも可能！月4回プランを親しい人と2回ずつシェアすると、月2回プランをさらにお得に通えます！' },
];

const OFFERS = [
  { title: <>入会費用5,000円が<mark>無料（0円）</mark>に！</>, text: <>はじめてサブスク会員に登録いただく方は初回5,000円頂戴しておりますが、<strong>当日のご契約で無料に！</strong></> },
  { title: <>解約費<mark>無料</mark>！翌月プラン変更・解約可能！</>, text: <>通常しっかり効果を感じていただくために3ヶ月以内の解約は解約金をいただいております。<strong>リニューアル記念で解約金も0円</strong>で翌月から解約OK！</> },
  { title: <>当日契約限定で指名料が<mark>ずっと無料</mark>に！</>, text: <>施術の体感があうセラピストの指名予約が<strong>永年無料</strong>に！身体の状態をより深く理解した担当者による施術で効果も◎</> },
];

const MARK = '[&_mark]:bg-transparent [&_mark]:font-bold';

function Numbered({ items, tone }) {
  return (
    <ol className="grid gap-3 md:grid-cols-3">
      {items.map((b, i) => (
        <li key={i} className={cx('flex gap-3 rounded-xl border p-3.5', tone === 'gold' ? 'border-gold-200 bg-surface dark:border-gold-500/30' : 'border-line bg-surface-2')}>
          <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white', tone === 'gold' ? 'bg-gold-500' : 'bg-brand-600')}>{'①②③'[i]}</span>
          <div className="min-w-0">
            <h4 className={cx('text-[13px] font-bold leading-snug text-ink', MARK, tone === 'gold' ? '[&_mark]:text-gold-700 dark:[&_mark]:text-gold-300' : '[&_mark]:text-brand-700 dark:[&_mark]:text-brand-300')}>{b.title}</h4>
            <p className="mt-1 text-xs leading-relaxed text-ink-2">{b.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function MemberBenefits() {
  return (
    <Card title="サブスク会員 3つのポイント" icon="star">
      <Numbered items={BENEFITS} />
    </Card>
  );
}

export function TodayOffers() {
  return (
    <section className="card overflow-hidden border-gold-300 dark:border-gold-500/40">
      <header className="flex flex-wrap items-center gap-2 bg-gradient-to-r from-gold-500 to-gold-400 px-4 py-3 text-white sm:px-5">
        <span className="rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold tracking-widest">TODAY'S SPECIAL</span>
        <h2 className="text-[15px] font-bold">当日契約で3つの特典 ★</h2>
      </header>
      <div className="card-pad bg-gold-50/60 dark:bg-gold-500/5">
        <Numbered items={OFFERS} tone="gold" />
      </div>
    </section>
  );
}

export function PlanTips() {
  return (
    <div className="rounded-2xl border border-line bg-surface-2 p-4 text-[13px] leading-relaxed text-ink-2">
      <h4 className="mb-1 flex items-center gap-1.5 font-bold text-ink"><Icon name="info" size={15} className="text-brand-600 dark:text-brand-300" />プラン選びのポイント</h4>
      <p>
        <strong className="text-ink">3ヶ月続ければ、身体は確実に変わります。</strong>まずはここを目標にしてください。<br />
        安定期以降は<strong className="text-ink">月2回の継続</strong>が最もバランスが良く、効果を高いまま維持できます。<br />
        離脱するよりは<strong className="text-ink">月1回でも継続する</strong>ことが大切です。
      </p>
    </div>
  );
}
