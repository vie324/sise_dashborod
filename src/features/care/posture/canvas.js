// ============================================================
// 写真に骨格・スコアを描き込んだ画像を作る（レポート・保存用）
// ============================================================

import { useEffect, useState } from 'react';
import { POSTURE_LM as L, VIEW_LABELS, getTotal, isLowConfidence, mid, scoreColor, scoreColorOnDark, scoreLabel } from './scoring.js';
import { VIEW_CONNECTIONS, VIEW_POINTS, isVisible, itemAnchor } from './overlay.js';

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
}

function dot(ctx, x, y, r, w) {
  ctx.fillStyle = '#0F6E56';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1.5, Math.round(w / 400));
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/** 骨格（分析に使う線と点）を描く */
export function drawSkeletonOnCanvas(ctx, w, h, landmarks, viewMode) {
  if (!landmarks) return;
  ctx.lineCap = 'round';
  const lineW = Math.max(2, Math.round(w / 200));
  const r = Math.max(4, Math.round(w / 120));

  if (viewMode === 'back') {
    // 背面: 肩と骨盤の三角形 + 脊柱ライン
    const ls = landmarks[L.LEFT_SHOULDER];
    const rs = landmarks[L.RIGHT_SHOULDER];
    const lh = landmarks[L.LEFT_HIP];
    const rh = landmarks[L.RIGHT_HIP];
    const nose = landmarks[L.NOSE];
    if (!ls || !rs || !lh || !rh) return;
    const sm = mid(ls, rs);
    const hm = mid(lh, rh);
    const line = (pts) => {
      ctx.beginPath();
      ctx.moveTo(pts[0].x * w, pts[0].y * h);
      pts.slice(1).forEach((p) => ctx.lineTo(p.x * w, p.y * h));
      ctx.stroke();
    };
    ctx.strokeStyle = 'rgba(15,110,86,0.85)';
    ctx.lineWidth = lineW;
    line([ls, sm, rs]);
    line([ls, rs]);
    line([lh, hm, rh]);
    line([lh, rh]);
    ctx.strokeStyle = 'rgba(15,110,86,0.9)';
    ctx.lineWidth = Math.max(2.5, Math.round(w / 180));
    line(nose && nose.visibility >= 0.5 ? [nose, sm, hm] : [sm, hm]);
    const pts = [];
    if (nose && nose.visibility >= 0.5) pts.push(nose);
    [ls, rs, lh, rh].forEach((p) => { if (p.visibility >= 0.5) pts.push(p); });
    pts.push(sm, hm);
    pts.forEach((p) => dot(ctx, p.x * w, p.y * h, r, w));
    return;
  }

  (VIEW_CONNECTIONS[viewMode] || []).forEach(([a, b]) => {
    const la = landmarks[a];
    const lb = landmarks[b];
    if (!isVisible(la) || !isVisible(lb)) return;
    ctx.strokeStyle = 'rgba(15,110,86,0.8)';
    ctx.lineWidth = lineW;
    ctx.beginPath();
    ctx.moveTo(la.x * w, la.y * h);
    ctx.lineTo(lb.x * w, lb.y * h);
    ctx.stroke();
  });
  (VIEW_POINTS[viewMode] || []).forEach((idx) => {
    const l = landmarks[idx];
    if (!isVisible(l)) return;
    dot(ctx, l.x * w, l.y * h, r, w);
  });
  // 体軸（正面のみ破線）
  if (viewMode === 'front') {
    const ls = landmarks[11];
    const rs = landmarks[12];
    const lh = landmarks[23];
    const rh = landmarks[24];
    if (ls && rs && lh && rh) {
      const sm = mid(ls, rs);
      const hm = mid(lh, rh);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = Math.max(2, Math.round(w / 250));
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(sm.x * w, sm.y * h);
      ctx.lineTo(hm.x * w, hm.y * h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

/** 総合スコアのバッジ（左上）と各部位のスコアラベルを描く */
export function drawScoreOnCanvas(ctx, w, h, analysis, viewMode, landmarks) {
  if (!analysis || !landmarks) return;
  const total = getTotal(analysis);
  if (total === null) return;
  const scale = Math.max(1, w / 400);
  const pad = Math.round(8 * scale);

  const badgeW = Math.round(w * 0.3);
  const badgeH = Math.round(28 * scale);
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  roundRectPath(ctx, pad, pad, badgeW, badgeH, Math.round(6 * scale));
  ctx.fill();
  const circleR = Math.round(10 * scale);
  const cx = pad + pad + circleR;
  const cy = pad + badgeH / 2;
  const totalColor = scoreColor(total);
  ctx.beginPath();
  ctx.arc(cx, cy, circleR, 0, Math.PI * 2);
  ctx.strokeStyle = totalColor;
  ctx.lineWidth = Math.round(2 * scale);
  ctx.stroke();
  ctx.fillStyle = scoreColorOnDark(total);
  ctx.font = `bold ${Math.round(10 * scale)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(total), cx, cy);
  ctx.textAlign = 'left';
  ctx.font = `bold ${Math.round(8 * scale)}px sans-serif`;
  ctx.fillText(scoreLabel(total), cx + circleR + Math.round(4 * scale), cy - Math.round(4 * scale));
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = `${Math.round(6 * scale)}px sans-serif`;
  ctx.fillText(VIEW_LABELS[viewMode] || '', cx + circleR + Math.round(4 * scale), cy + Math.round(6 * scale));

  analysis.items.forEach((item) => {
    if (isLowConfidence(item)) return;
    const pos = itemAnchor(item, viewMode, landmarks, true);
    if (!pos) return;
    const px = pos.x * w;
    const py = pos.y * h;
    const color = scoreColor(item.score);
    const labelText = item.label;
    const scoreText = String(item.score);
    const detailText = item.value + (item.valueCm ? ` / ${item.valueCm}` : '');
    const fontLabel = Math.round(7 * scale);
    const fontScore = Math.round(10 * scale);
    const fontDetail = Math.round(6 * scale);
    const borderW = Math.round(3 * scale);
    ctx.font = `${fontLabel}px sans-serif`;
    const labelW = ctx.measureText(labelText).width;
    ctx.font = `bold ${fontScore}px sans-serif`;
    const scoreW = ctx.measureText(scoreText).width;
    ctx.font = `${fontDetail}px sans-serif`;
    const detailW = ctx.measureText(detailText).width;
    const boxW = Math.max(labelW + scoreW + Math.round(8 * scale), detailW) + Math.round(12 * scale) + borderW;
    const boxH = Math.round(22 * scale);
    const bx = pos.align === 'center' ? px - boxW / 2 : px;
    const by = pos.align === 'center' ? py - boxH : py - boxH / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    roundRectPath(ctx, bx + borderW, by, boxW - borderW, boxH, Math.round(4 * scale));
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(bx, by, borderW, boxH);
    const tx = bx + borderW + Math.round(5 * scale);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = `${fontLabel}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelText, tx, by + boxH * 0.32);
    ctx.fillStyle = scoreColorOnDark(item.score);
    ctx.font = `bold ${fontScore}px sans-serif`;
    ctx.fillText(scoreText, tx + labelW + Math.round(4 * scale), by + boxH * 0.32);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `${fontDetail}px sans-serif`;
    ctx.fillText(detailText, tx, by + boxH * 0.72);
  });
}

/** 写真 + 骨格（+ スコア）を合成した JPEG の data URL */
export function composeImage(imageDataUrl, landmarks, analysis, viewMode, drawScore) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        drawSkeletonOnCanvas(ctx, img.width, img.height, landmarks, viewMode);
        if (drawScore) drawScoreOnCanvas(ctx, img.width, img.height, analysis, viewMode, landmarks);
        resolve(c.toDataURL('image/jpeg', 0.92));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    img.src = imageDataUrl;
  });
}

// 分析結果（撮影ごとに別オブジェクト）単位で合成結果を覚えておき、
// 位置修正中やプレビューの再描画で同じ写真を何度も合成しないようにする
const composedCache = new WeakMap();

function composeCached(entry, drawScore) {
  let byFlag = composedCache.get(entry.analysis);
  if (!byFlag) {
    byFlag = new Map();
    composedCache.set(entry.analysis, byFlag);
  }
  const key = drawScore ? 'score' : 'plain';
  if (!byFlag.has(key)) {
    byFlag.set(key, composeImage(entry.src, entry.landmarks, entry.analysis, entry.viewMode, drawScore).catch(() => null));
  }
  return byFlag.get(key);
}

/**
 * entries: [{ id, src, landmarks, analysis, viewMode }] を合成して { id: dataUrl } を返す。
 * 合成が終わるまで（または失敗した時）は id が無いので、呼び出し側で元の写真を使う。
 */
export function useComposedImages(entries, drawScore, delay = 0) {
  const [images, setImages] = useState({});
  useEffect(() => {
    let cancelled = false;
    const valid = (entries || []).filter((e) => e && e.src && e.landmarks && e.analysis);
    const timer = setTimeout(async () => {
      const results = await Promise.all(valid.map((e) => composeCached(e, drawScore)));
      if (cancelled) return;
      const next = {};
      valid.forEach((e, i) => { if (results[i]) next[e.id] = results[i]; });
      setImages(next);
    }, delay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [entries, drawScore, delay]);
  return images;
}
