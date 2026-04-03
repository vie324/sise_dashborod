// Meta (Facebook/Instagram) Marketing API Proxy
// Forwards requests to Meta Graph API with server-side authentication

const ALLOWED_EDGES = [
  'campaigns',
  'adsets',
  'ads',
  'insights',
];

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;

  if (!token || !adAccountId || token === 'YOUR_META_ACCESS_TOKEN') {
    return res.status(500).json({
      error: 'Meta Ads API not configured',
      message: 'Set META_ACCESS_TOKEN and META_AD_ACCOUNT_ID in Vercel environment variables.'
    });
  }

  const { path } = req.query;
  let metaPath = '';
  if (Array.isArray(path)) {
    metaPath = path.join('/');
  } else if (typeof path === 'string') {
    metaPath = path;
  }

  // /api/meta/config → 設定情報を返す
  if (metaPath === 'config') {
    return res.status(200).json({
      configured: !!(token && adAccountId && token !== 'YOUR_META_ACCESS_TOKEN'),
      adAccountId: adAccountId ? `act_${adAccountId.replace('act_', '')}` : null
    });
  }

  if (!metaPath) {
    return res.status(400).json({ error: 'Missing path parameter' });
  }

  // Whitelist check
  const isAllowed = ALLOWED_EDGES.some(edge => metaPath.includes(edge));
  if (!isAllowed) {
    return res.status(403).json({ error: 'Endpoint not allowed', path: metaPath });
  }

  const accountId = `act_${adAccountId.replace('act_', '')}`;
  const apiVersion = process.env.META_API_VERSION || 'v21.0';

  // Build query parameters
  const queryParams = new URLSearchParams(req.query);
  queryParams.delete('path');
  queryParams.set('access_token', token);

  // For POST requests, merge body params
  if (req.method === 'POST' && req.body) {
    for (const [key, value] of Object.entries(req.body)) {
      if (key !== 'access_token') {
        queryParams.set(key, typeof value === 'object' ? JSON.stringify(value) : value);
      }
    }
  }

  const url = `https://graph.facebook.com/${apiVersion}/${accountId}/${metaPath}?${queryParams.toString()}`;

  try {
    const response = await fetch(url, { method: 'GET' });
    const data = await response.json();

    if (!response.ok) {
      // Add helpful hints for common Meta API errors
      if (data.error) {
        const code = data.error.code;
        const msg = (data.error.message || '').toLowerCase();
        if (code === 190 || msg.includes('expired') || msg.includes('invalid')) {
          data.error._hint = 'アクセストークンが無効または期限切れです。Meta Graph API Explorerで新しいトークンを発行してください。';
        } else if (msg.includes('blocked')) {
          data.error._hint = 'APIアクセスがブロックされています。アクセストークンの更新またはアプリの権限を確認してください。';
        }
      }
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('Meta API proxy error:', error);
    return res.status(502).json({
      error: 'Failed to connect to Meta API',
      message: error.message
    });
  }
}
