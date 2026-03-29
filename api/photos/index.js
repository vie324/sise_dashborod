// Photo API - Vercel Serverless Function
// POST: Upload Base64 image to Vercel Blob Storage
// GET: List uploaded photos from Vercel Blob Storage

import { put, list } from '@vercel/blob';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

export default async function handler(req, res) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({
      error: 'Storage not configured',
      message: 'BLOB_READ_WRITE_TOKEN environment variable is not set.',
    });
  }

  // GET: List photos
  if (req.method === 'GET') {
    try {
      const { folder, limit: limitParam } = req.query;
      const prefix = folder ? `photos/${folder}/` : 'photos/';
      const { blobs } = await list({
        prefix,
        limit: parseInt(limitParam) || 50,
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

  // POST: Upload photo
  if (req.method === 'POST') {
    try {
      const { imageData, fileName, folder } = req.body;
      if (!imageData) {
        return res.status(400).json({ error: 'imageData is required' });
      }
      const matches = imageData.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!matches) {
        return res.status(400).json({ error: 'Invalid image data format. Expected base64 data URI.' });
      }
      const extension = matches[1] === 'jpeg' ? 'jpg' : matches[1];
      const base64Data = matches[2];
      const buffer = Buffer.from(base64Data, 'base64');
      const timestamp = Date.now();
      const sanitizedName = (fileName || 'photo').replace(/[^a-zA-Z0-9_\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF-]/g, '_');
      const folderPath = folder ? `photos/${folder}` : 'photos';
      const blobPath = `${folderPath}/${timestamp}_${sanitizedName}.${extension}`;

      const blob = await put(blobPath, buffer, {
        access: 'public',
        contentType: `image/${matches[1]}`,
      });

      return res.status(200).json({
        success: true,
        url: blob.url,
        pathname: blob.pathname,
        size: buffer.length,
      });
    } catch (error) {
      console.error('Photo upload error:', error);
      return res.status(500).json({ error: 'Upload failed', message: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
