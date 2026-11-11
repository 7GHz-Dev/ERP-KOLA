/**
 * Total cost — จัดหมวด / นับทางเดียว / หัก ณ ที่จ่าย 3% / ตรวจข้อมูลจาก SHIPME (ฟังก์ชันล้วน)
 *   npm run test:total-cost
 */
import assert from 'node:assert/strict';
import { categoryOf, categoryOfLabel, parseCostPayload, summarize, sumSummaries, type RawLine } from '../src/lib/total-cost/cost';

const inv = (label: string, amount: number, vat = 0, kind = vat ? 'V' : 'NV'): RawLine =>
  ({ source: 'INVOICE', ref: kind + '20261101', kind, key: null, label, amount, vat, note: null });
const st = (key: string, label: string, amount: number): RawLine =>
  ({ source: 'SETTLEMENT', ref: 'ชิปปิ้ง A · 01/11/2026', kind: null, key, label, amount, vat: 0, note: null });

// --- จัดหมวดจากชื่อรายการในใบแจ้งหนี้ ADV ---
assert.equal(categoryOfLabel('ADV - ค่า LIFT ON'), 'LIFT_ON');
assert.equal(categoryOfLabel('ADV - ค่า LIFT OFF'), 'LIFT_OFF');
assert.equal(categoryOfLabel('ADV - ค่า EXTRA MOVEMENT'), 'EXTRA_MOVEMENT');
assert.equal(categoryOfLabel('ADV - ค่า STORAGE'), 'STORAGE');
assert.equal(categoryOfLabel('ADV - ค่าพรบ.'), 'INSURANCE');
assert.equal(categoryOfLabel('ADV - ค่า DEM'), 'DEM');
assert.equal(categoryOfLabel('ค่า ER ท่า B2'), 'ER_B2');
assert.equal(categoryOfLabel('ค่าแลก ER'), 'ER_B2');
assert.equal(categoryOfLabel('ADV - ค่า ORDER FORM'), 'OTHER', 'ORDER ไม่ใช่ ER / DO');
assert.equal(categoryOfLabel('ค่าน็อคตู้'), 'KNOCK');
assert.equal(categoryOfLabel('ค่าน๊อคประตูออกจากท่า'), 'KNOCK');
assert.equal(categoryOfLabel('ยางเกิน'), 'SALE_SPECIAL');
assert.equal(categoryOfLabel('ค่าล่วงเวลา (มีใบเสร็จ)'), 'OVERTIME');
assert.equal(categoryOfLabel('ค่าตะกั่ว'), 'SEAL');
assert.equal(categoryOfLabel('ค่าบริการนายตรวจ'), 'INSPECTOR');
// DO: มี VAT หรือไม่ดูจากบรรทัดจริง
assert.equal(categoryOf(inv('ADV - ค่าแลก DO (VAT)', 1000, 70)), 'DO_VAT');
assert.equal(categoryOf(inv('ADV - ค่าแลก DO (NON VAT)', 500, 0, 'V')), 'DO_NOVAT');
assert.equal(categoryOf(inv('ADV - ค่าแลก DO', 3000)), 'DO_NOVAT');
// ใบปิดบัญชี: ดูจากคีย์ช่อง
assert.equal(categoryOf(st('extra_service', 'ค่าบริการเพิ่มเติม(ฟรีโซน)', 500)), 'INSPECTOR');
assert.equal(categoryOf(st('overtime', 'ค่าล่วงเวลา (มีใบเสร็จ)', 300)), 'OVERTIME');

// --- BL ตัวอย่าง ---
const lines: RawLine[] = [
  inv('ADV - ค่าแลก DO (VAT)', 1000, 70),
  inv('ADV - ค่าแลก DO (NON VAT)', 500, 0, 'V'),
  inv('ADV - ค่า LIFT ON', 1000, 70),
  inv('ADV - ค่า LIFT ON', 333.33, 23.33),          // หลายบรรทัด → WHT ปัดทีละบรรทัด
  inv('ADV - ค่า EXTRA MOVEMENT', 510, 35.7),
  inv('ADV - ค่าพรบ.', 401.25, 28.09),             // มี VAT แต่ไม่อยู่ในหมวดที่หัก ณ ที่จ่าย
  inv('ADV - ค่าแลก DO', 3000),                    // ใบ NV
  st('lift_on', 'ค่า LIFT ON', 1040),               // หมวดนี้นับจากใบแจ้งหนี้ → ไม่นับ
  st('lift_off', 'ค่า LIFT OFF', 800),              // ใบแจ้งหนี้ไม่มี → นับจากใบปิดบัญชี (ไม่มี VAT ไม่หัก)
  st('overtime', 'ค่าล่วงเวลา (มีใบเสร็จ)', 300),
  st('seal', 'ค่าตะกั่ว', 50),
  st('special', 'ค่าน็อคตู้', 100),
  st('special', 'ยางเกิน', 2000),                   // ใช้ยอดจาก Sale
  st('special', 'ค่า ER ท่า B2', 200),
];
const s = summarize(lines, { amount: 1500, approved: true, status: 'อนุมัติแล้ว', chargeId: 'SPC-1', items: 1 });
assert.equal(s.amounts.DO_VAT, 1000);
assert.equal(s.whtBy.DO_VAT, 30);
assert.equal(s.amounts.DO_NOVAT, 3500);
assert.equal(s.whtBy.DO_NOVAT, 0);
assert.equal(s.amounts.LIFT_ON, 1333.33, 'ใช้ยอดในใบแจ้งหนี้ ไม่บวกยอดใบปิดบัญชี');
assert.equal(s.whtBy.LIFT_ON, 40, '30 + 10.00 (333.33 × 3% = 9.9999 → 10.00)');
assert.equal(s.whtBy.EXTRA_MOVEMENT, 15.3);
assert.equal(s.amounts.INSURANCE, 401.25);
assert.equal(s.whtBy.INSURANCE, 0);
assert.equal(s.amounts.LIFT_OFF, 800);
assert.equal(s.whtBy.LIFT_OFF, 0, 'ไม่มี VAT ไม่หัก');
assert.equal(s.amounts.OVERTIME, 300);
assert.equal(s.amounts.SEAL, 50);
assert.equal(s.amounts.KNOCK, 100);
assert.equal(s.amounts.ER_B2, 200);
assert.equal(s.amounts.SPECIAL, 1500, 'ยอดจาก Sale ไม่ใช่ 2000 ที่ SHIPME ขอ');
assert.equal(s.lines.filter((l) => l.skipped).length, 2);
assert.equal(s.vat, round(70 + 70 + 23.33 + 35.7 + 28.09));
const sub = 1000 + 3500 + 1333.33 + 510 + 401.25 + 800 + 300 + 50 + 100 + 200 + 1500;
assert.equal(s.subtotal, round(sub));
assert.equal(s.wht, round(30 + 40 + 15.3));
assert.equal(s.total, round(sub + s.vat));
assert.equal(s.net, round(s.total - s.wht));

// ใบแจ้งหนี้มีหมวดที่ปกติมาจากใบปิดบัญชี (พิมพ์เพิ่มเอง) → ใช้ใบแจ้งหนี้ ไม่นับซ้ำ
const t = summarize([inv('ADV - ค่า LIFT OFF', 750, 52.5), st('lift_off', 'ค่า LIFT OFF', 780)], null);
assert.equal(t.amounts.LIFT_OFF, 750);
assert.equal(t.whtBy.LIFT_OFF, 22.5);
assert.equal(t.lines[1].skipped, 'ใบแจ้งหนี้ ADV มีหมวดนี้แล้ว');

const both = sumSummaries([s, t]);
assert.equal(both.amounts.LIFT_OFF, 1550);
assert.equal(both.net, round(s.net + t.net));

// --- ตรวจข้อมูลที่ SHIPME ส่ง ---
assert.equal(parseCostPayload(null).ok, false);
assert.equal(parseCostPayload({ bls: [] }).ok, false);
let p = parseCostPayload({ bls: [{ blNo: 'AMP 056-1328B', lines: [{ source: 'invoice', label: 'ADV - ค่า LIFT ON', amount: '1,000.00', vat: 70 }, { source: 'SETTLEMENT', label: 'x', amount: 0 }] }] });
assert.ok(p.ok);
if (p.ok) {
  assert.equal(p.data.bls[0].lines.length, 1, 'บรรทัดยอด 0 ข้าม');
  assert.equal(p.data.bls[0].lines[0].amount, 1000);
  assert.equal(p.data.bls[0].lines[0].source, 'INVOICE');
}
p = parseCostPayload({ bls: [{ blNo: 'X1', lines: [{ source: 'EMAIL', label: 'a', amount: 1 }] }] });
assert.equal(p.ok, false);
p = parseCostPayload({ bls: [{ blNo: 'X1', lines: [{ source: 'INVOICE', label: 'a', amount: 'abc' }] }] });
assert.equal(p.ok, false);
p = parseCostPayload({ bls: [{ blNo: '', lines: [] }] });
assert.equal(p.ok, false);

function round(n: number) { return Math.round(n * 100) / 100; }
console.log('total-cost: ผ่านทั้งหมด');
