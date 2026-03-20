// LINE Messaging API Proxy - Vercel Serverless Function
// Forwards requests to LINE API with server-side authentication
// Supports multiple stores via X-Store-Id header

const LINE_API_BASE = 'https://api.line.me/v2/bot';

// Allowed endpoints
const ALLOWED_ENDPOINTS = [
  'message/push',
  'message/reply',
  'profile/',
  'group/summary',
  'richmenu',
];

function getLineConfig(storeId) {
  if (!storeId) return null;
  const prefix = `LINE_STORE_${storeId}`;
  const token = process.env[`${prefix}_CHANNEL_ACCESS_TOKEN`];
  const secret = process.env[`${prefix}_CHANNEL_SECRET`];
  if (!token || !secret) return null;
  return {
    token,
    secret,
    name: process.env[`${prefix}_NAME`] || process.env[`SQUARE_STORE_${storeId}_NAME`] || `店舗 ${storeId}`,
  };
}

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Store-Id');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const storeId = req.headers['x-store-id'] || req.query.store;
  if (!storeId) return res.status(400).json({ error: 'X-Store-Id header required' });

  const config = getLineConfig(storeId);
  if (!config) {
    return res.status(500).json({
      error: 'LINE not configured',
      message: `Store "${storeId}" does not have LINE configured.`,
    });
  }

  const { path } = req.query;
  let linePath = '';
  if (Array.isArray(path)) {
    linePath = path.join('/');
  } else if (typeof path === 'string') {
    linePath = path;
  }

  if (!linePath) return res.status(400).json({ error: 'Missing path parameter' });

  // Whitelist check
  const isAllowed = ALLOWED_ENDPOINTS.some(ep => linePath.startsWith(ep));
  if (!isAllowed) {
    return res.status(403).json({ error: 'Endpoint not allowed', path: linePath });
  }

  try {
    const response = await fetch(`${LINE_API_BASE}/${linePath}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    });

    if (response.status === 200) {
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await response.json();
        return res.status(200).json(data);
      }
      return res.status(200).json({ success: true });
    }

    const errorData = await response.json().catch(() => ({}));
    return res.status(response.status).json(errorData);
  } catch (error) {
    console.error('LINE API proxy error:', error);
    return res.status(502).json({ error: 'Failed to connect to LINE API', message: error.message });
  }
}
