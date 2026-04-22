// Service Worker (si'se dashboard)
// ==============================================
// ストラテジ:
//  - /api/* は常にネットワーク優先（キャッシュしない、認証とデータ鮮度最優先）
//  - 同一オリジンの静的アセット (index.html / manifest / 画像 / CDN 以外) は
//    stale-while-revalidate: キャッシュ即時応答 + バックグラウンドで最新化
//  - HTML (navigate) は network-first: 新しい版を優先、オフライン時のみ
//    キャッシュ版にフォールバック
//  - 同一オリジン以外（unpkg, googleapis, cdn.jsdelivr, html2canvas CDN 等）は
//    キャッシュしない（バージョン管理外、SW の責務外）
// ==============================================

const CACHE_NAME = 'sise-dash-v1';
const CORE_ASSETS = [
  '/',
  '/manifest.json',
  '/images/logo.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 同一オリジンのみキャッシュ対象にする
  if (url.origin !== self.location.origin) return;

  // /api は常にネットワーク（データ鮮度と認証のため）
  if (url.pathname.startsWith('/api/')) return;

  // navigate (HTML): network-first
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req).then((resp) => {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, clone).catch(() => {}));
        return resp;
      }).catch(() => caches.match(req).then((cached) => cached || caches.match('/')))
    );
    return;
  }

  // 静的アセット: stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((resp) => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone).catch(() => {}));
        }
        return resp;
      }).catch(() => cached);
      return cached || network;
    })
  );
});

// クライアント側から skipWaiting 指示を受け取る（更新促進用）
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
