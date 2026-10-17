import { Card, Badge } from '../../ui/primitives.jsx';
import Icon from '../../ui/Icon.jsx';
import { yen, yenShort } from '../../lib/format.js';
import { channelLabel } from '../../../shared/channels.js';
import { formatMonthJa } from '../../../shared/dates.js';

// インセンティブ制度の内容（資料「インセンティブ制度概要」を画面化）と、
// SalonOne のデータからどう集計しているかの説明。
function TierTable({ head, rows }) {
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <table className="data-table">
        <thead><tr><th>{head[0]}</th><th className="text-right">{head[1]}</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]}><td className="text-ink">{r[0]}</td><td className="num-cell font-semibold text-ink">{r[1]}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({ no, title, icon, children }) {
  return (
    <Card>
      <h2 className="mb-3 flex items-center gap-2 text-[15px] font-bold text-ink">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-600 text-xs text-white">{no}</span>
        <Icon name={icon} size={17} className="text-brand-600 dark:text-brand-300" />
        {title}
      </h2>
      <div className="space-y-3 text-[13px] leading-relaxed text-ink-2">{children}</div>
    </Card>
  );
}

export default function RulesView({ rules }) {
  const s = rules.sales.tiers;
  const salesRows = [[`${yen(s[0].min)} 未満`, yen(0)]];
  s.forEach((t, i) => {
    const next = s[i + 1];
    salesRows.push([next ? `${yen(t.min)} 以上 〜 ${yen(next.min)} 未満` : `${yen(t.min)} 以上`, yen(t.amount)]);
  });
  const nc = rules.newContract;
  const ncRows = nc.tiers.map((t, i) => {
    const next = nc.tiers[i + 1];
    return [next ? `${t.minPct}% 以上 〜 ${next.minPct}% 未満` : `${t.minPct}% 以上`, yen(t.amount)];
  });
  const start = formatMonthJa(rules.startMonth);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand" icon="calendar-check">制度開始 {start}1日〜</Badge>
          <Badge tone="gold" icon="calendar-range">支給は{rules.periodMonths}ヶ月に1回</Badge>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-ink-2">
          各月の金額を計算し、{rules.periodMonths}ヶ月分（例: 11月〜12月）をまとめて支給します。実績はすべて SalonOne のデータから自動で集計します。
        </p>
      </Card>

      <Section no="1" title="施術消化売上インセンティブ" icon="banknote">
        <p>SalonOne の「施術消化売上」を評価基準とします。</p>
        <TierTable head={['月間施術消化売上（条件）', 'インセンティブ支給額']} rows={salesRows} />
        <div className="rounded-xl bg-surface-2 px-3.5 py-3">
          <p className="font-semibold text-ink">評価基準額の算出根拠：1回あたり {yen(rules.unitPrice)}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            <li>60分・月2回プラン：月額15,000円 ÷ 2回 = 7,500円／回</li>
            <li>75分・月2回プラン：月額18,000円 ÷ 2回 = 9,000円／回</li>
            <li>平均値（8,250円／回）を元に、分かりやすい基準額として1回あたり8,000円に設定</li>
          </ul>
          <p className="mt-1 text-xs text-muted">各段階は 8,000円 × 72回 / 86回 / 101回 / 116回 / 131回 に相当します。</p>
        </div>
      </Section>

      <Section no="2" title="継続率インセンティブ" icon="repeat">
        <p>以下をすべて満たした場合、<strong className="text-ink">1人あたり月額 {yen(rules.retention.amountPerPerson)}</strong> を支給します。</p>
        <ul className="list-disc space-y-0.5 pl-5">
          <li>店舗全体の退会率が {rules.retention.maxChurnRatePct}% 以下</li>
          <li>店舗全体の平均継続期間が {rules.retention.minAvgTenureMonths}ヶ月以上</li>
          <li>会員数が {rules.retention.minMembers}名以上（都度払いはカウント対象外）</li>
        </ul>
      </Section>

      <Section no="3" title="新規契約インセンティブ" icon="user-plus">
        <p>
          既存顧客の施術消化売上が月間 <strong className="text-ink">{yen(nc.minExistingSales)} 以上</strong>（資料の「40,0000円」は 400,000円 と解釈しています）かつ、
          3経路（{nc.channels.map(channelLabel).join('・')}）の新規初回来店数が合計 <strong className="text-ink">{nc.minNewVisits}名以上</strong> の場合に適用。
        </p>
        <div className="rounded-xl border border-line px-3.5 py-2.5 font-semibold text-ink">
          契約率 ＝ 3経路からの新規契約数合計 ÷ 3経路からの新規初回来店数合計 × 100
        </div>
        <TierTable head={['契約率', 'インセンティブ支給額']} rows={ncRows} />
        <p className="text-xs text-muted">計算例：新規初回来店 18名（ホットペッパー 10名 / Meta 5名 / Web 3名）、契約 11名 → 契約率 61.1% → 15,000円</p>
      </Section>

      <Section no="4" title="Minimo・Threads・Instagram インセンティブ" icon="smartphone">
        <ul className="list-disc space-y-0.5 pl-5">
          <li>Minimo / Threads / Instagram 経由で {rules.sns.minCustomers}名以上集客</li>
          <li>1件契約につき {yen(rules.sns.amountPerContract)} を支給</li>
        </ul>
      </Section>

      <Section no="5" title="紹介インセンティブ" icon="users">
        <p>紹介した顧客が新たにサブスク契約を締結した場合：<strong className="text-ink">{yen(rules.referral.amountPerContract)}</strong></p>
        <ul className="list-disc space-y-0.5 pl-5 text-xs">
          <li>SalonOne の専用URL/QRコードを使用し管理します（Canva等で作成した紹介カードを配布してご案内ください）</li>
          <li>予約のまま来店していない方、キャンセル、既存のお客様は対象外です</li>
          <li>シェアプランの利用は新規サブスク契約として扱いません</li>
          <li>紹介実績は SalonOne のシステムで管理します</li>
        </ul>
      </Section>

      <Card title="SalonOne のデータからの集計方法" icon="database" subtitle="画面の数字はすべて次のルールで計算しています">
        <dl className="grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
          {[
            ['施術消化売上', 'SalonOne の売上分析の「消化売上」（担当スタッフ別）。会計金額に回数券・サブスクの消化分と失効分を加え、前受の購入額を差し引いた実質的な収益'],
            ['既存顧客の消化売上', '施術消化売上から、新規のお客様の初回来店分を除いた金額'],
            ['新規数・既存数', 'SalonOne の売上分析の「新規数」（その店舗で初めての来店）と「リピート数」（2回目以降の来店）'],
            ['契約数', 'SalonOne の売上分析の「購入数」。新規のお客様のうち回数券・サブスクを契約した人数（初回来店の月に計上し、後の月の契約も含む）'],
            ['経路別の新規・契約', 'インセンティブの 3経路・SNS・紹介は、SalonOne の受付履歴の「来店経由」（設定で経路を対応付け）と購入プラン・入会から集計'],
            ['会員数', 'SalonOne の継続管理（サブスク）で、離反以外のお客様の人数（都度払い・回数券のみの方は含めない）'],
            ['退会率', '直近1か月に離反になった人数 ÷ 1か月前の会員数（SalonOne の継続管理から）'],
            ['平均継続期間', '直近1年にサブスクの支払いがあったお客様の、サブスク継続月数の平均'],
            ['紹介', '経路が「紹介」の新規のお客様がサブスク（シェアプランを除く）を契約した件数'],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="font-semibold text-ink">{k}</dt>
              <dd className="mt-0.5 text-ink-2">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-muted">目安：施術消化売上の段階 {s.map((t) => yenShort(t.min)).join(' / ')}</p>
      </Card>
    </div>
  );
}
