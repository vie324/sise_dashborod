// Photo List API - Vercel Serverless Function
// Lists uploaded photos from Vercel Blob Storage

import { list } from '@vercel/blob';

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ error: 'Storage not configured' });
  }

  try {
    const { folder, limit } = req.query;
    const prefix = folder ? `photos/${folder}/` : 'photos/';

    const { blobs } = await list({
      prefix,
      limit: parseInt(limit) || 50,
    });

    return res.status(200).json({
      success: true,
      photos: blobs.map(b => ({
        url: b.url,
        pathname: b.pathname,
        size: b.size,
        uploadedAt: b.uploadedAt,
      })),
    });
  } catch (error) {
    console.error('Photo list error:', error);
    return res.status(500).json({ error: 'List failed', message: error.message });
  }
}
