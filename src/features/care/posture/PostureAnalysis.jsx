import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Banner, Button, Card, Field, Input, Spinner, cx } from '../../../ui/primitives.jsx';
import Icon from '../../../ui/Icon.jsx';
import { confirmDialog, showToast } from '../../../ui/feedback.jsx';
import { postJson } from '../../../lib/api.js';
import { todayJst } from '../../../../shared/dates.js';
import { VIEW_LABELS, VIEW_MODES, analyzePosture, getTotal } from './scoring.js';
import { EDITABLE_POINTS } from './overlay.js';
import { usePoseCamera } from './poseCamera.js';
import { useComposedImages } from './canvas.js';
import PoseViewport, { DrawLayer, EditHandles, GridOverlay, LiveBadge, LiveSkeleton, ScoreLabels, SkeletonSvg, TotalBadge } from './PoseViewport.jsx';
import { BeforeStrip, ComparisonResults, ComparisonThumbs, FlowSwitch, GuideCard, IDLE_HINTS, ResultsCard, ViewSwitch } from './PostureSections.jsx';
import PostureReportCard from './PostureReportCard.jsx';
import ReferenceModal from './ReferenceModal.jsx';
import ComparisonViewer from './ComparisonViewer.jsx';
import OutputActions from '../shared/OutputActions.jsx';
import PrintPortal from '../shared/PrintPortal.jsx';
import { downloadJson, fileNamePart } from '../shared/exportImage.js';
import { initialCustomerName, initialStaffName, useSharedCustomerName } from '../shared/prefill.js';

// ============================================================
// 姿勢分析
// ------------------------------------------------------------
// 背面カメラで撮影 → MediaPipe Pose で骨格を検出 → 正面・背面・側面・座位ごとに
// スコア化。施術前（Before）と施術後（After）を同じ向きで撮ると比較レポートになる。
// 写真はこの端末の中だけで扱い、サーバーには送らない（AI アドバイスは数値のみ送信）。
// ============================================================

const EMPTY_SLOTS = { front: null, back: null, side: null, seated: null };
const IDLE_ADVICE = { status: 'idle', text: '', error: null };
const DRAW_COLORS = [
  { color: '#E24B4A', label: '赤' },
  { color: '#3B82F6', label: '青' },
  { color: '#FBBF24', label: '黄' },
  { color: '#FFFFFF', label: '白' },
  { color: '#1E293B', label: '黒' },
];
const REPORT_WIDTH = 420;

function adviceError(e) {
  const status = e && e.status;
  const msg = String((e && e.message) || '');
  if (/ANTHROPIC_API_KEY/i.test(msg)) {
    return { title: 'AIアドバイスは現在使えません', message: 'AI の APIキーがサーバーに設定されていません。管理者に設定を依頼してください。', retry: false };
  }
  if (status === 401) return { title: 'ログインの有効期限が切れました', message: 'ページを再読み込みしてから、もう一度お試しください。', retry: false };
  if (status === 400) return { title: 'アドバイスを作れませんでした', message: '分析データが不足しています。撮影し直してからお試しください。', retry: false };
  if (status === 429) return { title: '混み合っています', message: '少し時間をおいてから、もう一度お試しください。', retry: true };
  if (status === 502 || status === 503 || status === 504) return { title: 'AI サービスに接続できませんでした', message: '時間をおいて、もう一度お試しください。', retry: true };
  if (status === 0) return { title: '通信できませんでした', message: msg || '通信状況を確認してください。', retry: true };
  return { title: 'アドバイスの生成に失敗しました', message: '時間をおいて、もう一度お試しください。', retry: true };
}

// 写真の上に重ねる操作ボタン（片手で撮影しながら押せるよう枠の下端に置く）
function OverlayButton({ tone = 'light', className = '', children, ...rest }) {
  const tones = {
    primary: 'bg-brand-600/95 text-white hover:bg-brand-700',
    gold: 'bg-gold-500/95 text-white hover:bg-gold-600',
    light: 'bg-white/90 text-[#3f4742] hover:bg-white',
  };
  return (
    <button type="button" className={cx('inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-3.5 text-sm font-bold shadow-lg transition-colors active:translate-y-px', tones[tone], className)} {...rest}>
      {children}
    </button>
  );
}

function BottomBar({ children, className = '' }) {
  return (
    <div className={cx('absolute inset-x-0 bottom-0 z-10 flex gap-2 p-3 sm:p-4', className)} style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.6))' }}>
      {children}
    </div>
  );
}

function ToggleRow({ items }) {
  return (
    <div className="flex gap-2 rounded-xl border border-line bg-surface p-2">
      {items.map((t) => (
        <button
          key={t.label}
          type="button"
          aria-pressed={t.on}
          onClick={() => t.set(!t.on)}
          className={cx('flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition-colors', t.on ? 'text-white shadow-sm' : 'bg-surface-3 text-muted hover:text-ink')}
          style={t.on ? { background: t.color } : undefined}
        >
          <Icon name={t.on ? 'check' : 'x'} size={13} strokeWidth={2.5} />
          {t.label}
        </button>
      ))}
    </div>
  );
}

export default function PostureAnalysis({ active = true }) {
  const cam = usePoseCamera({ trackTilt: true });
  const { stop: stopCam } = cam;

  const [customerName, setCustomerName] = useState(initialCustomerName);
  useSharedCustomerName(setCustomerName);
  const [staffName, setStaffName] = useState(initialStaffName);
  const [visitDate, setVisitDate] = useState(() => todayJst());

  const [viewMode, setViewMode] = useState('front');
  const [flowPhase, setFlowPhase] = useState('before');
  const [captured, setCaptured] = useState(null); // { image } 撮影直後の写真
  const [landmarks, setLandmarks] = useState(null); // 撮影時のランドマーク（手動修正を含む）
  const [overlayOn, setOverlayOn] = useState(true);
  const [scoreOverlayOn, setScoreOverlayOn] = useState(true);
  const [gridOn, setGridOn] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const editSnapshot = useRef(null);
  const [drawMode, setDrawMode] = useState(false);
  const [drawColor, setDrawColor] = useState(DRAW_COLORS[0].color);
  const [drawWidth, setDrawWidth] = useState(3);
  const [drawPaths, setDrawPaths] = useState([]);
  const [before, setBefore] = useState(EMPTY_SLOTS);
  const [after, setAfter] = useState(EMPTY_SLOTS);
  const [viewerKey, setViewerKey] = useState(null);
  const [refItem, setRefItem] = useState(null);
  const [advice, setAdvice] = useState(IDLE_ADVICE);
  const adviceReq = useRef(0);
  const reportRef = useRef(null);

  const phase = captured ? 'captured' : cam.status;
  const analysis = useMemo(() => (captured && landmarks ? analyzePosture(viewMode, landmarks) : null), [captured, landmarks, viewMode]);
  const total = analysis ? getTotal(analysis) : null;
  const viewLabel = VIEW_LABELS[viewMode];

  // 別のツールに切り替えたらカメラを止める（撮影データは残す）
  useEffect(() => { if (!active) stopCam(); }, [active, stopCam]);

  // 向きを変えた・撮り直した時は前の写真向けのアドバイスを消す
  useEffect(() => {
    adviceReq.current += 1;
    setAdvice(IDLE_ADVICE);
  }, [viewMode, captured]);

  const clearCapture = useCallback(() => {
    setCaptured(null);
    setLandmarks(null);
    setEditMode(false);
    setDrawMode(false);
    setDrawPaths([]);
    editSnapshot.current = null;
  }, []);

  const startCamera = () => {
    clearCapture();
    cam.start();
  };

  const takePhoto = () => {
    const r = cam.capture();
    if (!r) {
      showToast('カメラの映像を取得できませんでした。もう一度お試しください', 'error');
      return;
    }
    setCaptured({ image: r.image });
    setLandmarks(r.landmarks);
  };

  const resetCapture = () => {
    stopCam();
    clearCapture();
  };

  const changeView = (v) => {
    setViewMode(v);
    if (captured) clearCapture();
  };

  const changeFlow = (p) => {
    setFlowPhase(p);
    if (captured) clearCapture();
  };

  const saveToSlot = () => {
    if (!captured || !landmarks || !analysis) return;
    const data = {
      image: captured.image,
      landmarks: landmarks.map((l) => ({ ...l })),
      analysis: JSON.parse(JSON.stringify(analysis)),
    };
    if (flowPhase === 'before') setBefore((prev) => ({ ...prev, [viewMode]: data }));
    else setAfter((prev) => ({ ...prev, [viewMode]: data }));
    clearCapture();
    showToast(`${viewLabel}の${flowPhase === 'before' ? 'Before' : 'After'}を保存しました`, 'success');
  };

  const clearAll = async () => {
    const ok = await confirmDialog({
      title: '撮影データを消去',
      message: '保存した Before / After の写真と分析結果をすべて消去しますか？\nこの操作は元に戻せません。',
      confirmLabel: '消去する',
      variant: 'danger',
    });
    if (!ok) return;
    stopCam();
    clearCapture();
    setBefore(EMPTY_SLOTS);
    setAfter(EMPTY_SLOTS);
    setFlowPhase('before');
    setViewerKey(null);
  };

  // 位置の手動修正。キャンセルしたら修正前に戻す
  const startEdit = () => {
    editSnapshot.current = landmarks;
    setDrawMode(false);
    setOverlayOn(true);
    setEditMode(true);
  };
  const confirmEdit = () => {
    editSnapshot.current = null;
    setEditMode(false);
  };
  const cancelEdit = () => {
    if (editSnapshot.current) setLandmarks(editSnapshot.current);
    editSnapshot.current = null;
    setEditMode(false);
  };
  const moveLandmark = useCallback((idx, x, y) => {
    setLandmarks((prev) => (prev ? prev.map((l, i) => (i === idx ? { ...l, x, y } : l)) : prev));
  }, []);

  const toggleDraw = () => {
    if (drawMode) {
      setDrawMode(false);
    } else {
      setEditMode(false);
      setDrawMode(true);
    }
  };

  const generateAdvice = async () => {
    if (!analysis || advice.status === 'loading') return;
    const req = ++adviceReq.current;
    setAdvice({ status: 'loading', text: '', error: null });
    try {
      const r = await postJson('/api/claude/advice', { analysisData: analysis, viewMode, customerName });
      if (req !== adviceReq.current) return;
      const text = String((r && r.advice) || '').trim();
      if (!text) {
        setAdvice({ status: 'error', text: '', error: { title: 'アドバイスを作れませんでした', message: 'AI から回答がありませんでした。もう一度お試しください。', retry: true } });
        return;
      }
      setAdvice({ status: 'done', text, error: null });
    } catch (e) {
      if (req !== adviceReq.current) return;
      console.warn('[姿勢分析] AIアドバイスの取得に失敗:', e);
      setAdvice({ status: 'error', text: '', error: adviceError(e) });
    }
  };

  // ---- 比較・レポート ----
  const pairs = useMemo(
    () => VIEW_MODES.filter((v) => before[v] && after[v]).map((v) => ({ key: v, label: VIEW_LABELS[v], before: before[v], after: after[v] })),
    [before, after],
  );
  const hasBefore = VIEW_MODES.some((v) => before[v]);
  const reportMode = pairs.length ? 'comparison' : analysis && total != null ? 'single' : null;

  const composeEntries = useMemo(() => {
    if (reportMode === 'comparison') {
      return pairs.flatMap((p) => [
        { id: `${p.key}-before`, src: p.before.image, landmarks: p.before.landmarks, analysis: p.before.analysis, viewMode: p.key },
        { id: `${p.key}-after`, src: p.after.image, landmarks: p.after.landmarks, analysis: p.after.analysis, viewMode: p.key },
      ]);
    }
    if (reportMode === 'single') return [{ id: 'single', src: captured.image, landmarks, analysis, viewMode }];
    return [];
  }, [reportMode, pairs, captured, landmarks, analysis, viewMode]);
  // 位置修正のドラッグ中は合成し直さず、指を止めてから作る
  const composed = useComposedImages(composeEntries, scoreOverlayOn, editMode ? 400 : 120);

  const adviceText = advice.status === 'done' ? advice.text : '';
  const reportProps = {
    mode: reportMode,
    customerName,
    staffName,
    visitDate,
    viewMode,
    analysis,
    image: captured ? captured.image : null,
    pairs,
    images: composed,
    advice: adviceText,
  };
  const contentKey = useMemo(() => ({}), [reportMode, customerName, staffName, visitDate, viewMode, analysis, pairs, composed, adviceText]);

  const namePart = fileNamePart(customerName, 'posture');
  const datePart = (visitDate || todayJst()).replace(/-/g, '');
  const phaseLabel = flowPhase === 'after' ? 'After' : 'Before';
  const fileBase = reportMode === 'comparison' ? `BeforeAfter_${namePart}_${datePart}` : `Posture_${namePart}_${datePart}_${viewLabel}_${phaseLabel}`;

  const exportJson = () => {
    const exportedAt = new Date().toISOString();
    if (reportMode === 'comparison') {
      downloadJson({
        customerName,
        visitDate,
        staffName,
        pairs: pairs.map((p) => ({
          viewMode: p.key,
          viewLabel: p.label,
          before: { totalScore: getTotal(p.before.analysis), analysis: p.before.analysis },
          after: { totalScore: getTotal(p.after.analysis), analysis: p.after.analysis },
        })),
        exportedAt,
      }, `${fileBase}.json`);
    } else {
      downloadJson({ customerName, visitDate, staffName, viewMode, viewLabel, flowPhase, totalScore: total, analysis, exportedAt }, `${fileBase}.json`);
    }
    showToast('分析データ（JSON）を保存しました', 'success');
  };

  const hasResult = phase === 'captured' && !!analysis && total != null;
  const showScores = hasResult && scoreOverlayOn && !editMode;
  // Modal は onClose が変わるたびにフォーカスを当て直すので、参照を固定する
  const closeReference = useCallback(() => setRefItem(null), []);
  const closeViewer = useCallback(() => setViewerKey(null), []);

  return (
    <div className="space-y-4">
      <Card title="レポート情報" icon="user">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="お客様名" htmlFor="posture-customer">
            <Input id="posture-customer" value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="山田 花子" autoComplete="off" />
          </Field>
          <Field label="担当" htmlFor="posture-staff">
            <Input id="posture-staff" value={staffName} onChange={(e) => setStaffName(e.target.value)} placeholder="田中" autoComplete="off" />
          </Field>
          <Field label="日付" htmlFor="posture-date" className="col-span-2 sm:col-span-1">
            <Input id="posture-date" type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)} />
          </Field>
        </div>
      </Card>

      <div className="grid gap-4 min-[1100px]:grid-cols-[minmax(320px,400px)_minmax(0,1fr)] min-[1100px]:items-start">
        {/* 撮影 */}
        <div className="space-y-3">
          <FlowSwitch value={flowPhase} onChange={changeFlow} hasBefore={hasBefore} />
          {hasBefore ? <BeforeStrip before={before} onClear={clearAll} /> : null}
          <ViewSwitch value={viewMode} onChange={changeView} before={before} after={after} />

          <PoseViewport
            videoRef={cam.videoRef}
            phase={phase}
            image={captured ? captured.image : null}
            className="shadow-card"
            renderStage={({ width, height }) => (
              <>
                {overlayOn && phase === 'live' ? <LiveSkeleton live={cam.live} viewMode={viewMode} width={width} height={height} /> : null}
                {overlayOn && phase === 'captured' ? <SkeletonSvg landmarks={landmarks} viewMode={viewMode} analysis={analysis} width={width} height={height} /> : null}
                {showScores ? <ScoreLabels analysis={analysis} landmarks={landmarks} viewMode={viewMode} /> : null}
                {phase === 'captured' && editMode && landmarks ? <EditHandles landmarks={landmarks} points={EDITABLE_POINTS[viewMode]} onMove={moveLandmark} /> : null}
              </>
            )}
          >
            {gridOn && (phase === 'live' || phase === 'captured') ? <GridOverlay /> : null}
            {showScores ? <TotalBadge total={total} viewMode={viewMode} /> : null}

            {phase === 'idle' ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-white/60">
                  <Icon name="camera" size={28} strokeWidth={1.5} />
                </div>
                <p className="text-xs leading-relaxed text-white/60">{IDLE_HINTS[viewMode]}</p>
                <Button variant="primary" size="lg" icon="camera" onClick={startCamera}>カメラを起動</Button>
              </div>
            ) : null}

            {phase === 'loading' ? (
              <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-3 bg-black/60 px-6 text-center text-white" role="status">
                <Spinner size={32} className="text-brand-300" />
                <p className="text-sm font-semibold">カメラ・AI 読み込み中…</p>
                <p className="text-[11px] text-white/60">初回は AI モデルの読み込みに少し時間がかかります</p>
                <button type="button" onClick={stopCam} className="mt-1 text-xs text-white/70 underline hover:text-white">キャンセル</button>
              </div>
            ) : null}

            {phase === 'live' ? (
              <>
                <LiveBadge live={cam.live} showTilt />
                <BottomBar>
                  <OverlayButton tone="primary" className="flex-1" onClick={takePhoto}>
                    <Icon name="aperture" size={17} />撮影・分析を確定
                  </OverlayButton>
                  <OverlayButton onClick={stopCam}>停止</OverlayButton>
                </BottomBar>
              </>
            ) : null}

            {phase === 'captured' && !editMode ? (
              <div className="absolute right-3 top-3 z-[6] rounded-full bg-black/50 px-2.5 py-1 text-xs font-bold text-white">撮影済み</div>
            ) : null}

            {phase === 'captured' && drawMode ? (
              <>
                <DrawLayer paths={drawPaths} onCommit={setDrawPaths} color={drawColor} lineWidth={drawWidth} />
                <div className="absolute left-3 top-3 z-20 flex flex-col gap-2">
                  <div className="flex gap-1 rounded-xl bg-black/75 p-1.5">
                    {DRAW_COLORS.map((c) => (
                      <button
                        key={c.color}
                        type="button"
                        onClick={() => setDrawColor(c.color)}
                        aria-label={`${c.label}で描く`}
                        aria-pressed={drawColor === c.color}
                        className="h-7 w-7 shrink-0 rounded-lg transition-all"
                        style={{ background: c.color, border: drawColor === c.color ? '3px solid #fff' : '2px solid rgba(255,255,255,0.3)' }}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-1 rounded-xl bg-black/75 p-1.5 text-xs font-bold text-white">
                    {[{ w: 3, label: '細' }, { w: 7, label: '太' }].map((o) => (
                      <button key={o.w} type="button" onClick={() => setDrawWidth(o.w)} aria-pressed={drawWidth === o.w}
                        className={cx('rounded-lg px-3 py-1', drawWidth === o.w ? 'bg-white/25' : 'hover:bg-white/10')}>
                        {o.label}
                      </button>
                    ))}
                    <span className="mx-1 h-4 w-px bg-white/20" />
                    <button type="button" onClick={() => setDrawPaths((p) => p.slice(0, -1))} disabled={!drawPaths.length} className="rounded-lg px-3 py-1 hover:bg-white/10 disabled:opacity-40">戻す</button>
                    <button type="button" onClick={() => setDrawPaths([])} disabled={!drawPaths.length} className="rounded-lg px-3 py-1 hover:bg-white/10 disabled:opacity-40">クリア</button>
                  </div>
                </div>
              </>
            ) : null}

            {phase === 'captured' && editMode ? (
              <>
                <div className="absolute inset-x-2 top-2 z-[25] rounded-lg px-3 py-1.5 text-center text-xs font-bold text-white" style={{ background: 'rgba(255,107,107,0.92)' }}>
                  修正モード — ポイントをドラッグして調整
                </div>
                <BottomBar className="z-30">
                  <OverlayButton tone="primary" className="flex-1" onClick={confirmEdit}>修正を確定</OverlayButton>
                  <OverlayButton onClick={cancelEdit}>キャンセル</OverlayButton>
                </BottomBar>
              </>
            ) : null}

            {phase === 'captured' && !editMode && !drawMode ? (
              <BottomBar>
                {analysis ? (
                  <OverlayButton tone={flowPhase === 'before' ? 'primary' : 'gold'} className="flex-1" onClick={saveToSlot}>
                    <Icon name="save" size={16} />{flowPhase === 'before' ? 'Beforeを保存' : 'Afterを保存'}
                  </OverlayButton>
                ) : null}
                <OverlayButton tone={analysis ? 'light' : 'primary'} className={analysis ? '' : 'flex-1'} onClick={startCamera}>再撮影</OverlayButton>
                <OverlayButton onClick={resetCapture}>リセット</OverlayButton>
              </BottomBar>
            ) : null}
          </PoseViewport>

          {(phase === 'live' || phase === 'captured') && !editMode ? (
            <div className="space-y-2">
              <ToggleRow
                items={[
                  { label: '骨格', on: overlayOn, set: setOverlayOn, color: '#236c48' },
                  { label: '点数', on: scoreOverlayOn, set: setScoreOverlayOn, color: '#2a78d6' },
                  { label: '方眼', on: gridOn, set: setGridOn, color: '#c43434' },
                ]}
              />
              {phase === 'captured' ? (
                <div className="flex gap-2">
                  {analysis && landmarks && !drawMode ? (
                    <Button className="flex-1" icon="move" onClick={startEdit}>位置を修正</Button>
                  ) : null}
                  <Button className="flex-1" variant={drawMode ? 'gold' : 'secondary'} icon="pen-line" onClick={toggleDraw}>
                    {drawMode ? '手書きを終了' : '手書き'}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {cam.error ? (
            <Banner tone="bad" title="カメラを起動できません" action={<Button size="sm" icon="refresh-cw" onClick={startCamera}>再試行</Button>}>
              {cam.error}
            </Banner>
          ) : null}
          {phase === 'captured' && !landmarks ? (
            <Banner tone="warn" title="姿勢を検出できませんでした">
              全身が映るように立ち位置やカメラの角度を調整して、再撮影してください。
            </Banner>
          ) : null}
          {phase === 'captured' && analysis && total == null ? (
            <Banner tone="warn" title="スコアを計算できませんでした">
              検出の信頼度が低いため判定できません。明るい場所で全身が映るように撮り直してください。
            </Banner>
          ) : null}
        </div>

        {/* 結果・比較・レポート */}
        <div className="space-y-4">
          {/* 結果が出ていない間（撮影前・検出できなかった時）は撮り方を案内する */}
          {!hasResult ? <GuideCard flowPhase={flowPhase} viewMode={viewMode} /> : null}

          {hasResult ? (
            <ResultsCard
              viewMode={viewMode}
              flowPhase={flowPhase}
              analysis={analysis}
              total={total}
              advice={advice}
              onGenerateAdvice={generateAdvice}
              onCloseAdvice={() => setAdvice(IDLE_ADVICE)}
              onReference={setRefItem}
            />
          ) : null}

          {pairs.length ? (
            <>
              <ComparisonThumbs pairs={pairs} onOpen={setViewerKey} />
              <ComparisonResults pairs={pairs} onClear={clearAll} />
            </>
          ) : null}

          {reportMode ? (
            <Card
              title="お客様用レポート"
              icon="file-heart"
              subtitle={reportMode === 'comparison' ? 'Before / After の比較レポート' : `${viewLabel}の分析レポート`}
            >
              <OutputActions
                targetRef={reportRef}
                fileBase={fileBase}
                exportWidth={REPORT_WIDTH}
                contentKey={contentKey}
                shareTitle="姿勢分析レポート"
                extra={<Button variant="ghost" icon="file-json" onClick={exportJson}>分析データ(JSON)</Button>}
              />
              <div className="mt-4 flex justify-center">
                <div className="w-full" style={{ maxWidth: REPORT_WIDTH }}>
                  <PostureReportCard ref={reportRef} {...reportProps} />
                </div>
              </div>
            </Card>
          ) : null}
        </div>
      </div>

      <ReferenceModal item={refItem} onClose={closeReference} />
      {viewerKey ? <ComparisonViewer view={viewerKey} pairs={pairs} onChange={setViewerKey} onClose={closeViewer} /> : null}
      {active && reportMode ? (
        <PrintPortal width={520}>
          <PostureReportCard {...reportProps} />
        </PrintPortal>
      ) : null}
    </div>
  );
}
