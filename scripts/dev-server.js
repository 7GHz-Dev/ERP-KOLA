'use strict';
/**
 * Local dev server for the KOLA Import ERP frontend.
 *
 * - Builds test/preview.html from the real GAS template files (Index.html,
 *   Styles.html, MockupStyles.html, AppScripts.html) with google.script.run
 *   mocked out (test/preview-mock.js), so the UI runs in a plain browser
 *   with no Apps Script deployment needed.
 * - Serves the test/ directory over HTTP so the sample PDFs are reachable
 *   too (drag one into the upload UI to exercise the real PDF.js parsing).
 * - Watches the source template files and rebuilds automatically on save.
 *
 * Usage: npm run dev   (then open the printed URL)
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const testDir = path.join(root, 'test');
const buildScript = path.join(testDir, 'build-preview.js');
const port = Number(process.env.PORT) || 5173;

// ปลายทาง Apps Script web app สำหรับ proxy ข้อมูลจริง (ดู dev-config.json.example)
const configPath = path.join(root, 'dev-config.json');
const MAX_BODY_BYTES = 32 * 1024 * 1024;
let execUrl = process.env.KOLA_EXEC_URL || '';
if (!execUrl && fs.existsSync(configPath)) {
  try {
    execUrl = JSON.parse(fs.readFileSync(configPath, 'utf8')).execUrl || '';
  } catch (error) {
    console.warn('[dev-server] อ่าน dev-config.json ไม่ได้:', error.message);
  }
}

const watchedFiles = [
  path.join(root, 'Index.html'),
  path.join(root, 'Styles.html'),
  path.join(root, 'MockupStyles.html'),
  path.join(root, 'AppScripts.html'),
  path.join(testDir, 'preview-mock.js'),
];

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function build() {
  const startedAt = Date.now();
  try {
    execFileSync(process.execPath, [buildScript], { stdio: 'inherit' });
    console.log(`[dev-server] rebuilt preview.html (${Date.now() - startedAt}ms)`);
  } catch (error) {
    console.error('[dev-server] build failed:', error.message);
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

/**
 * ส่งต่อ rpc ไปยัง Apps Script web app จากฝั่งเซิร์ฟเวอร์
 * ทำที่นี่เพื่อเลี่ยงปัญหา CORS และ redirect ของ /exec ที่เบราว์เซอร์จัดการเองไม่ได้
 */
function proxyApi(req, res) {
  if (!execUrl) {
    sendJson(res, 503, { ok: false, error: 'NO_CONFIG|ไม่พบ execUrl กรุณาตั้งค่าใน dev-config.json' });
    return;
  }

  const chunks = [];
  let size = 0;
  let aborted = false;

  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      aborted = true;
      sendJson(res, 413, { ok: false, error: 'PAYLOAD_TOO_LARGE|ข้อมูลที่ส่งใหญ่เกินไป' });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', async () => {
    if (aborted) return;
    try {
      const upstream = await fetch(execUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.concat(chunks).toString('utf8'),
        redirect: 'follow'
      });
      const text = await upstream.text();
      const contentType = upstream.headers.get('content-type') || '';

      if (!contentType.includes('application/json')) {
        console.error('[dev-server] Apps Script ไม่ได้ตอบ JSON:', text.slice(0, 300));
        sendJson(res, 502, {
          ok: false,
          error: 'BAD_UPSTREAM|Apps Script ไม่ได้ตอบเป็น JSON อาจยังไม่ได้ deploy เวอร์ชันที่มี doPost หรือสิทธิ์เข้าถึงไม่ถูกต้อง'
        });
        return;
      }

      res.writeHead(upstream.status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(text);
    } catch (error) {
      console.error('[dev-server] proxy ล้มเหลว:', error.message);
      sendJson(res, 502, { ok: false, error: 'PROXY_FAILED|' + error.message });
    }
  });
}

function serve(req, res) {
  const requestPath = decodeURIComponent(req.url.split('?')[0]);
  if (requestPath === '/api') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED|ต้องเรียกด้วย POST' });
      return;
    }
    proxyApi(req, res);
    return;
  }

  const relative = requestPath === '/' ? '/preview.html' : requestPath;
  const filePath = path.join(testDir, relative);

  if (!filePath.startsWith(testDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found: ' + relative);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

build();

let rebuildTimer = null;
watchedFiles.forEach((file) => {
  fs.watch(file, () => {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(build, 150);
  });
});

http.createServer(serve).listen(port, () => {
  console.log(`[dev-server] KOLA ERP preview running at http://localhost:${port}/`);
  console.log('[dev-server] editing Index.html / Styles.html / MockupStyles.html / AppScripts.html auto-rebuilds. Refresh the browser after each save.');
  if (execUrl) {
    console.log('[dev-server] โหมด LIVE: /api ส่งต่อไปยัง ' + execUrl);
    console.log('[dev-server] ข้อมูลทั้งหมดมาจาก Google Sheets ตัวจริง - การแก้ไขมีผลจริง');
  } else {
    console.log('[dev-server] โหมด MOCK: ไม่พบ execUrl ใน dev-config.json จึงใช้ข้อมูลจำลอง');
  }
});
