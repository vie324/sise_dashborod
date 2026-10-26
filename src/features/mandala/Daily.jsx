import { useEffect, useRef, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { Button, EmptyState, PageHeader, Textarea, cx } from '../../ui/primitives.jsx';
import { showToast } from '../../ui/feedback.jsx';
import { navigate } from '../../app/router.js';
import { useMandala, useAutosave, useForgetOnClose, mandalaAction, refreshMandala } from './data.js';
import { StateBadge, DayStrip, Thread, SaveStatus, LoadingState, ErrorState } from './parts.jsx';
import { DAILY_SECTIONS, formatDay } from '../../../shared/mandala.js';

// ============================================================
// 日報（若手メンバー向け。紙の「業務チェックリスト」と同じ構成）
//   01 出勤時 / 02 勤務中 / 03 退勤前 のチェック → 04 今日の振り返り → 05 備考・メモ
// 対象は店長・オーナーが指定したメンバーだけ。今日を含む 7日間は書き直せる。
// 入力は自動で保存する。「出納帳」などの項目からは、その画面をすぐ開ける。
// ============================================================

function Section({ step, title, hint, children }) {
  return (
    <section className="card card-pad">
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-sm font-bold text-gold-600 num dark:text-gold-300">0{step}</span>
        <h2 className="text-[15px] font-bold text-ink">{title}</h2>
        {hint ? <span className="ml-auto text-[11px] text-muted num">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

function CheckRow({ item, checked, onToggle, readOnly }) {
  return (
    <li className="flex items-stretch gap-1.5">
      <button type="button" role="checkbox" aria-checked={checked} disabled={readOnly} onClick={() => onToggle(!checked)}
        className={cx('flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] transition-colors disabled:cursor-default',
          checked ? 'bg-brand-50 dark:bg-brand-500/15' : 'bg-surface-2')}>
        <span className={cx('flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors',
          checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-line-strong bg-surface')}>
          {checked ? <Icon name="check" size={15} strokeWidth={2.6} /> : null}
        </span>
        <span className="leading-snug text-ink">{item.label}</span>
      </button>
      {item.link && !readOnly ? (
        <button type="button" onClick={() => navigate(item.link.path)} title={item.link.label} aria-label={item.link.label}
          className="flex w-12 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-line text-[10px] font-semibold text-brand-700 hover:bg-surface-2 dark:text-brand-300">
          <Icon name="external-link" size={15} />開く
        </button>
      ) : null}
    </li>
  );
}

function TextBlock({ id, label, value, onChange, placeholder, readOnly }) {
  return (
    <div>
      {label ? <label htmlFor={id} className="mb-1.5 block text-[13px] font-semibold text-ink-2">{label}</label> : null}
      {readOnly ? (
        <p className="min-h-10 whitespace-pre-wrap rounded-xl bg-surface-2 px-3 py-2 text-[14px] leading-relaxed text-ink">{value || <span className="text-muted">（未記入）</span>}</p>
      ) : (
        <Textarea id={id} rows={3} maxLength={4000} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label || '備考・メモ'} />
      )}
    </div>
  );
}

export function DailyForm({ data, readOnly }) {
  const [checks, setChecks] = useState(() => Object.fromEntries(data.items.map((i) => [i.id, !!data.checks[i.id]])));
  const r = data.report || {};
  const [text, setText] = useState({ learnings: r.learnings || '', challenges: r.challenges || '', tomorrow: r.tomorrow || '', memo: r.memo || '' });
  const [report, setReport] = useState(data.report);
  const [busy, setBusy] = useState(false);
  const values = () => ({ date: data.date, checks, ...text });
  const autosave = useAutosave(async (v) => {
    const res = await mandalaAction('saveDaily', { ...v, submit: false }, { refresh: false });
    setReport(res.report);
  });
  useForgetOnClose(autosave, readOnly ? [] : ['mandala:daily:', 'mandala:home:']);
  const first = useRef(true);
  useEffect(() => {
    if (first.current || readOnly) { first.current = false; return; }
    autosave.schedule(values());
  }, [checks, text]);

  const submitted = report && report.status === 'submitted';
  const done = data.items.filter((i) => checks[i.id]).length;
  const submit = async () => {
    setBusy(true);
    try {
      await autosave.flush();
      const res = await mandalaAction('saveDaily', { ...values(), submit: true }, { refresh: false });
      setReport(res.report);
      showToast(submitted ? '日報を更新しました' : '日報を提出しました。おつかれさまでした！', 'success');
      refreshMandala();
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const setField = (k) => (v) => setText((t) => ({ ...t, [k]: v }));

  return (
    <div className="space-y-3">
      {data.items.length === 0 ? (
        <p className="card card-pad text-[13px] text-muted">チェック項目はまだ設定されていません（店長・オーナーが「マンダラ → 設定」で決めます）。</p>
      ) : <p className="px-1 text-xs text-muted num">業務チェック {done}/{data.items.length}</p>}
      {DAILY_SECTIONS.map((sec, i) => {
        const items = data.items.filter((it) => it.section === sec.key);
        if (!items.length) return null;
        return (
          <Section key={sec.key} step={i + 1} title={sec.label} hint={`${items.filter((it) => checks[it.id]).length}/${items.length}`}>
            <ul className="space-y-1.5">
              {items.map((it) => <CheckRow key={it.id} item={it} checked={!!checks[it.id]} readOnly={readOnly} onToggle={(on) => setChecks((c) => ({ ...c, [it.id]: on }))} />)}
            </ul>
          </Section>
        );
      })}
      <Section step={4} title="今日の振り返り" hint="任意">
        <div className="space-y-4">
          <TextBlock id="d-learn" label="今日の学び・よかったこと" value={text.learnings} onChange={setField('learnings')} readOnly={readOnly} placeholder="お客様に喜ばれたこと、先輩から教わったこと など" />
          <TextBlock id="d-chal" label="課題・つまずき" value={text.challenges} onChange={setField('challenges')} readOnly={readOnly} placeholder="うまくいかなかったこと、迷ったこと など" />
          <TextBlock id="d-tmr" label="明日やること" value={text.tomorrow} onChange={setField('tomorrow')} readOnly={readOnly} placeholder="明日ひとつだけ意識すること" />
        </div>
      </Section>
      <Section step={5} title="備考・メモ">
        <TextBlock id="d-memo" value={text.memo} onChange={setField('memo')} readOnly={readOnly} placeholder="引き継ぎ事項、気づいたこと、報告 など" />
      </Section>
      {!readOnly ? (
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20 lg:bottom-4">
          <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface/95 p-2 pl-3.5 shadow-pop backdrop-blur">
            <SaveStatus autosave={autosave} className="min-w-0 flex-1" />
            <Button variant="primary" size="lg" icon={submitted ? 'check' : 'send'} loading={busy} onClick={submit} className="shrink-0">{submitted ? '提出済み・更新' : '提出する'}</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DailyComments({ data, title, placeholder }) {
  if (!data.report) return null;
  return (
    <Thread className="mt-4" title={title} items={data.comments}
      onPost={async (body) => { await mandalaAction('addComment', { kind: 'daily', targetId: data.report.id, body }); }}
      onDelete={async (id) => { await mandalaAction('deleteComment', { kind: 'daily', id }); }}
      placeholder={placeholder} emptyText="まだコメントはありません。" />
  );
}

export default function Daily({ date }) {
  const res = useMandala('daily', date ? { date } : {});
  const data = res.shown;
  if (!data && res.error) return <ErrorState error={res.error} onRetry={res.reload} />;
  if (!data) return <LoadingState />;
  if (!data.dailyEnabled) {
    return (
      <div>
        <PageHeader title="日報" />
        <div className="card"><EmptyState icon="sun-medium" title="日報の対象ではありません" message="日報は、店長・オーナーが指定したメンバーが毎日書きます。週の振り返りは「週報」から書けます。" /></div>
      </div>
    );
  }
  const state = data.report ? (data.report.status === 'submitted' ? 'submitted' : 'draft') : 'none';
  return (
    <div className="pb-4">
      <PageHeader title="日報" subtitle={`${formatDay(data.date)}${data.date === data.today ? '・今日' : ''}`} actions={<StateBadge state={state} />} />
      <DayStrip days={data.days} selected={data.date} statuses={data.statuses} hrefFor={(d) => `/mandala/daily/${d}`} />
      {!data.editable ? <p className="mb-3 rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">7日より前の日報は見るだけです。</p> : null}
      <DailyForm key={data.date} data={data} readOnly={!data.editable} />
      <DailyComments data={data} title="店長・オーナーからのコメント" placeholder="コメントへの返信や、相談したいことを書けます" />
    </div>
  );
}
