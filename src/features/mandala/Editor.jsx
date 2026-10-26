import { useEffect, useMemo, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { Badge, Banner, Button, Card, Field, Input, PageHeader, Textarea, cx } from '../../ui/primitives.jsx';
import { showToast } from '../../ui/feedback.jsx';
import { yen } from '../../lib/format.js';
import { navigate } from '../../app/router.js';
import { useMandala, useMySales, mandalaAction } from './data.js';
import { TypeBadge, Toggle, LoadingState, ErrorState } from './parts.jsx';
import { ITEM_TYPES, ITEM_TYPE_LABEL, ITEM_TYPE_HINT, THEME_PLACEHOLDERS, parseAmount, formatManYen } from '../../../shared/mandala.js';

// ============================================================
// チャートの作成・編集（5ステップ）
//   ① 目標（センターゴール・現状と目標の月売上・期限）
//   ② 逆算（差分をどう埋めるか）
//   ③ 8つのテーマ
//   ④ 各テーマの 8項目（テーマの番号から直接行き来できる）
//   ⑤ 分類（行動 / 数値 / 心構え・毎週チェックするか）+ AI の提案
// 各ステップは保存してから次へ進む（スマホで少しずつ書ける）。
// テーマの番号で移動する時も、書きかけは先に保存する。
// ============================================================

const STEPS = ['目標', '逆算', 'テーマ', '項目', '分類'];
const editPath = (step, theme) => `/mandala/edit/${step}${theme ? `/${theme}` : ''}`;

function StepIndicator({ step, onJump, enabled }) {
  return (
    <ol className="mb-5 grid grid-cols-5 gap-1.5" aria-label="ステップ">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const on = n === step;
        return (
          <li key={label}>
            <button type="button" disabled={!enabled && n > 1} onClick={() => onJump(n)} aria-current={on ? 'step' : undefined}
              className="flex w-full flex-col items-center gap-1 disabled:opacity-50">
              <span className={cx('h-1.5 w-full rounded-full', n <= step ? 'bg-brand-600' : 'bg-surface-3')} />
              <span className={cx('text-[11px]', on ? 'font-bold text-ink' : 'text-muted')}><span className="num">{n}</span> {label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function ThemeJump({ chart, step, current, onJump }) {
  return (
    <nav className="-mx-4 mb-3 overflow-x-auto px-4 sm:mx-0 sm:px-0" aria-label="テーマを選ぶ">
      <ul className="flex gap-1.5 whitespace-nowrap pb-1">
        {chart.themes.map((t) => {
          const filled = t.items.filter((i) => i.content.trim()).length;
          const on = t.position === current;
          return (
            <li key={t.position}>
              <button type="button" onClick={() => onJump(t.position)} aria-current={on ? 'page' : undefined} title={t.title || `テーマ${t.position}`}
                className={cx('flex h-11 min-w-[56px] flex-col items-center justify-center rounded-xl px-2 text-xs font-bold transition-colors',
                  on ? 'bg-brand-600 text-white' : 'border border-line bg-surface text-ink-2 hover:bg-surface-2')}>
                <span className="num">{t.position}</span>
                <span className={cx('text-[10px] font-semibold num', on ? 'text-white/80' : 'text-muted')}>{step === 4 ? `${filled}/8` : `${t.items.filter((i) => i.content.trim() && i.itemType === 'action' && i.weeklyTrackable).length}✓`}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Footer({ onBack, backLabel = '戻る', onNext, nextLabel, busy, disabled }) {
  return (
    <div className="mt-5 flex gap-2">
      {onBack ? <Button size="lg" className="flex-1" onClick={onBack} disabled={busy}>{backLabel}</Button> : null}
      <Button size="lg" variant="primary" className="flex-[2]" onClick={onNext} loading={busy} disabled={disabled}>{nextLabel}</Button>
    </div>
  );
}

// ------------------------------------------------------------
// ① 目標
// ------------------------------------------------------------
function StepGoal({ chart, save }) {
  const sales = useMySales();
  const [v, setV] = useState(() => ({
    centerGoal: chart ? chart.centerGoal : '',
    title: chart ? chart.title : '',
    baselineAmount: chart && chart.baselineAmount != null ? String(chart.baselineAmount) : '',
    targetAmount: chart && chart.targetAmount != null ? String(chart.targetAmount) : '',
    deadlineMonth: chart && chart.deadlineMonth ? chart.deadlineMonth.slice(0, 7) : '',
  }));
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const baseline = parseAmount(v.baselineAmount);
  const target = parseAmount(v.targetAmount);
  const invalidAmount = (v.baselineAmount && baseline === null) || (v.targetAmount && target === null);
  return (
    <Card>
      <div className="space-y-4">
        <Field label="センターゴール" htmlFor="m-goal" required hint="マンダラの真ん中に入る、いちばん大きな目標です。">
          <Input id="m-goal" value={v.centerGoal} onChange={set('centerGoal')} maxLength={200} placeholder="例: 施術消化売上 月100万！" />
        </Field>
        <Field label="チャート名（任意）" htmlFor="m-title">
          <Input id="m-title" value={v.title} onChange={set('title')} maxLength={100} placeholder="例: 100万への道" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="現状の月売上（円）" htmlFor="m-base" hint={baseline ? `= ${formatManYen(baseline)}` : '「62万」のようにも書けます'}>
            <Input id="m-base" inputMode="numeric" value={v.baselineAmount} onChange={set('baselineAmount')} placeholder="620000" />
            {sales.linked && sales.avg3 ? (
              <button type="button" onClick={() => setV({ ...v, baselineAmount: String(sales.avg3) })}
                className="mt-1.5 inline-flex items-center gap-1 rounded-lg bg-brand-50 px-2 py-1 text-[11px] font-semibold text-brand-700 hover:bg-brand-100 dark:bg-brand-500/15 dark:text-brand-200">
                <Icon name="plug" size={12} />SalonOne の直近{sales.avgMonths}ヶ月の平均 {yen(sales.avg3)} を入れる
              </button>
            ) : null}
          </Field>
          <Field label="目標の月売上（円）" htmlFor="m-target" hint={target ? `= ${formatManYen(target)}` : null}>
            <Input id="m-target" inputMode="numeric" value={v.targetAmount} onChange={set('targetAmount')} placeholder="1000000" />
          </Field>
        </div>
        <Field label="到達期限（月）" htmlFor="m-deadline">
          <Input id="m-deadline" type="month" value={v.deadlineMonth} onChange={set('deadlineMonth')} />
        </Field>
        {invalidAmount ? <p className="text-xs font-semibold text-[#b42323] dark:text-[#f08a8a]">金額は数字で入れてください（例: 620000 / 62万）</p> : null}
        <p className="rounded-xl bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-muted">
          ここで書くのは「目標そのもの」です。毎日の売上や施術数は SalonOne から自動で集計されるので、マンダラでは入力しません。
        </p>
      </div>
      <Footer nextLabel="保存して次へ" disabled={!v.centerGoal.trim() || invalidAmount}
        onNext={() => save({ chart: { ...v, deadlineMonth: v.deadlineMonth || null } }, editPath(2))} busy={save.busy} />
    </Card>
  );
}

// ------------------------------------------------------------
// ② 逆算
// ------------------------------------------------------------
function StepBreakdown({ chart, save }) {
  const [text, setText] = useState(chart.targetBreakdown || '');
  const gap = chart.baselineAmount && chart.targetAmount ? chart.targetAmount - chart.baselineAmount : null;
  return (
    <Card>
      {gap ? (
        <div className="mb-4 rounded-xl bg-brand-50 px-3.5 py-3 dark:bg-brand-500/15">
          <p className="text-[11px] font-semibold text-brand-700 dark:text-brand-200">埋める差分</p>
          <p className="text-[20px] font-bold text-ink num">{gap > 0 ? '+' : ''}{formatManYen(gap)} / 月</p>
          <p className="text-[11px] text-muted num">{formatManYen(chart.baselineAmount)} → {formatManYen(chart.targetAmount)}</p>
        </div>
      ) : null}
      <Field label="この差分をどう埋めるか" htmlFor="m-breakdown" hint="「何を・どれだけ増やすか」を書いておくと、テーマと行動に落とし込みやすくなります。目標の画面の「達成までの道すじ」も参考になります。">
        <Textarea id="m-breakdown" rows={6} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000}
          placeholder={'例:\nサブスク +4人 = +20万円\n新規の契約率 50% → 70% で +10万円\n来店頻度 月1.5回 → 2回 で +8万円'} />
      </Field>
      <Footer onBack={() => save({ chart: { targetBreakdown: text } }, editPath(1))} onNext={() => save({ chart: { targetBreakdown: text } }, editPath(3))} nextLabel="保存して次へ" busy={save.busy} />
    </Card>
  );
}

// ------------------------------------------------------------
// ③ 8つのテーマ
// ------------------------------------------------------------
function StepThemes({ chart, save }) {
  const [titles, setTitles] = useState(() => Object.fromEntries(chart.themes.map((t) => [t.position, t.title])));
  const payload = () => ({ themes: chart.themes.map((t) => ({ position: t.position, title: titles[t.position] || '' })) });
  return (
    <Card>
      <p className="mb-4 text-[13px] text-ink-2">センターゴールを達成するための 8つの領域を入れます。</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {chart.themes.map((t) => (
          <Field key={t.position} label={`テーマ ${t.position}`} htmlFor={`m-theme-${t.position}`}>
            <Input id={`m-theme-${t.position}`} value={titles[t.position] || ''} maxLength={60} placeholder={THEME_PLACEHOLDERS[t.position - 1]}
              onChange={(e) => setTitles({ ...titles, [t.position]: e.target.value })} />
          </Field>
        ))}
      </div>
      <Footer onBack={() => save(payload(), editPath(2))} onNext={() => save(payload(), editPath(4, 1))} nextLabel="保存して次へ" busy={save.busy} />
    </Card>
  );
}

// ------------------------------------------------------------
// ④ 各テーマの 8項目
// ------------------------------------------------------------
function StepItems({ chart, theme, save }) {
  const [contents, setContents] = useState(() => Object.fromEntries(theme.items.map((i) => [i.id, i.content])));
  const payload = () => ({ items: theme.items.map((i) => ({ id: i.id, content: contents[i.id] || '' })) });
  const jump = (pos) => save(payload(), editPath(4, pos));
  return (
    <>
      <ThemeJump chart={chart} step={4} current={theme.position} onJump={jump} />
      <Card>
        <p className="text-[11px] font-semibold text-muted num">テーマ {theme.position}/8</p>
        <p className="mb-4 text-[17px] font-bold text-ink">{theme.title || '（テーマ名が未入力）'}</p>
        <div className="space-y-2">
          {theme.items.map((i) => (
            <div key={i.id} className="flex items-center gap-2">
              <span className="w-5 shrink-0 text-center text-xs text-muted num">{i.position}</span>
              <Input value={contents[i.id] || ''} maxLength={200} placeholder="やることを書く" aria-label={`項目 ${i.position}`}
                onChange={(e) => setContents({ ...contents, [i.id]: e.target.value })} />
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-muted">「やったかどうか」で答えられる書き方にすると、週報でチェックしやすくなります（⑤で AI が言い換えを提案します）。</p>
        <Footer onBack={() => save(payload(), theme.position > 1 ? editPath(4, theme.position - 1) : editPath(3))}
          onNext={() => save(payload(), theme.position < 8 ? editPath(4, theme.position + 1) : editPath(5, 1))}
          nextLabel={theme.position < 8 ? '保存して次のテーマへ' : '保存して分類へ'} busy={save.busy} />
      </Card>
    </>
  );
}

// ------------------------------------------------------------
// ⑤ 分類 + AI の提案
// ------------------------------------------------------------
function AssistPanel({ theme, aiConfigured, onApplied }) {
  const [state, setState] = useState({ loading: false, error: null, suggestions: null });
  const [applied, setApplied] = useState([]);
  const [useRewrite, setUseRewrite] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { setState({ loading: false, error: null, suggestions: null }); setApplied([]); setUseRewrite({}); }, [theme.position]);
  if (!aiConfigured) return null;
  const fetchSuggestions = async () => {
    setState({ loading: true, error: null, suggestions: null });
    try {
      const r = await mandalaAction('aiAssist', { themePosition: theme.position }, { refresh: false });
      setState({ loading: false, error: null, suggestions: r.suggestions });
      setApplied([]);
      setUseRewrite({});
    } catch (e) {
      setState({ loading: false, error: e.message, suggestions: null });
    }
  };
  const apply = async (list) => {
    setBusy(true);
    try {
      await onApplied(list.map((s) => ({ id: s.itemId, itemType: s.suggestedType, weeklyTrackable: s.weeklyTrackable, ...(useRewrite[s.itemId] && s.rewrite ? { content: s.rewrite } : {}) })));
      setApplied((a) => [...a, ...list.map((s) => s.itemId)]);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const pending = (state.suggestions || []).filter((s) => !applied.includes(s.itemId));
  return (
    <div className="mb-3 rounded-2xl border border-dashed border-line-strong bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-bold text-ink"><Icon name="sparkles" size={15} className="text-gold-600 dark:text-gold-300" />AI に分類と言い換えを提案してもらう</p>
          <p className="mt-0.5 text-xs text-muted">測れる形への言い換えも出ます。数は「◯」で出るので、自分で決めて書き直してください。</p>
        </div>
        <Button size="sm" variant="subtle" onClick={fetchSuggestions} loading={state.loading}>{state.suggestions ? '出し直す' : '提案を見る'}</Button>
      </div>
      {state.loading ? <p className="mt-3 text-xs text-muted">考えています…（10秒ほど）</p> : null}
      {state.error ? <p className="mt-3 text-xs font-semibold text-[#b42323] dark:text-[#f08a8a]">{state.error}</p> : null}
      {state.suggestions && state.suggestions.length === 0 ? <p className="mt-3 text-xs text-muted">提案はありませんでした。</p> : null}
      {pending.length > 1 ? <Button size="sm" className="mt-3" icon="check-check" loading={busy} onClick={() => apply(pending)}>残り{pending.length}件をまとめて採用</Button> : null}
      {state.suggestions && state.suggestions.length ? (
        <ul className="mt-3 space-y-2">
          {state.suggestions.map((s) => {
            const done = applied.includes(s.itemId);
            const changed = s.suggestedType !== s.currentType || s.weeklyTrackable !== s.currentTrackable;
            return (
              <li key={s.itemId} className={cx('rounded-xl border border-line px-3 py-2.5', done ? 'opacity-60' : '')}>
                <p className="text-[13px] leading-snug text-ink">{s.content}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                  <TypeBadge type={s.suggestedType} />
                  {s.suggestedType === 'action' ? <span>毎週チェック: {s.weeklyTrackable ? 'する' : 'しない'}</span> : null}
                  {!changed && !s.rewrite ? <span>（今のままでOK）</span> : changed ? <span>（今: {ITEM_TYPE_LABEL[s.currentType]}{s.currentType === 'action' ? `・${s.currentTrackable ? 'チェックする' : 'しない'}` : ''}）</span> : null}
                </div>
                {s.rewrite ? (
                  <label className="mt-2 flex items-start gap-2 rounded-lg bg-surface-2 px-2.5 py-2 text-xs">
                    <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[#236c48]" disabled={done} checked={!!useRewrite[s.itemId]}
                      onChange={(e) => setUseRewrite({ ...useRewrite, [s.itemId]: e.target.checked })} />
                    <span className="leading-snug text-ink-2"><span className="font-semibold text-ink">言い換えも使う: </span>{s.rewrite}</span>
                  </label>
                ) : null}
                <div className="mt-2">
                  {done ? <span className="text-xs font-semibold text-[var(--text-good)]">反映しました</span>
                    : <Button size="sm" onClick={() => apply([s])} disabled={busy}>採用</Button>}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function StepClassify({ chart, theme, save, aiConfigured }) {
  const filled = theme.items.filter((i) => i.content.trim());
  const initial = () => Object.fromEntries(theme.items.map((i) => [i.id, { itemType: i.itemType, weeklyTrackable: i.weeklyTrackable }]));
  const [v, setV] = useState(initial);
  // AI の提案を反映した時は、保存済みの内容から入れ直す
  useEffect(() => { setV(initial()); }, [theme]);
  const payload = () => ({ items: filled.map((i) => ({ id: i.id, ...v[i.id] })) });
  const setType = (id, itemType) => setV({ ...v, [id]: { itemType, weeklyTrackable: itemType === 'action' ? v[id].weeklyTrackable : false } });
  const allActionsOn = () => setV(Object.fromEntries(Object.entries(v).map(([id, x]) => [id, x.itemType === 'action' ? { ...x, weeklyTrackable: true } : x])));
  const finish = theme.position >= 8;
  return (
    <>
      <ThemeJump chart={chart} step={5} current={theme.position} onJump={(pos) => save(payload(), editPath(5, pos))} />
      <AssistPanel theme={theme} aiConfigured={aiConfigured} onApplied={(items) => save.silently({ items })} />
      <Card>
        <p className="text-[11px] font-semibold text-muted num">テーマ {theme.position}/8</p>
        <p className="text-[17px] font-bold text-ink">{theme.title || '（テーマ名が未入力）'}</p>
        <p className="mb-4 mt-1 text-xs text-muted">「行動」だけが週報のチェック対象になります。数値は SalonOne で見るもの、心構えは追跡しません。</p>
        {filled.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-strong px-3 py-6 text-center text-[13px] text-muted">
            このテーマにはまだ項目がありません。<button type="button" className="font-semibold text-brand-700 underline dark:text-brand-300" onClick={() => navigate(editPath(4, theme.position))}>④で書く</button>
          </p>
        ) : (
          <>
            <div className="mb-2 flex justify-end">
              <button type="button" onClick={allActionsOn} className="text-xs font-semibold text-brand-700 hover:underline dark:text-brand-300">行動をすべて毎週チェックにする</button>
            </div>
            <ul className="space-y-2.5">
              {filled.map((i) => {
                const x = v[i.id];
                return (
                  <li key={i.id} className="rounded-xl border border-line p-3">
                    <p className="mb-2 text-[14px] leading-snug text-ink">{i.content}</p>
                    <div role="radiogroup" aria-label="分類" className="grid grid-cols-3 gap-1 rounded-xl bg-surface-3 p-1">
                      {ITEM_TYPES.map((t) => (
                        <button key={t} type="button" role="radio" aria-checked={x.itemType === t} title={ITEM_TYPE_HINT[t]} onClick={() => setType(i.id, t)}
                          className={cx('h-10 rounded-lg text-[13px] font-semibold transition-colors sm:h-8', x.itemType === t ? 'bg-surface text-ink shadow-card' : 'text-ink-2')}>
                          {ITEM_TYPE_LABEL[t]}
                        </button>
                      ))}
                    </div>
                    <label className={cx('mt-2 flex min-h-11 items-center justify-between gap-3 text-[13px]', x.itemType === 'action' ? 'text-ink' : 'text-muted')}>
                      毎週チェックする{x.itemType !== 'action' ? '（行動のみ）' : ''}
                      <Toggle checked={x.itemType === 'action' && x.weeklyTrackable} disabled={x.itemType !== 'action'} label="毎週チェックする"
                        onChange={(on) => setV({ ...v, [i.id]: { ...x, weeklyTrackable: on } })} />
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <Footer onBack={() => save(payload(), theme.position > 1 ? editPath(5, theme.position - 1) : editPath(4, 8))}
          onNext={() => save(payload(), finish ? '/mandala/chart' : editPath(5, theme.position + 1), finish ? 'チャートを保存しました' : null)}
          nextLabel={finish ? '保存して完了' : '保存して次のテーマへ'} busy={save.busy} />
      </Card>
    </>
  );
}

export default function Editor({ step: rawStep, theme: rawTheme, me }) {
  const res = useMandala('chart');
  const [busy, setBusy] = useState(false);
  const data = res.shown;
  const chart = data && data.chart;
  const step = Math.min(Math.max(Number(rawStep) || 1, 1), 5);
  const themePos = Math.min(Math.max(Number(rawTheme) || 1, 1), 8);
  const theme = useMemo(() => (chart ? chart.themes.find((t) => t.position === themePos) : null), [chart, themePos]);

  // チャートが無いうちは ① から
  useEffect(() => {
    if (data && !chart && step > 1) navigate(editPath(1));
  }, [data, chart, step]);

  if (!data && res.error) return <ErrorState error={res.error} onRetry={res.reload} />;
  if (!data) return <LoadingState />;
  if (!me.viewer.canHaveChart) return <Banner tone="info">チャートはスタッフ URL で開いて作ります（管理者モードでは自分のチャートは持てません）。</Banner>;

  const save = async (body, nextPath, doneMessage) => {
    setBusy(true);
    try {
      await mandalaAction('saveChart', body);
      // 次のステップを新しい内容で開く（作ったばかりのチャートを ① に戻されないように）
      await res.reload();
      if (doneMessage) showToast(doneMessage, 'success');
      if (nextPath) navigate(nextPath);
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  save.busy = busy;
  save.silently = async (body) => { await mandalaAction('saveChart', body); await res.reload(); };

  return (
    <div>
      <PageHeader title={chart ? 'チャートを編集' : 'チャートを作る'} subtitle="スマホで少しずつ進められます。各ステップは保存されます。"
        actions={chart ? <Button size="sm" variant="ghost" icon="x" onClick={() => navigate('/mandala/chart')}>閉じる</Button> : null} />
      <StepIndicator step={step} enabled={!!chart} onJump={(n) => navigate(editPath(n, n >= 4 ? themePos : null))} />
      {step === 1 ? <StepGoal key={chart ? chart.id : 'new'} chart={chart} save={save} /> : null}
      {step === 2 && chart ? <StepBreakdown chart={chart} save={save} /> : null}
      {step === 3 && chart ? <StepThemes chart={chart} save={save} /> : null}
      {step === 4 && chart && theme ? <StepItems key={theme.id} chart={chart} theme={theme} save={save} /> : null}
      {step === 5 && chart && theme ? <StepClassify key={theme.id} chart={chart} theme={theme} save={save} aiConfigured={me.aiConfigured} /> : null}
      {step >= 4 && chart ? (
        <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-muted"><Badge tone="neutral">{step === 4 ? '数字' : '✓'}</Badge>{step === 4 ? '番号の下は書いた項目の数' : '番号の下は毎週チェックする行動の数'}</p>
      ) : null}
    </div>
  );
}
