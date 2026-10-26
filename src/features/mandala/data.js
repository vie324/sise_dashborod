import { useCallback, useEffect, useRef, useState } from 'react';
import { useResource, invalidate, forget, useSummary, useTrend } from '../../lib/hooks.js';
import { mandalaGet, mandalaPost } from '../../lib/api.js';
import { currentAccess } from '../../lib/access.js';
import { useApp } from '../../app/state.jsx';
import { monthOf, addMonths } from '../../../shared/dates.js';

// ============================================================
// マンダラの画面のデータ取得・保存
// ============================================================

/** GET /api/mandala?action=... をキャッシュ付きで読む（params が変わると読み直す） */
export function useMandala(action, params = {}, { enabled = true, maxAge = 30 * 1000 } = {}) {
  const key = enabled ? `mandala:${action}:${JSON.stringify(params)}` : null;
  return useResource(key, () => mandalaGet(action, params), { maxAge });
}

export const useMe = () => useMandala('me', {}, { maxAge: 60 * 1000 });

/** POST して、表示中のマンダラの画面を読み直す（refresh:false なら読み直さない） */
export async function mandalaAction(action, body, { refresh = true } = {}) {
  const r = await mandalaPost(action, body);
  if (refresh) invalidate('mandala:');
  return r;
}

export const refreshMandala = () => invalidate('mandala:');

/**
 * 自動保存の画面を閉じる時に呼ぶ。待っている保存を済ませてから、その画面とホームのキャッシュを捨てる
 * （自動保存は読み直しをしないので、すぐ開き直しても保存前の内容を出さないように）。
 */
export function useForgetOnClose(autosave, prefixes) {
  const ref = useRef({ autosave, prefixes });
  ref.current = { autosave, prefixes };
  useEffect(() => () => {
    const { autosave: a, prefixes: p } = ref.current;
    a.flush().finally(() => p.forEach((x) => forget(x)));
  }, []);
}

/**
 * 入力の自動保存（施術の合間に書くので、画面を離れても消えないように）。
 *   schedule(values) … 最後の変更から delay ミリ秒後に save(values) を呼ぶ
 *   flush()          … 待っている保存をすぐ行う（提出の前・画面を離れる時）
 * 保存中・未保存の間はブラウザを閉じる前に確認を出す。
 */
export function useAutosave(save, { delay = 1200 } = {}) {
  const [state, setState] = useState({ status: 'idle', savedAt: null, error: null });
  const pending = useRef(null);
  const timer = useRef(null);
  const chain = useRef(Promise.resolve());
  const saveRef = useRef(save);
  saveRef.current = save;

  const run = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = null;
    const values = pending.current;
    if (!values) return chain.current;
    pending.current = null;
    setState((s) => ({ ...s, status: 'saving', error: null }));
    chain.current = chain.current.then(() => saveRef.current(values)).then(
      () => setState({ status: pending.current ? 'dirty' : 'saved', savedAt: new Date(), error: null }),
      (e) => {
        // 失敗した分は次の変更か「再試行」で保存し直す
        if (!pending.current) pending.current = values;
        setState((s) => ({ ...s, status: 'error', error: e }));
      },
    );
    return chain.current;
  }, []);

  const schedule = useCallback((values) => {
    pending.current = values;
    setState((s) => ({ ...s, status: 'dirty' }));
    clearTimeout(timer.current);
    timer.current = setTimeout(run, delay);
  }, [run, delay]);

  const flush = useCallback(() => run(), [run]);

  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (!pending.current && state.status !== 'saving') return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [state.status]);

  // 画面を離れる時に、待っている保存を済ませる
  useEffect(() => () => { if (pending.current) run(); }, [run]);

  return { ...state, schedule, flush, hasPending: () => !!pending.current };
}

/**
 * SalonOne の自分の施術消化売上（スタッフ URL で開いている時だけ）。
 * チャートの目標金額と並べて見せるための読み取りだけで、マンダラには保存しない。
 */
export function useMySales() {
  const { today, storeId } = useApp();
  const thisMonth = monthOf(today);
  const enabled = !!currentAccess;
  const summary = useSummary(enabled ? thisMonth : null, storeId);
  const trend = useTrend(enabled ? thisMonth : null, storeId, 6);
  const me = summary.shown && summary.shown.me;
  if (!me) return { linked: false, loading: enabled && summary.loading };
  const row = trend.shown && trend.shown.staff ? trend.shown.staff.find((r) => r.key === me.key) : null;
  // 締まった直近 3ヶ月の平均（チャートの「現状の月売上」の目安）
  const closed = [1, 2, 3].map((n) => addMonths(thisMonth, -n)).map((m) => (row && row.values ? row.values[m] : null)).filter((v) => v > 0);
  return {
    linked: true,
    month: thisMonth,
    thisMonth: me.metrics.consumedSales || 0,
    progress: summary.shown.progress,
    avg3: closed.length ? Math.round(closed.reduce((a, b) => a + b, 0) / closed.length / 1000) * 1000 : null,
    avgMonths: closed.length,
    demo: summary.shown.mode === 'demo',
  };
}
