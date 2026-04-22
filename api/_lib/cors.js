const ALLOWED = process.env.ALLOWED_ORIGIN || '*';

export function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  // X-Staff-Id / X-Staff-Token はスタッフ権限判定に利用する
  // (api/_lib/auth.js の extractStaffContext が参照)
  // X-Store-Id は Square/LINE プロキシが既存で利用中
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Staff-Id, X-Staff-Token, X-Store-Id');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}
