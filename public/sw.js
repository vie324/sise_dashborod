// Service Worker (si'se dashboard)
// ==============================================
// ストラテジ:
//  - /api/* は常にネットワーク優先（キャッシュしない、認証とデータ鮮度最優先）
//  - /manifest.json はリクエスト元 client (page) の URL から ?v=<token> を
//    読み取り、token 入り start_url のマニフェストを動的に返す。
//    （iOS / Android の「ホーム画面に追加」がスタッフ個別の URL で起動するように）
//  - 同一オリジンの静的アセット (index.html / 画像 / CDN 以外) は
//    stale-while-revalidate: キャッシュ即時応答 + バックグラウンドで最新化
//  - HTML (navigate) は network-first: 新しい版を優先、オフライン時のみ
//    キャッシュ版にフォールバック
//  - 同一オリジン以外（unpkg, googleapis, cdn.jsdelivr, html2canvas CDN 等）は
//    キャッシュしない（バージョン管理外、SW の責務外）
// ==============================================

const CACHE_NAME = 'sise-dash-v3';
// /manifest.json は token 込みで動的に応答するため、CORE_ASSETS から外す
// （v2 まで間違えてキャッシュしていた古いマニフェストがあれば、CACHE_NAME
//  バージョンアップ時の activate cleanup で削除される）。
const CORE_ASSETS = [
  '/',
  '/images/logo.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // 旧バージョンのキャッシュを掃除（v2 にあった /manifest.json を含めて）
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
    // 現行キャッシュからも /manifest.json を強制削除（古いマニフェストが残っていた場合）
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.delete('/manifest.json');
      await cache.delete(new Request('/manifest.json'));
    } catch (_) {}
    await self.clients.claim();
  })());
});

// /manifest.json リクエストから ?v=<token> を解決するヘルパー。
// 1) リクエスト URL 自体に ?v= が含まれていればそれを使う
// 2) なければリクエスト元の page (client) の URL から ?v= を読み取る
async function resolveStaffToken(event) {
  const reqUrl = new URL(event.request.url);
  const tokenFromReq = reqUrl.searchParams.get('v');
  if (tokenFromReq) return tokenFromReq;
  if (event.clientId) {
    try {
      const client = await self.clients.get(event.clientId);
      if (client && client.url) {
        const cu = new URL(client.url);
        return cu.searchParams.get('v') || '';
      }
    } catch (_) { /* ignore */ }
  }
  return '';
}

// payload から staffName を取り出す（失敗してもスキップ）。
function decodeStaffName(token) {
  try {
    const part = token.indexOf('.') >= 0 ? token.split('.')[0] : token;
    let b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const json = new TextDecoder('utf-8').decode(bytes);
    const decoded = JSON.parse(json);
    return decoded && decoded.n ? String(decoded.n) : '';
  } catch (_) { return ''; }
}

// マニフェスト JSON を生成（token あれば start_url にトークン付与）。
function buildManifest(token, staffName) {
  const m = {
    name: staffName ? `si'se - ${staffName}` : "si'se Dashboard",
    short_name: staffName ? (staffName.length > 12 ? staffName.slice(0, 12) : staffName) : "si'se",
    description: "si'se 整体院経営ダッシュボード",
    start_url: token ? `/?v=${encodeURIComponent(token)}` : "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f4f8f5",
    theme_color: "#33a065",
    lang: "ja",
    icons: [
      { src: "/images/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/images/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/images/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
    ],
    categories: ["business", "productivity"]
  };
  return m;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 同一オリジンのみキャッシュ対象にする
  if (url.origin !== self.location.origin) return;

  // /api は常にネットワーク（データ鮮度と認証のため）
  if (url.pathname.startsWith('/api/')) return;

  // /manifest.json はリクエスト元の token を見て動的に生成
  // （ブラウザ/iOS が ?v= 無しでフェッチしても、SW が page の URL から token を補う）
  if (url.pathname === '/manifest.json') {
    event.respondWith((async () => {
      const token = await resolveStaffToken(event);
      const staffName = token ? decodeStaffName(token) : '';
      const manifest = buildManifest(token, staffName);
      return new Response(JSON.stringify(manifest), {
        status: 200,
        headers: {
          'Content-Type': 'application/manifest+json; charset=utf-8',
          'Cache-Control': 'no-store',
        }
      });
    })());
    return;
  }

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
