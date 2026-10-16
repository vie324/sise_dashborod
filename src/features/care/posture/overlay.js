// ============================================================
// 骨格・スコア表示の位置計算（画面の重ね表示と保存画像の合成で共用）
// ============================================================

import { POSTURE_LM as L, mid } from './scoring.js';

// ビューごとに分析で使う線と点だけを描く（背面は専用の三角形パターン）
export const VIEW_CONNECTIONS = {
  front: [[11, 12], [11, 23], [12, 24], [23, 24]], // 肩ライン・体幹・腰ライン
  back: [],
  side: [[11, 23], [23, 25], [25, 27]], // 肩→腰→膝→足首
  seated: [[11, 23], [11, 13]], // 肩→腰、肩→肘
};

export const VIEW_POINTS = {
  front: [L.NOSE, L.LEFT_SHOULDER, L.RIGHT_SHOULDER, L.LEFT_HIP, L.RIGHT_HIP],
  back: [],
  side: [L.LEFT_EAR, L.LEFT_SHOULDER, L.LEFT_HIP, L.LEFT_KNEE, L.LEFT_ANKLE],
  seated: [L.NOSE, L.LEFT_EAR, L.LEFT_SHOULDER, L.LEFT_HIP, L.LEFT_ELBOW],
};

// 手動修正できるポイント（分析に使うものだけ）
export const EDITABLE_POINTS = {
  front: [
    { idx: L.NOSE, label: '鼻' },
    { idx: L.LEFT_SHOULDER, label: '左肩' },
    { idx: L.RIGHT_SHOULDER, label: '右肩' },
    { idx: L.LEFT_HIP, label: '左腰' },
    { idx: L.RIGHT_HIP, label: '右腰' },
  ],
  back: [
    { idx: L.NOSE, label: '頭頂' },
    { idx: L.LEFT_SHOULDER, label: '左肩' },
    { idx: L.RIGHT_SHOULDER, label: '右肩' },
    { idx: L.LEFT_HIP, label: '左腰' },
    { idx: L.RIGHT_HIP, label: '右腰' },
  ],
  side: [
    { idx: L.LEFT_EAR, label: '左耳' },
    { idx: L.LEFT_SHOULDER, label: '左肩' },
    { idx: L.LEFT_HIP, label: '大転子' },
    { idx: L.LEFT_KNEE, label: '左膝' },
    { idx: L.LEFT_ANKLE, label: '左足首' },
  ],
  seated: [
    { idx: L.NOSE, label: '鼻' },
    { idx: L.LEFT_EAR, label: '左耳' },
    { idx: L.LEFT_SHOULDER, label: '左肩' },
    { idx: L.LEFT_HIP, label: '左腰' },
    { idx: L.LEFT_ELBOW, label: '左肘' },
  ],
};

export const isVisible = (l) => !!l && !(l.visibility < 0.5);

/** 撮影後の骨格線を、その線に対応する項目のスコア色で塗るための対応表 */
export function connectionItemKey(viewMode, a, b) {
  if (viewMode === 'front') {
    if (a === 11 || b === 12) return 'shoulder';
    if (a === 23 || b === 24) return 'hip';
    return null;
  }
  if (a === 11 && b === 23) return 'shoulder';
  if (a === 23 && b === 25) return 'hip';
  if (a === 25 && b === 27) return 'knee';
  return null;
}

/**
 * 各項目のスコアラベルを置く位置（0〜1 の画像座標）。
 * align: 'center' は点の上に中央揃え、'left' は点の右側に置く。
 * 保存画像（Canvas）は文字が相対的に大きいので少し離して置く。
 */
export function itemAnchor(item, viewMode, lm, forCanvas = false) {
  if (!lm) return null;
  const o = forCanvas
    ? { sh: 0.035, hip: 0.025, head: 0.045, aside: 0.13, near: 0.09, trunk: 0.11 }
    : { sh: 0.03, hip: 0.02, head: 0.04, aside: 0.12, near: 0.08, trunk: 0.1 };
  const ls = lm[L.LEFT_SHOULDER];
  const rs = lm[L.RIGHT_SHOULDER];
  const lh = lm[L.LEFT_HIP];
  const rh = lm[L.RIGHT_HIP];
  const nose = lm[L.NOSE];
  const ear = lm[L.LEFT_EAR];
  const knee = lm[L.LEFT_KNEE];
  const k = item.key;

  if (viewMode === 'front' || viewMode === 'back') {
    if (k === 'shoulder' && ls && rs) return { x: (ls.x + rs.x) / 2, y: Math.min(ls.y, rs.y) - o.sh, align: 'center' };
    if (k === 'hip' && lh && rh) return { x: (lh.x + rh.x) / 2, y: Math.min(lh.y, rh.y) - o.hip, align: 'center' };
    if (viewMode === 'front' && k === 'head' && nose) return { x: nose.x, y: nose.y - o.head, align: 'center' };
    if (viewMode === 'back' && k === 'spine' && nose && ls && rs) {
      const sm = mid(ls, rs);
      return { x: (nose.x + sm.x) / 2 + o.aside, y: (nose.y + sm.y) / 2, align: 'left' };
    }
    if ((k === 'center' || k === 'trunk') && ls && rs && lh && rh) {
      const sm = mid(ls, rs);
      const hm = mid(lh, rh);
      return { x: (sm.x + hm.x) / 2 + o.aside, y: (sm.y + hm.y) / 2, align: 'left' };
    }
    return null;
  }

  if (k === 'head' && ear) return { x: ear.x, y: ear.y - o.head, align: 'center' };
  if (k === 'shoulder' && ls) return { x: ls.x + o.near, y: ls.y, align: 'left' };
  if (viewMode === 'side') {
    if (k === 'hip' && lh) return { x: lh.x + o.near, y: lh.y, align: 'left' };
    if (k === 'knee' && knee) return { x: knee.x + o.near, y: knee.y, align: 'left' };
    return null;
  }
  if (k === 'trunk' && ls && lh) return { x: (ls.x + lh.x) / 2 + o.trunk, y: (ls.y + lh.y) / 2, align: 'left' };
  if (k === 'posture' && lh) return { x: lh.x + o.near, y: lh.y, align: 'left' };
  return null;
}

/**
 * object-fit: cover で表示している写真・映像の「元画像全体」が、表示枠のどこに
 * 来るか（はみ出した部分は枠の外）。ランドマークは元画像基準の 0〜1 なので、
 * この矩形の中に重ねれば映像と骨格の位置がずれない。
 */
export function coverBox(mediaW, mediaH, boxW, boxH) {
  if (!mediaW || !mediaH || !boxW || !boxH) return { left: 0, top: 0, width: boxW || 0, height: boxH || 0 };
  const s = Math.max(boxW / mediaW, boxH / mediaH);
  const width = mediaW * s;
  const height = mediaH * s;
  return { left: (boxW - width) / 2, top: (boxH - height) / 2, width, height };
}
