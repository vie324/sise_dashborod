// Meta (Facebook/Instagram) Marketing API Proxy
// Forwards requests to Meta Graph API with server-side authentication

import { extractStaffContext } from '../_lib/auth.js';

const ALLOWED_EDGES = [
  'campaigns',
  'adsets',
  'ads',
  'insights',
];

// headquarter / admin ロールのみ Meta API を叩ける
function isMarketingAllowed(staffCtx) {
  if (staffCtx === null) return true; // admin モード（URL-less）
  if (!staffCtx || staffCtx.valid === false) return false;
  const role = String(staffCtx.role || '').toLowerCase();
  return role === 'headquarter' || role === 'admin';
}

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Staff-Id, X-Staff-Token');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID;
  const isConfigured = !!(token && adAccountId && token !== 'YOUR_META_ACCESS_TOKEN');

  const { path } = req.query;
  let metaPath = '';
  if (Array.isArray(path)) {
    metaPath = path.join('/');
  } else if (typeof path === 'string') {
    metaPath = path;
  }

  // /api/meta/config → 設定情報のみで機密は含まないので認証なしで返す
  if (metaPath === 'config') {
    return res.status(200).json({
      configured: isConfigured,
      adAccountId: adAccountId ? `act_${adAccountId.replace('act_', '')}` : null
    });
  }

  if (!isConfigured) {
    return res.status(500).json({
      error: 'Meta Ads API not configured',
      message: 'Set META_ACCESS_TOKEN and META_AD_ACCOUNT_ID in Vercel environment variables.'
    });
  }

  // 本部 (headquarter/admin) ロールのみマーケティング API を利用可能
  const staffCtx = await extractStaffContext(req);
  if (staffCtx && staffCtx.valid === false) {
    return res.status(401).json({ error: '認証エラー: ' + (staffCtx.reason || 'invalid') });
  }
  if (!isMarketingAllowed(staffCtx)) {
    return res.status(403).json({ error: 'Marketing API は本部ロールのみ利用できます' });
  }

  if (!metaPath) {
    return res.status(400).json({ error: 'Missing path parameter' });
  }

  // Whitelist check
  const isAllowed = ALLOWED_EDGES.some(edge => metaPath.includes(edge));
  if (!isAllowed) {
    return res.status(403).json({ error: 'Endpoint not allowed', path: metaPath });
  }

  const accountId = `act_${adAccountId.replace('act_', '')}`;
  const apiVersion = process.env.META_API_VERSION || 'v21.0';

  // Build query parameters
  const queryParams = new URLSearchParams(req.query);
  queryParams.delete('path');
  queryParams.set('access_token', token);

  // For POST requests, merge body params
  if (req.method === 'POST' && req.body) {
    for (const [key, value] of Object.entries(req.body)) {
      if (key !== 'access_token') {
        queryParams.set(key, typeof value === 'object' ? JSON.stringify(value) : value);
      }
    }
  }

  const url = `https://graph.facebook.com/${apiVersion}/${accountId}/${metaPath}?${queryParams.toString()}`;

  try {
    const response = await fetch(url, { method: 'GET' });
    const data = await response.json();

    if (!response.ok) {
      // Add helpful hints for common Meta API errors
      if (data.error) {
        const code = data.error.code;
        const msg = (data.error.message || '').toLowerCase();
        if (code === 190 || msg.includes('expired') || msg.includes('invalid')) {
          data.error._hint = 'アクセストークンが無効または期限切れです。Meta Graph API Explorerで新しいトークンを発行してください。';
        } else if (msg.includes('blocked')) {
          data.error._hint = 'APIアクセスがブロックされています。アクセストークンの更新またはアプリの権限を確認してください。';
        }
      }
      return res.status(response.status).json(data);
    }

    return res.status(200).json(data);
  } catch (error) {
    console.error('Meta API proxy error:', error);
    return res.status(502).json({
      error: 'Failed to connect to Meta API',
      message: error.message
    });
  }
}
