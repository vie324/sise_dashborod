// LINE Webhook Receiver - Vercel Serverless Function
// Receives messages from LINE and forwards to GAS for storage
// Each store has its own webhook URL: /api/line/webhook?store={id}

import crypto from 'crypto';

// Disable Vercel's automatic body parsing to get raw body for signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

function getLineConfig(storeId) {
  if (!storeId) return null;
  const prefix = `LINE_STORE_${storeId}`;
  const token = process.env[`${prefix}_CHANNEL_ACCESS_TOKEN`] || process.env[`${prefix}_ACCESS_TOKEN`];
  const secret = process.env[`${prefix}_CHANNEL_SECRET`] || process.env[`${prefix}_SECRET`];
  if (!token || !secret) return null;
  return { token, secret };
}

function verifySignature(rawBody, signature, secret) {
  const hash = crypto.createHmac('SHA256', secret).update(rawBody).digest('base64');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(signature));
}

// Read raw body from request stream
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// POST to GAS with redirect handling (GAS returns 302 which converts POST→GET, losing body)
async function postToGas(gasUrl, data) {
  const jsonBody = JSON.stringify(data);
  const response = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: jsonBody,
    redirect: 'follow',
  });
  return response;
}

export default async function handler(req, res) {
  // LINE sends POST for webhooks, but also verify endpoint with GET
  if (req.method === 'GET') return res.status(200).json({ status: 'ok' });
  if (req.method !== 'POST') return res.status(200).end();

  const storeId = req.query.store;
  if (!storeId) return res.status(400).json({ error: 'store query parameter required' });

  const lineConfig = getLineConfig(storeId);
  if (!lineConfig) {
    console.error('Store not configured:', storeId);
    return res.status(404).json({ error: 'Store not configured', storeId });
  }

  // Read raw body for accurate signature verification
  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (err) {
    console.error('Failed to read request body:', err);
    return res.status(400).json({ error: 'Failed to read body' });
  }

  // Verify LINE signature against raw body bytes
  const signature = req.headers['x-line-signature'];
  if (!signature) {
    console.error('Missing x-line-signature header');
    return res.status(401).json({ error: 'Missing x-line-signature header' });
  }

  try {
    if (!verifySignature(rawBody, signature, lineConfig.secret)) {
      console.error('Signature mismatch for store:', storeId);
      return res.status(401).json({ error: 'Invalid signature' });
    }
  } catch (err) {
    console.error('Signature verification error:', err);
    return res.status(401).json({ error: 'Signature verification failed' });
  }

  // Parse the body after signature verification
  let body;
  try {
    body = JSON.parse(rawBody.toString('utf-8'));
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const events = body.events || [];

  // LINE sends a verification request with empty events on webhook URL registration
  if (events.length === 0) {
    return res.status(200).json({ success: true, message: 'Webhook verified' });
  }

  // Forward message events to GAS for storage
  const gasUrl = process.env.GAS_WEBHOOK_URL;
  const messageEvents = events.filter(e => e.type === 'message' || e.type === 'follow' || e.type === 'unfollow');

  if (gasUrl && messageEvents.length > 0) {
    try {
      const gasRes = await postToGas(gasUrl, {
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
      });
      console.log('GAS webhook response:', gasRes.status);
    } catch (err) {
      console.error('Failed to forward to GAS:', err);
    }
  }

  // Also fetch user profiles for new messages and store them
  for (const event of messageEvents) {
    if (event.source?.userId && gasUrl) {
      try {
        const profileRes = await fetch(`https://api.line.me/v2/bot/profile/${event.source.userId}`, {
          headers: { 'Authorization': `Bearer ${lineConfig.token}` },
        });
        if (profileRes.ok) {
          const profile = await profileRes.json();
          await postToGas(gasUrl, {
            type: 'lineProfile',
            storeId,
            userId: event.source.userId,
            displayName: profile.displayName || '',
            pictureUrl: profile.pictureUrl || '',
          });
        }
      } catch (err) {
        console.error('Failed to fetch LINE profile:', err);
      }
    }
  }

  // Always respond 200 to LINE
  return res.status(200).json({ success: true, processed: messageEvents.length });
}
