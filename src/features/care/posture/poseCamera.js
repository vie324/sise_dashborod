// ============================================================
// カメラ + MediaPipe Pose
// ------------------------------------------------------------
// MediaPipe は重い（モデル数十MB）ので、カメラを起動した時に初めて CDN から読む。
// バージョンは旧画面と同じものに固定（モデルファイルも同じバージョンから読む）。
// Pose のインスタンスはアプリ全体で 1 つだけ作り、姿勢分析と施術レポートの
// カメラで使い回す（同時に動くカメラは常に 1 つ）。
// ============================================================

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

const POSE_VERSION = '0.5.1675469404';
const POSE_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/pose@${POSE_VERSION}`;

// 超広角レンズを優先し、zoom を最小にして最大画角を確保する
const VIDEO_CONSTRAINTS = {
  width: { ideal: 1280 },
  height: { ideal: 960 },
  facingMode: { ideal: 'environment' },
  zoom: { ideal: 0.5 },
  advanced: [{ zoom: { min: 0.5, ideal: 0.5 } }],
};

class PoseLoadError extends Error {
  constructor() {
    super('MediaPipe の読み込みに失敗しました');
    this.name = 'PoseLoadError';
  }
}

let scriptPromise = null;
let posePromise = null;
let poseListener = null;

function loadScript() {
  if (window.Pose) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const sc = document.createElement('script');
      sc.src = `${POSE_BASE}/pose.js`;
      sc.onload = resolve;
      sc.onerror = () => {
        sc.remove();
        reject(new PoseLoadError());
      };
      document.head.appendChild(sc);
    })
      // 旧画面と同じく、スクリプト評価直後は内部の初期化が終わっていないことがあるので少し待つ
      .then(() => new Promise((r) => setTimeout(r, 500)))
      .catch((e) => {
        scriptPromise = null;
        throw e;
      });
  }
  return scriptPromise;
}

function getPose() {
  if (!posePromise) {
    posePromise = (async () => {
      await loadScript();
      if (!window.Pose) throw new PoseLoadError();
      const pose = new window.Pose({ locateFile: (f) => `${POSE_BASE}/${f}` });
      pose.setOptions({
        modelComplexity: 2,
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.7,
      });
      pose.onResults((r) => { if (poseListener) poseListener(r); });
      await pose.initialize();
      return pose;
    })().catch((e) => {
      posePromise = null;
      throw e instanceof PoseLoadError ? e : Object.assign(new PoseLoadError(), { cause: e });
    });
  }
  return posePromise;
}

/** カメラ起動の失敗をスタッフ向けの日本語にする */
export function cameraErrorMessage(e) {
  const name = e && e.name;
  if (name === 'PoseLoadError') return 'AI（姿勢推定）の読み込みに失敗しました。通信状況を確認して、もう一度お試しください。';
  if (name === 'UnsupportedError') return 'このブラウザではカメラを使えません。Safari / Chrome の最新版で、https のページから開いてください。';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return 'カメラの使用が許可されていません。ブラウザ（iPad は「設定」>「Safari」>「カメラ」）でこのサイトのカメラを許可してください。';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return 'カメラが見つかりません。カメラ付きの端末（iPad・スマートフォン）でお試しください。';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return 'カメラを起動できませんでした。ほかのアプリがカメラを使っていないか確認してください。';
  }
  return `カメラの起動に失敗しました。${e && e.message ? `（${e.message}）` : ''}`;
}

/**
 * 直近数フレームのランドマークを平均して、撮影の瞬間のブレを抑える。
 * 3 フレーム以上ある時は、その点の visibility が最も低いフレームを外れ値として除く。
 */
export function averageLandmarks(frames) {
  if (!frames.length) return null;
  if (frames.length === 1) return frames[0];
  const count = frames[0].length;
  const out = [];
  for (let i = 0; i < count; i++) {
    const use = frames.length >= 3
      ? [...frames].sort((a, b) => a[i].visibility - b[i].visibility).slice(1)
      : frames;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let sv = 0;
    use.forEach((f) => {
      sx += f[i].x;
      sy += f[i].y;
      sz += f[i].z;
      sv += f[i].visibility;
    });
    const n = use.length;
    out.push({ x: sx / n, y: sy / n, z: sz / n, visibility: sv / n });
  }
  return out;
}

// ライブ中のランドマークと端末の傾きは毎フレーム変わるので、React の state ではなく
// 小さなストアに置き、重ね表示の部品だけが再描画されるようにする
function createLiveStore() {
  let state = { landmarks: null, tilt: null };
  const subs = new Set();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      subs.forEach((fn) => fn());
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useLiveValue(store, select) {
  const get = () => select(store.get());
  return useSyncExternalStore(store.subscribe, get, get);
}

/**
 * @param {{ bufferSize?: number, trackTilt?: boolean }} opts
 * @returns {{ videoRef, status: 'idle'|'loading'|'live', error: string, clearError, start, stop, capture, live }}
 */
export function usePoseCamera({ bufferSize = 5, trackTilt = false } = {}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(0);
  const runRef = useRef(0);
  const bufferRef = useRef([]);
  const orientationRef = useRef(null);
  const storeRef = useRef(null);
  if (!storeRef.current) storeRef.current = createLiveStore();
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState('');

  const release = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    if (orientationRef.current) {
      window.removeEventListener('deviceorientation', orientationRef.current);
      window.removeEventListener('deviceorientationabsolute', orientationRef.current);
      orientationRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    // 実行中の start() は世代番号が変わったことで途中終了する
    runRef.current += 1;
    release();
    storeRef.current.set({ landmarks: null, tilt: null });
    setStatus('idle');
  }, [release]);

  const start = useCallback(async () => {
    const run = ++runRef.current;
    const alive = () => run === runRef.current;
    release();
    bufferRef.current = [];
    storeRef.current.set({ landmarks: null, tilt: null });
    setError('');
    setStatus('loading');

    // iOS のジャイロ許可はユーザー操作の同期区間で要求する必要があるため、最初の await より前に呼ぶ
    let orientationPermission = null;
    if (trackTilt && typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      orientationPermission = DeviceOrientationEvent.requestPermission().then((p) => p === 'granted', () => false);
    }

    try {
      const orientationAllowed = orientationPermission ? await orientationPermission : trackTilt;
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        throw Object.assign(new Error('getUserMedia is not available'), { name: 'UnsupportedError' });
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS });
      if (!alive()) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0];
      if (track) {
        try {
          const caps = track.getCapabilities ? track.getCapabilities() : {};
          if (caps.zoom) await track.applyConstraints({ advanced: [{ zoom: caps.zoom.min }] });
        } catch (_) { /* zoom 非対応の端末は無視 */ }
      }
      const v = videoRef.current;
      if (!v || !alive()) return;
      v.srcObject = stream;
      await v.play();
      if (!alive()) return;

      const pose = await getPose();
      if (!alive()) return;
      poseListener = (r) => {
        if (!alive() || !r.poseLandmarks) return;
        const frame = r.poseLandmarks.map((l) => ({ x: l.x, y: l.y, z: l.z, visibility: l.visibility }));
        bufferRef.current.push(frame);
        if (bufferRef.current.length > bufferSize) bufferRef.current.shift();
        storeRef.current.set({ landmarks: frame });
      };
      setStatus('live');
      const detect = async () => {
        if (!alive() || !streamRef.current) return;
        try { await pose.send({ image: v }); } catch (_) { /* 1 フレームの失敗は無視して続ける */ }
        if (alive()) rafRef.current = requestAnimationFrame(detect);
      };
      detect();

      if (trackTilt && orientationAllowed) {
        const onOrientation = (e) => {
          if (e.beta == null && e.gamma == null) return;
          const next = { beta: Math.round(e.beta ?? 0), gamma: Math.round(e.gamma ?? 0) };
          const cur = storeRef.current.get().tilt;
          if (cur && cur.beta === next.beta && cur.gamma === next.gamma) return;
          storeRef.current.set({ tilt: next });
        };
        orientationRef.current = onOrientation;
        window.addEventListener('deviceorientation', onOrientation);
        window.addEventListener('deviceorientationabsolute', onOrientation);
      }
    } catch (e) {
      if (!alive()) return;
      console.warn('[姿勢分析] カメラ起動エラー:', e);
      release();
      setStatus('idle');
      setError(cameraErrorMessage(e));
    }
  }, [release, trackTilt, bufferSize]);

  /** 今の映像を JPEG にし、直近フレームを平均したランドマークと一緒に返してカメラを止める */
  const capture = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d').drawImage(v, 0, 0);
    const image = c.toDataURL('image/jpeg', 0.92);
    const landmarks = averageLandmarks(bufferRef.current);
    stop();
    return { image, landmarks };
  }, [stop]);

  const clearError = useCallback(() => setError(''), []);

  useEffect(() => () => {
    runRef.current += 1;
    release();
  }, [release]);

  return { videoRef, status, error, clearError, start, stop, capture, live: storeRef.current };
}
