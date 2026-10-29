import { useEffect, useState } from 'react';
import { Badge, Banner, Button, Card, EmptyState, Input, Skeleton, cx } from '../../../ui/primitives.jsx';
import Icon from '../../../ui/Icon.jsx';
import { toJstDate, todayJst, addDays } from '../../../../shared/dates.js';
import { matchConcern } from '../../../../shared/counseling.js';

// ============================================================
// カウンセリングシート（Google フォームの回答）— フォームを使う店舗だけ
// ------------------------------------------------------------
//   SheetList   届いた回答の一覧（お名前で過去の回答も探せる）
//   SheetPicker 選んだお客様に回答を付ける（お名前の書き方が違って自動で結びつかなかった時・選び直す時）
//   SheetCard   選んだお客様の回答。施術前の確認・お悩み・ご要望・目標時期を大きく見やすく出す
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

/** 「肩こり・姿勢・猫背 ほか2」 */
export function ConcernPreview({ concerns, max = 3 }) {
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
 * @param {Array} rows                回答（新しい順）
 * @param {Set<string>} arrived       この画面を開いてから届いた回答（sheetKey）
 * @param {(row)=>Object|null} visitOf 回答と結びついた今日の予約（同じお名前・3日以内の回答）
 */
export function SheetList({ rows, loading, error, arrived, visitOf, onSelect, onSearch, searching, searchResult, onClearSearch, onRefresh }) {
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const now = Date.now();
  const list = searchResult ? searchResult.rows : rows || [];
  const visible = showAll || searchResult ? list : list.slice(0, 8);

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
            const fresh = (arrived && arrived.has(sheetKey(s))) || (t && now - t < FRESH_MS);
            const visit = visitOf ? visitOf(s) : null;
            return (
              <li key={sheetKey(s)}>
                <button type="button" onClick={() => onSelect(s)} className="flex w-full items-center gap-3 bg-surface px-3 py-2.5 text-left transition-colors hover:bg-surface-2">
                  <span className={cx('relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                    fresh ? 'bg-gold-100 text-gold-800 dark:bg-gold-500/20 dark:text-gold-100' : 'bg-brand-100 text-brand-800 dark:bg-brand-500/20 dark:text-brand-100')} aria-hidden="true">
                    {Array.from(s.name || '?')[0]}
                    {fresh ? <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-surface bg-gold-500" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-bold text-ink">{s.name} 様</span>
                      {fresh ? <Badge tone="gold">NEW</Badge> : null}
                      {visit ? <Badge tone="brand" icon="calendar-check">今日 {visit.time} 予約</Badge> : null}
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

      {!searchResult && list.length > 8 ? (
        <Button size="sm" variant="ghost" className="mt-2" icon={showAll ? 'chevron-up' : 'chevron-down'} onClick={() => setShowAll((v) => !v)}>
          {showAll ? '閉じる' : `すべて表示（${list.length}件）`}
        </Button>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------
// 選んだお客様のシート（スタッフが見る。お客様向けのご説明には健康状態・住所などは出さない）
// ------------------------------------------------------------
function Item({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-[15px] font-semibold leading-snug text-ink">{children}</dd>
    </div>
  );
}

/** お悩みの見出しの補足（いくつをチェックに入れたか） */
function concernNote(concerns) {
  if (!concerns.length) return 'お悩みの回答なし';
  const hit = concerns.filter((c) => matchConcern(c).length > 0).length;
  if (!hit) return `${concerns.length}つ・チェック項目に当たるものはありません`;
  return hit === concerns.length ? `${hit}つ・下のチェックに入れました` : `${concerns.length}つのうち ${hit}つを下のチェックに入れました`;
}

/**
 * 予約にカウンセリングシートを付ける（お名前の書き方が違って自動で結びつかなかった時・選び直す時）
 * @param {Object} form VisitList の form と同じ（{ res, visitOf, onSearch, searching, searchResult, onClearSearch, onRefresh }）
 * @param {Array} rows 回答（3日以内・お名前が近い回答が先）
 * @param {boolean} replacing 付いているシートを選び直すか
 */
export function SheetPicker({ form, rows, guestName, replacing, onPick, onClose }) {
  // 開いたら一覧が見えるところまで送る（スマホでは選んだお客様の下に開くため）
  useEffect(() => {
    const el = document.getElementById('sheet-picker');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  return (
    <Card id="sheet-picker" title={replacing ? 'カウンセリングシートを選び直す' : 'カウンセリングシートを選ぶ'} icon="file-search" className="animate-rise-in scroll-mt-20"
      subtitle={`${guestName ? `${guestName} 様の` : 'このお客様の'}回答を選ぶと、フォームのお悩みがチェックに入ります`}
      actions={<Button size="sm" variant="ghost" icon="x" onClick={onClose}>閉じる</Button>}>
      {replacing ? (
        <p className="mb-3 flex items-start gap-1.5 rounded-lg bg-surface-2 px-2.5 py-2 text-xs leading-relaxed text-ink-2">
          <Icon name="info" size={13} className="mt-0.5 shrink-0" />選び直すと、前のシートから入ったチェックは外れます
        </p>
      ) : null}
      <SheetList rows={rows} loading={form.res.loading} error={form.res.error} arrived={null} visitOf={form.visitOf}
        onSelect={onPick} onSearch={form.onSearch} searching={form.searching} searchResult={form.searchResult}
        onClearSearch={form.onClearSearch} onRefresh={form.onRefresh} />
    </Card>
  );
}

/**
 * @param {Object} sheet api/_lib/counseling.js の normDetail（電話・メールは含まない）
 * @param {Function|null} onRepick 別の回答を選び直す（フォームの店舗だけ）
 */
export function SheetCard({ sheet, loading, error, onRetry, onRepick }) {
  const repick = onRepick ? <Button size="sm" variant="ghost" icon="file-search" onClick={onRepick}>選び直す</Button> : null;
  if (!sheet) {
    if (error) {
      return (
        <Banner tone="bad" title="カウンセリングシートを開けませんでした"
          action={<span className="flex flex-wrap gap-1.5"><Button size="sm" icon="refresh-cw" onClick={onRetry}>もう一度</Button>{repick}</span>}>
          {error.message}
        </Banner>
      );
    }
    return loading ? <Skeleton className="h-56 rounded-2xl" /> : null;
  }
  const age = ageOf(sheet.birthday);
  const concerns = sheet.concerns || [];
  const profile = [
    age || sheet.birthday ? { label: '年齢', value: age ? `${age}歳` : sheet.birthday } : null,
    sheet.occupation ? { label: 'ご職業', value: sheet.occupation } : null,
    sheet.address ? { label: 'お住まい', value: sheet.address } : null,
    sheet.visitPurpose && sheet.visitPurpose.length ? { label: 'ご来店のきっかけ', value: sheet.visitPurpose.join('、') } : null,
    sheet.treatmentExperience && sheet.treatmentExperience.length ? { label: 'ご利用経験のある施術', value: sheet.treatmentExperience.join('、') } : null,
  ].filter(Boolean);

  return (
    <Card title="カウンセリングシート" icon="file-text" className="animate-rise-in"
      subtitle={`${sheet.name} 様が Google フォームに記入した内容`}
      actions={(
        <span className="flex flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-1.5">
          {sheet.submittedAt ? <Badge tone="info" icon="clock">{sheetTime(sheet.submittedAt)}</Badge> : null}
          {repick}
        </span>
      )}>
      {/* 施術の前に確認すること（いちばん上に、目立たせる） */}
      {sheet.cautions && sheet.cautions.length ? (
        <section className="mb-4 rounded-2xl border-2 border-[#efc0c0] bg-[#fdf2f2] p-3.5 dark:border-[#d03b3b]/40 dark:bg-[#d03b3b]/10" role="note" aria-label="施術の前に確認">
          <h3 className="mb-2.5 flex items-center gap-2 text-[15px] font-bold text-[#9b2525] dark:text-[#f3a3a3]">
            <Icon name="triangle-alert" size={19} />施術の前に確認してください
          </h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {sheet.cautions.map((c) => (
              <li key={c.key} className="flex items-start gap-2.5 rounded-xl bg-surface px-3 py-2.5">
                <Icon name={c.warn ? 'circle-alert' : 'info'} size={18} className={cx('mt-0.5 shrink-0', c.warn ? 'text-[#c43434] dark:text-[#f08a8a]' : 'text-muted')} />
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-[#9b2525] dark:text-[#f3a3a3]">{c.label}</span>
                  <span className="block break-words text-[15px] font-semibold leading-snug text-ink">{c.value}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="mb-4 flex items-center gap-2 rounded-xl bg-[#e7f6e7] px-3 py-2.5 text-[13px] font-semibold text-[#0f5f12] dark:bg-[#0ca30c]/15 dark:text-[#7fe08a]">
          <Icon name="circle-check" size={16} />手術歴・治療中・アレルギーなど、施術の前に確認することはありません
        </p>
      )}

      {/* お悩み（お客様が選んだ言葉のまま。チェック項目に当たったものは緑） */}
      <section aria-labelledby="sheet-concerns">
        <h3 id="sheet-concerns" className="mb-2 flex flex-wrap items-baseline gap-x-2 text-[15px] font-bold text-ink">
          お悩み
          <span className="text-xs font-medium text-muted">{concernNote(concerns)}</span>
        </h3>
        {concerns.length ? (
          <div className="flex flex-wrap gap-2">
            {concerns.map((c) => {
              const hit = matchConcern(c).length > 0;
              return (
                <span key={c} className={cx('inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[15px] font-bold',
                  hit ? 'bg-brand-600 text-white' : 'border border-line-strong bg-surface-2 text-ink')}>
                  {hit ? <Icon name="check" size={15} strokeWidth={3} /> : null}{c}
                  {!hit ? <span className="text-[11px] font-medium text-muted">（チェック項目なし）</span> : null}
                </span>
              );
            })}
          </div>
        ) : null}
      </section>

      {/* ご要望・目標時期（お客様の言葉を大きく） */}
      {sheet.treatmentRequest || sheet.improvementTimeline ? (
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          {sheet.treatmentRequest ? (
            <figure className="rounded-2xl border border-[#bfd6f3] bg-[#f1f6fd] p-3.5 dark:border-[#3987e5]/30 dark:bg-[#3987e5]/10">
              <figcaption className="mb-1 flex items-center gap-1.5 text-xs font-bold text-[#1f4f8f] dark:text-[#b8d3f6]"><Icon name="message-square" size={14} />施術のご要望</figcaption>
              <blockquote className="whitespace-pre-wrap text-base font-semibold leading-relaxed text-ink">「{sheet.treatmentRequest}」</blockquote>
            </figure>
          ) : null}
          {sheet.improvementTimeline ? (
            <div className="rounded-2xl border border-gold-200 bg-gold-50 p-3.5 dark:border-gold-500/30 dark:bg-gold-500/10">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-bold text-gold-800 dark:text-gold-200"><Icon name="target" size={14} />改善したい時期</div>
              <div className="text-xl font-bold leading-snug text-ink">{sheet.improvementTimeline}</div>
            </div>
          ) : null}
        </div>
      ) : null}

      {profile.length ? (
        <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 rounded-2xl bg-surface-2 p-3.5 sm:grid-cols-3 lg:grid-cols-5">
          {profile.map((p) => <Item key={p.label} label={p.label}>{p.value}</Item>)}
        </dl>
      ) : null}
    </Card>
  );
}
