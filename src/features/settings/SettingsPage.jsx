import { useState } from 'react';
import { PageHeader, Segmented, Card, cx } from '../../ui/primitives.jsx';
import Icon from '../../ui/Icon.jsx';
import { useApp } from '../../app/state.jsx';
import { INCENTIVE_RULES } from '../../../shared/incentive-rules.js';
import SalonOneSettings from './SalonOneSettings.jsx';
import CounselingSettings from './CounselingSettings.jsx';
import StaffSection from './StaffSection.jsx';
import StoreSection from './StoreSection.jsx';
import RulesView from '../incentives/RulesView.jsx';

const TAB_KEY = 'sise_settings_tab';

function DisplaySettings() {
  const { theme, setTheme } = useApp();
  const options = [
    { value: 'system', label: '端末に合わせる', icon: 'monitor', desc: 'スマホ・PC の設定（ライト/ダーク）に自動で合わせます' },
    { value: 'light', label: 'ライト', icon: 'sun', desc: '明るい背景で表示します' },
    { value: 'dark', label: 'ダーク', icon: 'moon', desc: '暗い背景で表示します。夜間の施術室などに' },
  ];
  return (
    <Card title="表示" icon="palette" subtitle="この端末だけに保存されます">
      <div className="grid gap-3 sm:grid-cols-3">
        {options.map((o) => (
          <button key={o.value} type="button" onClick={() => setTheme(o.value)} aria-pressed={theme === o.value}
            className={cx('rounded-xl border p-4 text-left transition-colors',
              theme === o.value ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/15' : 'border-line hover:bg-surface-2')}>
            <Icon name={o.icon} size={20} className={theme === o.value ? 'text-brand-600 dark:text-brand-300' : 'text-muted'} />
            <div className="mt-2 text-sm font-bold text-ink">{o.label}</div>
            <div className="mt-0.5 text-xs text-ink-2">{o.desc}</div>
          </button>
        ))}
      </div>
    </Card>
  );
}

export default function SettingsPage() {
  const [tab, setTabState] = useState(() => {
    try { return localStorage.getItem(TAB_KEY) || 'salonone'; } catch (_) { return 'salonone'; }
  });
  const setTab = (t) => {
    setTabState(t);
    try { localStorage.setItem(TAB_KEY, t); } catch (_) { /* noop */ }
  };
  return (
    <div>
      <PageHeader title="設定" subtitle="SalonOne 連携・カウンセリングフォーム・スタッフと URL・店舗・インセンティブ制度・表示" />
      <Segmented
        className="mb-4"
        value={tab}
        onChange={setTab}
        ariaLabel="設定の項目"
        options={[
          { value: 'salonone', label: 'SalonOne連携', icon: 'plug' },
          { value: 'counseling', label: 'カウンセリング', icon: 'clipboard-check' },
          { value: 'staff', label: 'スタッフ', icon: 'users' },
          { value: 'stores', label: '店舗', icon: 'store' },
          { value: 'rules', label: 'インセンティブ制度', icon: 'award' },
          { value: 'display', label: '表示', icon: 'palette' },
        ]}
      />
      {tab === 'salonone' ? <SalonOneSettings /> : null}
      {tab === 'counseling' ? <CounselingSettings /> : null}
      {tab === 'staff' ? <StaffSection /> : null}
      {tab === 'stores' ? <StoreSection /> : null}
      {tab === 'rules' ? (
        <>
          <p className="mb-3 text-xs text-muted">制度の金額・条件を変える場合は shared/incentive-rules.js を更新します（計算と画面の表示がまとめて切り替わります）。</p>
          <RulesView rules={INCENTIVE_RULES} />
        </>
      ) : null}
      {tab === 'display' ? <DisplaySettings /> : null}
    </div>
  );
}
