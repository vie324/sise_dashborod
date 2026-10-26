import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { Badge, Banner, Button, Card, EmptyState, Field, Input, Modal, PageHeader, Textarea, cx } from '../../ui/primitives.jsx';
import { showToast } from '../../ui/feedback.jsx';
import { navigate } from '../../app/router.js';
import { useMandala, useAutosave, useForgetOnClose, mandalaAction, refreshMandala } from './data.js';
import { StateBadge, WeekNav, Thread, SaveStatus, LoadingState, ErrorState, WeekChips, go } from './parts.jsx';
import { MAX_FOCUS, formatWeekShort, isCurrentWeek, formatDateTimeJst } from '../../../shared/mandala.js';

// ============================================================
// 週報（週次の振り返り）
// ------------------------------------------------------------
//   1. できた行動（チャートの「行動」×「毎週チェック」の項目）
//   2. 今週のフォーカスの達成（◯ / ×）
//   3. ひとこと振り返り（よかったこと・課題）
//   4. 来週のフォーカス（自分で選ぶ・AI の提案を採用）
// 入力は自動で保存する（施術の合間に書いて閉じても消えない）。提出すると AI がレビューする。
// 店長・オーナーは同じ内容を読み取りだけで見て、コメントする（ReviewReadOnly）。
// 売上や施術数などの数字はここでは書かない（SalonOne で見られる）。
// ============================================================

// ------------------------------------------------------------
// AI レビュー
// ------------------------------------------------------------
function AiPanel({ ai, loading, error, canRerun, onRerun, canAdopt, nextWeek, nextFocus, onAdopt }) {
  const [busy, setBusy] = useState(false);
  if (loading) {
    return (
      <div className="card mb-4 flex items-center gap-3 p-4" role="status">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gold-50 text-gold-700 dark:bg-gold-500/15 dark:text-gold-200"><Icon name="sparkles" size={19} className="animate-pulse" /></span>
        <div>
          <p className="text-[13px] font-bold text-ink">AI が今週を振り返っています…</p>
          <p className="text-xs text-muted">10秒ほどかかります。このまま待つか、画面を移っても大丈夫です。</p>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <Banner tone="warn" className="mb-4" title="AI のレビューを作れませんでした" action={canRerun ? <Button size="sm" onClick={onRerun}>再実行</Button> : null}>
        {error}
      </Banner>
    );
  }
  if (!ai) return null;
  const r = ai.result || {};
  const insight = r.habit_insight || r.kpi_insight || null; // kpi_insight は旧ツール（v1）の保存分
  const have = new Set((nextFocus || []).map((f) => f.mandalaItemId));
  const remaining = (r.next_focus || []).filter((f) => !have.has(f.mandala_item_id));
  const room = MAX_FOCUS - (nextFocus || []).length;
  const adopt = async (items) => {
    setBusy(true);
    try { await onAdopt(items); } finally { setBusy(false); }
  };
  return (
    <Card className="mb-4" title="AI のレビュー" icon="sparkles" subtitle={ai.createdAt ? `${formatDateTimeJst(ai.createdAt)} 作成` : null}
      actions={canRerun ? <Button size="sm" variant="ghost" icon="refresh-cw" onClick={onRerun}>作り直す</Button> : null}>
      <p className="text-[14px] leading-relaxed text-ink">{r.summary}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1.5 text-xs font-semibold text-ink-2">よかった点</p>
          <ul className="space-y-1.5">
            {(r.wins || []).map((w, i) => <li key={i} className="flex gap-2 text-[13px] leading-snug text-ink"><Icon name="circle-check" size={15} className="mt-0.5 text-[var(--status-good)]" />{w}</li>)}
          </ul>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold text-ink-2">気になる点</p>
          <ul className="space-y-1.5">
            {(r.concerns || []).map((w, i) => <li key={i} className="flex gap-2 text-[13px] leading-snug text-ink"><Icon name="circle-alert" size={15} className="mt-0.5 text-[var(--status-warn)]" />{w}</li>)}
          </ul>
        </div>
      </div>
      {insight ? (
        <div className="mt-4 rounded-xl bg-surface-2 px-3 py-2.5">
          <p className="text-[11px] font-semibold text-muted">今週のポイント</p>
          <p className="mt-0.5 text-[13px] leading-snug text-ink">{insight}</p>
        </div>
      ) : null}
      {(r.next_focus || []).length > 0 ? (
        <div className="mt-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-ink-2">{canAdopt ? `${formatWeekShort(nextWeek)}のフォーカスの提案` : '翌週のフォーカスの提案'}</p>
            {canAdopt && remaining.length > 1 && room > 0 ? (
              <Button size="sm" variant="subtle" loading={busy} onClick={() => adopt(remaining.slice(0, room))}>{Math.min(remaining.length, room)}つまとめて採用</Button>
            ) : null}
          </div>
          <ul className="space-y-2">
            {r.next_focus.map((f) => {
              const done = have.has(f.mandala_item_id);
              return (
                <li key={f.mandala_item_id} className={cx('rounded-xl border px-3 py-2.5', done ? 'border-brand-300 bg-brand-50/60 dark:border-brand-500/40 dark:bg-brand-500/10' : 'border-line')}>
                  <p className="text-[14px] font-semibold leading-snug text-ink">{f.title}</p>
                  <p className="mt-0.5 text-xs leading-snug text-muted">{f.reason}</p>
                  {canAdopt ? (
                    <div className="mt-2">
                      {done ? <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 dark:text-brand-300"><Icon name="check" size={13} />来週のフォーカスに入っています</span>
                        : <Button size="sm" icon="plus" disabled={busy || room <= 0} onClick={() => adopt([f])}>{room <= 0 ? 'フォーカスがいっぱいです' : '採用'}</Button>}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="mt-4 text-xs text-muted">フォーカスの提案は取得できませんでした。作り直すか、自分で選んでください。</p>
      )}
      {r.message_to_staff ? <p className="mt-4 rounded-r-xl border-l-[3px] border-brand-500 bg-surface-2 px-3 py-2 text-[14px] leading-snug text-ink">{r.message_to_staff}</p> : null}
    </Card>
  );
}

// ------------------------------------------------------------
// フォーカスを選ぶ
// ------------------------------------------------------------
function FocusPicker({ open, onClose, candidates, taken, onPick, weekLabel }) {
  const [q, setQ] = useState('');
  const [free, setFree] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setQ(''); setFree(''); } }, [open]);
  const groups = useMemo(() => {
    const map = new Map();
    for (const c of candidates) {
      if (q && !`${c.content} ${c.themeTitle}`.includes(q)) continue;
      if (!map.has(c.themeTitle)) map.set(c.themeTitle, []);
      map.get(c.themeTitle).push(c);
    }
    return [...map.entries()];
  }, [candidates, q]);
  const pick = async (arg) => {
    setBusy(true);
    try { await onPick(arg); onClose(); } catch (e) { showToast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title={`${weekLabel}のフォーカスを選ぶ`}>
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="行動を探す（例: 口コミ）" aria-label="行動を探す" />
      <div className="mt-3 max-h-[46vh] space-y-4 overflow-y-auto">
        {groups.length === 0 ? <p className="py-6 text-center text-[13px] text-muted">{candidates.length ? '見つかりませんでした' : 'チャートに「行動」の項目がありません'}</p> : groups.map(([theme, list]) => (
          <div key={theme}>
            <p className="mb-1.5 text-[11px] font-semibold text-muted">{theme}</p>
            <ul className="space-y-1.5">
              {list.map((c) => {
                const on = taken.has(c.id);
                return (
                  <li key={c.id}>
                    <button type="button" disabled={on || busy} onClick={() => pick({ itemId: c.id })}
                      className={cx('flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left text-[14px] leading-snug transition-colors',
                        on ? 'border-brand-300 bg-brand-50 text-ink-2 dark:border-brand-500/40 dark:bg-brand-500/10' : 'border-line text-ink hover:bg-surface-2')}>
                      <Icon name={on ? 'check' : 'plus'} size={16} className={on ? 'text-brand-600' : 'text-muted'} />
                      <span className="min-w-0 flex-1">{c.content}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <Field label="チャートに無いことを書く" htmlFor="focus-free">
          <div className="flex gap-2">
            <Input id="focus-free" value={free} maxLength={200} onChange={(e) => setFree(e.target.value)} placeholder="例: 毎朝ストレッチを伝える練習" />
            <Button variant="primary" disabled={!free.trim() || busy} onClick={() => pick({ freeText: free.trim() })}>追加</Button>
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function FocusList({ title, subtitle, focus, editable, achieved, onAchieved, onRemove, onAdd, id }) {
  return (
    <Card title={title} icon="target" subtitle={subtitle} id={id}
      actions={<span className="text-xs text-muted num">{focus.length}/{MAX_FOCUS}</span>}>
      {focus.length === 0 ? <p className="text-[13px] text-muted">まだ決めていません。</p> : (
        <ul className="space-y-2">
          {focus.map((f) => (
            <li key={f.id} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] leading-snug text-ink">{f.label}</span>
                <span className="mt-0.5 flex items-center gap-2">
                  {f.source === 'ai' ? <Badge tone="info" icon="sparkles">AI提案</Badge> : null}
                  {editable && onRemove ? <button type="button" onClick={() => onRemove(f.id)} className="text-[11px] font-semibold text-muted underline hover:text-ink">外す</button> : null}
                </span>
              </span>
              {onAchieved ? (
                <div className="flex shrink-0 gap-1.5">
                  {[true, false].map((val) => {
                    const on = achieved[f.id] === val;
                    return (
                      <button key={String(val)} type="button" disabled={!editable} aria-pressed={on} aria-label={val ? '達成' : '未達成'} onClick={() => onAchieved(f.id, on ? null : val)}
                        className={cx('flex h-11 w-11 items-center justify-center rounded-xl border text-lg font-bold transition-colors disabled:opacity-70',
                          on ? (val ? 'border-[#0ca30c] bg-[#e7f6e7] text-[#0f5f12] dark:bg-[#0ca30c]/20 dark:text-[#7fe08a]' : 'border-[#d03b3b] bg-[#fbe9e9] text-[#9b2525] dark:bg-[#d03b3b]/20 dark:text-[#f3a3a3]') : 'border-line text-muted')}>
                        {val ? '◯' : '×'}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editable && onAdd && focus.length < MAX_FOCUS ? (
        <Button size="sm" variant="subtle" icon="plus" className="mt-3" onClick={onAdd}>フォーカスを選ぶ</Button>
      ) : null}
    </Card>
  );
}

function groupTrackables(trackables) {
  const map = new Map();
  for (const t of trackables) {
    if (!map.has(t.themeTitle)) map.set(t.themeTitle, []);
    map.get(t.themeTitle).push(t);
  }
  return [...map.entries()];
}

function ChecksCard({ trackables, checks, onToggle, editable }) {
  const done = trackables.filter((t) => checks[t.itemId]).length;
  const count = <span className="text-xs font-semibold text-ink-2 num">{done}/{trackables.length}</span>;
  if (!editable) {
    // 店長・オーナー向け: テーマごとに「できた / できなかった」をまとめて短く見せる
    return (
      <Card title="できた行動" icon="list-checks" actions={count}>
        {trackables.length === 0 ? <p className="text-[13px] text-muted">毎週チェックする行動がありません。</p> : (
          <ul className="space-y-3">
            {groupTrackables(trackables).map(([theme, rows]) => {
              const n = rows.filter((t) => checks[t.itemId]).length;
              return (
                <li key={theme}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
                    <span className="truncate font-semibold text-ink">{theme}</span>
                    <span className="shrink-0 text-xs text-muted num">{n}/{rows.length}</span>
                  </div>
                  <ul className="flex flex-wrap gap-1">
                    {rows.map((t) => (
                      <li key={t.itemId} className={cx('inline-flex max-w-full items-center gap-1 rounded-lg px-2 py-1 text-[12px] leading-snug',
                        checks[t.itemId] ? 'bg-[#e7f6e7] text-[#0f5f12] dark:bg-[#0ca30c]/15 dark:text-[#7fe08a]' : 'bg-surface-3 text-muted line-through decoration-1')}>
                        <Icon name={checks[t.itemId] ? 'check' : 'minus'} size={12} strokeWidth={2.4} /><span className="min-w-0">{t.content}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    );
  }
  return (
    <Card title="できた行動" icon="list-checks" actions={count}>
      {trackables.length === 0 ? (
        <p className="text-[13px] text-muted">毎週チェックする行動がありません。<button type="button" className="font-semibold text-brand-700 underline dark:text-brand-300" onClick={go('/mandala/edit/5/1')}>チャートの⑤分類で選ぶ</button></p>
      ) : (
        <div className="space-y-4">
          {groupTrackables(trackables).map(([theme, rows]) => (
            <div key={theme}>
              <p className="mb-1.5 flex items-baseline justify-between gap-2 text-[11px] font-semibold text-muted">
                <span className="truncate">{theme}</span>
                <span className="shrink-0 num">{rows.filter((t) => checks[t.itemId]).length}/{rows.length}</span>
              </p>
              <ul className="space-y-1.5">
                {rows.map((t) => {
                  const on = !!checks[t.itemId];
                  return (
                    <li key={t.itemId}>
                      <label className={cx('flex min-h-12 items-start gap-3 rounded-xl border px-3 py-3 transition-colors', editable ? 'cursor-pointer' : 'cursor-default',
                        on ? 'border-[#9fd7a4] bg-[#f0faf0] dark:border-[#0ca30c]/40 dark:bg-[#0ca30c]/10' : 'border-line active:bg-surface-2')}>
                        <input type="checkbox" className="mt-0.5 h-6 w-6 shrink-0 accent-[#236c48]" checked={on} disabled={!editable} onChange={(e) => onToggle(t.itemId, e.target.checked)} />
                        <span className="text-[14px] leading-snug text-ink">{t.content}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ------------------------------------------------------------
// 本人の週報
// ------------------------------------------------------------
function ReviewForm({ data }) {
  const week = data.week;
  const [checks, setChecks] = useState(data.checks);
  const [achieved, setAchieved] = useState(() => Object.fromEntries(data.focus.map((f) => [f.id, f.achieved])));
  const [goodThings, setGoodThings] = useState(data.review ? data.review.goodThings : '');
  const [challenges, setChallenges] = useState(data.review ? data.review.challenges : '');
  const [review, setReview] = useState(data.review);
  const [focus, setFocus] = useState(data.focus);
  const [nextFocus, setNextFocus] = useState(data.nextFocus);
  const [ai, setAi] = useState({ result: data.aiReview, loading: false, error: null });
  const [picker, setPicker] = useState(null); // 'this' | 'next'
  const [submitting, setSubmitting] = useState(false);
  const topRef = useRef(null);
  const current = isCurrentWeek(week);

  const values = () => ({ week, checks, focusAchieved: achieved, goodThings, challenges });
  const autosave = useAutosave(async (v) => {
    const r = await mandalaAction('saveReview', { ...v, submit: false }, { refresh: false });
    setReview(r.review);
  });
  useForgetOnClose(autosave, ['mandala:review:', 'mandala:home:']);
  // 入力が変わったら自動で保存する（最初の表示では保存しない）
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    autosave.schedule(values());
  }, [checks, achieved, goodThings, challenges]);

  useEffect(() => {
    if (window.location.hash.includes('focus=1')) {
      const el = document.getElementById('focus-this');
      if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
    }
  }, []);

  const runAi = async (reviewId, force) => {
    setAi({ result: ai.result, loading: true, error: null });
    try {
      const r = await mandalaAction('aiReview', { reviewId, force }, { refresh: false });
      setAi({ result: r.aiReview, loading: false, error: null });
    } catch (e) {
      setAi({ result: null, loading: false, error: e.message });
    }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      await autosave.flush();
      const r = await mandalaAction('saveReview', { ...values(), submit: true }, { refresh: false });
      setReview(r.review);
      showToast(review && review.status === 'submitted' ? '提出し直しました' : '提出しました。おつかれさまでした', 'success');
      if (topRef.current) topRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (data.aiConfigured && data.hasChart) await runAi(r.review.id, true);
      refreshMandala();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const addFocus = (which) => async (arg) => {
    const target = which === 'this' ? week : data.nextWeek;
    const r = await mandalaAction('addFocus', { week: target, ...arg }, { refresh: false });
    if (which === 'this') {
      setFocus(r.focus);
      setAchieved((a) => ({ ...Object.fromEntries(r.focus.map((f) => [f.id, f.achieved])), ...a }));
    } else setNextFocus(r.focus);
    showToast('フォーカスに入れました', 'success');
  };
  const removeFocus = (which) => async (focusId) => {
    try {
      const r = await mandalaAction('removeFocus', { week: which === 'this' ? week : data.nextWeek, focusId }, { refresh: false });
      if (which === 'this') setFocus(r.focus); else setNextFocus(r.focus);
    } catch (e) { showToast(e.message, 'error'); }
  };
  const adopt = async (items) => {
    try {
      const r = await mandalaAction('adoptFocus', { week: data.nextWeek, items: items.map((f) => ({ mandalaItemId: f.mandala_item_id })) }, { refresh: false });
      setNextFocus(r.focus);
      showToast(`${formatWeekShort(data.nextWeek)}のフォーカスに入れました`, 'success');
    } catch (e) { showToast(e.message, 'error'); }
  };
  const canFocusThis = current; // 過去の週のフォーカスは達成の記録だけ
  const takenFor = (list) => new Set(list.map((f) => f.mandalaItemId).filter(Boolean));
  const submitted = review && review.status === 'submitted';

  const postComment = async (body) => {
    let id = review && review.id;
    if (!id) {
      const r = await mandalaAction('saveReview', { ...values(), submit: false }, { refresh: false });
      setReview(r.review);
      id = r.review.id;
    }
    await mandalaAction('addComment', { kind: 'review', targetId: id, body });
  };

  return (
    <div ref={topRef} className="scroll-mt-20 space-y-4">
      <AiPanel ai={ai.result} loading={ai.loading} error={ai.error} canRerun={!!review && data.aiConfigured} onRerun={() => runAi(review.id, true)}
        canAdopt={current} nextWeek={data.nextWeek} nextFocus={nextFocus} onAdopt={adopt} />
      <ChecksCard trackables={data.trackables} checks={checks} editable onToggle={(id, on) => setChecks((c) => ({ ...c, [id]: on }))} />
      <FocusList id="focus-this" title={current ? '今週のフォーカス' : 'この週のフォーカス'} subtitle="できたら ◯、できなかったら ×" focus={focus} editable
        achieved={achieved} onAchieved={(id, v) => setAchieved((a) => ({ ...a, [id]: v }))}
        onRemove={canFocusThis ? removeFocus('this') : null} onAdd={canFocusThis ? () => setPicker('this') : null} />
      <Card title="ひとこと振り返り" icon="notebook-pen">
        <div className="space-y-3">
          <Field label="今週よかったこと" htmlFor="rv-good">
            <Textarea id="rv-good" rows={3} maxLength={4000} value={goodThings} onChange={(e) => setGoodThings(e.target.value)} placeholder="うまくいったこと、お客様の反応など" />
          </Field>
          <Field label="課題・つまずき" htmlFor="rv-challenge">
            <Textarea id="rv-challenge" rows={3} maxLength={4000} value={challenges} onChange={(e) => setChallenges(e.target.value)} placeholder="できなかったこと、困っていること" />
          </Field>
          <p className="text-[11px] text-muted">売上や施術数などの数字は SalonOne（ホーム・インセンティブの画面）で見られるので、ここには書かなくて大丈夫です。</p>
        </div>
      </Card>
      {current ? (
        <FocusList title={`来週のフォーカス（${formatWeekShort(data.nextWeek)}）`} subtitle="提出すると AI も 3つ提案します" focus={nextFocus} editable
          onRemove={removeFocus('next')} onAdd={() => setPicker('next')} />
      ) : null}
      {review ? (
        <Thread title="店長・オーナーとのやりとり" items={data.comments} onPost={postComment}
          onDelete={async (id) => { await mandalaAction('deleteComment', { kind: 'review', id }); }}
          placeholder="相談したいことや、コメントへの返信を書けます" emptyText="まだコメントはありません。店長・オーナーからのコメントがここに届きます。" />
      ) : null}

      {/* 保存の状態と提出（スマホでは下のタブの上に固定） */}
      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 lg:bottom-4">
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface/95 p-2 pl-3.5 shadow-pop backdrop-blur">
          <SaveStatus autosave={autosave} className="min-w-0 flex-1" />
          <Button variant="primary" size="lg" icon={submitted ? 'refresh-cw' : 'send'} loading={submitting} onClick={submit} className="shrink-0">
            {submitted ? '提出し直す' : '提出する'}
          </Button>
        </div>
      </div>

      <FocusPicker open={!!picker} onClose={() => setPicker(null)} candidates={data.candidates}
        taken={takenFor(picker === 'next' ? nextFocus : focus)} onPick={addFocus(picker)}
        weekLabel={picker === 'next' ? formatWeekShort(data.nextWeek) : '今週'} />
    </div>
  );
}

// ------------------------------------------------------------
// 店長・オーナーが見る週報（読み取りのみ・コメントできる）
// ------------------------------------------------------------
export function ReviewReadOnly({ data, reload }) {
  const [ai, setAi] = useState({ result: data.aiReview, loading: false, error: null });
  useEffect(() => { setAi({ result: data.aiReview, loading: false, error: null }); }, [data.aiReview, data.week]);
  const runAi = async () => {
    setAi({ result: ai.result, loading: true, error: null });
    try {
      const r = await mandalaAction('aiReview', { reviewId: data.review.id, force: true }, { refresh: false });
      setAi({ result: r.aiReview, loading: false, error: null });
    } catch (e) {
      setAi({ result: null, loading: false, error: e.message });
    }
  };
  const achieved = Object.fromEntries(data.focus.map((f) => [f.id, f.achieved]));
  return (
    <div className="space-y-4">
      <Card title={`直近${data.history.length}週`} icon="calendar-check">
        <WeekChips weeks={data.history} selected={data.week} hrefFor={(w) => `/mandala/member/${data.member.id}/review/${w}`} />
      </Card>
      {!data.review ? (
        <div className="card"><EmptyState icon="notebook-pen" title="この週の週報はまだありません" message={data.hasChart ? '提出されるとここに表示されます。' : 'マンダラチャートもまだありません。'} /></div>
      ) : (
        <>
          <AiPanel ai={ai.result} loading={ai.loading} error={ai.error} canRerun={data.aiConfigured} onRerun={runAi} canAdopt={false} />
          <ChecksCard trackables={data.trackables} checks={data.checks} editable={false} />
          {data.focus.length ? <FocusList title="この週のフォーカス" focus={data.focus} editable={false} achieved={achieved} onAchieved={() => {}} /> : null}
          <Card title="ひとこと振り返り" icon="notebook-pen" subtitle={data.review.submittedAt ? `${formatDateTimeJst(data.review.submittedAt)} 提出` : `${formatDateTimeJst(data.review.updatedAt)} 更新（下書き）`}>
            <dl className="space-y-3">
              {[['今週よかったこと', data.review.goodThings], ['課題・つまずき', data.review.challenges]].map(([label, text]) => (
                <div key={label}>
                  <dt className="mb-1 text-xs font-semibold text-ink-2">{label}</dt>
                  <dd className="whitespace-pre-wrap rounded-xl bg-surface-2 px-3 py-2 text-[14px] leading-relaxed text-ink">{text || <span className="text-muted">（記入なし）</span>}</dd>
                </div>
              ))}
            </dl>
          </Card>
          <Thread title="コメント" items={data.comments}
            onPost={async (body) => { await mandalaAction('addComment', { kind: 'review', targetId: data.review.id, body }); reload(); }}
            onDelete={async (id) => { await mandalaAction('deleteComment', { kind: 'review', id }); reload(); }}
            placeholder="承認のひとことや、来週へのアドバイスを送りましょう" ownerTag="本人" />
        </>
      )}
    </div>
  );
}

export default function Review({ week: weekParam }) {
  const res = useMandala('review', weekParam ? { week: weekParam } : {});
  const data = res.shown;
  if (!data && res.error) return <ErrorState error={res.error} onRetry={res.reload} />;
  if (!data) return <LoadingState />;
  const title = isCurrentWeek(data.week) ? '今週の振り返り' : '週報';
  const state = data.review ? (data.review.status === 'submitted' ? 'submitted' : 'draft') : 'none';
  return (
    <div className="pb-4">
      <PageHeader title={title} subtitle="できた行動にチェックして、ひとこと振り返ります。入力は自動で保存されます。" actions={<StateBadge state={state} />} />
      <WeekNav week={data.week} currentWeek={data.currentWeek} hrefFor={(w) => `/mandala/review/${w}`} />
      {data.future ? (
        <div className="card"><EmptyState icon="calendar-clock" title="未来の週はまだ入力できません" /></div>
      ) : !data.hasChart ? (
        <div className="card">
          <EmptyState icon="grid-3x3" title="先にマンダラチャートを作りましょう" message="チャートの「行動」の項目が、毎週チェックする内容になります。"
            action={<Button variant="primary" icon="plus" onClick={() => navigate('/mandala/edit')}>チャートを作る</Button>} />
        </div>
      ) : (
        // 週を変えた時だけ入れ直す（読み直しで入力中の内容が消えないように）
        <ReviewForm key={data.week} data={data} />
      )}
    </div>
  );
}
