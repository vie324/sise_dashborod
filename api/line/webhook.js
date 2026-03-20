// LINE Webhook Receiver - Vercel Serverless Function
// Receives messages from LINE and forwards to GAS for storage
// Each store has its own webhook URL: /api/line/webhook?store={id}

import crypto from 'crypto';

function getLineConfig(storeId) {
  if (!storeId) return null;
  const prefix = `LINE_STORE_${storeId}`;
  const token = process.env[`${prefix}_CHANNEL_ACCESS_TOKEN`] || process.env[`${prefix}_ACCESS_TOKEN`];
  const secret = process.env[`${prefix}_CHANNEL_SECRET`] || process.env[`${prefix}_SECRET`];
  if (!token || !secret) return null;
  return { token, secret };
}

function verifySignature(body, signature, secret) {
  const hash = crypto.createHmac('SHA256', secret).update(body).digest('base64');
  return hash === signature;
}

export default async function handler(req, res) {
  // LINE sends POST for webhooks
  if (req.method !== 'POST') return res.status(200).end();

  const storeId = req.query.store;
  if (!storeId) return res.status(400).json({ error: 'store query parameter required' });

  const config = getLineConfig(storeId);
  if (!config) return res.status(404).json({ error: 'Store not configured' });

  // Verify LINE signature
  const signature = req.headers['x-line-signature'];
  const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);

  if (!signature || !verifySignature(rawBody, signature, config.secret)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const events = body.events || [];

  // Forward message events to GAS for storage
  const gasUrl = process.env.GAS_WEBHOOK_URL;
  const messageEvents = events.filter(e => e.type === 'message' || e.type === 'follow' || e.type === 'unfollow');

  if (gasUrl && messageEvents.length > 0) {
    try {
      await fetch(gasUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'lineWebhook',
          storeId,
          events: messageEvents.map(e => ({
            type: e.type,
            timestamp: e.timestamp,
            replyToken: e.type === 'message' ? e.replyToken : undefined,
            userId: e.source?.userId || '',
            messageType: e.message?.type || '',
            messageText: e.message?.text || '',
            messageId: e.message?.id || '',
          })),
        }),
      });
    } catch (err) {
      console.error('Failed to forward to GAS:', err);
    }
  }

  // Also fetch user profiles for new messages and store them
  for (const event of messageEvents) {
    if (event.source?.userId && gasUrl) {
      try {
        const profileRes = await fetch(`https://api.line.me/v2/bot/profile/${event.source.userId}`, {
          headers: { 'Authorization': `Bearer ${config.token}` },
        });
        if (profileRes.ok) {
          const profile = await profileRes.json();
          await fetch(gasUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'lineProfile',
              storeId,
              userId: event.source.userId,
              displayName: profile.displayName || '',
              pictureUrl: profile.pictureUrl || '',
            }),
          });
        }
      } catch (err) {
        console.error('Failed to fetch LINE profile:', err);
      }
    }
  }

  // Always respond 200 to LINE
  return res.status(200).json({ success: true });
}
