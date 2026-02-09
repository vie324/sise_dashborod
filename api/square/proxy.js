// Square API Proxy - Vercel Serverless Function
// Forwards requests to Square API with server-side authentication
// This keeps the API token safe (never exposed to the browser)

// Read-only endpoints (always allowed)
const READ_ENDPOINTS = [
  'customers/search',
  'subscriptions/search',
  'invoices/search',
  'catalog/batch-retrieve',
  'locations',
];

// Write endpoints (only allowed in sandbox for test data creation)
const SANDBOX_WRITE_ENDPOINTS = [
  'customers',
  'catalog/object',
  'subscriptions',
  'orders',
  'invoices',
  'cards',
];

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Validate environment variables
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token || token === 'YOUR_SQUARE_ACCESS_TOKEN') {
    return res.status(500).json({
      error: 'Square API not configured',
      message: 'Set SQUARE_ACCESS_TOKEN in Vercel environment variables'
    });
  }

  // Build Square API path from query parameter or URL segments
  // Vercel rewrite passes path as query: /api/square/proxy?path=customers/search
  const { path } = req.query;
  let squarePath = '';
  if (Array.isArray(path)) {
    squarePath = path.join('/');
  } else if (typeof path === 'string') {
    squarePath = path;
  }

  if (!squarePath) {
    return res.status(400).json({ error: 'Missing path parameter' });
  }

  // Determine environment
  const env = process.env.SQUARE_ENVIRONMENT || 'sandbox';
  const isSandbox = env !== 'production';

  // Whitelist check
  const isReadAllowed = READ_ENDPOINTS.some(ep => squarePath.startsWith(ep));
  const isWriteAllowed = isSandbox && SANDBOX_WRITE_ENDPOINTS.some(ep => squarePath.startsWith(ep));

  if (!isReadAllowed && !isWriteAllowed) {
    return res.status(403).json({
      error: 'Endpoint not allowed',
      allowed: isSandbox ? [...READ_ENDPOINTS, ...SANDBOX_WRITE_ENDPOINTS] : READ_ENDPOINTS
    });
  }

  const baseUrl = isSandbox
    ? 'https://connect.squareupsandbox.com/v2'
    : 'https://connect.squareup.com/v2';

  try {
    const response = await fetch(`${baseUrl}/${squarePath}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Square-Version': '2025-01-23'
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('Square API proxy error:', error);
    return res.status(502).json({
      error: 'Failed to connect to Square API',
      message: error.message
    });
  }
}
