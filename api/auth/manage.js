// Password management endpoint (master only)
// Proxies CRUD operations to Google Spreadsheet via Apps Script

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, authPassword, ...params } = req.body || {};
  const allowed = ['listUsers', 'addUser', 'updateUser', 'deleteUser'];
  if (!allowed.includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }
  if (!authPassword) {
    return res.status(401).json({ error: '認証パスワードが必要です' });
  }

  const authSheetUrl = process.env.AUTH_SHEET_URL;
  if (!authSheetUrl) {
    return res.status(500).json({ error: 'AUTH_SHEET_URL not configured' });
  }

  try {
    const response = await fetch(authSheetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, authPassword, ...params })
    });

    const data = await response.json();
    if (!data.success) {
      return res.status(data.error === '権限がありません' ? 403 : 400).json({ error: data.error || '操作に失敗しました' });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('Password manage error:', error);
    return res.status(500).json({ error: 'サービスに接続できません' });
  }
}
