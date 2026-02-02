const http = require('http');
const https = require('https');
const url = require('url');

// Square API設定
const SQUARE_CONFIG = {
    accessToken: 'EAAAl5R0doojggXSLfNzzTaBW2g3DWJM3o1Koiz2Rml13JpHPLDbSq98qPeGwIu0',
    locationId: 'LCEDWZPT7QHJ3',
    baseUrl: 'https://connect.squareupsandbox.com/v2'
};

const PORT = 3000;

const server = http.createServer((req, res) => {
    // CORS設定
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // プリフライトリクエストの処理
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    console.log(`[${new Date().toISOString()}] ${req.method} ${pathname}`);

    // Square APIへのプロキシ
    if (pathname.startsWith('/api/square')) {
        const squareEndpoint = pathname.replace('/api/square', '');
        const squareUrl = `${SQUARE_CONFIG.baseUrl}${squareEndpoint}`;

        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', () => {
            const options = {
                method: req.method,
                headers: {
                    'Authorization': `Bearer ${SQUARE_CONFIG.accessToken}`,
                    'Content-Type': 'application/json',
                    'Square-Version': '2024-01-18'
                }
            };

            const squareReq = https.request(squareUrl, options, (squareRes) => {
                let data = '';

                squareRes.on('data', chunk => {
                    data += chunk;
                });

                squareRes.on('end', () => {
                    res.writeHead(squareRes.statusCode, {
                        'Content-Type': 'application/json',
                        'Access-Control-Allow-Origin': '*'
                    });
                    res.end(data);
                    console.log(`  → Status: ${squareRes.statusCode}`);
                });
            });

            squareReq.on('error', (error) => {
                console.error('Square API Error:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: error.message }));
            });

            if (body) {
                squareReq.write(body);
            }
            squareReq.end();
        });

    } else if (pathname === '/' || pathname === '/index.html') {
        // index.htmlを返す
        const fs = require('fs');
        fs.readFile('./index.html', (err, data) => {
            if (err) {
                res.writeHead(404);
                res.end('File not found');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    }
});

server.listen(PORT, () => {
    console.log('========================================');
    console.log('🚀 si\'se Dashboard Server Started!');
    console.log('========================================');
    console.log(`📍 URL: http://localhost:${PORT}`);
    console.log(`🔧 Square API: ${SQUARE_CONFIG.baseUrl}`);
    console.log(`📍 Location ID: ${SQUARE_CONFIG.locationId}`);
    console.log('========================================');
    console.log('');
    console.log('ブラウザで http://localhost:3000 を開いてください');
    console.log('');
    console.log('サーバーを停止するには Ctrl+C を押してください');
    console.log('');
});
