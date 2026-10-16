import { useCallback, useMemo, useState } from 'react';
import { Banner, Button, Modal, Segmented, Spinner } from '../../../ui/primitives.jsx';
import Icon from '../../../ui/Icon.jsx';
import { VIEW_LABELS, analyzePosture, getTotal, scoreColor } from '../posture/scoring.js';
import { usePoseCamera } from '../posture/poseCamera.js';
import PoseViewport, { LiveBadge, LiveSkeleton, SkeletonSvg } from '../posture/PoseViewport.jsx';
import { ScorePill } from '../posture/ScoreBits.jsx';

// ============================================================
// 施術レポートの「姿勢分析カメラで撮影」
// 撮影した写真をレポートに載せ、総合スコアを ★姿勢 の点数（0〜5）に反映する。
// ============================================================

const VIEW_OPTIONS = [
  { value: 'front', label: '正面' },
  { value: 'side', label: '側面' },
];

export default function PostureCameraModal({ open, onClose, onApply }) {
  const cam = usePoseCamera();
  const { stop: stopCam } = cam;
  const [viewMode, setViewMode] = useState('front');
  const [captured, setCaptured] = useState(null); // { image, landmarks }

  const analysis = useMemo(() => (captured && captured.landmarks ? analyzePosture(viewMode, captured.landmarks) : null), [captured, viewMode]);
  const total = analysis ? getTotal(analysis) : null;
  const phase = captured ? 'captured' : cam.status;

  const close = useCallback(() => {
    stopCam();
    setCaptured(null);
    onClose();
  }, [stopCam, onClose]);

  const start = () => {
    setCaptured(null);
    cam.start();
  };

  const take = () => {
    const r = cam.capture();
    if (r) setCaptured(r);
  };

  const apply = () => {
    if (!captured || !analysis) return;
    onApply({ image: captured.image, analysis, viewMode });
    close();
  };

  return (
    <Modal open={open} onClose={close} title="姿勢分析カメラ" size="md">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Segmented value={viewMode} onChange={setViewMode} options={VIEW_OPTIONS} size="sm" ariaLabel="撮影方向" />
          <span className="text-xs text-muted">{viewMode === 'front' ? '正面全身を撮影' : '左側面から撮影'}</span>
        </div>

        <PoseViewport
          videoRef={cam.videoRef}
          phase={phase}
          image={captured ? captured.image : null}
          className="mx-auto w-full max-w-[calc(56vh*9/16)]"
          renderStage={({ width, height }) => (phase === 'live'
            ? <LiveSkeleton live={cam.live} viewMode={viewMode} width={width} height={height} full />
            : <SkeletonSvg landmarks={captured && captured.landmarks} viewMode={viewMode} width={width} height={height} full />)}
        >
          {phase === 'idle' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-white/60"><Icon name="camera" size={26} strokeWidth={1.5} /></div>
              <p className="text-xs text-white/60">{viewMode === 'front' ? '正面全身を撮影します' : '左側面から全身を撮影します'}</p>
              <Button variant="primary" icon="camera" onClick={start}>カメラ起動</Button>
            </div>
          ) : null}
          {phase === 'loading' ? (
            <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-3 bg-black/60 text-white" role="status">
              <Spinner size={28} className="text-brand-300" />
              <p className="text-sm">読み込み中…</p>
            </div>
          ) : null}
          {phase === 'live' ? (
            <>
              <LiveBadge live={cam.live} />
              <div className="absolute inset-x-0 bottom-0 z-10 flex gap-2 p-3" style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.7))' }}>
                <button type="button" onClick={take} className="flex-1 rounded-xl bg-brand-600/95 py-3 text-sm font-bold text-white shadow-lg hover:bg-brand-700">撮影・分析確定</button>
                <button type="button" onClick={stopCam} className="rounded-xl bg-white/90 px-4 py-3 text-sm font-bold text-[#3f4742] shadow-lg hover:bg-white">停止</button>
              </div>
            </>
          ) : null}
        </PoseViewport>

        {cam.error ? <Banner tone="bad" title="カメラを起動できません">{cam.error}</Banner> : null}

        {phase === 'captured' && !analysis ? (
          <Banner tone="warn" title="姿勢を検出できませんでした">全身が映るように位置を調整して、再撮影してください。</Banner>
        ) : null}

        {phase === 'captured' && analysis ? (
          <div className="space-y-2 rounded-xl border border-line bg-surface-2 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-ink">{VIEW_LABELS[viewMode]}分析結果</span>
              {total != null ? (
                <span className="rounded-full px-2.5 py-0.5 text-sm font-bold text-white num" style={{ background: scoreColor(total) }}>{total}点</span>
              ) : <span className="text-xs text-muted">判定不可</span>}
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {analysis.items.map((item) => (
                <div key={item.key} className="flex items-center justify-between gap-2 rounded-lg bg-surface px-2.5 py-1.5 text-xs">
                  <span className="min-w-0 truncate text-ink-2">{item.label}</span>
                  <ScorePill score={item.score} low={item.confidence != null && item.confidence < 0.5} className="h-6 min-w-[36px] text-xs" />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {phase === 'captured' ? (
          <div className="flex gap-2">
            {analysis ? <Button variant="primary" icon="check" className="flex-1" onClick={apply}>レポートに反映</Button> : null}
            <Button icon="rotate-ccw" className={analysis ? '' : 'flex-1'} onClick={start}>再撮影</Button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
