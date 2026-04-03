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
    console.error('reports error:', e);
    res.status(500).json({ error: e.message });
  }
}

// GET: 日報データ取得 (GAS互換レスポンス形式)
async function handleGet(params) {
  let query = supabase
    .from('daily_reports')
    .select('*')
    .order('timestamp', { ascending: false });

  // 日付フィルタ
  if (params.all === 'true') {
    // 全データ - フィルタなし
  } else if (params.month) {
    // 特定月 (YYYY-MM)
    const [y, m] = params.month.split('-').map(Number);
    const start = new Date(y, m - 1, 1).toISOString();
    const end = new Date(y, m, 0, 23, 59, 59).toISOString();
    query = query.gte('timestamp', start).lte('timestamp', end);
  } else if (params.months) {
    // 直近N ヶ月
    const n = parseInt(params.months) || 1;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - (n - 1), 1).toISOString();
    query = query.gte('timestamp', start);
  } else {
    // デフォルト: 当月
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    query = query.gte('timestamp', start);
  }

  const { data, error } = await query;
  if (error) throw error;

  // GAS互換のレスポンス形式に変換
  const reports = (data || []).map(r => ({
    id: r.id,
    timestamp: r.timestamp,
    store: r.store,
    hpbNew: r.hpb_new,
    metaNew: r.meta_new,
    referralNew: r.referral_new,
    discountNew: r.discount_new,
    hpbContract: r.hpb_contract,
    metaContract: r.meta_contract,
    referralContract: r.referral_contract,
    discountContract: r.discount_contract,
    existingTreatments: r.existing_treatments,
    taskComplete: r.task_complete,
    prepComplete: r.prep_complete
  }));

  return { reports, total: reports.length, lastUpdated: new Date().toISOString() };
}

// POST: 日報の作成・更新・削除
async function handlePost(body) {
  const action = body.action || 'create';

  switch (action) {
    case 'create': return createReport(body.report || body);
    case 'update': return updateReport(body.report || body);
    case 'delete': return deleteReport(body.id);
    default:
      return { error: '不明なaction: ' + action };
  }
}

async function createReport(report) {
  if (!report.store) return { error: '店舗が必要です' };

  const row = {
    timestamp: report.timestamp || new Date().toISOString(),
    store: report.store,
    hpb_new: parseInt(report.hpbNew) || 0,
    meta_new: parseInt(report.metaNew) || 0,
    referral_new: parseInt(report.referralNew) || 0,
    discount_new: parseInt(report.discountNew) || 0,
    hpb_contract: parseInt(report.hpbContract) || 0,
    meta_contract: parseInt(report.metaContract) || 0,
    referral_contract: parseInt(report.referralContract) || 0,
    discount_contract: parseInt(report.discountContract) || 0,
    existing_treatments: parseInt(report.existingTreatments) || 0,
    task_complete: !!report.taskComplete,
    prep_complete: !!report.prepComplete
  };

  const { data, error } = await supabase
    .from('daily_reports')
    .insert(row)
    .select()
    .single();
  if (error) throw error;

  return { success: true, report: data };
}

async function updateReport(report) {
  if (!report.id) return { error: 'idが必要です' };

  const updates = {};
  if (report.store !== undefined)              updates.store = report.store;
  if (report.hpbNew !== undefined)             updates.hpb_new = parseInt(report.hpbNew) || 0;
  if (report.metaNew !== undefined)            updates.meta_new = parseInt(report.metaNew) || 0;
  if (report.referralNew !== undefined)        updates.referral_new = parseInt(report.referralNew) || 0;
  if (report.discountNew !== undefined)        updates.discount_new = parseInt(report.discountNew) || 0;
  if (report.hpbContract !== undefined)        updates.hpb_contract = parseInt(report.hpbContract) || 0;
  if (report.metaContract !== undefined)       updates.meta_contract = parseInt(report.metaContract) || 0;
  if (report.referralContract !== undefined)   updates.referral_contract = parseInt(report.referralContract) || 0;
  if (report.discountContract !== undefined)   updates.discount_contract = parseInt(report.discountContract) || 0;
  if (report.existingTreatments !== undefined) updates.existing_treatments = parseInt(report.existingTreatments) || 0;
  if (report.taskComplete !== undefined)       updates.task_complete = !!report.taskComplete;
  if (report.prepComplete !== undefined)       updates.prep_complete = !!report.prepComplete;

  const { error } = await supabase
    .from('daily_reports')
    .update(updates)
    .eq('id', report.id);
  if (error) throw error;

  return { success: true, id: report.id };
}

async function deleteReport(id) {
  if (!id) return { error: 'idが必要です' };

  const { error } = await supabase.from('daily_reports').delete().eq('id', id);
  if (error) throw error;

  return { success: true, id };
}
