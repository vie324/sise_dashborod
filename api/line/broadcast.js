// LINE Broadcast/Narrowcast - Vercel Serverless Function

function getLineConfig(storeId) {
  if (!storeId) return null;
  const prefix = `LINE_STORE_${storeId}`;
  const token = process.env[`${prefix}_CHANNEL_ACCESS_TOKEN`] || process.env[`${prefix}_ACCESS_TOKEN`];
  const secret = process.env[`${prefix}_CHANNEL_SECRET`] || process.env[`${prefix}_SECRET`];
  if (!token || !secret) return null;
  return { token, secret };
}

async function postToGas(gasUrl, data) {
  const response = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(data),
    redirect: 'follow',
  });
  return response;
}

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Store-Id');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const storeId = req.headers['x-store-id'] || req.query.store;
  if (!storeId) return res.status(400).json({ error: 'X-Store-Id header required' });

  const config = getLineConfig(storeId);
  if (!config) return res.status(500).json({ error: 'LINE not configured for this store' });

  const { messages, userIds, type } = req.body;
  // type: 'broadcast' (all followers), 'multicast' (specific users)

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array required' });
  }
  if (messages.length > 5) {
    return res.status(400).json({ error: 'Maximum 5 messages per request' });
  }

  try {
    let lineUrl, body;

    if (type === 'multicast' && userIds && userIds.length > 0) {
      // Send to specific users (max 500 per request)
      lineUrl = 'https://api.line.me/v2/bot/message/multicast';
      body = JSON.stringify({ to: userIds.slice(0, 500), messages });
    } else {
      // Broadcast to all followers
      lineUrl = 'https://api.line.me/v2/bot/message/broadcast';
      body = JSON.stringify({ messages });
    }

    const response = await fetch(lineUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      body,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return res.status(response.status).json(errorData);
    }

    // Record broadcast to GAS
    const gasUrl = process.env.GAS_WEBHOOK_URL;
    if (gasUrl) {
      await postToGas(gasUrl, {
        type: 'lineBroadcast',
        storeId,
        broadcastType: type === 'multicast' ? 'multicast' : 'broadcast',
        messageContent: JSON.stringify(messages),
        recipientCount: type === 'multicast' ? userIds.length : -1,
        timestamp: new Date().toISOString(),
      }).catch(err => console.error('Failed to log broadcast to GAS:', err));
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Broadcast error:', error);
    return res.status(502).json({ error: 'Failed to send broadcast', message: error.message });
  }
}
