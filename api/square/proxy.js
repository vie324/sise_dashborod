// Square API Proxy - Vercel Serverless Function
// Forwards requests to Square API with server-side authentication
// Supports multiple stores via X-Store-Id header
// This keeps the API token safe (never exposed to the browser)

// Read-only endpoints (always allowed)
const READ_ENDPOINTS = [
  'customers/search',
  'subscriptions/search',
  'invoices/search',
  'catalog/batch-retrieve',
  'catalog/list',
  'locations',
];

// Write endpoints (only allowed in sandbox for test data creation)
const SANDBOX_WRITE_ENDPOINTS = [
  'customers',
  'catalog/object',
  'catalog/batch-upsert',
  'subscriptions',
  'orders',
  'invoices',
  'cards',
];

// Operation endpoints (allowed in all environments with confirmation)
const OPERATION_ENDPOINTS = [
  'subscriptions/',  // cancel, pause, resume use subscriptions/{id}/cancel etc.
  'online-checkout/payment-links',  // サブスク契約リンク生成
];

// Get store configuration by store ID
function getStoreConfig(storeId) {
  // Multi-store: SQUARE_STORE_{ID}_ACCESS_TOKEN, SQUARE_STORE_{ID}_LOCATION_ID etc.
  // Default store (backward compat): SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID
  if (!storeId || storeId === 'default') {
    return {
      token: process.env.SQUARE_ACCESS_TOKEN,
      locationId: process.env.SQUARE_LOCATION_ID || '',
      environment: process.env.SQUARE_ENVIRONMENT || 'sandbox',
      name: process.env.SQUARE_STORE_NAME || 'デフォルト店舗',
    };
  }

  // Extra source IDs: e.g. "2_extra_1" → SQUARE_STORE_2_EXTRA_1_ACCESS_TOKEN
  const extraMatch = storeId.match(/^(\d+)_extra_(\d+)$/);
  if (extraMatch) {
    const [, baseId, extraIdx] = extraMatch;
    const prefix = `SQUARE_STORE_${baseId}_EXTRA_${extraIdx}`;
    const token = process.env[`${prefix}_ACCESS_TOKEN`];
    if (!token) return null;
    return {
      token,
      locationId: process.env[`${prefix}_LOCATION_ID`] || '',
      environment: process.env[`SQUARE_STORE_${baseId}_ENVIRONMENT`] || process.env.SQUARE_ENVIRONMENT || 'sandbox',
      name: `Extra source ${baseId}-${extraIdx}`,
    };
  }

  const prefix = `SQUARE_STORE_${storeId}`;
  const token = process.env[`${prefix}_ACCESS_TOKEN`];
  if (!token) return null;

  return {
    token,
    locationId: process.env[`${prefix}_LOCATION_ID`] || '',
    environment: process.env[`${prefix}_ENVIRONMENT`] || process.env.SQUARE_ENVIRONMENT || 'sandbox',
    name: process.env[`${prefix}_NAME`] || `店舗 ${storeId}`,
  };
}

export default async function handler(req, res) {
  // CORS headers - restrict to own domain in production if ALLOWED_ORIGIN is set
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Store-Id');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Determine which store to use
  const storeId = req.headers['x-store-id'] || req.query.store || 'default';
  const storeConfig = getStoreConfig(storeId);

  if (!storeConfig || !storeConfig.token || storeConfig.token === 'YOUR_SQUARE_ACCESS_TOKEN') {
    return res.status(500).json({
      error: 'Square API not configured',
      message: `Store "${storeId}" is not configured. Set environment variables in Vercel.`
    });
  }

  // Build Square API path from query parameter
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

  const isSandbox = storeConfig.environment !== 'production';

  // Whitelist check
  const isReadAllowed = READ_ENDPOINTS.some(ep => squarePath.startsWith(ep));
  const isWriteAllowed = isSandbox && SANDBOX_WRITE_ENDPOINTS.some(ep => squarePath.startsWith(ep));
  const isOperationAllowed = OPERATION_ENDPOINTS.some(ep => squarePath.startsWith(ep));

  if (!isReadAllowed && !isWriteAllowed && !isOperationAllowed) {
    return res.status(403).json({
      error: 'Endpoint not allowed',
      path: squarePath
    });
  }

  const baseUrl = isSandbox
    ? 'https://connect.squareupsandbox.com/v2'
    : 'https://connect.squareup.com/v2';

  // catalog/list is a GET endpoint with query parameters
  const GET_ENDPOINTS = ['catalog/list', 'locations'];
  const isGetEndpoint = GET_ENDPOINTS.some(ep => squarePath.startsWith(ep));

  try {
    let squareUrl = `${baseUrl}/${squarePath}`;
    const fetchOptions = {
      headers: {
        'Authorization': `Bearer ${storeConfig.token}`,
        'Content-Type': 'application/json',
        'Square-Version': '2025-01-23'
      },
    };

    if (isGetEndpoint) {
      // Convert body params to query string for GET endpoints
      fetchOptions.method = 'GET';
      const params = new URLSearchParams();
      if (req.body) {
        Object.entries(req.body).forEach(([key, value]) => {
          if (Array.isArray(value)) {
            params.set(key, value.join(','));
          } else if (value !== undefined && value !== null) {
            params.set(key, String(value));
          }
        });
      }
      const qs = params.toString();
      if (qs) squareUrl += `?${qs}`;
    } else {
      fetchOptions.method = 'POST';
      fetchOptions.body = JSON.stringify(req.body);
    }

    const response = await fetch(squareUrl, fetchOptions);

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
