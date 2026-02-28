// Password verification endpoint
// Checks password against Google Spreadsheet via Apps Script

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'Password required' });

  const authSheetUrl = process.env.AUTH_SHEET_URL;
  if (!authSheetUrl) {
    return res.status(500).json({ error: 'AUTH_SHEET_URL not configured' });
  }

  try {
    const response = await fetch(authSheetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'verify', password })
    });

    const data = await response.json();

    if (!data.success) {
      return res.status(401).json({ error: 'パスワードが正しくありません' });
    }

    return res.status(200).json({
      role: data.role,
      name: data.name,
      storeIds: data.storeIds || [],
    });
  } catch (error) {
    console.error('Auth verification error:', error);
    return res.status(500).json({ error: '認証サービスに接続できません' });
  }
}
