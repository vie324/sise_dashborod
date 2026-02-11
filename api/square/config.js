// Returns non-sensitive Square configuration including store list
// Used by the frontend to know available stores, locationIds and environment

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Build store list from environment variables
  const stores = [];

  // Default store (backward compatible)
  const defaultToken = process.env.SQUARE_ACCESS_TOKEN;
  if (defaultToken && defaultToken !== 'YOUR_SQUARE_ACCESS_TOKEN') {
    stores.push({
      id: 'default',
      name: process.env.SQUARE_STORE_NAME || 'デフォルト店舗',
      locationId: process.env.SQUARE_LOCATION_ID || '',
      environment: process.env.SQUARE_ENVIRONMENT || 'sandbox',
    });
  }

  // Multi-store: scan SQUARE_STORE_{ID}_ACCESS_TOKEN pattern
  // IDs are numbered 1-20 (scan range)
  for (let i = 1; i <= 20; i++) {
    const prefix = `SQUARE_STORE_${i}`;
    const token = process.env[`${prefix}_ACCESS_TOKEN`];
    if (token) {
      stores.push({
        id: String(i),
        name: process.env[`${prefix}_NAME`] || `店舗 ${i}`,
        locationId: process.env[`${prefix}_LOCATION_ID`] || '',
        environment: process.env[`${prefix}_ENVIRONMENT`] || process.env.SQUARE_ENVIRONMENT || 'sandbox',
      });
    }
  }

  return res.status(200).json({
    configured: stores.length > 0,
    stores,
    defaultMonthlyPrice: parseInt(process.env.SQUARE_DEFAULT_MONTHLY_PRICE || '10000', 10),
    // Backward compat fields
    environment: stores.length > 0 ? stores[0].environment : 'sandbox',
    locationId: stores.length > 0 ? stores[0].locationId : '',
  });
}
