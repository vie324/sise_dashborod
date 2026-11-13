// ============================================================
// 設定 > インセンティブ制度 > 店舗ごとの売上インセンティブ
// ------------------------------------------------------------
// ①売上インセンティブの判定に使う指標（施術消化売上 / 入金売上）と段階を、店舗ごとに変える。
// 例: 大和店（si'se 大和店 + titi 大和店を合算）は、合算した入金売上で判定する。
// ほかの項目（継続率・新規契約・SNS・紹介・系列店）は全店共通。保存先は dash_config の rules.storeSales
// ============================================================
import { useEffect, useState } from 'react';
import { Card, Button, Select, Input, EmptyState, Skeleton } from '../../ui/primitives.jsx';
import { showToast } from '../../ui/feedback.jsx';
import Icon from '../../ui/Icon.jsx';
import { useStores, useDashConfig, saveDashConfig, refreshSalonOne } from '../../lib/hooks.js';
import { yen } from '../../lib/format.js';
import { INCENTIVE_RULES } from '../../../shared/incentive-rules.js';
import { SALES_METRICS, validSalesTiers } from '../../../shared/incentive.js';

const KEY = 'rules.storeSales';
const DEFAULT_TIERS = INCENTIVE_RULES.sales.tiers;
const toForm = (tiers) => tiers.map((t) => ({ min: String(t.min), amount: String(t.amount) }));
const digits = (v) => String(v || '').replace(/[^\d]/g, '');

function TierEditor({ tiers, onChange, storeName }) {
  const set = (i, field, v) => onChange(tiers.map((t, j) => (j === i ? { ...t, [field]: digits(v) } : t)));
  return (
    <div className="mt-2 space-y-2">
      <div className="grid grid-cols-[1fr_1fr_44px] gap-2 text-[11px] font-semibold text-muted">
        <span>月の売上（以上）</span><span>支給額</span><span />
      </div>
      {tiers.map((t, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_44px] items-center gap-2">
          <Input inputMode="numeric" value={t.min} onChange={(e) => set(i, 'min', e.target.value)} aria-label={`${storeName} ランク${i + 1}の売上の下限（円）`} />
          <Input inputMode="numeric" value={t.amount} onChange={(e) => set(i, 'amount', e.target.value)} aria-label={`${storeName} ランク${i + 1}の支給額（円）`} />
          <button type="button" onClick={() => onChange(tiers.filter((_, j) => j !== i))} disabled={tiers.length <= 1}
            className="flex h-11 w-11 items-center justify-center rounded-xl text-muted hover:bg-surface-3 disabled:opacity-40" aria-label={`ランク${i + 1}を削除`}>
            <Icon name="trash-2" size={16} />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" icon="plus" disabled={tiers.length >= 10}
          onClick={() => onChange([...tiers, { min: '', amount: '' }])}>ランクを追加</Button>
        <Button size="sm" variant="ghost" icon="rotate-ccw" onClick={() => onChange(toForm(DEFAULT_TIERS))}>全店共通の段階に戻す</Button>
      </div>
    </div>
  );
}

export default function StoreSalesRules() {
  const storesRes = useStores();
  const configRes = useDashConfig();
  const stores = storesRes.shown || [];
  const saved = (configRes.shown && configRes.shown[KEY]) || {};
  const [form, setForm] = useState({}); // storeId → { metric, custom, tiers: [{min, amount}] }
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!configRes.shown) return;
    const next = {};
    for (const [sid, r] of Object.entries(saved)) {
      const tiers = validSalesTiers(r && r.tiers);
      next[sid] = { metric: r && r.metric === 'depositSales' ? 'depositSales' : 'consumedSales', custom: !!tiers, tiers: toForm(tiers || DEFAULT_TIERS) };
    }
    setForm(next);
  }, [configRes.shown]); // eslint-disable-line react-hooks/exhaustive-deps

  const rowOf = (sid) => form[sid] || { metric: 'consumedSales', custom: false, tiers: toForm(DEFAULT_TIERS) };
  const update = (sid, patch) => setForm((f) => ({ ...f, [sid]: { ...rowOf(sid), ...patch } }));

  const save = async () => {
    const out = {};
    for (const st of stores) {
      const r = form[st.id];
      if (!r) continue;
      let tiers = null;
      if (r.custom) {
        tiers = validSalesTiers(r.tiers.map((t) => ({ min: Number(t.min), amount: Number(t.amount) })));
        if (!tiers) {
          showToast(`${st.name}の段階は、売上の下限を小さい順に（0より大きく）入れてください`, 'error');
          return;
        }
      }
      if (r.metric === 'consumedSales' && !tiers) continue; // 全店共通のまま
      out[st.id] = { metric: r.metric, ...(tiers ? { tiers } : {}) };
    }
    setSaving(true);
    try {
      await saveDashConfig(KEY, out);
      refreshSalonOne();
      showToast('店舗ごとの売上インセンティブを保存しました', 'success');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title="店舗ごとの売上インセンティブ" icon="sliders-horizontal"
      subtitle="①の判定に使う売上の指標と段階を店舗ごとに変えられます（例: 大和店は si'se と titi を合算した入金売上で判定）。スタッフは所属店舗の設定で判定し、ほかの項目は全店共通です">
      {!storesRes.shown || !configRes.shown ? <Skeleton className="h-40" /> : stores.length === 0 ? (
        <EmptyState compact icon="store" title="店舗が登録されていません" />
      ) : (
        <ul className="divide-y divide-line">
          {stores.map((st) => {
            const r = rowOf(st.id);
            return (
              <li key={st.id} className="py-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-[13px] font-semibold text-ink">{st.name}</span>
                  <Select className="sm:w-72" value={r.metric} onChange={(e) => update(st.id, { metric: e.target.value })} aria-label={`${st.name}の売上インセンティブの指標`}>
                    <option value="consumedSales">{SALES_METRICS.consumedSales}（全店共通）</option>
                    <option value="depositSales">{SALES_METRICS.depositSales}（合算した店舗は合算）</option>
                  </Select>
                </div>
                <label className="mt-2 inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-[13px] text-ink-2">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--chart-sales)]" checked={r.custom} onChange={(e) => update(st.id, { custom: e.target.checked })} />
                  段階（金額）も変える
                </label>
                {r.custom ? <TierEditor tiers={r.tiers} storeName={st.name} onChange={(tiers) => update(st.id, { tiers })} /> : (
                  <p className="text-xs text-muted">段階は全店共通: {DEFAULT_TIERS.map((t) => `${yen(t.min)}〜 ${yen(t.amount)}`).join(' / ')}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4 flex justify-end">
        <Button variant="primary" icon="save" onClick={save} loading={saving} disabled={!storesRes.shown || !configRes.shown}>保存</Button>
      </div>
    </Card>
  );
}
