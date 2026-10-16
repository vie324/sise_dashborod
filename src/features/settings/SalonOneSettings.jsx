import { useEffect, useMemo, useState } from 'react';
import { Card, Button, Badge, Banner, Select, Input, Field, EmptyState, Skeleton, cx } from '../../ui/primitives.jsx';
import { showToast } from '../../ui/feedback.jsx';
import Icon from '../../ui/Icon.jsx';
import { salonOne, salonOnePost } from '../../lib/api.js';
import { useResource, useStores, useStaffList, saveDashConfig, refreshSalonOne, invalidate } from '../../lib/hooks.js';
import { CHANNELS, guessChannel, channelLabel } from '../../../shared/channels.js';
import { copyText } from './clipboard.js';

// 名前の表記ゆれ（全角/半角スペース・敬称）を吸収して比較する
const normName = (s) => String(s || '').replace(/[\s　]/g, '').replace(/(さん|先生)$/, '').toLowerCase();

function SetupSteps() {
  return (
    <ol className="space-y-3 text-[13px] leading-relaxed text-ink-2">
      {[
        <>SalonOne の管理画面で <strong className="text-ink">ブランド管理 &gt; 「API連携」</strong> を開き、新しいキーを発行します（用途: 社内分析ダッシュボード／有効期限: 1年がおすすめ）。<span className="block text-xs text-muted">「個人情報を含める」「サロンワンのログインを必須にする」はオフのままで構いません（集計に氏名などは使いません）。</span></>,
        <>Vercel のプロジェクト設定 &gt; Environment Variables に <code className="rounded bg-surface-3 px-1">SALONONE_API_KEY</code> を追加し、再デプロイします（キーはサーバーだけで使い、画面には出しません）。</>,
        <>このページの <strong className="text-ink">接続テスト</strong> で各データが取得できるか確認し、下で店舗・スタッフ・来店経由を対応付けます。</>,
      ].map((t, i) => (
        <li key={i} className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">{i + 1}</span>
          <span>{t}</span>
        </li>
      ))}
    </ol>
  );
}

/** 接続テストの 1行（取得できた項目名 / エラーの説明） */
function ProbeDetail({ r }) {
  if (!r.ok) return <span className="text-[#8f2121] dark:text-[#f2b0b0]">{(r.error || '').replace(/^SalonOne API エラー \([^)]*\): /, '')}</span>;
  const info = r.info ? Object.entries(r.info) : [];
  const nested = r.nested ? Object.entries(r.nested).filter(([, keys]) => keys.length) : [];
  return (
    <div className="space-y-1">
      {info.length ? <div className="text-ink">{info.map(([k, v]) => `${k}: ${v}`).join(' / ')}</div> : null}
      <div>{r.sampleKeys && r.sampleKeys.length ? r.sampleKeys.join(', ') : '（0件のため項目名は確認できません）'}</div>
      {nested.map(([k, keys]) => <div key={k} className="text-muted"><code>{k}</code>: {keys.join(', ')}</div>)}
    </div>
  );
}

function ConnectionCard({ status, master }) {
  const [probe, setProbe] = useState(null);
  const [busy, setBusy] = useState(false);
  const live = status && status.mode === 'live';
  const runProbe = async () => {
    setBusy(true);
    try {
      setProbe(await salonOne('probe'));
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };
  const copyProbe = async () => {
    const res = await copyText(JSON.stringify({ at: new Date().toISOString(), baseUrl: probe.baseUrl, results: probe.results }, null, 2));
    showToast(res.ok ? '接続テストの結果をコピーしました' : 'コピーできませんでした', res.ok ? 'success' : 'error');
  };
  const clearCache = async () => {
    try {
      await salonOnePost('clearCache');
      refreshSalonOne();
      invalidate('salonone-master');
      showToast('SalonOne のデータを取り直します', 'success');
    } catch (e) {
      showToast(e.message, 'error');
    }
  };
  return (
    <Card title="SalonOne との接続" icon="plug"
      actions={status ? (live ? <Badge tone="good" icon="circle-check">接続済み</Badge> : <Badge tone="gold" icon="flask-conical">デモデータ</Badge>) : null}>
      {!status ? <Skeleton className="h-24" /> : (
        <div className="space-y-4">
          {live ? (
            <p className="text-[13px] text-ink-2">
              <span className="font-semibold text-ink">{status.baseUrl}</span> の分析APIから、受付履歴・継続管理・店舗・スタッフを読み取っています（読み取り専用）。
            </p>
          ) : (
            <>
              <Banner tone="demo" title="APIキーが未設定のため、デモデータで表示しています">
                実際の店舗・スタッフ名に、それらしい数字を当てはめています。次の手順で SalonOne とつなぐと実データに切り替わります。
              </Banner>
              <SetupSteps />
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button icon="activity" onClick={runProbe} loading={busy} disabled={!live}>接続テスト</Button>
            <Button variant="ghost" icon="refresh-cw" onClick={clearCache}>データを取り直す</Button>
          </div>
          {probe ? (
            probe.configured === false ? <p className="text-xs text-muted">{probe.message}</p> : (
              <div className="space-y-2">
                <div className="scroll-x rounded-xl border border-line">
                  <table className="data-table">
                    <thead><tr><th>データ</th><th>結果</th><th>項目名（先頭の1件）</th></tr></thead>
                    <tbody>
                      {probe.results.map((r) => (
                        <tr key={r.name}>
                          <td className="whitespace-nowrap">
                            <div className="font-semibold text-ink">{r.label || r.name}</div>
                            <code className="text-[11px] text-muted">{r.path || '—'}</code>
                          </td>
                          <td className="whitespace-nowrap">
                            {r.ok ? <Badge tone="good" icon="circle-check">{r.count}件{r.more ? '〜' : ''}</Badge> : <Badge tone="bad" icon="circle-x">{r.status || 'エラー'}</Badge>}
                          </td>
                          <td className="min-w-[16rem] text-xs text-ink-2"><ProbeDetail r={r} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Button variant="ghost" size="sm" icon="copy" onClick={copyProbe}>結果をコピー</Button>
                  <span className="text-xs text-muted">値（金額・顧客）は含まれません。うまくいかない時は開発担当に共有してください。</span>
                </div>
              </div>
            )
          ) : null}
          {probe && probe.results && probe.results.some((r) => r.ok === false) ? (
            <p className="text-xs leading-relaxed text-muted">
              エラーの説明に沿って SalonOne 側の設定（キー・機能・為替レート）を確認してください。<code>error_id</code> が出ている場合は、SalonOne の運営に伝えると原因を調べてもらえます。
            </p>
          ) : null}
          {master && master.mode === 'live' ? (
            <p className="text-xs text-muted">SalonOne 側: 店舗 {master.shops.length} / スタッフ {master.staff.length} / 来店経由 {master.sources.length}</p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function MappingSection({ title, icon, subtitle, rows, options, value, onChange, onAuto, onSave, saving, disabled, emptyText }) {
  return (
    <Card title={title} icon={icon} subtitle={subtitle}
      actions={onAuto ? <Button size="sm" variant="ghost" icon="wand-sparkles" onClick={onAuto} disabled={disabled}>名前で自動対応</Button> : null}>
      {rows.length === 0 ? <EmptyState compact icon="inbox" title={emptyText} /> : (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-ink">{r.label}</div>
                {r.sub ? <div className="text-[11px] text-muted">{r.sub}</div> : null}
              </div>
              <Select className="sm:w-72" value={value[r.id] || ''} onChange={(e) => onChange(r.id, e.target.value)} disabled={disabled} aria-label={`${r.label} の対応先`}>
                <option value="">{r.placeholder || '未連携'}</option>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex justify-end">
        <Button variant="primary" icon="save" onClick={onSave} loading={saving} disabled={disabled}>保存</Button>
      </div>
    </Card>
  );
}

export default function SalonOneSettings() {
  const status = useResource('salonone-status', () => salonOne('status'), { maxAge: 60 * 1000 });
  const masterRes = useResource('salonone-master', () => salonOne('master'), { maxAge: 5 * 60 * 1000 });
  const storesRes = useStores();
  const staffRes = useStaffList();
  const master = masterRes.shown;
  const demo = master && master.mode === 'demo';

  const [shopMap, setShopMap] = useState({});
  const [staffMap, setStaffMap] = useState({});
  const [channelMap, setChannelMap] = useState({});
  const [planRules, setPlanRules] = useState({ sharePlanKeyword: '', payPerVisitKeyword: '' });
  const [saving, setSaving] = useState('');

  useEffect(() => {
    if (!master) return;
    setShopMap(master.mapping.shopMap || {});
    setStaffMap(master.mapping.staffMap || {});
    setChannelMap(master.mapping.channelMap || {});
    setPlanRules({ sharePlanKeyword: '', payPerVisitKeyword: '', ...(master.mapping.planRules || {}) });
  }, [master]);

  const stores = storesRes.shown || [];
  const staff = useMemo(() => (staffRes.shown || []).filter((s) => s.status !== 'inactive'), [staffRes.shown]);

  const save = async (key, value, label) => {
    setSaving(key);
    try {
      // 未選択（空文字）は保存しない
      const clean = Object.fromEntries(Object.entries(value).filter(([, v]) => v));
      await saveDashConfig(key, clean);
      refreshSalonOne();
      invalidate('salonone-master');
      showToast(`${label}を保存しました`, 'success');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving('');
    }
  };

  const autoMatch = (list, targets, current, setter) => {
    const next = { ...current };
    let matched = 0;
    for (const item of list) {
      if (next[item.id]) continue;
      const hit = targets.find((t) => normName(t.name) === normName(item.name));
      if (hit) { next[item.id] = hit.id; matched += 1; }
    }
    setter(next);
    showToast(matched ? `${matched}件を名前で対応付けました（保存してください）` : '名前が一致する候補はありませんでした', matched ? 'success' : 'info');
  };

  if (masterRes.error && !master) {
    return <Banner tone="bad" title="SalonOne の情報を取得できませんでした">{masterRes.error.message}</Banner>;
  }

  return (
    <div className="space-y-4">
      <ConnectionCard status={status.shown} master={master} />
      {!master ? <Skeleton className="h-64 rounded-2xl" /> : (
        <>
          {demo ? (
            <Banner tone="info">デモ中は、ダッシュボードの店舗・スタッフをそのまま SalonOne の店舗・スタッフとして扱います。店舗とスタッフの対応付けは APIキー登録後に設定してください（来店経由の対応付けはデモでも反映されます）。</Banner>
          ) : null}
          <MappingSection
            title="店舗の対応付け" icon="store" subtitle="ダッシュボードの店舗 → SalonOne の店舗"
            rows={stores.map((s) => ({ id: String(s.id), label: s.name, sub: `ID: ${s.id}` }))}
            options={master.shops.map((s) => ({ value: s.id, label: s.name }))}
            value={shopMap} onChange={(id, v) => setShopMap((m) => ({ ...m, [id]: v }))}
            onAuto={() => autoMatch(stores.map((s) => ({ id: String(s.id), name: s.name })), master.shops, shopMap, setShopMap)}
            onSave={() => save('salonone.shopMap', shopMap, '店舗の対応付け')} saving={saving === 'salonone.shopMap'}
            disabled={demo} emptyText="店舗が登録されていません（店舗タブで追加）"
          />
          <MappingSection
            title="スタッフの対応付け" icon="users" subtitle="スタッフURLでログインした人が、SalonOne のどのスタッフの実績を見るか"
            rows={staff.map((s) => ({ id: String(s.id), label: s.name, sub: s.role === 'headquarter' ? '本部' : s.role === 'manager' ? '店舗責任者' : 'スタッフ', placeholder: s.role === 'headquarter' ? '対応なし（本部）' : '未連携' }))}
            options={master.staff.map((s) => ({ value: s.id, label: `${s.name}${s.shopId ? `（${(master.shops.find((x) => x.id === s.shopId) || {}).name || s.shopId}）` : ''}` }))}
            value={staffMap} onChange={(id, v) => setStaffMap((m) => ({ ...m, [id]: v }))}
            onAuto={() => autoMatch(staff.map((s) => ({ id: String(s.id), name: s.name })), master.staff, staffMap, setStaffMap)}
            onSave={() => save('salonone.staffMap', staffMap, 'スタッフの対応付け')} saving={saving === 'salonone.staffMap'}
            disabled={demo} emptyText="スタッフが登録されていません（スタッフタブで追加）"
          />
          <MappingSection
            title="来店経由 → 集客経路" icon="route"
            subtitle="インセンティブの「3経路（ホットペッパー・Meta広告・ホームページ）」「Minimo・Threads・Instagram」「紹介」の判定に使います。未設定は名前から自動判定します"
            rows={master.sources.map((name) => ({ id: name, label: name, placeholder: `自動: ${channelLabel(guessChannel(name))}` }))}
            options={CHANNELS.map((c) => ({ value: c.key, label: c.label }))}
            value={channelMap} onChange={(id, v) => setChannelMap((m) => ({ ...m, [id]: v }))}
            onSave={() => save('salonone.channelMap', channelMap, '来店経由の対応付け')} saving={saving === 'salonone.channelMap'}
            emptyText="直近の来店経由データがありません"
          />
          <Card title="プランの判定" icon="tags" subtitle="プラン名に含まれる言葉で判定します（カンマ区切りで複数可）">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="シェアプラン" hint="紹介インセンティブの対象外にします（既定: シェア）">
                <Input value={planRules.sharePlanKeyword || ''} placeholder="シェア" onChange={(e) => setPlanRules((r) => ({ ...r, sharePlanKeyword: e.target.value }))} />
              </Field>
              <Field label="都度払い" hint="会員数に数えません（既定: 都度）">
                <Input value={planRules.payPerVisitKeyword || ''} placeholder="都度" onChange={(e) => setPlanRules((r) => ({ ...r, payPerVisitKeyword: e.target.value }))} />
              </Field>
            </div>
            <div className="mt-4 flex justify-end">
              <Button variant="primary" icon="save" loading={saving === 'salonone.planRules'}
                onClick={() => save('salonone.planRules', planRules, 'プランの判定')}>保存</Button>
            </div>
          </Card>
          <p className={cx('flex items-start gap-1.5 text-xs leading-relaxed text-muted')}>
            <Icon name="shield-check" size={14} className="mt-px" />
            APIキーはサーバーの環境変数にのみ保存され、ブラウザやスタッフの端末には送られません。SalonOne のデータは読み取りのみで、書き換えることはありません。
          </p>
        </>
      )}
    </div>
  );
}
