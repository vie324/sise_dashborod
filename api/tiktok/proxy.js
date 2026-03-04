// TikTok Marketing API Proxy
// Forwards requests to TikTok Ads API with server-side authentication

const ALLOWED_ENDPOINTS = [
  'campaign/get',
  'adgroup/get',
  'ad/get',
  'report/integrated/get',
];

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.TIKTOK_ACCESS_TOKEN;
  const advertiserId = process.env.TIKTOK_ADVERTISER_ID;

  if (!token || !advertiserId || token === 'YOUR_TIKTOK_ACCESS_TOKEN') {
    return res.status(500).json({
      error: 'TikTok Ads API not configured',
      message: 'Set TIKTOK_ACCESS_TOKEN and TIKTOK_ADVERTISER_ID in Vercel environment variables.'
    });
  }

  const { path } = req.query;
  let tiktokPath = '';
  if (Array.isArray(path)) {
    tiktokPath = path.join('/');
  } else if (typeof path === 'string') {
    tiktokPath = path;
  }

  if (!tiktokPath) {
    return res.status(400).json({ error: 'Missing path parameter' });
  }

  // Whitelist check
  const isAllowed = ALLOWED_ENDPOINTS.some(ep => tiktokPath.includes(ep));
  if (!isAllowed) {
    return res.status(403).json({ error: 'Endpoint not allowed', path: tiktokPath });
  }

  // Build request body (TikTok API uses JSON body for GET-like requests)
  const body = {
    advertiser_id: advertiserId,
    ...(req.body || {})
  };

  const url = `https://business-api.tiktok.com/open_api/v1.3/${tiktokPath}/`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Access-Token': token,
        'Content-Type': 'application/json'
      }
    });

    // For endpoints that need query params
    const queryParams = new URLSearchParams();
    queryParams.set('advertiser_id', advertiserId);

    // Merge body params into query for GET requests
    if (req.body) {
      for (const [key, value] of Object.entries(req.body)) {
        queryParams.set(key, typeof value === 'object' ? JSON.stringify(value) : value);
      }
    }

    const getUrl = `${url}?${queryParams.toString()}`;

    const getResponse = await fetch(getUrl, {
      method: 'GET',
      headers: {
        'Access-Token': token,
        'Content-Type': 'application/json'
      }
    });

    const data = await getResponse.json();

    if (data.code !== 0) {
      return res.status(400).json(data);
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('TikTok API proxy error:', error);
    return res.status(502).json({
      error: 'Failed to connect to TikTok API',
      message: error.message
    });
  }
}
