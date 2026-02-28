// Manual member management endpoint
// Proxies CRUD operations for cash/QR payment members to Google Spreadsheet

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, ...params } = req.body || {};
  const allowed = ['listManualMembers', 'addManualMember', 'updateManualMember', 'deleteManualMember'];
  if (!allowed.includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }

  const authSheetUrl = process.env.AUTH_SHEET_URL;
  if (!authSheetUrl) {
    return res.status(500).json({ error: 'AUTH_SHEET_URL not configured' });
  }

  try {
    const response = await fetch(authSheetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...params })
    });

    const data = await response.json();
    if (!data.success) {
      return res.status(400).json({ error: data.error || '操作に失敗しました' });
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('Manual members error:', error);
    return res.status(500).json({ error: 'サービスに接続できません' });
  }
}
