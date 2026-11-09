/**
 * Sale — ราคาเก็บลูกค้า และข้อมูลค่าใช้จ่ายพิเศษจาก SHIPME (ฟังก์ชันล้วน ไม่แตะฐานข้อมูล)
 *   npm run test:sale
 */
import assert from 'node:assert/strict';
import { lineAmount, priceTotal, validateLines } from '../src/lib/sale/pricing';
import { itemsTotal, parseShipmePayload } from '../src/lib/sale/charges';

// --- ราคา ---
assert.equal(lineAmount({ quantity: 3, unitPrice: 0.1 }), 0.3, 'คิดเป็นสตางค์ ไม่ใช่ 0.30000000000000004');
assert.equal(priceTotal([{ quantity: 1, unitPrice: 0.1 }, { quantity: 1, unitPrice: 0.2 }]), 0.3);
assert.equal(priceTotal([{ quantity: 2, unitPrice: 4500 }, { quantity: 1, unitPrice: 1250.5 }]), 10250.5);

let v = validateLines([
  { description: 'ค่าพิธีการศุลกากร', unit: 'JOB', quantity: '1', unitPrice: '3,500' },
  { description: 'ค่าขนส่ง', unit: 'CONTAINER', quantity: 2, unitPrice: 4500 },
  { description: '', unit: 'JOB', quantity: 1, unitPrice: '' },          // แถวว่าง ข้าม
]);
assert.equal(v.error, null);
assert.equal(v.lines.length, 2);
assert.equal(v.total, 12500);
assert.equal(v.lines[1].amount, 9000);

assert.match(validateLines([{ description: 'x', unit: 'BOX', quantity: 1, unitPrice: 1 }]).error ?? '', /หน่วย/);
assert.match(validateLines([{ description: 'x', unit: 'JOB', quantity: 0, unitPrice: 1 }]).error ?? '', /จำนวน/);
assert.match(validateLines([{ description: '', unit: 'JOB', quantity: 1, unitPrice: 50 }]).error ?? '', /ชื่อรายการ/);
assert.match(validateLines('nope').error ?? '', /รูปแบบ/);

// --- SHIPME ---
const ok = parseShipmePayload({
  batchId: ' INV-1 ', blNo: 'amp 0561328b', currency: 'thb',
  items: [{ description: 'ค่า DEM', amount: '9,000', quantity: 2, code: 'DEM' }, { description: 'ยกตู้', amount: 1500.255 }],
  attachments: [{ fileName: 'a.jpg', url: 'https://x.test/a.jpg' }, { fileName: 'b.pdf', dataBase64: 'data:application/pdf;base64,JVBERi0=' }],
});
assert.ok(ok.ok);
if (ok.ok) {
  assert.equal(ok.data.batchId, 'INV-1');
  assert.equal(ok.data.blNo, 'AMP0561328B', 'ตัดช่องว่าง + ตัวใหญ่');
  assert.equal(ok.data.currency, 'THB');
  assert.equal(ok.data.items[0].amount, 9000);
  assert.equal(ok.data.items[1].amount, 1500.26, 'ปัดเป็นสตางค์');
  assert.equal(ok.data.attachments[0].contentType, 'image/jpeg', 'เดาชนิดจากนามสกุล');
  assert.equal(ok.data.attachments[1].dataBase64, 'JVBERi0=', 'ตัดหัว data: ออก');
  assert.equal(itemsTotal(ok.data.items.map((i) => i.amount)), 10500.26, 'amount = ยอดของรายการ ไม่คูณ quantity');
}

const bad = (body: unknown, re: RegExp) => {
  const r = parseShipmePayload(body);
  assert.ok(!r.ok, `ควรไม่ผ่าน: ${JSON.stringify(body).slice(0, 60)}`);
  if (!r.ok) assert.match(r.error, re);
};
bad(null, /JSON/);
bad({ blNo: 'X', items: [{ description: 'a', amount: 1 }] }, /batchId/);
bad({ batchId: 'b', items: [{ description: 'a', amount: 1 }] }, /blNo/);
bad({ batchId: 'b', blNo: 'X', items: [] }, /items/);
bad({ batchId: 'b', blNo: 'X', items: [{ description: 'a', amount: -5 }] }, /items\[0\]\.amount/);
bad({ batchId: 'b', blNo: 'X', items: [{ amount: 5 }] }, /items\[0\]\.description/);
bad({ batchId: 'b', blNo: 'X', issuedAt: 'เมื่อวาน', items: [{ description: 'a', amount: 1 }] }, /issuedAt/);
bad({ batchId: 'b', blNo: 'X', items: [{ description: 'a', amount: 1 }], attachments: [{ fileName: 'a.exe', url: 'https://x' }] }, /contentType/);
bad({ batchId: 'b', blNo: 'X', items: [{ description: 'a', amount: 1 }], attachments: [{ fileName: 'a.jpg', url: 'http://x/a.jpg' }] }, /https/);
bad({ batchId: 'b', blNo: 'X', items: [{ description: 'a', amount: 1 }], attachments: [{ fileName: 'a.jpg' }] }, /url หรือ dataBase64/);

console.log('✓ Sale: ราคา (สตางค์ · แถวว่าง · ตรวจช่อง) · ข้อมูล SHIPME (ปรับรูป · ปัดสตางค์ · ไฟล์แนบ · ข้อผิดพลาดบอกชื่อช่อง)');
