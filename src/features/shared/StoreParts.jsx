// ============================================================
// 店舗の合算の内訳（ホーム・売上分析）
// ------------------------------------------------------------
// 設定 > SalonOne連携 > 店舗の合算 で 1つの店舗に別の SalonOne の店舗を足している時（例: 大和店 = si'se 大和店 + titi 大和店）、
// SalonOne の店舗ごとの数字を並べる。上の KPI はこの合計
// ============================================================
import { Card } from '../../ui/primitives.jsx';
import { yen, yenShort, num, pct } from '../../lib/format.js';

const rate = (r) => (r.newCount > 0 && r.purchaseCount != null ? pct((r.purchaseCount / r.newCount) * 100, 0) : '—');
const members = (r) => (r.retention && r.retention.memberCount != null ? `${num(r.retention.memberCount)}名` : '—');
const churn = (r) => (r.retention && r.retention.churnRatePct != null ? pct(r.retention.churnRatePct) : '—');

const COLUMNS = [
  { key: 'consumedSales', label: '施術消化売上', render: (r) => yen(r.consumedSales), short: (r) => yenShort(r.consumedSales) },
  { key: 'depositSales', label: '入金売上', render: (r) => yen(r.depositSales), short: (r) => yenShort(r.depositSales) },
  { key: 'treatmentCount', label: '施術数', render: (r) => num(r.treatmentCount), short: (r) => `${num(r.treatmentCount)}回` },
  { key: 'newCount', label: '新規', render: (r) => num(r.newCount), short: (r) => `${num(r.newCount)}名` },
  { key: 'purchaseCount', label: '契約', render: (r) => (r.purchaseCount != null ? `${num(r.purchaseCount)}（${rate(r)}）` : '—'), short: (r) => (r.purchaseCount != null ? `${num(r.purchaseCount)}件（${rate(r)}）` : '—') },
  { key: 'members', label: '会員数', render: members, short: members },
  { key: 'churn', label: '退会率', render: churn, short: churn },
];

/**
 * @param {{ parts: Array, total: Object, storeName?: string }} props parts = summary.store.parts、total = summary.store
 */
export default function StoreParts({ parts, total, storeName }) {
  if (!parts || parts.length < 2) return null;
  const rows = [...parts, { shopId: 'total', name: '合計', ...total, total: true }];
  return (
    <Card title={`${storeName ? `${storeName}の` : ''}内訳`} icon="combine" pad={false}
      subtitle="店舗の合算をしている SalonOne の店舗ごとの数字です。上の数字はこの合計です（会員数・退会率・目標も合わせて判定します）">
      <div className="scroll-x hidden md:block">
        <table className="data-table">
          <thead>
            <tr>
              <th>SalonOne の店舗</th>
              {COLUMNS.map((c) => <th key={c.key} className="text-right">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.shopId} className={r.total ? 'font-semibold' : ''}>
                <td className="whitespace-nowrap text-ink">{r.name}</td>
                {COLUMNS.map((c) => <td key={c.key} className={r.total ? 'num-cell text-ink' : 'num-cell'}>{c.render(r)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="grid gap-2 px-4 pb-4 md:hidden">
        {rows.map((r) => (
          <li key={r.shopId} className={r.total ? 'rounded-2xl bg-surface-2 p-3' : 'rounded-2xl border border-line p-3'}>
            <div className="text-[14px] font-bold text-ink">{r.name}</div>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
              {COLUMNS.map((c) => (
                <div key={c.key} className="min-w-0">
                  <dt className="text-muted">{c.label}</dt>
                  <dd className="truncate font-semibold text-ink num">{c.short(r)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </Card>
  );
}
