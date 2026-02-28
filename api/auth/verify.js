// Password verification endpoint
// Checks password against Google Spreadsheet via Apps Script
// If AUTH_SHEET_URL is not set or no users exist, auth is bypassed

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, password } = req.body || {};
  const authSheetUrl = process.env.AUTH_SHEET_URL;

  // --- 認証状態チェック ---
  if (action === 'check') {
    if (!authSheetUrl) {
      return res.status(200).json({ authEnabled: false });
    }
    try {
      const response = await fetch(authSheetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'listUsers', authPassword: '__check__' })
      });
      // listUsersが権限エラーを返す＝ユーザーが存在する
      // まだユーザーがいないケースは verify で空マッチなので
      // GASに繋がるだけで「設定済み」と判断
      const data = await response.json();
      // listUsersが成功してusersが空 = まだ誰も登録していない
      if (data.success && (!data.users || data.users.length === 0)) {
        return res.status(200).json({ authEnabled: false });
      }
      // それ以外（ユーザーあり or 権限エラー）= 認証有効
      return res.status(200).json({ authEnabled: true });
    } catch {
      // GASに繋がらない = 未設定と同等
      return res.status(200).json({ authEnabled: false });
    }
  }

  // --- パスワード検証 ---
  if (!password) return res.status(400).json({ error: 'Password required' });

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
      password: password,
    });
  } catch (error) {
    console.error('Auth verification error:', error);
    return res.status(500).json({ error: '認証サービスに接続できません' });
  }
}
