import { useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { Badge, Button } from '../../ui/primitives.jsx';
import { showToast, confirmDialog } from '../../ui/feedback.jsx';
import { isAdminLike, isManagerOrAbove, displayName } from '../../lib/access.js';
import { closeIncentivePeriod, reopenIncentivePeriod } from '../../lib/hooks.js';
import { yen, dateTimeJa } from '../../lib/format.js';
import { incentiveCsv } from '../../../shared/incentive.js';
import { monthOf, monthsBetween } from '../../../shared/dates.js';

// ============================================================
// 支給期間の確定（オーナー・管理者）と支給一覧の CSV（店長以上）
// ------------------------------------------------------------
// 契約数（生涯基準）・会員数（取得した時点）は後から変わることがあるので、支給期間が終わったら
// その時点の金額を確定して保存する。確定した後は、画面の「支給期間の合計」は確定した金額になる。
// ============================================================

function saveText(text, filename) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 見込みの一覧（summary.staff）を確定の記録と同じ形にする */
const liveRows = (staff) => staff.map((r) => ({ key: r.key, name: r.name, storeName: r.storeName, total: r.period.total, months: r.period.months }));

export default function PeriodCloseBar({ summary }) {
  const [busy, setBusy] = useState('');
  const { period, close } = summary;
  if (!period || period.preview || summary.mode !== 'live') return null;
  const admin = isAdminLike();
  const manager = isManagerOrAbove();
  const last = period.months[period.months.length - 1];
  const ended = monthsBetween(last, monthOf(summary.asOf)) > 0;
  const changed = close ? summary.staff.filter((r) => r.closed && r.closed.total !== r.period.total).length : 0;

  const doClose = async () => {
    const ok = await confirmDialog({
      title: `${period.label}のインセンティブを確定しますか？`,
      message: 'いまの SalonOne の数字で計算した金額を、支給額として保存します。確定した後は、SalonOne の数字が変わっても支給額は変わりません（取り消して確定し直せます）。',
      confirmLabel: '確定する',
    });
    if (!ok) return;
    setBusy('close');
    try {
      let r = await closeIncentivePeriod({ month: summary.month, operator: displayName() });
      // 確認してほしいことがあれば見せる。確認した内容だけを受け入れ、新しく出たもの（取り直しに失敗した など）はもう一度確認する
      for (let round = 0; r && r.needsConfirm && round < 3; round += 1) {
        const go = await confirmDialog({
          title: '確定する前に確認してください',
          message: `${r.issues.map((i) => `・${i.message}`).join('\n')}\n\nこのまま確定しますか？`,
          confirmLabel: 'このまま確定する',
          variant: 'danger',
        });
        if (!go) return;
        r = await closeIncentivePeriod({ month: summary.month, operator: displayName(), accept: r.issues.map((i) => i.code) });
      }
      if (!r || !r.success) throw new Error('確定できませんでした。時間をおいてもう一度お試しください');
      showToast(`${period.label}のインセンティブを確定しました（合計 ${yen(r.close.total)}）`, 'success');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const doReopen = async () => {
    const ok = await confirmDialog({
      title: '確定を取り消しますか？',
      message: `${period.label}の支給額は、いまの SalonOne の数字で計算し直した見込みに戻ります（確定した記録は履歴に残ります）。`,
      confirmLabel: '取り消す',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy('reopen');
    try {
      await reopenIncentivePeriod({ month: summary.month, operator: displayName() });
      showToast('確定を取り消しました', 'success');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const downloadCsv = () => {
    const status = close ? '確定' : '見込み';
    const text = incentiveCsv(close ? close.staff : liveRows(summary.staff), { periodLabel: period.label, status });
    saveText(text, `インセンティブ_${period.months[0]}_${status}.csv`);
  };

  return (
    <div className="mb-3 rounded-xl border border-line bg-surface px-3.5 py-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-2">
          <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
            <Icon name={close ? 'lock' : 'calendar-range'} size={15} className="text-muted" />支給期間 {period.label}
          </span>
          {close
            ? <Badge tone="good" icon="lock">確定済み {dateTimeJa(close.closedAt)}{close.closedBy ? `・${close.closedBy}` : ''}</Badge>
            : <Badge tone="neutral">見込み（未確定）</Badge>}
          {close ? <span className="num">支給額の合計 <span className="font-bold text-ink">{yen(close.total)}</span></span> : null}
        </span>
        <span className="flex flex-wrap justify-end gap-2">
          {manager ? <Button size="sm" variant="ghost" icon="download" onClick={downloadCsv}>CSV</Button> : null}
          {admin && !close ? (
            <Button size="sm" variant={ended ? 'primary' : 'secondary'} icon="lock" disabled={!ended} loading={busy === 'close'} onClick={doClose}>確定する</Button>
          ) : null}
          {admin && close ? <Button size="sm" variant="ghost" icon="lock-open" loading={busy === 'reopen'} onClick={doReopen}>確定を取り消す</Button> : null}
        </span>
      </div>
      {!close && admin && !ended ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
          {Number(last.slice(5))}月が終わると確定できます。契約数（後の月の契約も数える）・会員数（取得した時点の人数）は後から変わるため、支給の前に確定して金額を固定してください。
        </p>
      ) : null}
      {close && changed > 0 ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
          確定した後に SalonOne の数字が変わり、計算し直すと金額が違うスタッフが {changed}名います（支給額は確定した金額のままです）。
        </p>
      ) : null}
    </div>
  );
}
