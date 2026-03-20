// LINE Messaging API - Configuration Endpoint
// Returns non-sensitive LINE configuration (store list with LINE status)

export default function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Build LINE-enabled store list from environment variables
  // Pattern: LINE_STORE_{ID}_CHANNEL_ACCESS_TOKEN / LINE_STORE_{ID}_CHANNEL_SECRET
  const stores = [];

  for (let i = 1; i <= 20; i++) {
    const prefix = `LINE_STORE_${i}`;
    const token = process.env[`${prefix}_CHANNEL_ACCESS_TOKEN`];
    const secret = process.env[`${prefix}_CHANNEL_SECRET`];
    if (token && secret) {
      stores.push({
        id: String(i),
        name: process.env[`${prefix}_NAME`] || process.env[`SQUARE_STORE_${i}_NAME`] || `店舗 ${i}`,
        configured: true,
      });
    }
  }

  return res.status(200).json({
    configured: stores.length > 0,
    stores,
  });
}
