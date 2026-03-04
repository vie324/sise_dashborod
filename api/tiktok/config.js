// TikTok Ads API - Configuration Endpoint
// Returns non-sensitive configuration to the frontend

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.TIKTOK_ACCESS_TOKEN;
  const advertiserId = process.env.TIKTOK_ADVERTISER_ID;

  res.status(200).json({
    configured: !!(token && advertiserId && token !== 'YOUR_TIKTOK_ACCESS_TOKEN'),
    advertiserId: advertiserId || null
  });
}
