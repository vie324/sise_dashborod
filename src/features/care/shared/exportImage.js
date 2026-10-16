// ============================================================
// レポートの画像化（html2canvas）と保存・共有
// ============================================================

import html2canvas from 'html2canvas';

// SVG（レーダーチャート）は画像として描かれページの CSS が効かないため、文字のフォントを直接指定する
const SVG_FONT = "'Hiragino Sans', 'Hiragino Kaku Gothic ProN', 'Noto Sans JP', Meiryo, system-ui, sans-serif";

// 旧画面と同じく、2 倍描画で縦 3000px を超える画像は最大 3 枚に分ける。
// 縦に長すぎる画像は LINE などで縮小されて文字が読めなくなるため。
const SPLIT_HEIGHT = 3000;
const MAX_PARTS = 3;

/** iPhone / iPad（iPadOS はデスクトップの UA を名乗るのでタッチ点数でも判定） */
export function isIOS() {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** ファイル名に使えない文字を除き、空なら fallback */
export function fileNamePart(value, fallback) {
  const s = String(value || '').trim().replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_');
  return s || fallback;
}

let shareSupport = null;
/** PNG ファイルを Web Share で送れる端末か（iPad / iPhone / Android の Safari・Chrome など） */
export function canShareFiles() {
  if (shareSupport !== null) return shareSupport;
  try {
    if (typeof navigator === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') {
      shareSupport = false;
    } else {
      const probe = new File([new Blob(['x'], { type: 'image/png' })], 'report.png', { type: 'image/png' });
      shareSupport = !!navigator.canShare({ files: [probe] });
    }
  } catch (_) {
    shareSupport = false;
  }
  return shareSupport;
}

// html2canvas は文字のベースライン位置を、元のページに 1px の画像（固定の GIF）を
// 文字と並べて置いて測る。Tailwind の preflight（img { display: block }）だとその画像が
// 改行されて測定値がずれ、保存画像の文字がすべて下にずれる。測定用の画像だけ行内に戻す。
const PROBE_FIX_ID = 'care-html2canvas-probe-fix';
const PROBE_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP';

function ensureProbeFix() {
  if (document.getElementById(PROBE_FIX_ID)) return;
  const el = document.createElement('style');
  el.id = PROBE_FIX_ID;
  el.textContent = `img[src^="${PROBE_GIF}"]{display:inline !important;}`;
  document.head.appendChild(el);
}

function waitForImages(el) {
  const imgs = Array.from(el.querySelectorAll('img'));
  return Promise.all(imgs.map((img) => {
    if (img.complete && img.naturalWidth) return img.decode ? img.decode().catch(() => {}) : null;
    return new Promise((resolve) => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    });
  }));
}

/**
 * 要素を 2 倍の解像度で Canvas に描く。
 * width を渡すと、端末の画面幅に関係なくその幅でレイアウトして描く（保存画像を端末で変えないため）。
 */
export async function captureElement(el, { width } = {}) {
  if (!el) throw new Error('レポートが表示されていません');
  ensureProbeFix();
  await waitForImages(el);
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch (_) { /* noop */ }
  }
  return html2canvas(el, {
    scale: 2,
    backgroundColor: '#ffffff',
    useCORS: true,
    logging: false,
    windowWidth: width ? Math.max(window.innerWidth, width + 80) : window.innerWidth,
    onclone: (doc, cloned) => {
      if (width) {
        cloned.style.width = `${width}px`;
        cloned.style.maxWidth = 'none';
      }
      const view = doc.defaultView || window;
      cloned.querySelectorAll('svg').forEach((svg) => {
        // currentColor とフォントは画像化すると失われるので、計算済みの値を直接書き込む
        svg.style.color = view.getComputedStyle(svg).color;
        svg.style.fontFamily = SVG_FONT;
      });
    },
  });
}

function splitCanvas(canvas) {
  const total = canvas.height;
  const parts = total <= SPLIT_HEIGHT ? 1 : Math.min(MAX_PARTS, Math.ceil(total / SPLIT_HEIGHT));
  if (parts === 1) return [canvas];
  const partH = Math.ceil(total / parts);
  const out = [];
  for (let i = 0; i < parts; i++) {
    const y = i * partH;
    const h = Math.min(partH, total - y);
    const c = document.createElement('canvas');
    c.width = canvas.width;
    c.height = h;
    c.getContext('2d').drawImage(canvas, 0, y, canvas.width, h, 0, 0, canvas.width, h);
    out.push(c);
  }
  return out;
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('画像の生成に失敗しました'))), 'image/png');
  });
}

/** 要素を PNG ファイル（縦長なら分割）にする */
export async function renderPngFiles(el, baseName, opts) {
  const canvas = await captureElement(el, opts);
  const parts = splitCanvas(canvas);
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const blob = await canvasToBlob(parts[i]);
    const suffix = parts.length > 1 ? `_part${i + 1}of${parts.length}` : '';
    files.push(new File([blob], `${baseName}${suffix}.png`, { type: 'image/png' }));
  }
  return files;
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** 複数ファイルは少し間を空けて順にダウンロードする（連続だとブラウザに止められることがある） */
export async function downloadFiles(files) {
  for (let i = 0; i < files.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 400));
    downloadBlob(files[i], files[i].name);
  }
}

export function downloadJson(data, fileName) {
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), fileName);
}
