// LINE Messaging API - Configuration Endpoint
// Returns non-sensitive LINE configuration (store list with LINE status)

// Support both naming patterns:
//   LINE_STORE_{ID}_CHANNEL_ACCESS_TOKEN  or  LINE_STORE_{ID}_ACCESS_TOKEN
//   LINE_STORE_{ID}_CHANNEL_SECRET        or  LINE_STORE_{ID}_SECRET
function getLineEnv(storeNum) {
  const prefix = `LINE_STORE_${storeNum}`;
  const token = process.env[`${prefix}_CHANNEL_ACCESS_TOKEN`] || process.env[`${prefix}_ACCESS_TOKEN`];
  const secret = process.env[`${prefix}_CHANNEL_SECRET`] || process.env[`${prefix}_SECRET`];
  const name = process.env[`${prefix}_NAME`] || process.env[`SQUARE_STORE_${storeNum}_NAME`] || `店舗 ${storeNum}`;
  return { token, secret, name };
}

export default function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const stores = [];

  for (let i = 1; i <= 20; i++) {
    const { token, secret, name } = getLineEnv(i);
    if (token && secret) {
      stores.push({ id: String(i), name, configured: true });
    }
  }

  return res.status(200).json({
    configured: stores.length > 0,
    stores,
  });
}
