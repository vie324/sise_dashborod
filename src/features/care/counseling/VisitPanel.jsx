import { useState } from 'react';
import { Badge, Banner, Button, EmptyState, IconButton, Input, Segmented, Select, Skeleton, cx } from '../../../ui/primitives.jsx';
import Icon from '../../../ui/Icon.jsx';
import { navigate } from '../../../app/router.js';
import { isAdminLike } from '../../../lib/access.js';
import { todayJst, toJstDate } from '../../../../shared/dates.js';
import { SheetList, ConcernPreview, sheetTime } from './SheetPanel.jsx';

// ============================================================
// 本日のお客様（SalonOne の今日の予約）の一覧と、選んだお客様
// ------------------------------------------------------------
// 初回のお客様（SalonOne の区分「新規」）を先に出す。2回目以降のお客様に改めてご説明する時は「すべての予約」から。
// SalonOne のキーが「個人情報を含めない」設定ならお名前は来ないので、顧客番号で見分ける
// （ご説明の画面に出すお名前は、選んだ後に手で入れられる）。
// Google フォームを使う店舗は「フォームの回答」のタブも出し、同じお名前の予約には「シートあり」を付ける。
// ============================================================

const STATUS = {
  reserved: { label: '予約', tone: 'neutral' },
  checked_in: { label: '来店中', tone: 'brand' },
  completed: { label: '会計済み', tone: 'info' },
};

const timeOf = (iso) => new Date(iso).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });

/** 姓だけ（「山本 さくら」→「山本」）。区切りが無ければそのまま */
export function familyName(name) {
  const n = String(name || '').trim();
  const parts = n.split(/[\s　]+/).filter(Boolean);
  return parts.length > 1 ? parts[0] : n;
}

/** 一覧・まとめに出すお客様の名前（お名前が無ければ顧客番号） */
export const guestLabel = (g) => (g.customerName ? `${g.customerName} 様` : g.customerNumber ? `顧客番号 ${g.customerNumber}` : 'お客様');

function StatusBadge({ status }) {
  const s = STATUS[status] || { label: status, tone: 'neutral' };
  return (
    <Badge tone={s.tone} className="!px-1.5">
      {status === 'checked_in' ? (
        <span className="relative mr-0.5 flex h-1.5 w-1.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-500 opacity-70" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-brand-600" />
        </span>
      ) : null}
      {s.label}
    </Badge>
  );
}

/**
 * @param {Object|null} sheet 同じお名前のカウンセリングシート（Google フォームの店舗だけ）
 */
function VisitRow({ v, sheet, onSelect }) {
  return (
    <li>
      <button type="button" onClick={() => onSelect(v)} className="flex w-full items-center gap-3 bg-surface px-3 py-2.5 text-left transition-colors hover:bg-surface-2">
        <span className="flex w-14 shrink-0 flex-col items-center gap-1">
          <span className="num text-[15px] font-bold leading-none text-ink">{v.time || '—'}</span>
          <StatusBadge status={v.status} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className={cx('truncate text-sm font-bold', v.customerName ? 'text-ink' : 'text-ink-2')}>{guestLabel(v)}</span>
            {v.isNew ? <Badge tone="gold">初回</Badge> : null}
            {sheet ? <Badge tone="info" icon="file-text">シートあり</Badge> : null}
            {v.contracted ? <Badge tone="good" icon="check">ご契約</Badge> : null}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted">
            {[v.staffName ? `担当 ${v.staffName}` : '', v.sourceName, v.plans.length ? v.plans.join('・') : ''].filter(Boolean).join('　')}
          </span>
          {sheet ? (
            <span className="mt-0.5 flex items-center gap-1 truncate text-xs font-semibold text-brand-700 dark:text-brand-300">
              <Icon name="message-square" size={12} className="shrink-0" /><span className="truncate"><ConcernPreview concerns={sheet.concerns} /></span>
            </span>
          ) : null}
        </span>
        <Icon name="chevron-right" size={16} className="shrink-0 text-muted" />
      </button>
    </li>
  );
}

function ManualStart({ onStart }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  if (!open) {
    return <Button size="sm" variant="ghost" icon="user-round-pen" onClick={() => setOpen(true)}>予約に無いお客様で始める</Button>;
  }
  const start = (e) => {
    e.preventDefault();
    onStart(name.trim());
  };
  return (
    <form onSubmit={start} className="flex w-full flex-wrap items-center gap-2 rounded-xl bg-surface-2 p-2.5">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="お名前（任意）例: 山本" aria-label="お客様のお名前" className="h-10 min-w-[10rem] flex-1 py-1" autoFocus />
      <Button type="submit" variant="primary" icon="arrow-right">始める</Button>
      <Button variant="ghost" onClick={() => setOpen(false)}>やめる</Button>
    </form>
  );
}

const openSalonOneSettings = () => {
  try { localStorage.setItem('sise_settings_tab', 'salonone'); } catch (_) { /* noop */ }
  navigate('/settings');
};

/**
 * 今日の予約の一覧（Google フォームの店舗は「フォームの回答」のタブも）
 * @param {Object} res useTodayVisits の戻り値
 * @param {Object<string,Object>} links { [予約ID]: 同じお名前のカウンセリングシート }
 * @param {Object|null} form フォームの店舗だけ。{ res, rows, arrived, visitOf, onSelect, onSearch, searching, searchResult, onClearSearch, onRefresh }
 */
export function VisitList({ res, links = {}, form = null, onSelect, onManual, onRefresh, refreshing }) {
  const data = res.shown;
  const notLinked = !!(data && data.linked === false);
  const [filter, setFilter] = useState(() => (notLinked && form ? 'form' : 'new'));
  const visits = data && data.visits ? data.visits : null;
  const firstVisits = visits ? visits.filter((v) => v.isNew) : [];
  const list = filter === 'new' ? firstVisits : visits || [];
  const err = res.error;
  const today = todayJst();
  const todaySheets = form && form.rows ? form.rows.filter((r) => toJstDate(r.submittedAt) === today).length : 0;

  const options = [
    { value: 'new', label: '初回のお客様', count: visits ? firstVisits.length : undefined },
    { value: 'all', label: 'すべての予約', count: visits ? visits.length : undefined },
  ];
  if (form) options.push({ value: 'form', label: 'フォームの回答', count: form.rows ? todaySheets : undefined });

  let body;
  if (filter === 'form' && form) {
    body = (
      <SheetList rows={form.rows} loading={form.res.loading} error={form.res.error} arrived={form.arrived} visitOf={form.visitOf}
        onSelect={form.onSelect} onSearch={form.onSearch} searching={form.searching} searchResult={form.searchResult}
        onClearSearch={form.onClearSearch} onRefresh={form.onRefresh} />
    );
  } else if (notLinked) {
    body = (
      <Banner tone="info" title="この店舗は SalonOne の店舗と対応付けられていません"
        action={isAdminLike() ? <Button size="sm" variant="secondary" iconRight="chevron-right" onClick={openSalonOneSettings}>設定する</Button> : null}>
        設定 → SalonOne連携 で店舗を対応付けると、今日の予約がここに出ます。{form ? 'カウンセリングシートは「フォームの回答」から選べます。' : '予約に無いお客様としても始められます。'}
      </Banner>
    );
  } else if (err && !visits) {
    body = (
      <Banner tone="bad" title="今日の予約を読み込めませんでした" action={<Button size="sm" icon="refresh-cw" onClick={onRefresh}>再読み込み</Button>}>
        {err.message}
      </Banner>
    );
  } else if (!visits) {
    body = (
      <div className="space-y-2" aria-busy="true" aria-label="読み込み中">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[58px] rounded-xl" />)}
      </div>
    );
  } else if (list.length === 0) {
    body = (
      <EmptyState compact icon="calendar-check" title={filter === 'new' ? '今日の初回のお客様の予約はありません' : '今日の予約はありません'}
        message={filter === 'new' && visits.length ? '2回目以降のお客様は「すべての予約」から選べます' : 'SalonOne に予約が入ると、ここに自動で表示されます'} />
    );
  } else {
    body = (
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
        {list.map((v) => <VisitRow key={v.id} v={v} sheet={links[v.id] || null} onSelect={onSelect} />)}
      </ul>
    );
  }

  const fetchedAt = filter === 'form' && form ? form.res.data && form.res.data.fetchedAt : data && data.fetchedAt;
  return (
    <div>
      {data && data.stale && filter !== 'form' ? <Banner tone="warn" className="mb-3">{data.stale}</Banner> : null}
      {visits || form ? (
        <Segmented size="sm" className="mb-3" value={filter} onChange={setFilter} ariaLabel="表示する一覧" options={options} />
      ) : null}

      {body}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <ManualStart onStart={onManual} />
        {(filter === 'form' && form) || visits ? (
          <span className="flex items-center gap-1 text-[11px] text-muted">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
            </span>
            {filter === 'form' ? '30秒' : '1分'}ごとに自動で確認{fetchedAt ? `・${timeOf(fetchedAt)} 更新` : ''}
            <IconButton icon="refresh-cw" label="今すぐ確認" size="sm" onClick={filter === 'form' && form ? form.onRefresh : onRefresh} className={refreshing ? 'animate-spin' : ''} />
          </span>
        ) : null}
      </div>

      {filter !== 'form' && data && data.mode === 'live' && !data.names && visits && visits.length ? (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-surface-2 px-2.5 py-2 text-[11px] leading-relaxed text-muted">
          <Icon name="info" size={13} className="mt-px shrink-0" />
          <span>
            SalonOne の APIキーが「個人情報を含めない」設定のため、お名前の代わりに顧客番号を表示しています（SalonOne の顧客管理と同じ番号）。
            {form ? 'お名前が無いとカウンセリングシートと自動で結びつかないので、シートは「フォームの回答」から選んでください。' : ''}
            {isAdminLike() ? ' お名前も表示する場合は docs/COUNSELING.md の手順でキーを発行し直してください。' : ''}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/**
 * 選んだお客様
 * @param {{ customerName, customerNumber, time, status, isNew, staffName, sourceName, contracted, plans, manual, formOnly, sheet }} guest
 * @param {Object|null} pendingSheet 選んだ後に届いた（まだ反映していない）同じお名前のカウンセリングシート
 * @param {Function|null} onPickSheet フォームの回答から選んで付ける（フォームの店舗で、回答の一覧を読めた時だけ）
 */
export function GuestCard({ guest, callName, onCallName, onChange, onOpenTool, pendingSheet, onAttachSheet, onPickSheet }) {
  const title = guest.manual ? (guest.customerName ? `${guest.customerName} 様` : '予約に無いお客様') : guestLabel(guest);
  const meta = guest.manual
    ? ['予約に無いお客様（手入力）']
    : guest.formOnly
      ? ['カウンセリングシートから（今日の予約は見つかりませんでした）']
      : [guest.time, guest.staffName ? `担当 ${guest.staffName}` : '', guest.sourceName];
  return (
    <div className="animate-rise-in space-y-3">
      {pendingSheet ? (
        <Banner tone="info" title={`${pendingSheet.name} 様のカウンセリングシートが届きました（${sheetTime(pendingSheet.submittedAt)}）`}
          action={<Button size="sm" variant="primary" icon="file-check" onClick={onAttachSheet}>反映する</Button>}>
          反映すると、フォームで選ばれたお悩みがチェックに入ります（付けたチェックはそのまま残ります）。
        </Banner>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-100 text-base font-bold text-brand-800 dark:bg-brand-500/20 dark:text-brand-100" aria-hidden="true">
            {guest.customerName ? Array.from(guest.customerName)[0] : <Icon name="user-round" size={20} />}
          </span>
          <div className="min-w-0">
            <h3 className="flex flex-wrap items-center gap-2 text-lg font-bold tracking-tight text-ink">
              <span className="truncate">{title}</span>
              {guest.isNew ? <Badge tone="gold">初回</Badge> : null}
              {guest.sheet ? <Badge tone="info" icon="file-text">シートあり</Badge> : null}
              {!guest.manual && guest.status ? <StatusBadge status={guest.status} /> : null}
              {guest.contracted ? <Badge tone="good" icon="check">ご契約</Badge> : null}
            </h3>
            <p className="mt-0.5 truncate text-xs text-muted">{meta.filter(Boolean).join('　')}{guest.plans && guest.plans.length ? `　${guest.plans.join('・')}` : ''}</p>
          </div>
        </div>
        <Button size="sm" variant="secondary" icon="users" onClick={onChange}>別のお客様</Button>
      </div>

      {!guest.sheet && !pendingSheet && onPickSheet ? (
        <div className="rounded-xl border border-dashed border-line-strong px-3 py-2.5 sm:flex sm:items-center sm:gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <Icon name="file-question-mark" size={18} className="mt-0.5 shrink-0 text-muted" />
            <div className="min-w-0">
              <p className="text-[13px] font-bold text-ink">{guest.manual ? 'カウンセリングシート' : 'カウンセリングシートが見つかりません'}</p>
              <p className="text-xs leading-relaxed text-muted">
                {guest.manual
                  ? 'フォームに記入いただいた方は、回答を選ぶとお悩みがチェックに入ります'
                  : 'まだ届いていないか、SalonOne とフォームでお名前の書き方が違います。回答を選ぶとお悩みがチェックに入ります'}
              </p>
            </div>
          </div>
          <Button size="sm" variant="secondary" icon="file-search" onClick={onPickSheet} className="mt-2.5 w-full sm:mt-0 sm:w-auto">回答から選ぶ</Button>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 rounded-xl bg-surface-2 p-3 sm:flex-row sm:items-center">
        <label htmlFor="cs-call-name" className="shrink-0 text-xs font-semibold text-ink-2">ご説明の画面のお名前</label>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Input id="cs-call-name" value={callName} onChange={(e) => onCallName(e.target.value)} placeholder="例: 山本（空欄なら「お客様」）" className="h-10 flex-1 py-1" maxLength={20} />
          <span className="shrink-0 text-sm font-semibold text-ink-2">様</span>
        </div>
      </div>

      {onOpenTool ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="subtle" icon="person-standing" onClick={() => onOpenTool('posture')}>このお客様で姿勢分析</Button>
          <Button size="sm" variant="subtle" icon="clipboard-list" onClick={() => onOpenTool('report')}>施術レポート</Button>
        </div>
      ) : null}
    </div>
  );
}

/** 店舗の切り替え（見られる店舗が 2つ以上の時） */
export function StorePicker({ stores, value, onChange }) {
  if (stores.length <= 1) return stores[0] ? <Badge tone="brand" icon="store">{stores[0].name}</Badge> : null;
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="店舗" className="h-9 w-auto max-w-[11rem] py-1 text-[13px]">
      {stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </Select>
  );
}

