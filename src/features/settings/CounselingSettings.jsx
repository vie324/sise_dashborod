import { useEffect, useState } from 'react';
import { Badge, Banner, Button, Card, Field, Input, Select, Skeleton, cx } from '../../ui/primitives.jsx';
import Icon from '../../ui/Icon.jsx';
import { showToast } from '../../ui/feedback.jsx';
import { dbGet, dbPost } from '../../lib/api.js';
import { invalidate, useResource } from '../../lib/hooks.js';

// ============================================================
// 設定 > カウンセリングフォーム（Google フォームの回答を読む GAS との接続）
// ------------------------------------------------------------
// Google フォームでカウンセリングシートを取っている店舗だけが使う（SalonOne の問診票の店舗は設定不要）。
// GAS の URL と合言葉はサーバーにだけ保存し、画面には伏せた形でしか返さない。
// ============================================================

// 回答の日時は日本時間で出す（端末の時刻設定に関係なく）
const jstDateTime = (iso) => new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

async function load() {
  const r = await dbGet('counseling', { action: 'settings' });
  if (!r || r.error) throw new Error((r && r.error) || '通信エラー');
  return r;
}

function SetupSteps() {
  const steps = [
    <>カウンセリングの Google フォームの回答が入っているスプレッドシートを開き、<strong className="text-ink">拡張機能 → Apps Script</strong> に、リポジトリの <code className="rounded bg-surface-3 px-1">gas/counseling.gs</code> を貼り付けて保存します。</>,
    <>Apps Script の <strong className="text-ink">プロジェクトの設定 → スクリプト プロパティ</strong> に <code className="rounded bg-surface-3 px-1">DASHBOARD_TOKEN</code> を追加し、推測されにくい長い文字列（合言葉）を入れます。</>,
    <><strong className="text-ink">デプロイ → 新しいデプロイ</strong>（種類: ウェブアプリ / 実行するユーザー: 自分 / アクセスできるユーザー: 全員）。表示された URL（…/exec）をコピーします。</>,
    <>下の欄に URL と合言葉を貼り付けて保存し、<strong className="text-ink">接続テスト</strong>で各店舗の回答が読めるか確認します。以前の URL は <strong className="text-ink">デプロイを管理 → アーカイブ</strong> で止めておきます。</>,
  ];
  return (
    <ol className="space-y-2.5 text-[13px] leading-relaxed text-ink-2">
      {steps.map((t, i) => (
        <li key={i} className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">{i + 1}</span>
          <span>{t}</span>
        </li>
      ))}
    </ol>
  );
}

function ConnectionCard({ settings, onSaved }) {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState(null);
  const [showSteps, setShowSteps] = useState(!settings.configured);

  const save = async (body, message) => {
    setSaving(true);
    try {
      const r = await dbPost('counseling', { action: 'saveSettings', ...body });
      if (!r || r.error) throw new Error((r && r.error) || '保存できませんでした');
      setUrl('');
      setToken('');
      setTest(null);
      invalidate('counseling:');
      await onSaved();
      showToast(message, 'success');
    } catch (e) {
      showToast(e.message, 'error', 5000);
    } finally {
      setSaving(false);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    const body = {};
    if (url.trim()) body.gasUrl = url.trim();
    if (token.trim()) body.token = token.trim();
    if (!body.gasUrl && !body.token) { showToast('URL か合言葉を入力してください', 'info'); return; }
    save(body, '保存しました。接続テストで確認してください');
  };

  const runTest = async () => {
    setTesting(true);
    try {
      const r = await dbGet('counseling', { action: 'test' });
      if (!r || (r.error && !r.configured)) throw new Error((r && r.error) || '通信エラー');
      setTest(r);
    } catch (e) {
      showToast(e.message, 'error', 5000);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card title="Google フォーム（GAS）との接続" icon="plug"
      actions={settings.configured ? <Badge tone="good" icon="circle-check">設定済み</Badge> : <Badge tone="neutral">未設定</Badge>}>
      <div className="space-y-4">
        <p className="text-[13px] leading-relaxed text-ink-2">
          お客様が来店時に答えるカウンセリングの Google フォームの回答を、施術ツールの「カウンセリング」に表示します。
          読み取りだけで、回答を書き換えることはありません。
        </p>

        {settings.configured ? (
          <dl className="grid gap-x-4 gap-y-2 rounded-xl bg-surface-2 p-3 text-[13px] sm:grid-cols-[auto_minmax(0,1fr)]">
            <dt className="text-xs font-medium text-muted">URL</dt>
            <dd className="min-w-0 break-all font-mono text-xs text-ink">
              {settings.gasUrlMasked}
              <span className="ml-2 font-sans text-[11px] text-muted">（{settings.source === 'env' ? '環境変数 COUNSELING_GAS_URL' : 'この画面で保存'}）</span>
            </dd>
            <dt className="text-xs font-medium text-muted">合言葉</dt>
            <dd className="text-xs text-ink">
              {settings.tokenSet ? '設定済み' : <span className="font-semibold text-[#9b2525] dark:text-[#f3a3a3]">未設定（URL を知っている人は誰でも回答を読めます）</span>}
            </dd>
          </dl>
        ) : (
          <Banner tone="info" title="まだつながっていません">下の手順で GAS をデプロイし、URL と合言葉を保存してください。</Banner>
        )}

        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          <Field label={settings.configured ? 'URL を変更する' : 'ウェブアプリの URL'} htmlFor="cs-gas-url" hint="https://script.google.com/macros/s/…/exec">
            <Input id="cs-gas-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={settings.configured ? '変更しない場合は空のまま' : 'https://script.google.com/macros/s/…/exec'} autoComplete="off" spellCheck={false} inputMode="url" />
          </Field>
          <Field label={settings.tokenSet ? '合言葉を変更する' : '合言葉（DASHBOARD_TOKEN）'} htmlFor="cs-gas-token" hint="GAS のスクリプト プロパティと同じ文字列">
            <Input id="cs-gas-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={settings.tokenSet ? '変更しない場合は空のまま' : '例: 32文字くらいのランダムな文字列'} autoComplete="new-password" />
          </Field>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <Button type="submit" variant="primary" icon="save" loading={saving}>保存</Button>
            <Button icon="activity" onClick={runTest} loading={testing} disabled={!settings.configured}>接続テスト</Button>
            {settings.tokenSet && settings.source === 'settings' ? (
              <Button variant="ghost" size="sm" onClick={() => save({ token: '' }, '合言葉を消しました')} disabled={saving}>合言葉を消す</Button>
            ) : null}
          </div>
        </form>

        {test ? (
          test.ok === false && !test.results ? (
            <Banner tone="bad" title="GAS に接続できませんでした">{test.error}</Banner>
          ) : (
            <div className="scroll-x rounded-xl border border-line">
              <table className="data-table">
                <thead><tr><th>フォームの店舗</th><th>結果</th><th>最新の回答</th><th>ダッシュボードの店舗</th></tr></thead>
                <tbody>
                  {test.results.map((r) => (
                    <tr key={r.key}>
                      <td className="whitespace-nowrap font-semibold text-ink">{r.name}</td>
                      <td className="whitespace-nowrap">{r.ok ? <Badge tone="good" icon="circle-check">読めます</Badge> : <Badge tone="bad" icon="circle-x">エラー</Badge>}</td>
                      <td className="min-w-[10rem] text-xs text-ink-2">{r.ok ? (r.latestAt ? jstDateTime(r.latestAt) : 'まだ回答がありません') : r.error}</td>
                      <td className="whitespace-nowrap text-xs">{r.linkedStores.length ? r.linkedStores.join('、') : <span className="text-muted">対応なし</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        <div>
          <button type="button" onClick={() => setShowSteps((v) => !v)} aria-expanded={showSteps}
            className="flex items-center gap-1.5 text-xs font-semibold text-ink-2 hover:text-ink">
            <Icon name={showSteps ? 'chevron-down' : 'chevron-right'} size={14} />GAS の準備の手順
          </button>
          {showSteps ? <div className="mt-3"><SetupSteps /></div> : null}
        </div>
      </div>
    </Card>
  );
}

function StoreMapCard({ settings, onSaved }) {
  const [map, setMap] = useState(settings.storeMap || {});
  const [saving, setSaving] = useState(false);
  useEffect(() => { setMap(settings.storeMap || {}); }, [settings.storeMap]);
  const nameOf = (key) => (settings.gasStores.find((g) => g.key === key) || {}).name || key;

  const save = async () => {
    setSaving(true);
    try {
      const clean = Object.fromEntries(Object.entries(map).filter(([, v]) => v));
      const r = await dbPost('counseling', { action: 'saveSettings', storeMap: clean });
      if (!r || r.error) throw new Error((r && r.error) || '保存できませんでした');
      invalidate('counseling:');
      await onSaved();
      showToast('店舗の対応付けを保存しました', 'success');
    } catch (e) {
      showToast(e.message, 'error', 5000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="店舗の対応付け" icon="store" subtitle="ダッシュボードの店舗 → どのフォーム（回答シート）を見るか。同じ名前の店舗は自動で対応します">
      {settings.gasStoresSource !== 'gas' && settings.configured ? (
        <Banner tone="warn" className="mb-3">GAS から店舗の一覧を取れなかったため、標準の 5店舗を表示しています。{settings.gasStoresError ? `（${settings.gasStoresError}）` : ''}</Banner>
      ) : null}
      <ul className="divide-y divide-line">
        {settings.stores.map((s) => {
          const value = map[s.id] || '';
          const effective = value === 'none' ? '' : value || s.auto;
          return (
            <li key={s.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-ink">{s.name}</div>
                <div className={cx('text-[11px]', effective ? 'text-muted' : 'text-[#9b2525] dark:text-[#f3a3a3]')}>
                  {effective ? `「${nameOf(effective)}」の回答を表示` : 'カウンセリングシートは表示されません'}
                </div>
              </div>
              <Select className="sm:w-72" value={value} onChange={(e) => setMap((m) => ({ ...m, [s.id]: e.target.value }))} aria-label={`${s.name} の対応するフォーム`}>
                <option value="">{s.auto ? `自動（同じ名前: ${nameOf(s.auto)}）` : '自動（同じ名前の店舗なし）'}</option>
                {settings.gasStores.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
                <option value="none">連携しない</option>
              </Select>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex justify-end">
        <Button variant="primary" icon="save" onClick={save} loading={saving}>保存</Button>
      </div>
    </Card>
  );
}

export default function CounselingSettings() {
  const res = useResource('counseling:settings', load, { maxAge: 60 * 1000 });
  const settings = res.shown;
  if (res.error && !settings) return <Banner tone="bad" title="カウンセリングの設定を読み込めませんでした">{res.error.message}</Banner>;
  if (!settings) return <Skeleton className="h-64 rounded-2xl" />;
  return (
    <div className="space-y-4">
      <p className="flex items-start gap-1.5 rounded-xl bg-surface-2 px-3 py-2.5 text-xs leading-relaxed text-ink-2">
        <Icon name="info" size={14} className="mt-px shrink-0 text-muted" />
        <span>
          Google フォームでカウンセリングシートを取っている店舗だけ設定します。つなぐと、施術ツール → カウンセリングにお客様の回答が届き、
          お悩みのチェックが自動で入ります（SalonOne の今日の予約とはお名前で結びつきます）。フォームと同じ名前の店舗は自動でつながるので、SalonOne の問診票を使う店舗は下の「店舗の対応付け」で「連携しない」を選んでください。
        </span>
      </p>
      <ConnectionCard settings={settings} onSaved={res.reload} />
      <StoreMapCard settings={settings} onSaved={res.reload} />
      <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted">
        <Icon name="shield-check" size={14} className="mt-px shrink-0" />
        GAS の URL と合言葉はサーバーにだけ保存され、スタッフの端末には送られません。スタッフ・店長・マネージャーは所属・管轄の店舗のシートだけを見られます。電話番号とメールアドレスは表示しません。
      </p>
    </div>
  );
}
