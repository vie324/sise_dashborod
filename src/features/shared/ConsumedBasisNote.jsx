import Icon from '../../ui/Icon.jsx';
import { formatMonthJa } from '../../../shared/dates.js';

/**
 * 推移の注記: 施術消化売上（施術 1回分の合計）の記録が無い月は、SalonOne の売上分析の消化売上で埋めている
 * （サブスクの課金・失効なども含む別の数え方）。記録は毎日の Cron が過去の月の分も少しずつ作る
 * @param {string[]} months 'YYYY-MM'
 */
export default function ConsumedBasisNote({ months }) {
  if (!months || !months.length) return null;
  const label = months.length > 2
    ? `${formatMonthJa(months[0])}〜${formatMonthJa(months[months.length - 1])}のうち ${months.length}ヶ月`
    : months.map(formatMonthJa).join('・');
  return (
    <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted">
      <Icon name="info" size={13} className="mt-px shrink-0" />
      <span>{label}は施術消化売上の記録が無いため、SalonOne の売上分析の消化売上（サブスクの課金・失効なども含む別の数え方）を表示しています。過去の月の記録は毎日少しずつ作られます。</span>
    </p>
  );
}
