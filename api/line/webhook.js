// LINE Webhook Receiver - Vercel Serverless Function
// Receives messages from LINE and persists directly to Supabase.
// Each store has its own webhook URL: /api/line/webhook?store={id}
//
// Design:
//   1. Verify signature with per-store CHANNEL_SECRET
//   2. Persist every (follow/unfollow/message) event to Supabase scoped by storeId
//   3. Resolve and upsert LINE profile (display_name, picture_url) scoped by storeId
//   4. Run auto-reply rules (scoped by storeId)
//   5. Best-effort mirror to legacy GAS so existing sheets stay warm
//
// Store scoping is strict: events received on /api/line/webhook?store=1
// are ONLY ever written with store_id='1'. No cross-store bleed possible.

import crypto from 'crypto';
import { supabase } from '../_lib/supabase.js';

export const config = {
  api: { bodyParser: false },
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
  const a = Buffer.from(hash);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function postToGas(gasUrl, data) {
  return fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(data),
    redirect: 'follow',
  });
}

// Fetch LINE profile and upsert into line_profiles. Returns displayName or ''.
async function fetchAndUpsertProfile(storeId, userId, accessToken) {
  if (!userId) return '';
  try {
    const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      // Blocked / deleted accounts return 404. Still upsert with empty name
      // so UI shows a stable "guest" avatar instead of a broken name.
      await supabase.from('line_profiles').upsert({
        user_id: userId, store_id: String(storeId),
        display_name: '', picture_url: '',
      }, { onConflict: 'user_id,store_id' });
      return '';
    }
    const profile = await res.json();
    const displayName = profile.displayName || '';
    const pictureUrl = profile.pictureUrl || '';
    await supabase.from('line_profiles').upsert({
      user_id: userId,
      store_id: String(storeId),
      display_name: displayName,
      picture_url: pictureUrl,
    }, { onConflict: 'user_id,store_id' });
    return displayName;
  } catch (err) {
    console.error('[LINE webhook] profile fetch error:', err);
    return '';
  }
}

// Persist one LINE event to Supabase. Store scoping is enforced here.
// LINE Platform は webhook の再送を行うことがあり、同じ event が複数回
// 到達して line_messages に重複挿入される可能性がある。message.id をキーに
// 到達済み判定を行って冪等化する (follow/unfollow は message.id が無いので
// 対象外 — 同じ user から短時間に複数回 follow する設計でない限り実害なし)。
async function persistEvent(storeId, event) {
  const sid = String(storeId);
  const userId = event.source?.userId || '';
  if (!userId) return;

  if (event.type === 'message') {
    const messageId = event.message?.id || '';
    // LINE message.id が存在する場合は重複チェック。同じ (store, message_id)
    // が既に存在すればスキップ (再送対策)。
    if (messageId) {
      const { data: existing } = await supabase
        .from('line_messages')
        .select('id').eq('store_id', sid).eq('message_id', messageId).limit(1).maybeSingle();
      if (existing) {
        console.log('[LINE webhook] duplicate message skipped:', messageId);
        return;
      }
    }
    const msgType = event.message?.type || 'text';
    const text = event.message?.text
      || (msgType === 'image' ? '[画像]' : msgType === 'sticker' ? '[スタンプ]'
        : msgType === 'video' ? '[動画]' : msgType === 'audio' ? '[音声]'
        : msgType === 'location' ? '[位置情報]' : msgType === 'file' ? '[ファイル]' : '');
    await supabase.from('line_messages').insert({
      store_id: sid,
      user_id: userId,
      direction: 'received',
      message_type: msgType,
      message_text: text,
      message_id: messageId,
      timestamp: event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString(),
    });
  } else if (event.type === 'follow' || event.type === 'unfollow') {
    await supabase.from('line_messages').insert({
      store_id: sid,
      user_id: userId,
      direction: 'received',
      message_type: event.type,
      message_text: event.type === 'follow' ? '友だち追加' : 'ブロック',
      message_id: '',
      timestamp: event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString(),
    });
  }
}

// Run auto-reply matching for a single message event
async function runAutoReply(storeId, event, accessToken) {
  if (event.type !== 'message' || !event.replyToken) return;
  const text = event.message?.text || '';
  if (!text) return;

  const { data: rules, error } = await supabase
    .from('line_auto_replies')
    .select('*')
    .eq('store_id', String(storeId))
    .eq('enabled', true)
    .order('priority', { ascending: false });
  if (error || !rules || rules.length === 0) return;

  let matched = null;
  for (const rule of rules) {
    const method = rule.match_method || 'contains';
    if (method === 'exact' && text === rule.keyword) { matched = rule; break; }
    if (method === 'contains' && rule.keyword && text.includes(rule.keyword)) { matched = rule; break; }
    if (method === 'regex') {
      try { if (new RegExp(rule.keyword).test(text)) { matched = rule; break; } } catch (_) {}
    }
  }
  if (!matched) return;

  let replyMessage;
  if (matched.reply_type === 'flex') {
    try {
      replyMessage = { type: 'flex', altText: matched.keyword || 'メッセージ', contents: JSON.parse(matched.reply_content) };
    } catch (_) {
      replyMessage = { type: 'text', text: matched.reply_content || '' };
    }
  } else {
    replyMessage = { type: 'text', text: matched.reply_content || '' };
  }

  try {
    const res = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ replyToken: event.replyToken, messages: [replyMessage] }),
    });
    if (res.ok) {
      // Persist the outbound auto-reply so it shows up in the chat history
      await supabase.from('line_messages').insert({
        store_id: String(storeId),
        user_id: event.source?.userId || '',
        direction: 'sent',
        message_type: 'text',
        message_text: '[自動応答] ' + (matched.reply_type === 'flex' ? (matched.keyword || '') : (matched.reply_content || '')),
        message_id: '',
      });
    }
  } catch (err) {
    console.error('[LINE webhook] auto-reply send error:', err);
  }
}

export default async function handler(req, res) {
  // LINE health-check uses GET
  if (req.method === 'GET') return res.status(200).json({ status: 'ok' });
  if (req.method !== 'POST') return res.status(200).end();

  const storeId = req.query.store;
  if (!storeId) return res.status(400).json({ error: 'store query parameter required' });

  const lineConfig = getLineConfig(storeId);
  if (!lineConfig) {
    console.error('[LINE webhook] Store not configured:', storeId);
    return res.status(404).json({ error: 'Store not configured', storeId });
  }

  let rawBody;
  try {
    rawBody = await getRawBody(req);
  } catch (err) {
    console.error('[LINE webhook] read body error:', err);
    return res.status(400).json({ error: 'Failed to read body' });
  }

  const signature = req.headers['x-line-signature'];
  if (!signature) return res.status(401).json({ error: 'Missing x-line-signature header' });

  try {
    if (!verifySignature(rawBody, signature, lineConfig.secret)) {
      console.error('[LINE webhook] Signature mismatch for store:', storeId);
      return res.status(401).json({ error: 'Invalid signature' });
    }
  } catch (err) {
    console.error('[LINE webhook] Signature verification error:', err);
    return res.status(401).json({ error: 'Signature verification failed' });
  }

  let body;
  try {
    body = JSON.parse(rawBody.toString('utf-8'));
  } catch (err) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const events = body.events || [];
  if (events.length === 0) {
    return res.status(200).json({ success: true, message: 'Webhook verified' });
  }

  // Track unique userIds to fetch profiles once per event batch
  const userIdsNeedingProfile = new Set();
  for (const ev of events) {
    if (ev.source?.userId && (ev.type === 'message' || ev.type === 'follow')) {
      userIdsNeedingProfile.add(ev.source.userId);
    }
  }

  // 1. Refresh profiles (store-scoped)
  await Promise.all(
    [...userIdsNeedingProfile].map(uid =>
      fetchAndUpsertProfile(storeId, uid, lineConfig.token)
    )
  );

  // 2. Persist events (store-scoped)
  await Promise.all(events.map(ev => persistEvent(storeId, ev).catch(err => {
    console.error('[LINE webhook] persistEvent error:', err);
  })));

  // 3. Run auto-reply (store-scoped)
  await Promise.all(events.map(ev => runAutoReply(storeId, ev, lineConfig.token).catch(err => {
    console.error('[LINE webhook] autoReply error:', err);
  })));

  // 4. Best-effort mirror to GAS for legacy sheets
  const gasUrl = process.env.GAS_WEBHOOK_URL;
  const relay = events.filter(e => e.type === 'message' || e.type === 'follow' || e.type === 'unfollow');
  if (gasUrl && relay.length > 0) {
    postToGas(gasUrl, {
      type: 'lineWebhook',
      storeId,
      events: relay.map(e => ({
        type: e.type,
        timestamp: e.timestamp,
        replyToken: e.type === 'message' ? e.replyToken : undefined,
        userId: e.source?.userId || '',
        messageType: e.message?.type || '',
        messageText: e.message?.text || '',
        messageId: e.message?.id || '',
      })),
    }).catch(err => console.error('[LINE webhook] GAS relay error:', err));
  }

  return res.status(200).json({ success: true, processed: events.length });
}
