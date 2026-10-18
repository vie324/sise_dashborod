import { useCallback, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, Field, Input, Segmented, Select, Textarea, cx } from '../../../ui/primitives.jsx';
import Icon from '../../../ui/Icon.jsx';
import { confirmDialog, showToast } from '../../../ui/feedback.jsx';
import { addDays, isDate, todayJst } from '../../../../shared/dates.js';
import { VIEW_LABELS, getTotal, toFivePointScale } from '../posture/scoring.js';
import { ScorePill } from '../posture/ScoreBits.jsx';
import OutputActions from '../shared/OutputActions.jsx';
import PrintPortal from '../shared/PrintPortal.jsx';
import { fileNamePart } from '../shared/exportImage.js';
import { initialCustomerName, initialStaffName, useSharedCustomerName } from '../shared/prefill.js';
import { dotDate, honorific } from '../shared/labels.js';
import ReportPreviewCard from './ReportPreviewCard.jsx';
import PostureCameraModal from './PostureCameraModal.jsx';
import {
  COMMENT_TEMPLATES, COUPONS, COUPON_OPTIONS, COUPON_VALID_DAYS, DEFAULT_COMMENT, DEFAULT_MENU_CHECKS, EMPTY_SCORES,
  MENUS, SCORE_ITEMS, STRETCHES, STRETCH_CATEGORIES, TEMPLATE_OPTIONS, textLines,
} from './reportData.js';

// ============================================================
// 施術レポート（お客様にお渡しするアフターケアシート）
// ------------------------------------------------------------
// 左で入力 → 右のプレビューをそのまま画像保存・共有・印刷する。
// 狭い画面（スマホ・縦向き iPad）では「入力・編集」と「プレビュー」を切り替える。
// 写真は端末の中だけで扱い、どこにもアップロードしない。
// ============================================================

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const PREVIEW_WIDTH = 400;
const PANES = [
  { value: 'edit', label: '入力・編集', icon: 'square-pen' },
  { value: 'preview', label: 'プレビュー', icon: 'eye' },
];

function Section({ no, title, hint, children, actions }) {
  return (
    <Card title={`${no} ${title}`} subtitle={hint} actions={actions}>
      {children}
    </Card>
  );
}

function couponExpiryOf(visitDate) {
  if (!isDate(visitDate)) return '日付未設定';
  return addDays(visitDate, COUPON_VALID_DAYS).replace(/-/g, '.');
}

export default function TreatmentReport({ active = true }) {
  const [customerName, setCustomerName] = useState(initialCustomerName);
  useSharedCustomerName(setCustomerName);
  const [staffName, setStaffName] = useState(initialStaffName);
  const [visitDate, setVisitDate] = useState(() => todayJst());
  const [menuChecks, setMenuChecks] = useState(DEFAULT_MENU_CHECKS);
  const [scores, setScores] = useState(EMPTY_SCORES);
  const [photo, setPhoto] = useState(null); // { data, name }
  const [templateKey, setTemplateKey] = useState('');
  const [coachComment, setCoachComment] = useState('');
  const [selectedStretches, setSelectedStretches] = useState({}); // 'cat-id' → true（選んだ順に並ぶ）
  const [customStretch, setCustomStretch] = useState('');
  const [coupon, setCoupon] = useState('none');
  const [pane, setPane] = useState('edit');
  const [cameraOpen, setCameraOpen] = useState(false);
  const [postureResult, setPostureResult] = useState(null); // { analysis, viewMode }
  const fileInputRef = useRef(null);
  const previewRef = useRef(null);

  // ---- 入力 ----
  const toggleMenu = (m) => setMenuChecks((prev) => ({ ...prev, [m]: !prev[m] }));
  const setScore = (key, value) => setScores((prev) => ({ ...prev, [key]: Number(value) }));
  const toggleStretch = (cat, id) => {
    const key = `${cat}-${id}`;
    setSelectedStretches((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
  };

  const applyTemplate = (key) => {
    setTemplateKey(key);
    if (key && COMMENT_TEMPLATES[key]) setCoachComment(COMMENT_TEMPLATES[key]);
  };

  const onPhotoSelected = (e) => {
    const input = e.target;
    const file = input.files && input.files[0];
    if (!file) return;
    // 画像以外（動画・PDF など）や巨大なファイルは data URL 化で画面が固まるため受け付けない
    if (!file.type || !file.type.startsWith('image/')) {
      showToast('画像ファイルを選択してください', 'error');
      input.value = '';
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      showToast(`画像サイズは10MB以下にしてください（現在: ${(file.size / 1024 / 1024).toFixed(1)}MB）`, 'error');
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => showToast('画像の読み込みに失敗しました', 'error');
    reader.onload = () => setPhoto({ data: reader.result, name: file.name });
    reader.readAsDataURL(file);
    // 同じファイルを選び直しても change が来るように
    input.value = '';
  };

  const clearPhoto = () => setPhoto(null);

  const closeCamera = useCallback(() => setCameraOpen(false), []);
  const applyPosture = useCallback(({ image, analysis, viewMode }) => {
    setPhoto({ data: image, name: `姿勢分析_${viewMode}.jpg` });
    setPostureResult({ analysis, viewMode });
    const five = toFivePointScale(getTotal(analysis));
    if (five == null) {
      showToast('スコアを判定できなかったため、★姿勢の点数は変更していません', 'warning', 4500);
      return;
    }
    setScores((prev) => ({ ...prev, posture: five }));
    showToast(`写真と★姿勢のスコア（${five.toFixed(1)}）を反映しました`, 'success');
  }, []);

  const resetForm = async () => {
    const ok = await confirmDialog({ title: '入力リセット', message: '入力内容をすべてリセットしますか？', confirmLabel: 'リセット', variant: 'danger' });
    if (!ok) return;
    setCustomerName('');
    setStaffName(initialStaffName());
    setVisitDate(todayJst());
    setMenuChecks({ 骨盤矯正: false, 姿勢矯正: false, 小顔矯正: false, ほぐし: false });
    setScores(EMPTY_SCORES);
    setPhoto(null);
    setTemplateKey('');
    setCoachComment('');
    setSelectedStretches({});
    setCustomStretch('');
    setCoupon('none');
    setPostureResult(null);
    showToast('入力をリセットしました', 'info');
  };

  // ---- プレビュー用の値 ----
  const activeMenus = MENUS.filter((m) => menuChecks[m]);
  const activeStretches = useMemo(() => Object.keys(selectedStretches).map((key) => {
    const [cat, ...rest] = key.split('-');
    const id = rest.join('-');
    const item = (STRETCHES[cat] || []).find((s) => s.id === id);
    return item ? { ...item, cat } : null;
  }).filter(Boolean), [selectedStretches]);
  const couponInfo = COUPONS[coupon] || null;
  const couponExpiry = couponExpiryOf(visitDate);

  const previewProps = {
    displayName: honorific(customerName),
    displayDate: dotDate(visitDate),
    menus: activeMenus,
    scores,
    photo: photo ? photo.data : null,
    comment: coachComment || DEFAULT_COMMENT,
    stretches: activeStretches,
    customStretch,
    coupon: couponInfo,
    couponExpiry,
  };
  const contentKey = useMemo(
    () => ({}),
    [customerName, staffName, visitDate, menuChecks, scores, photo, coachComment, selectedStretches, customStretch, coupon],
  );
  const fileBase = `AfterCare_${fileNamePart(customerName, 'Customer')}_${visitDate || 'Date'}`;

  const showPreview = () => {
    setPane('preview');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const totalPosture = postureResult ? getTotal(postureResult.analysis) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 min-[1100px]:hidden">
        <Segmented value={pane} onChange={setPane} options={PANES} ariaLabel="表示の切り替え" />
      </div>

      <div className="grid gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,420px)] min-[1100px]:items-start">
        {/* 入力 */}
        <div className={cx('space-y-4', pane === 'edit' ? '' : 'hidden min-[1100px]:block')}>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-muted">入力するとプレビューにすぐ反映されます</p>
            <Button size="sm" variant="ghost" icon="rotate-ccw" onClick={resetForm}>入力をリセット</Button>
          </div>

          <Section no="①" title="基本情報">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="お客様名" htmlFor="tr-customer" className="col-span-2 sm:col-span-1">
                <Input id="tr-customer" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="例: 山田 花子" autoComplete="off" />
              </Field>
              <Field label="担当スタッフ" htmlFor="tr-staff">
                <Input id="tr-staff" value={staffName} onChange={(e) => setStaffName(e.target.value)} placeholder="例: 田中" autoComplete="off" />
              </Field>
              <Field label="来店日" htmlFor="tr-date">
                <Input id="tr-date" type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
              </Field>
            </div>
          </Section>

          <Section no="②" title="本日の施術" hint="当てはまるものを選択">
            <div className="grid grid-cols-2 gap-2">
              {MENUS.map((m) => (
                <label key={m} className={cx('flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors',
                  menuChecks[m] ? 'border-brand-300 bg-brand-500/10 text-brand-800 dark:border-brand-500/50 dark:text-brand-100' : 'border-line text-ink-2 hover:bg-surface-2')}>
                  <input type="checkbox" checked={!!menuChecks[m]} onChange={() => toggleMenu(m)} className="h-4 w-4 accent-brand-600" />
                  {m}
                </label>
              ))}
            </div>
          </Section>

          <Section no="③" title="現在の状態・課題" hint="0〜5.0点（0.5刻み）。レーダーチャートに反映されます">
            <div className="space-y-4">
              {SCORE_ITEMS.map((item) => (
                <div key={item.key}>
                  <div className="flex items-baseline justify-between gap-2">
                    <label htmlFor={`tr-score-${item.key}`} className="text-sm font-bold text-ink">{item.label}</label>
                    <span className="w-10 text-right text-sm font-bold text-brand-700 num dark:text-brand-300">{scores[item.key].toFixed(1)}</span>
                  </div>
                  <p className="text-[11px] text-muted">{item.sub}</p>
                  <input
                    id={`tr-score-${item.key}`}
                    type="range"
                    min="0"
                    max="5"
                    step="0.5"
                    value={scores[item.key]}
                    onChange={(e) => setScore(item.key, e.target.value)}
                    className="mt-1 w-full accent-brand-600"
                  />
                </div>
              ))}
            </div>
          </Section>

          <Section no="④" title="写真・姿勢分析" hint="任意">
            <div className="space-y-2.5">
              <button
                type="button"
                onClick={() => setCameraOpen(true)}
                className="flex w-full items-center gap-3 rounded-xl border border-brand-200 bg-brand-500/[0.06] p-3 text-left transition-colors hover:bg-brand-500/10 dark:border-brand-500/30"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white"><Icon name="person-standing" size={20} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-brand-800 dark:text-brand-100">姿勢分析カメラで撮影</span>
                  <span className="block text-[11px] text-brand-700/80 dark:text-brand-200/70">AI骨格検出＋姿勢スコアを自動反映</span>
                </span>
                <Icon name="chevron-right" size={16} className="text-brand-400" />
              </button>

              <div className="rounded-xl border border-dashed border-line-strong p-3">
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onPhotoSelected} />
                {photo ? (
                  <div className="flex items-center gap-3">
                    <img src={photo.data} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{photo.name}</p>
                      <p className="text-[11px] text-muted">この端末内だけで使います（アップロードしません）</p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                      <Button size="sm" icon="image" onClick={() => fileInputRef.current && fileInputRef.current.click()}>変更</Button>
                      <Button size="sm" variant="ghost" icon="trash-2" onClick={clearPhoto}>削除</Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1.5 py-1 text-center">
                    <Button size="sm" icon="image-plus" onClick={() => fileInputRef.current && fileInputRef.current.click()}>画像を選択</Button>
                    <span className="text-[11px] text-muted">Before/Afterや姿勢写真など</span>
                  </div>
                )}
              </div>

              {postureResult ? (
                <div className="rounded-xl border border-line bg-surface-2 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-brand-700 dark:text-brand-300">姿勢分析結果（{VIEW_LABELS[postureResult.viewMode]}）</span>
                    {totalPosture != null ? <ScorePill score={totalPosture} className="h-6 text-xs" /> : <Badge tone="warn">判定不可</Badge>}
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {postureResult.analysis.items.map((item) => (
                      <div key={item.key} className="flex items-center justify-between gap-1 rounded-lg bg-surface px-2 py-1 text-[11px]">
                        <span className="min-w-0 truncate font-semibold text-ink-2">{item.label}</span>
                        <span className="font-bold num" style={{ color: item.confidence != null && item.confidence < 0.5 ? '#a3a3a3' : undefined }}>{item.score}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted">→ ★姿勢スコアに自動反映済み</p>
                </div>
              ) : null}
            </div>
          </Section>

          <Section no="⑤" title="コメント / 次の目標">
            <Field label="テンプレート選択" htmlFor="tr-template" className="mb-3">
              <Select id="tr-template" value={templateKey} onChange={(e) => applyTemplate(e.target.value)}>
                <option value="">カスタム入力...</option>
                {TEMPLATE_OPTIONS.map((g) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.items.map((it) => <option key={it.value} value={it.value}>{it.label}</option>)}
                  </optgroup>
                ))}
              </Select>
            </Field>
            <Textarea
              aria-label="お客様へのコメント"
              value={coachComment}
              onChange={(e) => setCoachComment(e.target.value)}
              rows={5}
              placeholder="ここにお客様へのフィードバックを入力..."
            />
          </Section>

          <Section no="⑥" title="宿題ストレッチ" hint={activeStretches.length ? `${activeStretches.length}件選択中（選んだ順に表示）` : '選んだ順にプレビューへ並びます'}>
            <div className="space-y-2">
              {STRETCH_CATEGORIES.map((cat) => {
                const count = STRETCHES[cat.key].filter((s) => selectedStretches[`${cat.key}-${s.id}`]).length;
                return (
                  <details key={cat.key} className="group rounded-xl border border-line">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm font-bold text-ink hover:bg-surface-2">
                      <span className="flex items-center gap-2">
                        {cat.label}
                        {count ? <Badge tone="brand">{count}</Badge> : null}
                      </span>
                      <Icon name="chevron-down" size={16} className="text-muted transition-transform group-open:rotate-180" />
                    </summary>
                    <div className="grid gap-1 border-t border-line p-2">
                      {STRETCHES[cat.key].map((s) => {
                        const checked = !!selectedStretches[`${cat.key}-${s.id}`];
                        const preview = textLines(s.text).join(' ');
                        return (
                          <label key={s.id} className={cx('flex cursor-pointer items-start gap-2.5 rounded-lg p-2 transition-colors', checked ? 'bg-brand-500/10' : 'hover:bg-surface-2')}>
                            <input type="checkbox" checked={checked} onChange={() => toggleStretch(cat.key, s.id)} className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600" />
                            <span className="min-w-0">
                              <span className="block text-[13px] font-bold text-ink">{s.title}</span>
                              <span className="mt-0.5 block text-[11px] text-muted">{preview.length > 30 ? `${preview.slice(0, 30)}…` : preview}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </details>
                );
              })}
            </div>
            <Field label="自由記述（任意）" htmlFor="tr-custom-stretch" className="mt-4">
              <Textarea
                id="tr-custom-stretch"
                value={customStretch}
                onChange={(e) => setCustomStretch(e.target.value)}
                rows={3}
                placeholder="フォーマット以外の宿題やストレッチを自由に記載できます..."
              />
            </Field>
          </Section>

          <Section no="⑦" title="次回クーポン" hint={`任意。有効期限は来店日から${COUPON_VALID_DAYS}日`}>
            <div className="grid gap-2" role="radiogroup" aria-label="次回クーポン">
              {COUPON_OPTIONS.map((opt) => (
                <label key={opt.value} className={cx('flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors',
                  coupon === opt.value ? 'border-brand-300 bg-brand-500/10 dark:border-brand-500/50' : 'border-line hover:bg-surface-2')}>
                  <input type="radio" name="tr-coupon" checked={coupon === opt.value} onChange={() => setCoupon(opt.value)} className="h-4 w-4 accent-brand-600" />
                  <span>
                    <span className="block text-sm font-bold text-ink">{opt.label}</span>
                    {opt.desc ? <span className="block text-xs text-brand-700 dark:text-brand-300">{opt.desc}</span> : null}
                  </span>
                </label>
              ))}
            </div>
          </Section>

          <Button variant="primary" size="lg" icon="eye" className="w-full min-[1100px]:hidden" onClick={showPreview}>プレビューを確認</Button>
        </div>

        {/* プレビュー */}
        <div className={cx('space-y-3', pane === 'preview' ? '' : 'hidden min-[1100px]:block')}>
          <div className="card card-pad">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink">
                <Icon name="file-heart" size={17} className="text-brand-600 dark:text-brand-300" />
                アフターケアシート
              </h2>
              <span className="text-[11px] text-muted">このまま画像になります</span>
            </div>
            <OutputActions targetRef={previewRef} fileBase={fileBase} exportWidth={PREVIEW_WIDTH} contentKey={contentKey} shareTitle="アフターケアシート" />
          </div>
          <div className="mx-auto w-full" style={{ maxWidth: PREVIEW_WIDTH }}>
            <ReportPreviewCard ref={previewRef} {...previewProps} />
          </div>
        </div>
      </div>

      <PostureCameraModal open={cameraOpen} onClose={closeCamera} onApply={applyPosture} />
      {active ? (
        <PrintPortal width={440}>
          <ReportPreviewCard {...previewProps} />
        </PrintPortal>
      ) : null}
    </div>
  );
}
