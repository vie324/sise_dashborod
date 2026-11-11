// ============================================================
// 新規の内訳と媒体別の契約率（売上分析）
// ------------------------------------------------------------
// 左: 新規の内訳 … 媒体ごとの新規数と構成比（いちばん多い媒体を全幅にした横棒）
// 右: 媒体別の契約率 … 0〜100% のメーター。縦線は全体の契約率。先頭は 3経路の合計（新規契約インセンティブの判定）
// 下: 来店経由（SalonOne の名前のまま）ごとの表
// 数字は受付履歴から媒体（経路）ごとに数えたもの。インセンティブの判定と同じ（shared/newBreakdown.js）
// ============================================================
import { Card } from '../../ui/primitives.jsx';
import { Meter } from '../../ui/stats.jsx';
import { ChartTable } from '../../ui/charts.jsx';
import Icon from '../../ui/Icon.jsx';
import { num, pct } from '../../lib/format.js';
import { isAdminLike } from '../../lib/access.js';
import { navigate } from '../../app/router.js';
import { newBreakdown } from '../../../shared/newBreakdown.js';

const persons = (v) => `${num(v)}名`;
/** 「その他」に入った来店経由の名前（多いときは 2つ + ほか N） */
const aliasText = (list) => (list.length <= 2 ? list.join('・') : `${list.slice(0, 2).join('・')} ほか${list.length - 2}`);

function BlockHeader({ title, children }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h3 className="shrink-0 text-[13px] font-bold text-ink">{title}</h3>
      <span className="min-w-0 text-right text-xs text-muted num">{children}</span>
    </div>
  );
}

/** 新規の内訳: 媒体ごとの新規数と構成比 */
function CountList({ media, total }) {
  const top = Math.max(1, ...media.map((m) => m.visits));
  return (
    <ul className="space-y-3">
      {media.map((m) => (
        <li key={m.key} title={`${m.label}: 新規 ${m.visits}名${total.visits ? `（全体の ${pct(m.share * 100, 0)}）` : ''}`}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
            <span className="min-w-0 truncate">
              <span className="text-ink">{m.label}</span>
              {m.aliases.length ? <span className="ml-1.5 text-[11px] text-muted">{aliasText(m.aliases)}</span> : null}
            </span>
            <span className="shrink-0 num">
              <span className="font-semibold text-ink">{persons(m.visits)}</span>
              <span className="ml-1 inline-block w-10 text-right text-xs text-muted">{total.visits ? pct(m.share * 100, 0) : '—'}</span>
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-[var(--chart-sales)]" style={{ width: `${(m.visits / top) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function RateFigure({ ratePct, contracts, visits, digits = 0 }) {
  return (
    <span className="shrink-0 num">
      <span className="font-semibold text-ink">{ratePct == null ? '—' : pct(ratePct, digits)}</span>
      <span className="ml-1.5 inline-block min-w-[3.25rem] text-right text-xs text-muted">{visits ? `${num(contracts)}/${persons(visits)}` : '新規なし'}</span>
    </span>
  );
}

/** 媒体別の契約率: 0〜100% のメーター（縦線は全体の契約率） */
function RateList({ media, total, three }) {
  const avg = total.ratePct;
  const markerTitle = avg != null ? `全体の契約率 ${pct(avg)}` : undefined;
  return (
    <ul className="space-y-3">
      <li className="rounded-xl bg-surface-2 px-3 py-2.5">
        <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
          <span className="min-w-0 truncate font-semibold text-ink">3経路の合計</span>
          <RateFigure ratePct={three.ratePct} contracts={three.contracts} visits={three.visits} digits={1} />
        </div>
        <Meter value={three.ratePct || 0} max={100} marker={avg} markerTitle={markerTitle} label={`3経路の合計の契約率${three.visits ? '' : '（新規なし）'}`} />
        <p className="mt-1.5 text-[11px] leading-snug text-muted">{three.labels.join('・')}。新規契約インセンティブはこの契約率で判定します</p>
      </li>
      {media.map((m) => (
        <li key={m.key} className="px-0.5">
          <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
            <span className="min-w-0 truncate text-ink">{m.label}</span>
            <RateFigure ratePct={m.ratePct} contracts={m.contracts} visits={m.visits} />
          </div>
          <Meter value={m.ratePct || 0} max={100} marker={avg} markerTitle={markerTitle} label={`${m.label}の契約率${m.visits ? '' : '（新規なし）'}`} />
        </li>
      ))}
    </ul>
  );
}

/**
 * @param {{ data: Object, id?: string }} props data = 売上分析のサマリ（store・sources）
 */
export default function NewBreakdownCard({ data, id }) {
  const s = data.store;
  const b = newBreakdown(s, data.sources);
  const { total } = b;
  const visitsDiffer = s.newCount != null && s.newCount !== total.visits;
  const contractsDiffer = s.purchaseCount != null && s.purchaseCount !== total.contracts;
  return (
    <Card id={id} className="scroll-mt-20" title="新規の内訳と媒体別の契約率" icon="user-plus"
      subtitle="SalonOne の来店経由を媒体にまとめて集計（インセンティブの判定と同じ数字）">
      {total.visits === 0 ? (
        <p className="pb-1 text-[13px] text-muted">この月の新規来店はまだありません</p>
      ) : null}
      <div className="grid gap-x-8 gap-y-6 lg:grid-cols-2">
        <div className="min-w-0">
          <BlockHeader title="新規の内訳">合計 <span className="font-semibold text-ink">{persons(total.visits)}</span></BlockHeader>
          <CountList media={b.media} total={total} />
        </div>
        <div className="min-w-0 border-t border-line pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <BlockHeader title="媒体別の契約率">
            <span className="mr-1 inline-block h-3 w-[2px] translate-y-[2px] rounded-full bg-ink/60" aria-hidden="true" />
            全体 <span className="font-semibold text-ink">{pct(total.ratePct)}</span>{total.visits ? `（${num(total.contracts)}/${persons(total.visits)}）` : ''}
          </BlockHeader>
          <RateList media={b.media} total={total} three={b.threeChannels} />
        </div>
      </div>
      <div className="mt-4 space-y-1.5 text-xs leading-relaxed text-muted">
        <p>契約は、2回目以降の来店で契約した分も初回来店の月に数えます。そのため、あとから契約率が上がることがあります。</p>
        {visitsDiffer || contractsDiffer ? (
          <p>
            SalonOne の{visitsDiffer ? `新規数（${persons(s.newCount)}）` : ''}{visitsDiffer && contractsDiffer ? '・' : ''}{contractsDiffer ? `契約数（${num(s.purchaseCount)}件）` : ''}と少し違うのは、
            この内訳を受付履歴の「区分」から数えているためです（「既存顧客として扱う」にしたお客様など）。インセンティブの判定はこの内訳の数字を使います。
          </p>
        ) : null}
      </div>
      {b.sources.length ? (
        <ChartTable label="来店経由（SalonOne の名前）ごとに見る"
          columns={[
            // 媒体名と違う名前の来店経由は、まとめた先の媒体を下に出す（スマホでも横にはみ出さない 4列にする）
            { key: 'name', label: '来店経由', render: (r) => (
              <>
                <div className="whitespace-nowrap">{r.name}</div>
                {r.channelLabel !== r.name ? <div className="whitespace-nowrap text-[11px] text-muted">→ {r.channelLabel}</div> : null}
              </>
            ) },
            { key: 'visits', label: '新規', align: 'right', render: (r) => num(r.visits) },
            { key: 'contracts', label: '契約', align: 'right', render: (r) => num(r.contracts) },
            { key: 'ratePct', label: '契約率', align: 'right', render: (r) => pct(r.ratePct, 0) },
          ]}
          rows={b.sources}>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 px-2 text-xs text-muted">
            <span>来店経由をどの媒体にまとめるかは、設定 &gt; SalonOne連携 の「来店経由 → 集客経路」で決めます。</span>
            {isAdminLike() ? (
              <button type="button" onClick={() => navigate('/settings')} className="inline-flex items-center gap-0.5 font-semibold text-brand-700 hover:underline dark:text-brand-300">
                対応付けを変更<Icon name="chevron-right" size={12} />
              </button>
            ) : null}
          </p>
        </ChartTable>
      ) : null}
    </Card>
  );
}
