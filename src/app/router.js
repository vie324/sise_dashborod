import { useEffect, useState } from 'react';

// ハッシュルーター: #/incentives など。?v=<token>（スタッフURL）とは干渉しない。
// 画面の中の階層は #/mandala/review/2026-10-26 のようにパスで表す（basePath で画面を引く）。
export function currentPath() {
  const h = window.location.hash.replace(/^#/, '');
  return h.startsWith('/') ? h.split('?')[0] : '/';
}

/** '/mandala/review/2026-10-26' → '/mandala' */
export function basePath(path) {
  const seg = String(path || '/').split('/')[1] || '';
  return `/${seg}`;
}

export function navigate(path) {
  if (currentPath() === path) return;
  window.location.hash = path;
}

export function useRoute() {
  const [path, setPath] = useState(currentPath);
  useEffect(() => {
    const on = () => {
      setPath(currentPath());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return path;
}
