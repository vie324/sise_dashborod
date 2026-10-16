import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ローカル開発サーバー（scripts/dev-server.mjs --mock-db）はメモリ上の疑似 DB を
// globalThis に差し込む。本番では存在しないので常に実際の Supabase を使う。
const devMock = globalThis.__SISE_SUPABASE_MOCK__ || null;

export const supabaseConfigured = !!devMock || !!(supabaseUrl && supabaseServiceKey);

if (!supabaseConfigured) {
  console.warn('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
}

// service_role key を使用 (Vercel API Routes からのみアクセス)
// フロントエンドには公開しない
// 未設定時（ローカル開発・テスト）は import 時に例外で落ちないよう仮の URL で
// クライアントを作る。クエリは接続エラーとして返り、呼び出し側で扱われる。
export const supabase = devMock || createClient(supabaseUrl || 'http://127.0.0.1:54321', supabaseServiceKey || 'unconfigured', {
  auth: { persistSession: false }
});
