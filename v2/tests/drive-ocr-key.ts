import assert from 'node:assert/strict';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { normalizePrivateKey } from '../src/lib/drive-ocr';

/**
 * private key ของ service account ที่วางลง Vercel มาได้หลายหน้าตา
 * ทุกแบบต้องเซ็น JWT ได้ ไม่งั้นอ่าน Slip ไม่ได้ทั้งระบบ โดยได้แค่ error ของ OpenSSL ที่อ่านไม่ออก
 */

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const escaped = pem.replace(/\n/g, '\\n');                 // แบบที่อยู่ในไฟล์ JSON

const variants: Record<string, string> = {
  'PEM ขึ้นบรรทัดจริง': pem,
  '\\n เป็นอักษรสองตัว': escaped,
  'ติดเครื่องหมายคำพูด': `"${escaped}"`,
  'ติดคำพูดและลูกน้ำจาก JSON': `"${escaped}",`,
  'ทั้งไฟล์ JSON': JSON.stringify({ type: 'service_account', private_key: pem, client_email: 'x@y.iam.gserviceaccount.com' }),
  'ขึ้นบรรทัดหายกลายเป็นช่องว่าง': pem.replace(/\n/g, ' '),
  'ขึ้นบรรทัดแบบ Windows': pem.replace(/\n/g, '\r\n'),
  '\\r\\n เป็นอักษร': pem.replace(/\n/g, '\\r\\n'),
  'เนื้อกุญแจอย่างเดียว ไม่มีหัวท้าย': pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''),
};

for (const [name, value] of Object.entries(variants)) {
  const key = normalizePrivateKey(value);
  assert.doesNotThrow(() => createSign('RSA-SHA256').update('x').sign(key), name);
}
assert.equal(normalizePrivateKey(''), '');
assert.equal(normalizePrivateKey(undefined), '');

console.log(`PASS: service account key accepted in ${Object.keys(variants).length} paste formats`);
