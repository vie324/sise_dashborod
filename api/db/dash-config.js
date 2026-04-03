import { supabase } from '../_lib/supabase.js';
import { cors } from '../_lib/cors.js';

export default async function handler(req, res) {
  if (cors(req, res)) return;

  try {
    if (req.method === 'GET') {
      return res.json(await handleGet(req.query));
    }
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      return res.json(await handlePost(body));
    }
    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('dash-config error:', e);
    res.status(500).json({ error: e.message });
  }
}

// GET: 設定取得
async function handleGet(params) {
  if (params.key) {
    // 個別キー取得
    const { data, error } = await supabase
      .from('dash_config')
      .select('*')
      .eq('key', params.key)
      .maybeSingle();
    if (error) throw error;

    return { key: params.key, value: data ? data.value : null };
  }

  // 全設定取得
  const { data, error } = await supabase.from('dash_config').select('*');
  if (error) throw error;

  const config = {};
  for (const row of data || []) {
    config[row.key] = row.value;
  }
  return { config };
}

// POST: 設定保存
async function handlePost(body) {
  const action = body.action || '';

  switch (action) {
    case 'set': {
      if (!body.key) return { error: 'keyが必要です' };
      const { error } = await supabase
        .from('dash_config')
        .upsert({ key: body.key, value: body.value }, { onConflict: 'key' });
      if (error) throw error;
      return { success: true, key: body.key };
    }

    case 'setBulk': {
      const entries = body.entries || {};
      const rows = Object.entries(entries).map(([k, v]) => ({ key: k, value: v }));
      if (rows.length > 0) {
        const { error } = await supabase
          .from('dash_config')
          .upsert(rows, { onConflict: 'key' });
        if (error) throw error;
      }
      return { success: true, count: rows.length };
    }

    default:
      return { error: '不明なaction: ' + action };
  }
}
