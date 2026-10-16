import { useEffect } from 'react';
import { createPortal } from 'react-dom';

// ============================================================
// 印刷用のレポート
// ------------------------------------------------------------
// <body> 直下に印刷専用の要素を置き、印刷時はそれ以外（サイドバー・下部タブ・
// 入力フォームなど画面全体）を隠す。画面には表示しない。
// 表示中のツールだけがこれを置くので、ブラウザのメニューから印刷しても
// レポートだけが印刷される。
// ============================================================

const STYLE_ID = 'care-print-style';
const READY_CLASS = 'care-print-ready';

const CSS = `
@media screen {
  .care-print-root { display: none !important; }
}
@media print {
  html.${READY_CLASS} body > *:not(.care-print-root) { display: none !important; }
  html.${READY_CLASS}, html.${READY_CLASS} body { background: #ffffff !important; }
  .care-print-root { display: block !important; color: #1f2a24; }
  .care-print-root, .care-print-root * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  .care-print-root .care-print-avoid { break-inside: avoid; page-break-inside: avoid; }
  @page { margin: 10mm; }
}
`;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

export default function PrintPortal({ width = 480, children }) {
  useEffect(() => {
    ensureStyle();
    const root = document.documentElement;
    root.classList.add(READY_CLASS);
    return () => root.classList.remove(READY_CLASS);
  }, []);
  return createPortal(
    <div className="care-print-root" aria-hidden="true">
      <div style={{ width, maxWidth: '100%', margin: '0 auto' }}>{children}</div>
    </div>,
    document.body,
  );
}
