// Returns non-sensitive Square configuration
// Used by the frontend to know locationId and environment

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.SQUARE_ACCESS_TOKEN;
  const isConfigured = token && token !== 'YOUR_SQUARE_ACCESS_TOKEN';

  return res.status(200).json({
    configured: isConfigured,
    environment: process.env.SQUARE_ENVIRONMENT || 'sandbox',
    locationId: process.env.SQUARE_LOCATION_ID || '',
    defaultMonthlyPrice: parseInt(process.env.SQUARE_DEFAULT_MONTHLY_PRICE || '10000', 10)
  });
}
