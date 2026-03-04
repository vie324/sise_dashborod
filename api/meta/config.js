// Meta (Facebook/Instagram) Ads API - Configuration Endpoint
// Returns non-sensitive configuration to the frontend

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;

  res.status(200).json({
    configured: !!(token && adAccountId && token !== 'YOUR_META_ACCESS_TOKEN'),
    adAccountId: adAccountId ? `act_${adAccountId.replace('act_', '')}` : null
  });
}
