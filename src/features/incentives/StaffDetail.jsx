import { Card } from '../../ui/primitives.jsx';
import { HeroFigure } from '../../ui/stats.jsx';
import { yen } from '../../lib/format.js';
import {
  IncentiveBreakdown, SalesTierCard, NewContractCard, SnsCard, ReferralCard, RetentionCard, PeriodSummary, NextActions,
} from './parts.jsx';

/**
 * スタッフ 1人分のインセンティブ詳細。
 * @param {Object} row      summary.staff[] の 1行
 * @param {Object} summary  /api/salonone summary のレスポンス
 * @param {number} [goal]   この月の個人目標（消化売上）
 */
export default function StaffDetail({ row, summary, goal, compact = false }) {
  const { rules, period, progress } = summary;
  const items = Object.fromEntries(row.incentive.items.map((i) => [i.key, i]));
  return (
    <div className="space-y-4">
      <Card pad>
        <div className="grid gap-5 md:grid-cols-[1fr_1.2fr] md:items-start">
          <div>
            <HeroFigure
              label={`${row.name} さんの今月のインセンティブ${summary.period.preview ? '（試算）' : '見込み'}`}
              value={yen(row.incentive.total)}
              sub={row.storeName ? `${row.storeName}` : null}
            />
            <PeriodSummary className="mt-4" period={period} staffPeriod={row.period} />
            <NextActions className="mt-4" incentive={row.incentive} rules={rules} />
          </div>
          <IncentiveBreakdown incentive={row.incentive} />
        </div>
      </Card>
      <SalesTierCard item={items.sales} daily={row.daily} progress={progress} rules={rules} goal={goal} showChart={!compact} />
      <NewContractCard item={items.newContract} rules={rules} />
      <div className="grid gap-4 md:grid-cols-2">
        <SnsCard item={items.sns} rules={rules} />
        <ReferralCard item={items.referral} rules={rules} />
      </div>
      <RetentionCard item={items.retention} rules={rules} storeName={row.storeName} />
    </div>
  );
}
