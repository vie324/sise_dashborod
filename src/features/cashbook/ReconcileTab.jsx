import { useMemo, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { Badge, Banner, Button, Card, EmptyState, Skeleton, cx } from '../../ui/primitives.jsx';
import { StatTile } from '../../ui/stats.jsx';
import { showToast } from '../../ui/feedback.jsx';
import { useStoreCash } from '../../lib/hooks.js';
import { dateJa, dateTimeJa, num, signedYen, yen } from '../../lib/format.js';
import { formatMonthJa } from '../../../shared/dates.js';
import { reconcileDaily } from './calc.js';

// ============================================================
// SalonOne突合（旧「売上突合」= Square 照合の置き換え）
// ------------------------------------------------------------
// 1店舗・1ヶ月を日別に
//   出納帳の現金売上（SalonOne から取り込んだ記録 + 手入力の現金売上）
//   SalonOne の現金売上（/api/salonone?action=cash の days[].cashSales。受付履歴の現金の会計）
// を並べる。SalonOne が接続済みなら、ずれている日をここから取り込める
// （1日 1件の入金として記録。手入力の売上がある日は二重になるので取り込まない）。
// ============================================================

const STATUS = {
  match: { tone: 'good', icon: 'circle-check', label: '一致' },
  mismatch: { tone: 'warn', icon: 'triangle-alert', label: '差異あり' },
  pending: { tone: 'neutral', icon: 'clock', label: '集計待ち' },
};

function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.pending;
  return <Badge tone={s.tone} icon={s.icon}>{s.label}</Badge>;
}

const SOURCE = {
  imported: { tone: 'brand', icon: 'plug', label: '取り込み済み' },
  manual: { tone: 'neutral', icon: 'pencil', label: '手入力' },
};

function SourceBadge({ source }) {
  const s = SOURCE[source];
  return s ? <Badge tone={s.tone} icon={s.icon}>{s.label}</Badge> : <span className="text-[11px] text-muted">記録なし</span>;
}

function ChooseStore({ stores, onChoose }) {
  return (
    <Card>
      <EmptyState
        icon="store"
        title="突合する店舗を選んでください"
        message="SalonOne との突合は 1 店舗ずつ行います。上の店舗の切り替え、または下のボタンから選べます。"
        action={stores.length ? (
          <div className="flex flex-wrap justify-center gap-2">
            {stores.map((s) => (
              <Button key={s.id} size="sm" variant="secondary" icon="store" onClick={() => onChoose(String(s.id))}>{s.name}</Button>
            ))}
          </div>
        ) : null}
      />
    </Card>
  );
}

const diffClass = (status, diff) => {
  if (status !== 'mismatch') return 'text-muted';
  return diff < 0 ? 'text-[var(--text-bad)]' : 'text-[#7a5300] dark:text-[#f9d27a]';
};
const diffText = (r) => (r.future ? '—' : r.diff === 0 ? '±0' : signedYen(r.diff));
const totalDiffText = (t) => (t.diff === 0 ? '±0' : signedYen(t.diff));
const totalDiffClass = (t) => (t.diff === 0 ? 'text-ink' : diffClass('mismatch', t.diff));
const MISMATCH_BG = 'bg-[#fffaeb] dark:bg-[#fab219]/[0.07]';

function Amounts({ book, salon, diff, diffClassName }) {
  return (
    <dl className="mt-1.5 grid grid-cols-3 gap-2 text-right">
      <div><dt className="text-[10px] font-semibold text-muted">出納帳</dt><dd className="text-[13px] text-ink num">{book}</dd></div>
      <div><dt className="text-[10px] font-semibold text-muted">SalonOne</dt><dd className="text-[13px] text-ink num">{salon}</dd></div>
      <div><dt className="text-[10px] font-semibold text-muted">差額</dt><dd className={cx('text-[13px] font-bold num', diffClassName)}>{diff}</dd></div>
    </dl>
  );
}

function ImportButton({ row, onImport, busy }) {
  if (!onImport || !row.canImport) return null;
  return (
    <Button size="sm" variant="subtle" icon="download" onClick={() => onImport([row.date])} disabled={busy}>
      {row.source === 'imported' ? '更新' : '取り込む'}
    </Button>
  );
}

/** スマホ: 表だと差額・判定が画面外に出るので、日ごとに縦に積む */
function ReconcileList({ rows, total, onImport, busy }) {
  return (
    <ul className="divide-y divide-line border-t border-line sm:hidden">
      {rows.map((r) => (
        <li key={r.date} className={cx('px-4 py-3', r.status === 'mismatch' ? MISMATCH_BG : '')}>
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-sm font-semibold text-ink">
              {dateJa(r.date)}
              <SourceBadge source={r.source} />
            </span>
            <StatusBadge status={r.status} />
          </div>
          <Amounts book={yen(r.cashbook)} salon={r.future ? '—' : yen(r.salon)} diff={diffText(r)} diffClassName={diffClass(r.status, r.diff)} />
          {onImport && r.canImport ? <div className="mt-2 flex justify-end"><ImportButton row={r} onImport={onImport} busy={busy} /></div> : null}
        </li>
      ))}
      <li className="bg-surface-2 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-bold text-ink">合計</span>
          <StatusBadge status={total.diff === 0 ? 'match' : 'mismatch'} />
        </div>
        <Amounts book={yen(total.cashbook)} salon={yen(total.salon)} diff={totalDiffText(total)} diffClassName={totalDiffClass(total)} />
      </li>
    </ul>
  );
}

/** タブレット以上: 表で並べる */
function ReconcileTable({ rows, total, onImport, busy }) {
  return (
    <div className="scroll-x hidden sm:block">
      <table className="data-table">
        <thead>
          <tr>
            <th className="!pl-5">日付</th>
            <th>出納帳の記録</th>
            <th className="!text-right">出納帳（現金売上）</th>
            <th className="!text-right">SalonOne（現金売上）</th>
            <th className="!text-right">差額</th>
            <th className="!pr-5">判定</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.date} className={r.status === 'mismatch' ? MISMATCH_BG : ''}>
              <td className="!pl-5"><span className="whitespace-nowrap font-semibold text-ink">{dateJa(r.date)}</span></td>
              <td className="whitespace-nowrap"><SourceBadge source={r.source} /></td>
              <td className="num-cell text-ink">{yen(r.cashbook)}</td>
              <td className="num-cell text-ink">{r.future ? '—' : yen(r.salon)}</td>
              <td className={cx('num-cell font-bold', diffClass(r.status, r.diff))}>{diffText(r)}</td>
              <td className="!pr-5">
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <StatusBadge status={r.status} />
                  <ImportButton row={r} onImport={onImport} busy={busy} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-line-strong bg-surface-2 font-bold">
            <td className="!pl-5 text-ink" colSpan={2}>合計</td>
            <td className="num-cell text-ink">{yen(total.cashbook)}</td>
            <td className="num-cell text-ink">{yen(total.salon)}</td>
            <td className={cx('num-cell', totalDiffClass(total))}>{totalDiffText(total)}</td>
            <td className="!pr-5"><StatusBadge status={total.diff === 0 ? 'match' : 'mismatch'} /></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

const RESULT_LABEL = { imported: '取り込み', updated: '更新', removed: '取り消し' };

/** 取り込み結果をひとことで伝える */
function announce(r) {
  const list = (r && r.results) || [];
  const changed = list.filter((x) => RESULT_LABEL[x.status]);
  const manual = list.filter((x) => x.status === 'manual');
  const closed = list.filter((x) => x.status === 'closed');
  if (changed.length) {
    const sum = changed.reduce((a, x) => a + (x.amount || 0), 0);
    showToast(`SalonOne の現金売上を ${changed.length}日分 反映しました（${yen(sum)}）`, 'success');
  } else if (!manual.length && !closed.length) {
    showToast('取り込む差分はありませんでした', 'info');
  }
  if (manual.length) showToast(`${manual.length}日分は手入力の売上があるため取り込みませんでした`, 'warning', 5000);
  if (closed.length) showToast(`${closed.length}日分は締め済みのため取り込みませんでした`, 'warning', 5000);
}

function ImportPanel({ count, amount, onImportAll, busy }) {
  if (count === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-3 text-[13px] text-ink-2">
        <Icon name="circle-check" size={16} className="shrink-0 text-[var(--status-good)]" />
        取り込みが必要な日はありません。SalonOne の現金売上と出納帳はそろっています。
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-brand-200 bg-brand-50 p-4 dark:border-brand-500/30 dark:bg-brand-500/10 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white"><Icon name="download" size={19} /></span>
        <div className="min-w-0 text-[13px] leading-relaxed">
          <p className="font-bold text-ink">SalonOne の現金売上を取り込めます（{count}日分・{yen(amount)}）</p>
          <p className="text-ink-2">会計で受け取った現金を、1日 1件の入金（レジ）として記録します。手入力の売上がある日は取り込みません。</p>
        </div>
      </div>
      <Button variant="primary" icon="download" onClick={onImportAll} loading={busy} className="shrink-0">まとめて取り込む</Button>
    </div>
  );
}

/** 現金と他の決済方法を組み合わせた会計で、内訳が無いもの（現金の分がわからないので SalonOne の現金売上に入っていない） */
function UnknownCashBanner({ list }) {
  const count = list.reduce((a, d) => a + d.count, 0);
  const amount = list.reduce((a, d) => a + d.amount, 0);
  const days = list.map((d) => `${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8, 10))}`).join('・');
  return (
    <Banner tone="warn" title={`現金の分がわからない会計が ${num(count)}件あります（会計 ${yen(amount)}）`}>
      「現金 / クレジットカード」のように複数の決済方法で払われ、決済の内訳が無い会計は、SalonOne の現金売上に含めていません（{days}）。
      SalonOne の会計で内訳を登録すると、次に開いた時から現金の分が入ります。
    </Banner>
  );
}

function StoreReconcile({ entries, month, storeId, storeName, isDayClosed, onImport }) {
  // 店舗や月を切り替えた直後の前の結果は useStoreCash が外す
  const cash = useStoreCash(month, storeId);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const data = cash.shown;
  const salonDaily = data ? data.days : null;
  const result = useMemo(() => reconcileDaily({
    entries,
    storeId,
    month,
    salonDaily: salonDaily || [],
    asOf: data ? data.asOf : null,
  }), [entries, storeId, month, salonDaily, data]);

  if (!data) {
    if (cash.error && !cash.loading) {
      return (
        <Banner tone="bad" title="SalonOne のデータを取得できませんでした"
          action={<Button size="sm" variant="secondary" icon="refresh-cw" onClick={() => cash.reload()}>再読み込み</Button>}>
          {cash.error.message || String(cash.error)}
        </Banner>
      );
    }
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[104px] w-full rounded-2xl" />)}
        </div>
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  }

  const demo = data.mode === 'demo';
  const unlinked = !demo && data.linked === false;
  const canImport = !demo && !unlinked && !!onImport;
  // 締め済みの日はサーバーでも取り込まないので、ボタンも出さない
  const rowsAll = result.rows.map((r) => (r.canImport && isDayClosed(r.date, storeId) ? { ...r, canImport: false } : r));
  const importable = rowsAll.filter((r) => r.canImport);
  const importAmount = importable.reduce((a, r) => a + r.salon, 0);
  const rows = showAll ? rowsAll.filter((r) => !r.future || r.active) : rowsAll.filter((r) => r.active);
  const t = result.total;

  const runImport = async (dates) => {
    if (busy || dates.length === 0) return;
    setBusy(true);
    const r = await onImport(storeId, dates);
    setBusy(false);
    if (r) announce(r);
  };

  return (
    <div className="space-y-4">
      {demo ? (
        <Banner tone="demo" title="SalonOne 側はデモデータです">
          SalonOne が未接続のため、SalonOne の現金売上はサンプルの数字です（出納帳の数字は実データです）。
          接続すると、ここから SalonOne の現金売上を出納帳へ取り込めます。
        </Banner>
      ) : null}
      {unlinked ? (
        <Banner tone="warn" title="この店舗は SalonOne の店舗と未連携です">
          設定 &gt; SalonOne連携 で店舗を対応付けると、SalonOne の現金売上の表示と取り込みができます。
        </Banner>
      ) : null}
      {!demo && data.cashUnknown && data.cashUnknown.length ? <UnknownCashBanner list={data.cashUnknown} /> : null}
      {canImport ? <ImportPanel count={importable.length} amount={importAmount} busy={busy} onImportAll={() => runImport(importable.map((r) => r.date))} /> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="出納帳の現金売上" icon="wallet" value={yen(t.cashbook)} sub={`${num(t.count)}件の記録`} />
        <StatTile label="SalonOneの現金売上" icon={demo ? 'flask-conical' : 'plug'} value={yen(t.salon)} sub={demo ? 'デモデータ' : `${dateJa(data.asOf)}時点`} />
        <StatTile label="差額" icon="scale" value={t.diff === 0 ? '±0' : signedYen(t.diff)}
          sub={t.diff === 0 ? '合計は一致' : t.diff < 0 ? '出納帳が少ない' : '出納帳が多い'} />
        <StatTile label="差異のある日" icon={result.mismatchDays ? 'triangle-alert' : 'circle-check'} value={`${num(result.mismatchDays)}日`}
          sub={`一致 ${num(result.matchDays)}日`} />
      </div>

      <Card
        title="日別の突合"
        subtitle={`${storeName(storeId)}・${formatMonthJa(month)}／SalonOne ${dateTimeJa(data.fetchedAt)}取得${demo ? '（デモ）' : ''}`}
        icon="git-compare-arrows"
        bodyClassName="!px-0 !pb-1 sm:!pb-2"
        actions={(
          <label className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-ink-2">
            <input type="checkbox" className="h-4 w-4 rounded accent-brand-600" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
            記録のない日も表示
          </label>
        )}
      >
        {rows.length === 0 ? (
          <EmptyState compact icon="inbox" title="この月はまだ現金売上がありません" message="出納帳・SalonOne のどちらにも現金の売上がありません。" />
        ) : (
          <>
            <ReconcileList rows={rows} total={t} onImport={canImport ? runImport : null} busy={busy} />
            <ReconcileTable rows={rows} total={t} onImport={canImport ? runImport : null} busy={busy} />
          </>
        )}
        <p className="flex items-start gap-1.5 px-4 pt-3 text-[11px] leading-relaxed text-muted sm:px-5">
          <Icon name="info" size={13} className="mt-px shrink-0" />
          出納帳の現金売上は、SalonOne から取り込んだ記録と、手入力した現金の売上（施術売上・サブスク月額・回数券販売・物販）の合計です。
          釣銭の補充や金庫・小口への入金は売上ではないので含めません。差額がマイナスの日は記録漏れ、プラスの日は二重の記録がないか確認してください。
        </p>
      </Card>
    </div>
  );
}

export default function ReconcileTab({ entries, month, storeId, stores, storeName, onChooseStore, isDayClosed, onImport }) {
  if (storeId === 'all') return <ChooseStore stores={stores} onChoose={onChooseStore} />;
  return <StoreReconcile entries={entries} month={month} storeId={storeId} storeName={storeName} isDayClosed={isDayClosed} onImport={onImport} />;
}
