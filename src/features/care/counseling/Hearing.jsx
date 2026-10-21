import { Badge, Button, Card, Select, cx } from '../../../ui/primitives.jsx';
import Icon from '../../../ui/Icon.jsx';
import { yen } from '../../../lib/format.js';
import { CONCERN_CATEGORIES, CONCERN_ITEMS, FEEDBACK_ITEMS, PLAN_CATALOG } from '../../../../shared/counseling.js';

// ============================================================
// ヒアリング＆プラン診断
// ------------------------------------------------------------
// お悩み（カウンセリングで伺った内容。Google フォームの店舗は回答から自動で入る。ご説明の画面でお客様がタップしても入る）と
// 施術後の評価（セラピストが付ける）から 3つのプランを提案する。カードか「セラピスト変更」で選び直せる。
// ============================================================

function CheckItem({ checked, onToggle, children, aside }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={onToggle}
      className={cx('flex min-h-[44px] w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-[13px] transition-colors',
        checked ? 'border-brand-500 bg-brand-50 font-semibold text-ink dark:bg-brand-500/15' : 'border-line bg-surface text-ink-2 hover:bg-surface-2')}>
      <span className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors',
        checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong bg-surface')}>
        {checked ? <Icon name="check" size={13} strokeWidth={3} /> : null}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
      {aside}
    </button>
  );
}

/** カウンセリングシート（Google フォーム）の回答から入れた項目の印 */
function FormMark() {
  return (
    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#e6f0fb] text-[#1f4f8f] dark:bg-[#3987e5]/20 dark:text-[#b8d3f6]" title="カウンセリングシートの回答から">
      <Icon name="file-text" size={12} strokeWidth={2.2} /><span className="sr-only">カウンセリングシートの回答から</span>
    </span>
  );
}

const RANKS = [
  { key: 'matsu', label: 'しっかりコース', mark: '◆' },
  { key: 'take', label: 'おすすめ', mark: '★' },
  { key: 'ume', label: 'お手軽コース', mark: '●' },
];

function RecCard({ rank, plan, selected, onSelect }) {
  if (!plan) return null;
  const take = rank.key === 'take';
  return (
    <button type="button" onClick={() => onSelect(plan.key)} aria-pressed={selected}
      className={cx('relative flex flex-col rounded-2xl border p-3.5 text-left transition-all',
        selected ? 'border-brand-500 bg-surface shadow-pop ring-2 ring-brand-500' : 'border-line bg-surface hover:border-line-strong')}>
      {selected ? (
        <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-white"><Icon name="check" size={14} strokeWidth={3} /></span>
      ) : null}
      <span className={cx('mb-2 inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold',
        take ? 'bg-gold-500 text-white' : 'bg-surface-3 text-ink-2')}>
        <span aria-hidden="true">{rank.mark}</span>{rank.label}
      </span>
      <span className="text-base font-bold text-ink">{plan.name}</span>
      <span className="text-[13px] font-semibold text-brand-700 dark:text-brand-300">{plan.freqLabel}</span>
      <span className="mt-1 text-xs text-ink-2">{plan.desc}</span>
      <span className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2 text-xs text-muted">
        {plan.types}
        <span className="num text-sm font-bold text-ink">{yen(plan.price)}<span className="text-[10px] font-medium text-muted">/月</span></span>
      </span>
    </button>
  );
}

/**
 * @param {Object<string,boolean>} concerns / feedbacks  チェック状態
 * @param {Object<string,boolean>} [fromForm]  カウンセリングシート（Google フォーム）の回答から入れた項目（「フォーム」の印）
 * @param {ReturnType<import('../../../../shared/counseling.js').recommendPlans>} recommendation
 * @param {string} selectedKey  選んでいるプラン（PLAN_CATALOG の key）
 * @param {string} overrideKey  セラピストが選び直したプラン（空なら自動）
 */
export default function Hearing({ concerns, feedbacks, fromForm = {}, onToggleConcern, onToggleFeedback, recommendation, selectedKey, overrideKey, onSelectPlan }) {
  const concernCount = CONCERN_ITEMS.filter((c) => concerns[c.id]).length;
  const formCount = CONCERN_ITEMS.filter((c) => fromForm[c.id]).length;
  const feedbackCount = FEEDBACK_ITEMS.filter((f) => feedbacks[f.id]).length;
  return (
    <Card title="ヒアリング＆プラン診断" icon="list-checks" subtitle="カウンセリングで伺ったお悩みと、施術後のお身体の状態をチェックすると、おすすめプランが出ます">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="hearing-concerns">
          <h3 id="hearing-concerns" className="mb-2 flex items-center gap-2 text-sm font-bold text-ink">
            お悩み箇所
            <span className="text-xs font-medium text-muted">{concernCount}箇所</span>
            {formCount ? <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-[#1f4f8f] dark:text-[#b8d3f6]"><FormMark />＝カウンセリングシートから</span> : null}
          </h3>
          <div className="space-y-3">
            {CONCERN_CATEGORIES.map((cat) => (
              <div key={cat.key}>
                <div className="mb-1.5 text-[11px] font-bold text-muted">{cat.course}<span className="font-medium">（{cat.area}）</span></div>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {CONCERN_ITEMS.filter((c) => c.cat === cat.key).map((item) => (
                    <CheckItem key={item.id} checked={!!concerns[item.id]} onToggle={() => onToggleConcern(item.id)}
                      aside={fromForm[item.id] ? <FormMark /> : null}>
                      {item.label}
                    </CheckItem>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
        <section aria-labelledby="hearing-feedback">
          <h3 id="hearing-feedback" className="mb-0.5 flex items-center gap-2 text-sm font-bold text-ink">
            施術後のフィードバック
            <span className="text-xs font-medium text-muted">{feedbackCount}項目</span>
          </h3>
          <p className="mb-2 text-xs text-muted">セラピスト記入。施術後にお客様のお身体の状態を評価してチェックしてください。</p>
          <div className="grid gap-1.5">
            {FEEDBACK_ITEMS.map((item) => (
              <CheckItem key={item.id} checked={!!feedbacks[item.id]} onToggle={() => onToggleFeedback(item.id)}>{item.label}</CheckItem>
            ))}
          </div>
        </section>
      </div>

      {recommendation ? (
        <div className="mt-5 animate-rise-in rounded-2xl border border-brand-200 bg-brand-50/60 p-4 dark:border-brand-500/30 dark:bg-brand-500/10">
          <div className="mb-3">
            <h3 className="flex items-center gap-2 text-[15px] font-bold text-ink">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white"><Icon name="sparkles" size={15} /></span>
              おすすめプラン
            </h3>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-2">
              {recommendation.reasons.join('・')}、<strong className="text-ink">3つのプラン</strong>をご提案します。カードをタップで変更できます。
            </p>
            {recommendation.categories.length ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                対象:
                {recommendation.categories.map((k) => <Badge key={k} tone="brand">{CONCERN_CATEGORIES.find((c) => c.key === k).course}</Badge>)}
              </div>
            ) : null}
          </div>
          <div className="grid gap-2.5 md:grid-cols-3">
            {RANKS.map((rank) => (
              <RecCard key={rank.key} rank={rank} plan={recommendation[rank.key]} selected={selectedKey === recommendation[rank.key].key} onSelect={onSelectPlan} />
            ))}
          </div>
          <div className="mt-3 flex flex-col gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 sm:flex-row sm:items-center">
            <label htmlFor="plan-override" className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-ink-2">
              <Icon name="sliders-horizontal" size={14} />セラピスト変更
            </label>
            <Select id="plan-override" className="h-9 flex-1 py-1 text-[13px]" value={overrideKey} onChange={(e) => onSelectPlan(e.target.value)}>
              <option value="">自動おすすめ（{recommendation.take.name} {recommendation.take.freqLabel}）</option>
              {PLAN_CATALOG.map((p) => <option key={p.key} value={p.key}>{p.name} {p.freqLabel} — {yen(p.price)}</option>)}
            </Select>
            {overrideKey ? <Button size="sm" variant="ghost" icon="rotate-ccw" onClick={() => onSelectPlan('')}>自動に戻す</Button> : null}
          </div>
        </div>
      ) : (
        <p className="mt-4 flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-xs text-muted">
          <Icon name="info" size={14} />お悩みか施術後の評価をチェックすると、ここにおすすめプランが出ます
        </p>
      )}
    </Card>
  );
}
