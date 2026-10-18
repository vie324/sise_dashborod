import { useState } from 'react';
import { Badge, Banner, Button, IconButton, Input, Skeleton, EmptyState, cx } from '../../../ui/primitives.jsx';
import Icon from '../../../ui/Icon.jsx';
import { navigate } from '../../../app/router.js';
import { toJstDate, todayJst, addDays } from '../../../../shared/dates.js';
import { matchConcern } from '../../../../shared/counseling.js';

// ============================================================
// カウンセリングシート（Google フォームの回答）の一覧と、選んだお客様の内容
// ============================================================

const FRESH_MS = 60 * 60 * 1000;

const timeOf = (iso) => new Date(iso).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit' });

/** 「14分前」「今日 10:32」「昨日 18:20」「10/12 15:04」 */
export function sheetTime(iso, now = Date.now()) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = now - t;
  if (diff >= 0 && diff < 60 * 1000) return 'たった今';
  if (diff >= 0 && diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}分前`;
  const day = toJstDate(iso);
  const today = todayJst(now);
  if (day === today) return `今日 ${timeOf(iso)}`;
  if (day === addDays(today, -1)) return `昨日 ${timeOf(iso)}`;
  return `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))} ${timeOf(iso)}`;
}

/** '1992-04-18' / '1992/4/18' / '1992年4月18日' → 満年齢（読めなければ null） */
export function ageOf(birthday, today = todayJst()) {
  const m = String(birthday || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [ty, tm, td] = today.split('-').map(Number);
  const age = ty - y - (tm < mo || (tm === mo && td < d) ? 1 : 0);
  return age > 0 && age < 120 ? age : null;
}

export const sheetKey = (s) => `${s.index}:${s.name}`;

function Initial({ name, fresh }) {
  return (
    <span className={cx('relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold',
      fresh ? 'bg-gold-100 text-gold-800 dark:bg-gold-500/20 dark:text-gold-100' : 'bg-brand-100 text-brand-800 dark:bg-brand-500/20 dark:text-brand-100')} aria-hidden="true">
      {Array.from(name || '?')[0]}
      {fresh ? <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-surface bg-gold-500" /> : null}
    </span>
  );
}

function ConcernPreview({ concerns, max = 3 }) {
  if (!concerns || concerns.length === 0) return <span className="text-muted">お悩みの回答なし</span>;
  return (
    <>
      {concerns.slice(0, max).join('・')}
      {concerns.length > max ? <span className="text-muted"> ほか{concerns.length - max}</span> : null}
    </>
  );
}

// ------------------------------------------------------------
// 一覧
// ------------------------------------------------------------
/**
 * @param {Array} rows            回答（新しい順）
 * @param {Set<string>} arrived   この画面を開いてから届いた回答（sheetKey）
 */
export function SheetList({ rows, loading, error, arrived, onSelect, onSearch, searching, searchResult, onClearSearch, fetchedAt, onRefresh, refreshing }) {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const now = Date.now();
  const list = searchResult ? searchResult.rows : rows || [];
  const visible = showAll || searchResult ? list : list.slice(0, 6);

  const submit = (e) => {
    e.preventDefault();
    const q = query.trim();
    if (q) onSearch(q);
    else onClearSearch();
  };

  return (
    <div>
      <form onSubmit={submit} className="mb-3 flex gap-2" role="search">
        <div className="relative min-w-0 flex-1">
          <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="お名前で検索（過去の回答も）" className="pl-9" aria-label="お名前で検索" enterKeyHint="search" />
        </div>
        <Button type="submit" loading={searching}>検索</Button>
      </form>

      {searchResult ? (
        <div className="mb-2 flex items-center justify-between gap-2 text-xs text-ink-2">
          <span>「{searchResult.q}」の検索結果 {searchResult.rows.length}件</span>
          <Button size="sm" variant="ghost" icon="x" onClick={() => { setQuery(''); onClearSearch(); }}>検索をやめる</Button>
        </div>
      ) : null}

      {error && !rows ? (
        <Banner tone="bad" title="カウンセリングシートを読み込めませんでした" action={<Button size="sm" icon="refresh-cw" onClick={onRefresh}>再読み込み</Button>}>{error.message}</Banner>
      ) : loading && !rows && !searchResult ? (
        <div className="space-y-2" aria-busy="true" aria-label="読み込み中">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[60px] rounded-xl" />)}
        </div>
      ) : list.length === 0 ? (
        <EmptyState compact icon="inbox" title={searchResult ? '見つかりませんでした' : 'まだ回答がありません'}
          message={searchResult ? 'お名前の一部（姓だけ など）で検索してみてください' : 'お客様がカウンセリングフォームを送ると、ここに自動で表示されます'} />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {visible.map((s) => {
            const t = s.submittedAt ? new Date(s.submittedAt).getTime() : 0;
            const fresh = arrived.has(sheetKey(s)) || (t && now - t < FRESH_MS);
            return (
              <li key={sheetKey(s)}>
                <button type="button" onClick={() => onSelect(s)} className="flex w-full items-center gap-3 bg-surface px-3 py-2.5 text-left transition-colors hover:bg-surface-2">
                  <Initial name={s.name} fresh={fresh} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-bold text-ink">{s.name} 様</span>
                      {fresh ? <Badge tone="gold">NEW</Badge> : null}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink-2"><ConcernPreview concerns={s.concerns} /></span>
                  </span>
                  <span className="shrink-0 text-right text-[11px] text-muted">{sheetTime(s.submittedAt, now)}</span>
                  <Icon name="chevron-right" size={16} className="shrink-0 text-muted" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {!searchResult && list.length > 6 ? (
          <Button size="sm" variant="ghost" icon={showAll ? 'chevron-up' : 'chevron-down'} onClick={() => setShowAll((v) => !v)}>
            {showAll ? '閉じる' : `すべて表示（${list.length}件）`}
          </Button>
        ) : <span />}
        {!searchResult ? (
          <span className="flex items-center gap-1 text-[11px] text-muted">
            <span className="relative flex h-2 w-2" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping-slow rounded-full bg-brand-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
            </span>
            30秒ごとに自動で確認{fetchedAt ? `・${timeOf(fetchedAt)} 更新` : ''}
            <IconButton icon="refresh-cw" label="今すぐ確認" size="sm" onClick={onRefresh} className={refreshing ? 'animate-spin' : ''} />
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
// 選んだお客様のシート
// ------------------------------------------------------------
function Info({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-[13px] font-semibold text-ink">{children}</dd>
    </div>
  );
}

/**
 * @param {Object} sheet  サーバーが整形した 1件（api/_lib/counseling.js の normDetail）
 */
export function CustomerSheet({ sheet, loading, onChange, onOpenTool }) {
  if (loading && !sheet) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="読み込み中">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
    );
  }
  if (!sheet) return null;
  const age = ageOf(sheet.birthday);
  const profile = [
    sheet.birthday ? { label: '生年月日', value: `${sheet.birthday}${age ? `（${age}歳）` : ''}` } : null,
    sheet.occupation ? { label: '職業', value: sheet.occupation } : null,
    sheet.address ? { label: 'お住まい', value: sheet.address } : null,
    sheet.improvementTimeline ? { label: '目標時期', value: sheet.improvementTimeline } : null,
  ].filter(Boolean);

  return (
    <div className="animate-rise-in space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-xl font-bold tracking-tight text-ink">{sheet.name} <span className="text-base font-semibold text-ink-2">様</span></h3>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
            <Icon name="file-text" size={13} />Googleフォームで回答{sheet.submittedAt ? `・${sheetTime(sheet.submittedAt)}` : ''}
          </p>
        </div>
        <Button size="sm" variant="secondary" icon="users" onClick={onChange}>別のお客様</Button>
      </div>

      {sheet.cautions.length ? (
        <div className="rounded-xl border border-[#efc0c0] bg-[#fdf2f2] p-3 dark:border-[#d03b3b]/35 dark:bg-[#d03b3b]/10" role="note">
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-[#9b2525] dark:text-[#f3a3a3]">
            <Icon name="triangle-alert" size={14} />施術の前に確認
          </div>
          <ul className="space-y-1">
            {sheet.cautions.map((c) => (
              <li key={c.key} className="flex items-start gap-2 rounded-lg bg-surface px-2.5 py-1.5 text-[13px] text-ink">
                <Icon name={c.warn ? 'circle-alert' : 'info'} size={14} className={cx('mt-0.5 shrink-0', c.warn ? 'text-[#c43434] dark:text-[#f08a8a]' : 'text-muted')} />
                <span><span className="font-semibold text-ink-2">{c.label}:</span> {c.value}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {profile.length ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-surface-2 p-3 sm:grid-cols-4">
          {profile.map((p) => <Info key={p.label} label={p.label}>{p.value}</Info>)}
        </dl>
      ) : null}

      {sheet.treatmentRequest ? (
        <div className="rounded-xl border border-[#bfd6f3] bg-[#f1f6fd] p-3 dark:border-[#3987e5]/30 dark:bg-[#3987e5]/10">
          <div className="mb-0.5 flex items-center gap-1.5 text-xs font-bold text-[#1f4f8f] dark:text-[#b8d3f6]"><Icon name="message-square" size={13} />施術に関するご要望</div>
          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{sheet.treatmentRequest}</p>
        </div>
      ) : null}

      {sheet.concerns.length ? (
        <div>
          <div className="mb-1 text-[11px] font-medium text-muted">フォームで選んだお悩み（下のチェックに反映済み）</div>
          <div className="flex flex-wrap gap-1.5">
            {sheet.concerns.map((c) => {
              const hit = matchConcern(c).length > 0;
              return (
                <span key={c} className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
                  hit ? 'bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-100' : 'bg-surface-3 text-ink-2')}>
                  {hit ? <Icon name="check" size={12} strokeWidth={3} /> : null}{c}
                  {!hit ? <span className="text-[10px] font-medium text-muted">（項目なし）</span> : null}
                </span>
              );
            })}
          </div>
        </div>
      ) : null}

      {sheet.treatmentExperience.length || sheet.visitPurpose.length ? (
        <dl className="grid gap-2 sm:grid-cols-2">
          {sheet.treatmentExperience.length ? <Info label="ご利用経験のある施術">{sheet.treatmentExperience.join('、')}</Info> : null}
          {sheet.visitPurpose.length ? <Info label="ご来店のきっかけ">{sheet.visitPurpose.join('、')}</Info> : null}
        </dl>
      ) : null}

      {onOpenTool ? (
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <Button size="sm" variant="subtle" icon="person-standing" onClick={() => onOpenTool('posture')}>このお客様で姿勢分析</Button>
          <Button size="sm" variant="subtle" icon="clipboard-list" onClick={() => onOpenTool('report')}>施術レポート</Button>
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------
// 連携していない時
// ------------------------------------------------------------
export function NotConnected({ canConfigure, reason }) {
  const openSettings = () => {
    try { localStorage.setItem('sise_settings_tab', 'counseling'); } catch (_) { /* noop */ }
    navigate('/settings');
  };
  return (
    <Banner tone="info" title={reason === 'not_linked' ? 'この店舗はカウンセリングフォームと対応付けられていません' : 'カウンセリングフォームとの連携が未設定です'}
      action={canConfigure ? <Button size="sm" variant="secondary" iconRight="chevron-right" onClick={openSettings}>設定する</Button> : null}>
      {canConfigure
        ? 'Google フォームの回答（GAS）とつなぐと、お客様が送ったシートが自動で表示され、お悩みがチェックに反映されます。下のチェックは手で付けても使えます。'
        : 'オーナーに 設定 → カウンセリング の連携を依頼してください。下のチェックは手で付けても使えます。'}
    </Banner>
  );
}
