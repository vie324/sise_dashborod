// ============================================================
// ローカル開発サーバー（Vercel CLI なしで画面と API を動かす）
// ------------------------------------------------------------
//   npm run build && node scripts/dev-server.mjs            実際の Supabase を使う（.env.local を読む）
//   node scripts/dev-server.mjs --mock-db                    メモリ上の疑似 DB（.dev-data/db.json）
//   PORT=4000 node scripts/dev-server.mjs                     ポート変更
//   SISE_MOCK_DB_FILE=.dev-data/other.json                   疑似 DB のファイルを分ける
// SalonOne は SALONONE_API_KEY が無ければデモデータで動く。
// カウンセリング（GAS）は COUNSELING_GAS_URL が無ければ、--mock-db のとき疑似 GAS（scripts/dev/gas-fake.mjs）を使う。
// 画面の変更を反映するには別ターミナルで npm run watch を動かしておく。
// ============================================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const useMock = args.includes('--mock-db') || process.env.SISE_MOCK_DB === '1';
const port = Number(process.env.PORT || 3000);

// .env.local / .env を読み込む（既に設定済みの値は上書きしない）
for (const name of ['.env.local', '.env']) {
  const p = path.join(root, name);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

if (useMock) {
  const { createMockClient } = await import('./dev/supabase-mock.mjs');
  const dbFile = process.env.SISE_MOCK_DB_FILE || path.join(root, '.dev-data/db.json');
  globalThis.__SISE_SUPABASE_MOCK__ = createMockClient(dbFile);
  console.log(`疑似 DB を使用します (${path.relative(root, dbFile)})`);
}

// 疑似カウンセリング GAS（同じサーバーの /__fake-gas/exec で返す）
const FAKE_GAS_PATH = '/__fake-gas/exec';
// COUNSELING_GAS_URL= （空）で起動すると、疑似 GAS を使わず「未設定」の画面を確かめられる
const fakeGas = useMock && process.env.COUNSELING_GAS_URL === undefined ? (await import('./dev/gas-fake.mjs')).fakeGas : null;
if (fakeGas) {
  process.env.COUNSELING_GAS_URL = `http://127.0.0.1:${port}${FAKE_GAS_PATH}`;
  console.log('カウンセリングは疑似 GAS を使用します（設定 → カウンセリング で店舗を対応付けてください）');
}

const ROUTES = {
  '/api/db': 'api/db/index.js',
  '/api/salonone': 'api/salonone/index.js',
  '/api/claude/advice': 'api/claude/advice.js',
};
const handlers = {};
async function handlerFor(p) {
  if (!handlers[p]) handlers[p] = (await import(pathToFileURL(path.join(root, ROUTES[p])).href)).default;
  return handlers[p];
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => resolve(data));
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (fakeGas && url.pathname === FAKE_GAS_PATH) {
    const out = fakeGas(url);
    res.writeHead(out.status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(out.body));
    return;
  }
  if (ROUTES[url.pathname]) {
    const raw = req.method === 'POST' ? await readBody(req) : '';
    let body = raw;
    try { body = raw ? JSON.parse(raw) : {}; } catch (_) { /* そのまま渡す */ }
    const vreq = { method: req.method, headers: req.headers, query: Object.fromEntries(url.searchParams), body, url: req.url };
    const vres = {
      statusCode: 200,
      headersSent: false,
      writableEnded: false,
      setHeader(k, v) { res.setHeader(k, v); },
      status(code) { this.statusCode = code; return this; },
      json(obj) {
        res.writeHead(this.statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(obj));
        this.writableEnded = true;
        this.headersSent = true;
      },
      end(text) { res.writeHead(this.statusCode); res.end(text); this.writableEnded = true; },
    };
    try {
      await (await handlerFor(url.pathname))(vreq, vres);
    } catch (e) {
      console.error(e);
      if (!vres.writableEnded) vres.status(500).json({ error: e.message });
    }
    return;
  }

  let file = path.join(root, 'public', decodeURIComponent(url.pathname));
  if (!file.startsWith(path.join(root, 'public'))) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'public/index.html');
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

server.listen(port, () => {
  console.log(`si'se dashboard: http://localhost:${port}`);
});
