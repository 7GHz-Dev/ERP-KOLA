'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

// เลือกสะพานเชื่อมข้อมูล: ถ้ามี dev-config.json พร้อม execUrl ให้ใช้ของจริง
// ถ้าไม่มี ให้ถอยกลับไปใช้ข้อมูลจำลองเหมือนเดิม
const configPath = path.join(root, 'dev-config.json');
let bridgePath = path.join(__dirname, 'preview-mock.js');
let bridgeMode = 'mock';
if (fs.existsSync(configPath)) {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (config.execUrl) {
      bridgePath = path.join(__dirname, 'live-bridge.js');
      bridgeMode = 'live';
    }
  } catch (error) {
    console.warn('[build-preview] อ่าน dev-config.json ไม่ได้ ใช้ข้อมูลจำลองแทน:', error.message);
  }
}

let html = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
html = html
  .replace(/\s*<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/3\.11\.174\/pdf\.min\.js"><\/script>/, '')
  .replace(/<\?= appName \?>/g, 'KOLA Import ERP')
  .replace(/<\?= appVersion \?>/g, '1.1.0')
  .replace(/<\?!= include_\('Styles'\); \?>/g, fs.readFileSync(path.join(root, 'Styles.html'), 'utf8'))
  .replace(/<\?!= include_\('MockupStyles'\); \?>/g, fs.readFileSync(path.join(root, 'MockupStyles.html'), 'utf8'))
  .replace(/<\?!= include_\('AppScripts'\); \?>/g,
    `<script>${fs.readFileSync(bridgePath, 'utf8')}</script>\n` +
    fs.readFileSync(path.join(root, 'AppScripts.html'), 'utf8'));
fs.writeFileSync(path.join(__dirname, 'preview.html'), html);
console.log('Built test/preview.html (โหมด: ' + bridgeMode + ')');
