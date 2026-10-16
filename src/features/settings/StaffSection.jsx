import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { Badge, Banner, Button, Card, EmptyState, Field, Input, Modal, Spinner, Textarea, cx } from '../../ui/primitives.jsx';
import { confirmDialog, showToast } from '../../ui/feedback.jsx';
import { ROLE_LABELS, isAdmin } from '../../lib/access.js';
import { useStaffList } from '../../lib/hooks.js';
import { issueStaffUrl, postChange, useAllStores } from './settingsData.js';
import { copyText } from './clipboard.js';
import { FoldHeader, Initial, LoadError, RowsSkeleton } from './parts.jsx';

// ============================================================
// スタッフ管理
// ------------------------------------------------------------
//   ・スタッフの追加・編集（役割・所属店舗・パスワード）・無効化・復元
//   ・スタッフURL（?v=<署名付きトークン>）の発行とコピー、全員分の一括発行
// 変更は管理者・本部ができるが、URL の発行はサーバーが管理者モードでしか受け付けない
// ので、本部で開いているときは発行の操作を出さない。
// パスワードはサーバーから返らない（hasPassword だけ）ので、入力欄は書き込み専用。
// ============================================================

// 役割の説明はサーバー側の参照範囲（api/_lib/db-handlers-master.js の staffGet）と揃える
const ROLES = [
  { value: 'staff', icon: 'user', tone: 'brand', desc: '自分の実績を閲覧' },
  { value: 'manager', icon: 'users', tone: 'info', desc: '所属店舗のスタッフ全員を閲覧' },
  { value: 'headquarter', icon: 'building-2', tone: 'gold', desc: '全店舗を閲覧・設定を変更' },
];
const roleMeta = (role) => ROLES.find((r) => r.value === role) || ROLES[0];

function RoleBadge({ role }) {
  const m = roleMeta(role);
  return <Badge tone={m.tone} icon={m.icon}>{ROLE_LABELS[m.value]}</Badge>;
}

const sameIds = (a, b) => {
  const sa = new Set((a || []).map(String));
  const sb = new Set((b || []).map(String));
  return sa.size === sb.size && [...sa].every((x) => sb.has(x));
};

// 既存データと同じ形式の ID（時刻 + 乱数の base36）
const newStaffId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const selectAll = (e) => {
  try { e.target.select(); } catch (_) { /* noop */ }
};

export default function StaffSection() {
  const staffRes = useStaffList(true);
  const storesRes = useAllStores();
  const canIssueUrl = isAdmin();

  const staffList = staffRes.shown;
  const active = useMemo(() => (staffList || []).filter((s) => s.status !== 'inactive'), [staffList]);
  const inactive = useMemo(() => (staffList || []).filter((s) => s.status === 'inactive'), [staffList]);

  const stores = storesRes.shown;
  const storeById = useMemo(() => new Map((stores || []).map((s) => [String(s.id), s])), [stores]);
  const activeStores = useMemo(() => (stores || []).filter((s) => s.status !== 'inactive' && !s.mergedInto), [stores]);

  const [form, setForm] = useState(null); // { staff: 編集する行 | null（追加） }
  const [urlView, setUrlView] = useState(null); // 自動コピーできなかった URL { name, url }
  const [bulk, setBulk] = useState(null); // 一括発行 { running, total, results }
  const [showInactive, setShowInactive] = useState(false);
  const [busy, setBusy] = useState(null); // 行ごとの処理中 { id, action }
  const [copiedId, setCopiedId] = useState(null);
  const copiedTimer = useRef(null);
  const bulkRun = useRef(0);
  const inactiveListId = useId();

  useEffect(() => () => clearTimeout(copiedTimer.current), []);

  // Modal は onClose が変わるたびに先頭の入力へフォーカスし直すので、閉じる処理は固定の関数にする
  const openAdd = useCallback(() => setForm({ staff: null }), []);
  const closeForm = useCallback(() => setForm(null), []);
  const closeUrlView = useCallback(() => setUrlView(null), []);
  const closeBulk = useCallback(() => {
    bulkRun.current += 1; // 発行途中で閉じたら残りは発行しない
    setBulk(null);
  }, []);

  const storeText = (staff) => {
    // 本部は所属に関係なく全店舗を見られるので、見える範囲として「全店舗」と出す
    if (staff.role === 'headquarter') return '全店舗';
    if (!stores) return '…';
    const list = (staff.storeIds || []).map(String);
    if (list.length === 0) return '所属店舗なし';
    return list.map((id) => {
      const s = storeById.get(id);
      if (!s) return `不明な店舗（${id}）`;
      if (s.mergedInto) return `${s.name}（統合済み）`;
      if (s.status === 'inactive') return `${s.name}（無効）`;
      return s.name;
    }).join('、');
  };

  const copyUrl = async (staff) => {
    // iOS Safari はタップの処理中に clipboard を呼ばないと拒否するので、発行を待たずに
    // Promise のまま渡す（copyText が ClipboardItem で発行の完了を待つ）
    setBusy({ id: staff.id, action: 'url' });
    let issued = '';
    let issueError = '';
    const urlPromise = issueStaffUrl(staff.id).then(
      (url) => { issued = url; return url; },
      (e) => { issueError = e.message; return ''; },
    );
    const r = await copyText(urlPromise);
    setBusy(null);
    if (r.ok) {
      setCopiedId(staff.id);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopiedId(null), 2000);
      showToast(`${staff.name} さんのURLをコピーしました`, 'success', 2000);
    } else if (issued || r.text) {
      setUrlView({ name: staff.name, url: issued || r.text });
    } else {
      showToast(`URLを発行できませんでした: ${issueError || '通信エラー'}`, 'error', 5000);
    }
  };

  // 編集モーダルから呼ぶ。無効にできたら true（モーダルを閉じる）
  const deactivate = useCallback(async (staff) => {
    const ok = await confirmDialog({
      title: `「${staff.name}」を無効にしますか？`,
      message: 'このスタッフのURLは使えなくなります。\n過去のデータはそのまま残り、「無効なスタッフ」からいつでも復元できます。',
      confirmLabel: '無効にする',
      variant: 'danger',
    });
    if (!ok) return false;
    const r = await postChange('staff', { action: 'deleteStaff', staffId: staff.id }, { reload: staffRes.reload, errorLabel: '無効にできませんでした' });
    if (!r) return false;
    showToast(`「${staff.name}」を無効にしました`, 'success');
    return true;
  }, [staffRes.reload]);

  const restore = async (staff) => {
    // 復元すると以前に配ったURLがまた通るようになるので、確認してから
    const ok = await confirmDialog({
      title: `「${staff.name}」を復元しますか？`,
      message: '以前に発行したこのスタッフのURLが、また使えるようになります。',
      confirmLabel: '復元する',
    });
    if (!ok) return;
    setBusy({ id: staff.id, action: 'restore' });
    const r = await postChange('staff', { action: 'restoreStaff', staffId: staff.id }, { reload: staffRes.reload, errorLabel: '復元できませんでした' });
    setBusy(null);
    if (r) showToast(`「${staff.name}」を復元しました`, 'success');
  };

  const runBulk = async () => {
    const targets = active;
    if (targets.length === 0) return;
    const ok = await confirmDialog({
      title: '全スタッフのURLを発行',
      message: `有効なスタッフ ${targets.length} 人分のURLを新しく発行します。\nこれまでのURLも、有効期限内はそのまま使えます。`,
      confirmLabel: '発行する',
    });
    if (!ok) return;
    const runId = ++bulkRun.current;
    const results = [];
    setBulk({ running: true, total: targets.length, results: [] });
    for (const s of targets) {
      let row;
      try {
        row = { id: s.id, name: s.name, url: await issueStaffUrl(s.id) };
      } catch (e) {
        row = { id: s.id, name: s.name, error: e.message };
      }
      if (runId !== bulkRun.current) return;
      results.push(row);
      setBulk({ running: true, total: targets.length, results: [...results] });
    }
    setBulk({ running: false, total: targets.length, results });
    const failed = results.filter((r) => r.error).length;
    if (failed) showToast(`${results.length - failed}人分を発行しました（${failed}人分は失敗）`, 'warning', 5000);
    else showToast(`${results.length}人分のURLを発行しました`, 'success');
  };

  const rowProps = (s) => ({
    staff: s,
    storeText: storeText(s),
    canIssueUrl,
    copied: copiedId === s.id,
    busyAction: busy && busy.id === s.id ? busy.action : null,
    onCopyUrl: () => copyUrl(s),
    onEdit: () => setForm({ staff: s }),
    onRestore: () => restore(s),
  });

  const loadingFirst = !staffList && !staffRes.error;

  return (
    <Card
      title="スタッフ管理"
      icon="users"
      subtitle="役割・所属店舗とスタッフURLの管理"
      actions={<Button size="sm" variant="primary" icon="user-plus" onClick={openAdd}>スタッフを追加</Button>}
    >
      {!canIssueUrl ? (
        <Banner tone="info" className="mb-3">スタッフURLの発行は管理者だけが行えます。URLが必要なときは管理者に依頼してください。</Banner>
      ) : null}
      {staffRes.error ? <LoadError error={staffRes.error} onRetry={staffRes.reload} /> : null}
      {loadingFirst ? <RowsSkeleton /> : null}

      {staffList ? (
        <div className="-mx-4 border-t border-line sm:-mx-5">
          {active.length > 0 ? (
            <ul className="divide-y divide-line" aria-label="有効なスタッフ">
              {active.map((s) => <StaffRow key={s.id} {...rowProps(s)} />)}
            </ul>
          ) : (
            <EmptyState
              compact
              icon="users"
              title="スタッフが登録されていません"
              message="「スタッフを追加」から登録してください。"
            />
          )}

          {inactive.length > 0 ? (
            <div className="border-t border-line">
              <FoldHeader
                open={showInactive}
                onToggle={() => setShowInactive((v) => !v)}
                label={`無効なスタッフ（${inactive.length}名）`}
                note="データは保持されています"
                controls={inactiveListId}
              />
              {showInactive ? (
                <ul id={inactiveListId} className="divide-y divide-line border-t border-line bg-surface-2/60" aria-label="無効なスタッフ">
                  {inactive.map((s) => <StaffRow key={s.id} inactive {...rowProps(s)} />)}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-3 border-t border-line px-4 pt-4 sm:px-5">
            {canIssueUrl && active.length > 0 ? (
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-ink">URLの一括発行</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">有効なスタッフ全員のURLを発行し直し、「名前: URL」の形でまとめてコピーできます。</p>
                </div>
                <Button size="sm" variant="secondary" icon="refresh-cw" className="self-start sm:self-auto" onClick={runBulk} disabled={!!bulk}>
                  全員分を発行
                </Button>
              </div>
            ) : null}
            <p className="flex gap-1.5 text-xs leading-relaxed text-muted">
              <Icon name="info" size={14} className="mt-px" />
              <span>退職などでスタッフを無効にするときは「編集」から行います。過去のデータはそのまま残ります。パスワードを設定すると、スタッフURLを開くときに入力が必要になります。</span>
            </p>
          </div>
        </div>
      ) : null}

      {form ? (
        <StaffFormModal
          initial={form.staff}
          activeStores={activeStores}
          storeById={storeById}
          canIssueUrl={canIssueUrl}
          reload={staffRes.reload}
          onDeactivate={deactivate}
          onClose={closeForm}
        />
      ) : null}
      {urlView ? <UrlModal data={urlView} onClose={closeUrlView} /> : null}
      {bulk ? <BulkUrlModal state={bulk} onClose={closeBulk} /> : null}
    </Card>
  );
}

// ------------------------------------------------------------
// 一覧の行
// ------------------------------------------------------------
// 無効化はめったに使わず取り消しの確認も要るので、行には出さず編集モーダルの中に置く
function StaffRow({ staff, storeText, inactive = false, canIssueUrl, copied, busyAction, onCopyUrl, onEdit, onRestore }) {
  const busy = !!busyAction;
  // ボタンが 1 つだけなら狭い画面でも横に並べ、2 つ（URL と編集）なら下の段に回す
  const single = inactive || !canIssueUrl;
  return (
    <li className={cx('flex gap-2.5 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 sm:px-5', single ? 'items-start' : 'flex-col')}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <Initial name={staff.name} muted={inactive} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={cx('break-all text-sm font-semibold', inactive ? 'text-muted' : 'text-ink')}>{staff.name}</span>
            <RoleBadge role={staff.role} />
            {staff.hasPassword ? <Badge icon="lock">パスワードあり</Badge> : null}
            {inactive ? <Badge tone="bad" icon="ban">無効</Badge> : null}
          </div>
          <p className="mt-1 flex items-start gap-1 text-xs text-muted">
            <Icon name="store" size={13} className="mt-px" />
            <span className="min-w-0">{storeText}</span>
          </p>
        </div>
      </div>
      <div className={cx('flex shrink-0 flex-wrap items-center gap-1.5 sm:justify-end sm:pl-0', single ? '' : 'pl-12')}>
        {inactive ? (
          <Button size="sm" variant="subtle" icon="rotate-ccw" loading={busyAction === 'restore'} disabled={busy} onClick={onRestore}>
            復元
          </Button>
        ) : (
          <>
            {canIssueUrl ? (
              <Button
                size="sm"
                variant={copied ? 'subtle' : 'secondary'}
                icon={copied ? 'check' : 'link'}
                loading={busyAction === 'url'}
                disabled={busy}
                onClick={onCopyUrl}
              >
                {copied ? 'コピーしました' : 'URLをコピー'}
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" icon="pencil" disabled={busy} onClick={onEdit}>編集</Button>
          </>
        )}
      </div>
    </li>
  );
}

// ------------------------------------------------------------
// 追加・編集
// ------------------------------------------------------------
function StaffFormModal({ initial, activeStores, storeById, canIssueUrl, reload, onDeactivate, onClose }) {
  const editing = !!initial;
  const uid = useId();
  const formId = `${uid}-form`;
  const hadPassword = !!(initial && initial.hasPassword);

  const [name, setName] = useState(initial ? initial.name || '' : '');
  const [role, setRole] = useState(initial ? roleMeta(initial.role).value : 'staff');
  const [storeIds, setStoreIds] = useState(() => {
    if (initial) return (initial.storeIds || []).map(String);
    // 店舗が 1 つだけなら選ぶ手間を省く
    return activeStores.length === 1 ? [String(activeStores[0].id)] : [];
  });
  const [password, setPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const savingRef = useRef(false);

  // 保存中に閉じると結果のトーストだけが後から出て紛らわしいので、保存が終わるまで閉じない
  // （確認ダイアログを Esc で閉じたときに、このモーダルまで一緒に閉じないためでもある）
  const requestClose = useCallback(() => {
    if (!savingRef.current) onClose();
  }, [onClose]);

  const deactivate = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setDeactivating(true);
    const done = await onDeactivate(initial);
    savingRef.current = false;
    setDeactivating(false);
    if (done) onClose();
  };

  // 無効・統合済みの店舗に所属したままのスタッフもいる。開いた時点の所属は選択肢に残し、外せるようにする
  const options = useMemo(() => {
    const list = activeStores.map((s) => ({ id: String(s.id), name: s.name, note: '' }));
    const seen = new Set(list.map((o) => o.id));
    for (const raw of (initial && initial.storeIds) || []) {
      const id = String(raw);
      if (seen.has(id)) continue;
      seen.add(id);
      const s = storeById.get(id);
      list.push({ id, name: s ? s.name : id, note: !s ? '不明な店舗' : s.mergedInto ? '統合済み' : '無効' });
    }
    return list;
  }, [activeStores, storeById, initial]);

  const changeRole = (next) => {
    setRole(next);
    // 本部は所属に関係なく全店舗を見られる。旧画面と同じく、選んだ時点で全店舗を所属にする
    if (next === 'headquarter') setStoreIds(activeStores.map((s) => String(s.id)));
    setErrors((e) => ({ ...e, stores: undefined }));
  };

  const toggleStore = (id) => {
    setStoreIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setErrors((e) => ({ ...e, stores: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (savingRef.current) return;
    const trimmed = name.trim();
    // コピー&ペーストで紛れ込んだ前後の空白のせいで本人が開けなくなるのを防ぐ
    const pw = password.trim();
    const errs = {};
    if (!trimmed) errs.name = '名前を入力してください';
    if (role !== 'headquarter' && storeIds.length === 0) errs.stores = '所属店舗を1つ以上選んでください';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    let body;
    let message;
    let tone = 'success';
    if (!editing) {
      const row = { id: newStaffId(), name: trimmed, role, status: 'active', storeIds, createdAt: new Date().toISOString() };
      // パスワードは入力されたときだけ送る（キーが無ければサーバーは触らない）
      if (pw) row.password = pw;
      body = { action: 'saveStaff', staff: [row] };
      message = `「${trimmed}」を追加しました${canIssueUrl ? '。「URLをコピー」から本人に送れます' : ''}`;
    } else {
      const updates = {};
      if (trimmed !== initial.name) updates.name = trimmed;
      if (role !== initial.role) updates.role = role;
      if (!sameIds(storeIds, initial.storeIds)) updates.storeIds = storeIds;
      if (clearPassword) updates.password = '';
      else if (pw) updates.password = pw;
      if (Object.keys(updates).length === 0) {
        onClose();
        showToast('変更はありませんでした', 'info', 2000);
        return;
      }
      body = { action: 'updateStaff', staffId: initial.id, updates };
      // 権限はサーバーが DB の値で判定するのですぐ切り替わるが、名前・役割・所属店舗・パスワードの有無は
      // URL に埋め込んで画面の表示（パスワード入力画面を含む）に使っているため、新しい URL を送るまで古いまま
      tone = 'info';
      message = `「${trimmed}」を更新しました。${canIssueUrl ? '新しいURLをコピーして本人に送ってください' : '新しいURLの発行を管理者に依頼してください'}`;
    }

    savingRef.current = true;
    setSaving(true);
    const r = await postChange('staff', body, { reload });
    savingRef.current = false;
    setSaving(false);
    if (!r) return;
    showToast(message, tone, tone === 'info' ? 6000 : 3500);
    onClose();
  };

  const pwHint = clearPassword
    ? null
    : hadPassword
      ? '空欄のままなら今のパスワードを変えません。新しいパスワードは、新しいURLから有効になります。'
      : 'URLを開くときに入力が必要になります。空欄ならパスワードなし。';

  return (
    <Modal
      open
      title={editing ? 'スタッフを編集' : 'スタッフを追加'}
      onClose={requestClose}
      footer={(
        <>
          {editing ? (
            <Button
              variant="ghost"
              icon="archive"
              className="mr-auto !text-[#b42323] hover:!bg-[#fbe9e9] dark:!text-[#f08a8a] dark:hover:!bg-[#d03b3b]/15"
              onClick={deactivate}
              loading={deactivating}
              disabled={saving}
            >
              無効にする
            </Button>
          ) : null}
          <Button variant="ghost" onClick={requestClose} disabled={saving || deactivating}>キャンセル</Button>
          <Button type="submit" form={formId} variant="primary" icon={editing ? 'check' : 'user-plus'} loading={saving} disabled={deactivating}>
            {editing ? '保存' : '追加'}
          </Button>
        </>
      )}
    >
      <form id={formId} onSubmit={submit} className="space-y-5" noValidate>
        {editing ? (
          <Banner tone="info">
            名前・役割・所属店舗・パスワードを変えたら、新しいURLを本人に送ってください。表示される名前やパスワードの入力画面は、新しいURLから切り替わります。
          </Banner>
        ) : null}

        <Field label="名前" required htmlFor={`${uid}-name`} error={errors.name}>
          <Input
            id={`${uid}-name`}
            value={name}
            onChange={(e) => { setName(e.target.value); if (errors.name) setErrors((x) => ({ ...x, name: undefined })); }}
            placeholder="例: 田中 太郎"
            autoComplete="off"
            maxLength={40}
            aria-invalid={errors.name ? 'true' : undefined}
          />
        </Field>

        <fieldset>
          <legend className="field-label">役割</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {ROLES.map((r) => {
              const checked = role === r.value;
              return (
                <label
                  key={r.value}
                  className={cx(
                    'flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 transition-colors',
                    checked ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-500/15' : 'border-line hover:border-line-strong',
                  )}
                >
                  <input
                    type="radio"
                    name={`${uid}-role`}
                    value={r.value}
                    checked={checked}
                    onChange={() => changeRole(r.value)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                      <Icon name={r.icon} size={14} className={checked ? 'text-brand-600 dark:text-brand-300' : 'text-muted'} />
                      {ROLE_LABELS[r.value]}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-muted">{r.desc}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="field-label">
            所属店舗
            {role !== 'headquarter' ? <span className="ml-0.5 text-[#c43434]" aria-hidden="true">*</span> : null}
          </legend>
          {role === 'headquarter' ? (
            <p className="mb-2 text-xs text-muted">本部は所属店舗に関係なく、全店舗を閲覧できます。</p>
          ) : role === 'manager' ? (
            <p className="mb-2 text-xs text-muted">選んだ店舗のスタッフ全員の実績を閲覧できます。複数選べます。</p>
          ) : null}
          {options.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {options.map((o) => {
                const checked = storeIds.includes(o.id);
                return (
                  <label
                    key={o.id}
                    className={cx(
                      'flex min-w-0 cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-colors',
                      checked ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-500/15' : 'border-line hover:border-line-strong',
                    )}
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggleStore(o.id)} className="h-4 w-4 shrink-0 accent-brand-600" />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{o.name}</span>
                    {o.note ? <Badge tone="warn">{o.note}</Badge> : <span className="shrink-0 font-mono text-[11px] text-muted">{o.id}</span>}
                  </label>
                );
              })}
            </div>
          ) : (
            <Banner tone="warn">店舗が登録されていません。先に「店舗管理」で店舗を追加してください。</Banner>
          )}
          {errors.stores ? <p className="mt-1 text-xs font-medium text-[#b42323] dark:text-[#f08a8a]">{errors.stores}</p> : null}
        </fieldset>

        <div>
          <div className="mb-1.5 flex min-h-[24px] items-center justify-between gap-2">
            <label htmlFor={`${uid}-pw`} className="inline-flex items-center gap-2 text-xs font-semibold text-ink-2">
              パスワード
              {hadPassword && !clearPassword ? <Badge icon="lock">パスワードあり</Badge> : null}
            </label>
            {hadPassword && !clearPassword ? (
              <Button
                size="sm"
                variant="ghost"
                icon="lock-open"
                className="-my-1"
                onClick={() => { setClearPassword(true); setPassword(''); }}
              >
                パスワードを解除
              </Button>
            ) : null}
          </div>
          {clearPassword ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-line-strong bg-surface-2 px-3 py-2">
              <span className="flex items-center gap-2 text-[13px] text-ink-2">
                <Icon name="lock-open" size={15} className="text-muted" />
                保存するとパスワードを解除します
              </span>
              <Button size="sm" variant="ghost" icon="undo-2" onClick={() => setClearPassword(false)}>取り消す</Button>
            </div>
          ) : (
            // 管理者が本人に伝えるための値なので見える入力にする（type=password だとブラウザが管理者のパスワードを自動入力しかねない）
            <Input
              id={`${uid}-pw`}
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={hadPassword ? '変更するときだけ入力' : '例: sise2024'}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              maxLength={64}
            />
          )}
          {pwHint ? <p className="mt-1 text-xs text-muted">{pwHint}</p> : null}
        </div>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------
// 自動でコピーできなかったときの URL 表示（手動コピー・共有・開く）
// ------------------------------------------------------------
function UrlModal({ data, onClose }) {
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = async () => {
    // モーダル内のタップは新しい操作として扱われるので、ここではコピーできることが多い
    const r = await copyText(data.url);
    if (r.ok) {
      showToast('コピーしました', 'success', 2000);
      onClose();
    } else {
      showToast('コピーできませんでした。URLを長押しして選択し、コピーしてください', 'error', 5000);
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: `${data.name} さんのスタッフURL`, url: data.url });
    } catch (_) {
      // 共有シートを閉じただけ
    }
  };

  return (
    <Modal
      open
      title={`${data.name} さんのURL`}
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" icon="external-link" onClick={() => window.open(data.url, '_blank', 'noopener,noreferrer')}>開く</Button>
          {canShare ? <Button variant="secondary" icon="share-2" onClick={share}>共有</Button> : null}
          <Button variant="primary" icon="copy" onClick={copy}>コピー</Button>
        </>
      )}
    >
      <p className="mb-3 text-[13px] leading-relaxed text-ink-2">
        ブラウザが自動のコピーを許可しませんでした。下のURLを選択してコピーするか、「コピー」をもう一度押してください。
      </p>
      <Textarea readOnly value={data.url} rows={4} className="break-all font-mono text-xs" onFocus={selectAll} aria-label="スタッフURL" />
    </Modal>
  );
}

// ------------------------------------------------------------
// 全員分の一括発行
// ------------------------------------------------------------
function BulkUrlModal({ state, onClose }) {
  const { running, total, results } = state;
  const issued = results.filter((r) => r.url);
  const failedCount = results.length - issued.length;
  const allText = issued.map((r) => `${r.name}: ${r.url}`).join('\n');
  const [manual, setManual] = useState(false);

  const copyAll = async () => {
    const r = await copyText(allText);
    if (r.ok) {
      showToast(`${issued.length}人分のURLをコピーしました`, 'success');
    } else {
      setManual(true);
      showToast('自動でコピーできませんでした。下の欄からコピーしてください', 'warning', 5000);
    }
  };

  const copyOne = async (row) => {
    const r = await copyText(row.url);
    if (r.ok) showToast(`${row.name} さんのURLをコピーしました`, 'success', 2000);
    else showToast('コピーできませんでした。URLを長押しして選択し、コピーしてください', 'error', 5000);
  };

  const pct = total > 0 ? Math.round((results.length / total) * 100) : 0;

  return (
    <Modal
      open
      title="URLの一括発行"
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>閉じる</Button>
          <Button variant="primary" icon="copy" onClick={copyAll} disabled={running || issued.length === 0}>全員分をコピー</Button>
        </>
      )}
    >
      {running ? (
        <div className="mb-4" role="status">
          <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink">
            <Spinner size={14} />
            発行中… {results.length} / {total}
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-brand-500 transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      ) : (
        <div className="mb-4">
          <p className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-ink">
            {issued.length}人分のURLを発行しました
            {failedCount > 0 ? <Badge tone="bad" icon="circle-alert">{failedCount}人分は失敗</Badge> : null}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">「全員分をコピー」で「名前: URL」の形にまとめてコピーできます。</p>
        </div>
      )}

      <ul className="divide-y divide-line rounded-xl border border-line">
        {results.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-ink">{r.name}</p>
              {r.url ? (
                <p className="select-all truncate font-mono text-[11px] text-muted" title={r.url}>{r.url}</p>
              ) : (
                <p className="text-xs text-[#b42323] dark:text-[#f08a8a]">{r.error}</p>
              )}
            </div>
            {r.url ? (
              <Button size="sm" variant="secondary" icon="copy" onClick={() => copyOne(r)}>コピー</Button>
            ) : (
              <Badge tone="bad" icon="circle-alert">失敗</Badge>
            )}
          </li>
        ))}
        {results.length === 0 ? <li className="px-3 py-2.5 text-xs text-muted">発行を始めています…</li> : null}
      </ul>

      {manual ? (
        <Textarea readOnly value={allText} rows={6} className="mt-3 font-mono text-xs" onFocus={selectAll} aria-label="全員分のURL" />
      ) : null}
    </Modal>
  );
}
