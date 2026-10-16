import { useCallback, useId, useMemo, useRef, useState } from 'react';
import Icon from '../../ui/Icon.jsx';
import { Badge, Banner, Button, Card, EmptyState, Field, Input, Modal, cx } from '../../ui/primitives.jsx';
import { confirmDialog, showToast } from '../../ui/feedback.jsx';
import { dbPost } from '../../lib/api.js';
import { useStaffList } from '../../lib/hooks.js';
import { postChange, refreshAfterChange, useAllStores } from './settingsData.js';
import { FoldHeader, LoadError, RowsSkeleton } from './parts.jsx';

// ============================================================
// 店舗管理
// ------------------------------------------------------------
//   ・店舗の追加（ID・名前・メモ）、名前とメモのその場編集、無効化・復元
//   ・同じ名前の店舗の検出と統合（片方をもう片方の「別名」にする）、別名の解除
// 統合した店舗は status=inactive + merged_into=統合先 になる。発行済みのスタッフURLや
// 過去のデータはサーバーが別名を展開して読むのでそのまま使え、新しい出納帳の記録は
// 統合先へ寄る（api/_lib/stores.js）。
// ============================================================

// URL やクエリに載るので、記号や空白は入れさせない（既存の 'store-1' や '1' はこれで通る）
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

// 名前の表記ゆれ（全角・半角、空白、大文字・小文字）を吸収して同じ名前とみなす
const nameKey = (name) => String(name || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();

// 旧バージョンが自動で作った仮の名前（"店舗 N" / "(未登録: X)"）。正式な名前に直してもらう
const isPlaceholderName = (s) => s.name === `店舗 ${s.id}` || s.name === `(未登録: ${s.id})`;

const byCreated = (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''));

function createdDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('ja-JP');
}

export default function StoreSection() {
  const storesRes = useAllStores();
  const staffRes = useStaffList(true);
  const stores = storesRes.shown;

  const { active, inactive, merged, nameById, allIds } = useMemo(() => {
    const all = stores || [];
    return {
      active: all.filter((s) => s.status !== 'inactive' && !s.mergedInto),
      inactive: all.filter((s) => s.status === 'inactive' && !s.mergedInto),
      merged: all.filter((s) => s.mergedInto),
      nameById: new Map(all.map((s) => [String(s.id), s.name || String(s.id)])),
      allIds: new Set(all.map((s) => String(s.id))),
    };
  }, [stores]);

  // 有効なスタッフの所属人数（無効化の確認と、統合で残す店舗を選ぶときの目安）
  const staffCount = useMemo(() => {
    const m = new Map();
    for (const s of staffRes.shown || []) {
      if (s.status === 'inactive') continue;
      for (const id of s.storeIds || []) m.set(String(id), (m.get(String(id)) || 0) + 1);
    }
    return m;
  }, [staffRes.shown]);
  // スタッフ一覧を読めていないときは人数を出さない（0名と誤解させない）
  const countOf = (id) => (staffRes.shown ? staffCount.get(String(id)) || 0 : null);

  // 同じ名前の有効な店舗（統合済みの別名は除く）。手動で同じ店舗を二重に登録したときに起きる
  const dupGroups = useMemo(() => {
    const map = new Map();
    for (const s of active) {
      const key = nameKey(s.name);
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    }
    return [...map.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([key, list]) => ({ key, list: [...list].sort(byCreated) }));
  }, [active]);
  const dupIds = useMemo(() => new Set(dupGroups.flatMap((g) => g.list.map((s) => String(s.id)))), [dupGroups]);

  const [adding, setAdding] = useState(false);
  const [merging, setMerging] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [busy, setBusy] = useState(null); // 行ごとの処理中 { id, action }
  const [showInactive, setShowInactive] = useState(false);
  const [showMerged, setShowMerged] = useState(false);
  const inactiveListId = useId();
  const mergedListId = useId();

  // Modal は onClose が変わるたびに先頭の入力へフォーカスし直すので、固定の関数にする
  const openAdd = useCallback(() => setAdding(true), []);
  const closeAdd = useCallback(() => setAdding(false), []);
  const openMerge = useCallback(() => setMerging(true), []);
  const closeMerge = useCallback(() => setMerging(false), []);
  const onMerged = useCallback(() => setShowMerged(true), []);

  const saveEdit = async (store, values) => {
    if (values.name === store.name && values.memo === (store.memo || '')) {
      setEditingId(null);
      return;
    }
    setSavingEdit(true);
    const r = await postChange('stores', { action: 'updateStore', store: { id: store.id, ...values } }, { reload: storesRes.reload });
    setSavingEdit(false);
    if (!r) return;
    setEditingId(null);
    showToast(`「${values.name}」を保存しました`, 'success');
  };

  const deactivate = async (store) => {
    const n = countOf(store.id);
    const ok = await confirmDialog({
      title: `「${store.name}」を無効にしますか？`,
      message: '過去のデータはそのまま残り、「無効な店舗」からいつでも復元できます。'
        + (n > 0 ? `\nこの店舗には有効なスタッフが ${n} 名所属しています。必要に応じて所属店舗を変更してください。` : ''),
      confirmLabel: '無効にする',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy({ id: store.id, action: 'deactivate' });
    const r = await postChange('stores', { action: 'deleteStore', storeId: store.id }, { reload: storesRes.reload, errorLabel: '無効にできませんでした' });
    setBusy(null);
    if (!r) return;
    setEditingId(null);
    showToast(`「${store.name}」を無効にしました`, 'success');
  };

  const restore = async (store) => {
    setBusy({ id: store.id, action: 'restore' });
    const r = await postChange('stores', { action: 'restoreStore', storeId: store.id }, { reload: storesRes.reload, errorLabel: '復元できませんでした' });
    setBusy(null);
    if (r) showToast(`「${store.name}」を復元しました`, 'success');
  };

  const unmerge = async (store) => {
    const target = nameById.get(String(store.mergedInto)) || store.mergedInto;
    const ok = await confirmDialog({
      title: '別名を解除しますか？',
      message: `「${store.name}」を「${target}」から切り離し、独立した有効な店舗に戻します。`,
      confirmLabel: '解除する',
    });
    if (!ok) return;
    setBusy({ id: store.id, action: 'unmerge' });
    const r = await postChange(
      'stores',
      { action: 'unmergeStore', storeId: store.id, restoreActive: true },
      { reload: storesRes.reload, errorLabel: '解除できませんでした' },
    );
    setBusy(null);
    if (r) showToast(`「${store.name}」の別名を解除しました`, 'success');
  };

  const busyOf = (id) => (busy && busy.id === id ? busy.action : null);
  const loadingFirst = !stores && !storesRes.error;

  return (
    <Card
      title="店舗管理"
      icon="store"
      subtitle="店舗の追加・名前の変更・重複の統合"
      actions={<Button size="sm" variant="primary" icon="plus" onClick={openAdd}>店舗を追加</Button>}
    >
      {storesRes.error ? <LoadError error={storesRes.error} onRetry={storesRes.reload} /> : null}
      {loadingFirst ? <RowsSkeleton /> : null}

      {stores ? (
        <>
          {dupGroups.length > 0 ? (
            // Banner の title 付きだと本文が半透明になりボタンまで薄くなるので、見出しは本文側に置く
            <Banner tone="warn" className="mb-3">
              <p className="font-semibold">同じ名前の店舗が {dupGroups.length} 組あります</p>
              <ul className="mt-1 space-y-0.5">
                {dupGroups.map((g) => (
                  <li key={g.key} className="break-all">
                    <span className="font-semibold">{g.list[0].name}</span>
                    <span className="opacity-80">: {g.list.map((s) => s.id).join(' / ')}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 opacity-90">片方をもう片方の「別名」にまとめられます。発行済みのURLや過去のデータはそのまま使えます。</p>
              <Button size="sm" variant="secondary" icon="git-merge" className="mt-2.5" onClick={openMerge}>重複を統合</Button>
            </Banner>
          ) : null}

          <div className="-mx-4 border-t border-line sm:-mx-5">
            {active.length > 0 ? (
              <ul className="divide-y divide-line" aria-label="有効な店舗">
                {active.map((s) => (editingId === s.id ? (
                  <StoreEditRow
                    key={s.id}
                    store={s}
                    saving={savingEdit}
                    deactivating={busyOf(s.id) === 'deactivate'}
                    onSave={(values) => saveEdit(s, values)}
                    onDeactivate={() => deactivate(s)}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <StoreRow
                    key={s.id}
                    store={s}
                    staffCount={countOf(s.id)}
                    duplicate={dupIds.has(String(s.id))}
                    onEdit={() => setEditingId(s.id)}
                  />
                )))}
              </ul>
            ) : (
              <EmptyState
                compact
                icon="store"
                title="店舗が登録されていません"
                message="「店舗を追加」から登録してください。"
              />
            )}

            {inactive.length > 0 ? (
              <div className="border-t border-line">
                <FoldHeader
                  open={showInactive}
                  onToggle={() => setShowInactive((v) => !v)}
                  label={`無効な店舗（${inactive.length}件）`}
                  note="データは保持されています"
                  controls={inactiveListId}
                />
                {showInactive ? (
                  <ul id={inactiveListId} className="divide-y divide-line border-t border-line bg-surface-2/60" aria-label="無効な店舗">
                    {inactive.map((s) => (
                      <InactiveStoreRow key={s.id} store={s} busyAction={busyOf(s.id)} onRestore={() => restore(s)} />
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {merged.length > 0 ? (
              <div className="border-t border-line">
                <FoldHeader
                  open={showMerged}
                  onToggle={() => setShowMerged((v) => !v)}
                  label={`統合済みの店舗（${merged.length}件）`}
                  note="URLと過去のデータは有効なまま"
                  controls={mergedListId}
                />
                {showMerged ? (
                  <ul id={mergedListId} className="divide-y divide-line border-t border-line bg-surface-2/60" aria-label="統合済みの店舗">
                    {merged.map((s) => (
                      <MergedStoreRow
                        key={s.id}
                        store={s}
                        targetName={nameById.get(String(s.mergedInto)) || s.mergedInto}
                        busyAction={busyOf(s.id)}
                        onUnmerge={() => unmerge(s)}
                      />
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <div className="border-t border-line px-4 pt-4 sm:px-5">
              <p className="flex gap-1.5 text-xs leading-relaxed text-muted">
                <Icon name="info" size={14} className="mt-px" />
                <span>店舗を無効にするときは「編集」から行います。過去のデータはそのまま残り、いつでも復元できます。店舗IDはスタッフの所属や記録に使うため、あとから変更できません。</span>
              </p>
            </div>
          </div>
        </>
      ) : null}

      {adding ? <AddStoreModal existingIds={allIds} reload={storesRes.reload} onClose={closeAdd} /> : null}
      {merging ? (
        <MergeModal groups={dupGroups} countOf={countOf} reload={storesRes.reload} onClose={closeMerge} onMerged={onMerged} />
      ) : null}
    </Card>
  );
}

// ------------------------------------------------------------
// 一覧の行
// ------------------------------------------------------------
function StoreIcon({ icon = 'store', muted = false }) {
  return (
    <div
      aria-hidden="true"
      className={cx(
        'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
        muted ? 'bg-surface-3 text-muted' : 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-200',
      )}
    >
      <Icon name={icon} size={18} />
    </div>
  );
}

// 無効化はめったに使わないので行には出さず、編集を開いた中に置く（スタッフ管理と同じ）
function StoreRow({ store, staffCount, duplicate, onEdit }) {
  const placeholder = isPlaceholderName(store);
  return (
    <li className="flex items-start gap-3 px-4 py-3.5 sm:items-center sm:gap-4 sm:px-5">
      <StoreIcon />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="break-all text-sm font-semibold text-ink">{store.name}</span>
          {placeholder ? <Badge tone="warn" icon="triangle-alert">仮の名前</Badge> : null}
          {duplicate ? <Badge tone="warn" icon="copy">同じ名前あり</Badge> : null}
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
          <span className="break-all font-mono">ID: {store.id}</span>
          {staffCount != null ? <span className="inline-flex items-center gap-1"><Icon name="users" size={12} />スタッフ {staffCount}名</span> : null}
          {store.memo ? <span className="min-w-0 break-words">{store.memo}</span> : null}
        </p>
        {placeholder ? <p className="mt-1 text-xs text-[#7a5300] dark:text-[#f9d27a]">「編集」から正式な店舗名に変えてください。</p> : null}
      </div>
      <Button size="sm" variant="ghost" icon="pencil" className="shrink-0" onClick={onEdit}>編集</Button>
    </li>
  );
}

// 名前とメモのその場編集（Enter で保存・Esc で取り消し）
function StoreEditRow({ store, saving, deactivating, onSave, onDeactivate, onCancel }) {
  const uid = useId();
  const [name, setName] = useState(store.name || '');
  const [memo, setMemo] = useState(store.memo || '');
  const [error, setError] = useState('');

  const busy = saving || deactivating;

  const submit = (e) => {
    e.preventDefault();
    if (busy) return;
    const n = name.trim();
    if (!n) {
      setError('店舗名を入力してください');
      return;
    }
    onSave({ name: n, memo: memo.trim() });
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape' && !busy) onCancel();
  };

  return (
    <li className="bg-surface-2 px-4 py-3.5 sm:px-5">
      <form onSubmit={submit} onKeyDown={onKeyDown} className="space-y-3" noValidate aria-label={`${store.name} を編集`}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="店舗名" required htmlFor={`${uid}-name`} error={error} hint={`ID: ${store.id}（IDは変更できません）`}>
            <Input
              id={`${uid}-name`}
              autoFocus
              value={name}
              onChange={(e) => { setName(e.target.value); if (error) setError(''); }}
              maxLength={40}
              autoComplete="off"
              aria-invalid={error ? 'true' : undefined}
            />
          </Field>
          <Field label="メモ" htmlFor={`${uid}-memo`}>
            <Input id={`${uid}-memo`} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="例: 2024年4月オープン" maxLength={100} autoComplete="off" />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon="archive"
            className="!text-[#b42323] hover:!bg-[#fbe9e9] dark:!text-[#f08a8a] dark:hover:!bg-[#d03b3b]/15"
            onClick={onDeactivate}
            loading={deactivating}
            disabled={saving}
          >
            無効にする
          </Button>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>キャンセル</Button>
            <Button size="sm" type="submit" variant="primary" icon="check" loading={saving} disabled={deactivating}>保存</Button>
          </div>
        </div>
      </form>
    </li>
  );
}

function InactiveStoreRow({ store, busyAction, onRestore }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3.5 sm:items-center sm:gap-4 sm:px-5">
      <StoreIcon muted />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="break-all text-sm font-semibold text-muted">{store.name}</span>
          <Badge tone="bad" icon="ban">無効</Badge>
        </div>
        <p className="mt-1 break-all font-mono text-xs text-muted">ID: {store.id}</p>
      </div>
      <Button size="sm" variant="subtle" icon="rotate-ccw" className="shrink-0" loading={busyAction === 'restore'} disabled={!!busyAction} onClick={onRestore}>
        復元
      </Button>
    </li>
  );
}

function MergedStoreRow({ store, targetName, busyAction, onUnmerge }) {
  return (
    <li className="flex items-start gap-3 px-4 py-3.5 sm:items-center sm:gap-4 sm:px-5">
      <StoreIcon icon="git-merge" muted />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
          <span className="break-all font-semibold text-ink-2">{store.name}</span>
          <Icon name="arrow-right" size={14} className="text-muted" />
          <span className="sr-only">統合先:</span>
          <span className="break-all font-semibold text-ink">{targetName}</span>
          <Badge icon="git-merge">別名</Badge>
        </p>
        <p className="mt-1 break-all font-mono text-xs text-muted">ID: {store.id} → {store.mergedInto}</p>
      </div>
      <Button size="sm" variant="ghost" icon="unlink" className="shrink-0" loading={busyAction === 'unmerge'} disabled={!!busyAction} onClick={onUnmerge}>
        別名を解除
      </Button>
    </li>
  );
}

// ------------------------------------------------------------
// 店舗の追加
// ------------------------------------------------------------
function AddStoreModal({ existingIds, reload, onClose }) {
  const uid = useId();
  const formId = `${uid}-form`;
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [memo, setMemo] = useState('');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  const requestClose = useCallback(() => {
    if (!savingRef.current) onClose();
  }, [onClose]);

  const submit = async (e) => {
    e.preventDefault();
    if (savingRef.current) return;
    const n = name.trim();
    const i = id.trim();
    const errs = {};
    if (!n) errs.name = '店舗名を入力してください';
    if (i && !ID_PATTERN.test(i)) errs.id = '半角英数字・ハイフン・アンダースコアで入力してください';
    else if (i && existingIds.has(i)) errs.id = 'このIDは既に使われています（無効・統合済みの店舗を含む）';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    // 空欄なら旧画面と同じく時刻の base36 で作る
    const storeId = i || Date.now().toString(36);
    savingRef.current = true;
    setSaving(true);
    const r = await postChange(
      'stores',
      { action: 'addStore', store: { id: storeId, name: n, memo: memo.trim() } },
      { reload, errorLabel: '追加できませんでした' },
    );
    savingRef.current = false;
    setSaving(false);
    if (!r) return;
    showToast(`「${n}」を追加しました`, 'success');
    onClose();
  };

  const clearError = (key) => setErrors((x) => (x[key] ? { ...x, [key]: undefined } : x));

  return (
    <Modal
      open
      title="店舗を追加"
      onClose={requestClose}
      footer={(
        <>
          <Button variant="ghost" onClick={requestClose} disabled={saving}>キャンセル</Button>
          <Button type="submit" form={formId} variant="primary" icon="plus" loading={saving}>追加</Button>
        </>
      )}
    >
      <form id={formId} onSubmit={submit} className="space-y-4" noValidate>
        <Field label="店舗名" required htmlFor={`${uid}-name`} error={errors.name}>
          <Input
            id={`${uid}-name`}
            value={name}
            onChange={(e) => { setName(e.target.value); clearError('name'); }}
            placeholder="例: 本厚木店"
            maxLength={40}
            autoComplete="off"
            aria-invalid={errors.name ? 'true' : undefined}
          />
        </Field>
        <Field
          label="店舗ID"
          htmlFor={`${uid}-id`}
          error={errors.id}
          hint="空欄なら自動で作ります。スタッフの所属や記録に使うため、あとから変更できません。"
        >
          <Input
            id={`${uid}-id`}
            value={id}
            onChange={(e) => { setId(e.target.value); clearError('id'); }}
            placeholder="例: honatsugi（半角英数字）"
            maxLength={40}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            className="font-mono"
            aria-invalid={errors.id ? 'true' : undefined}
          />
        </Field>
        <Field label="メモ" htmlFor={`${uid}-memo`}>
          <Input id={`${uid}-memo`} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="例: 2024年4月オープン" maxLength={100} autoComplete="off" />
        </Field>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------
// 重複の統合（グループごとに残す店舗を選ぶ）
// ------------------------------------------------------------
function MergeModal({ groups, countOf, reload, onClose, onMerged }) {
  const uid = useId();
  // 残す店舗の初期値はいちばん古い店舗（過去のデータがつながっていることが多い）
  const [keep, setKeep] = useState(() => Object.fromEntries(groups.map((g) => [g.key, String(g.list[0].id)])));
  const [running, setRunning] = useState(false);
  const runningRef = useRef(false);

  const requestClose = useCallback(() => {
    if (!runningRef.current) onClose();
  }, [onClose]);

  const pairs = groups.flatMap((g) => {
    const canonicalId = keep[g.key] || String(g.list[0].id);
    return g.list
      .filter((s) => String(s.id) !== canonicalId)
      .map((s) => ({ duplicateId: String(s.id), canonicalId }));
  });

  const run = async () => {
    if (runningRef.current || pairs.length === 0) return;
    runningRef.current = true;
    setRunning(true);
    let done = 0;
    let firstError = '';
    for (const p of pairs) {
      const r = await dbPost('stores', { action: 'mergeStore', ...p });
      if (r && r.success) done += 1;
      else if (!firstError) firstError = (r && r.error) || '通信エラー';
    }
    await refreshAfterChange('stores', reload);
    runningRef.current = false;
    setRunning(false);
    if (done === pairs.length) showToast(`${done}件の店舗を統合しました`, 'success');
    else showToast(`${done}/${pairs.length}件を統合しました。失敗: ${firstError}`, 'error', 6000);
    if (done > 0) onMerged();
    onClose();
  };

  return (
    <Modal
      open
      size="lg"
      title="重複店舗の統合"
      onClose={requestClose}
      footer={(
        <>
          <Button variant="ghost" onClick={requestClose} disabled={running}>キャンセル</Button>
          <Button variant="primary" icon="git-merge" onClick={run} loading={running} disabled={pairs.length === 0}>
            {pairs.length}件を統合する
          </Button>
        </>
      )}
    >
      <p className="mb-4 text-[13px] leading-relaxed text-ink-2">
        グループごとに残す店舗を選んでください。選ばなかった店舗は、残す店舗の「別名」になります。
      </p>
      <div className="space-y-4">
        {groups.map((g) => (
          <fieldset key={g.key} className="rounded-xl border border-line px-3 pb-3 pt-1">
            <legend className="px-1 text-[13px] font-semibold text-ink">「{g.list[0].name}」（{g.list.length}件）</legend>
            <div className="mt-1 space-y-2">
              {g.list.map((s) => {
                const id = String(s.id);
                const checked = (keep[g.key] || String(g.list[0].id)) === id;
                const created = createdDate(s.createdAt);
                return (
                  <label
                    key={id}
                    className={cx(
                      'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 transition-colors',
                      checked ? 'border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-500/15' : 'border-line hover:border-line-strong',
                    )}
                  >
                    <input
                      type="radio"
                      name={`${uid}-${g.key}`}
                      checked={checked}
                      onChange={() => setKeep((k) => ({ ...k, [g.key]: id }))}
                      disabled={running}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-ink">
                        <span className="break-all">{s.name}</span>
                        {checked ? <Badge tone="brand" icon="check">残す</Badge> : <Badge icon="git-merge">別名になる</Badge>}
                      </span>
                      <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                        <span className="break-all font-mono">ID: {id}</span>
                        {countOf(id) != null ? <span>スタッフ {countOf(id)}名</span> : null}
                        {created ? <span>{created} 作成</span> : null}
                      </span>
                      {s.memo ? <span className="mt-0.5 block break-words text-xs text-muted">{s.memo}</span> : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      <Banner tone="info" className="mt-4">
        発行済みのスタッフURLや過去のデータはそのまま使え、新しい出納帳の記録は残す店舗に入ります。SalonOne との店舗の対応付けは残す店舗で設定してください。あとから「別名を解除」で元に戻せます。
      </Banner>
    </Modal>
  );
}
