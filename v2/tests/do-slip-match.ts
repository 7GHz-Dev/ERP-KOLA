import assert from 'node:assert/strict';
import { extractMemo, matchSlip, type SlipChoice } from '../src/lib/do-slip-match';

/**
 * จับ Slip เข้ากับงานจากเลข BL ในช่องบันทึกช่วยจำ
 *
 * สิ่งที่ต้องรับประกันคือ "ไม่แนบผิดงาน" มากกว่า "จับได้ทุกใบ"
 * สลิปที่จับไม่ได้คนเลือกเองได้ แต่สลิปที่ไปอยู่ผิดงานจะไม่มีใครสังเกต
 */

const choice = (jobId: string, blNo: string): SlipChoice => ({
  jobId, jobNo: `JOB-${jobId}`, blNo, consigneeName: null, hasSlip: false,
});
const choices = [
  choice('A', 'CULVYOK2600762'),
  choice('B', 'KG1222026-70107(ONEYTYOGF5133300)'),
  choice('C', 'KG1222026-70108'),
  choice('D', 'WHLC026ABC1234'),
];

// K PLUS — ป้ายกับค่าอยู่บรรทัดเดียวกัน
const kplus = [
  'โอนเงินสำเร็จ', '30 ก.ย. 69 10:15 น.', 'นาย เมย์ ทดสอบ', 'xxx-x-x1234-x',
  'จำนวน: 18,400.00 บาท', 'ค่าธรรมเนียม: 0.00 บาท', 'บันทึกช่วยจำ: CULVYOK2600762',
].join('\n');
assert.equal(extractMemo(kplus), 'CULVYOK2600762');
assert.deepEqual(matchSlip(kplus, choices), { memo: 'CULVYOK2600762', jobIds: ['A'], from: 'memo' });

// K BIZ ของจริง (CMA CGM) — มีเลขที่รายการยาว ๆ อยู่บรรทัดก่อนบันทึกช่วยจำ
const kbiz = [
  'โอนเงินสำเร็จ', '30 ก.ย. 69 09:14 น.', 'K BIZ', 'จาก', 'บจก. ชิป มี โลจิสติกส์', 'ธนาคารกสิกรไทย',
  'xxx-x-x1394-x', 'ไปยัง', 'CMA CGM (THAILAND)', 'LIMITED', 'ธนาคารฮ่องกงและเซี่ยงไฮ้', 'xxx-x-x6430-xxx',
  'จำนวนเงิน', '7,092.92 บาท', 'ค่าธรรมเนียม', '0.00 บาท', 'วันที่เงินเข้าบัญชี 30 ก.ย. 69',
  '(โอนแบบ เงินเข้าบัญชีทันทีที่มีผล)', 'เลขที่รายการ TRTS260930848889583', 'บันทึกช่วยจำ AMP0564125',
].join('\n');
const cma = [...choices, choice('E', 'AMP0564125'), choice('F', 'AMP0564126')];
assert.deepEqual(matchSlip(kbiz, cma), { memo: 'AMP0564125', jobIds: ['E'], from: 'memo' });
// BL ในระบบเก็บแบบมีรหัสสายเรือนำหน้า ส่วนบันทึกช่วยจำพิมพ์แค่ท่อนหลัง
assert.deepEqual(matchSlip(kbiz, [...choices, choice('G', 'CMDUAMP0564125')]).jobIds, ['G']);

// ค่าขึ้นบรรทัดถัดไป และ OCR ใส่ช่องว่างกับอ่าน O เป็น 0
const split = 'Transfer successful\nMemo\nCULVY0K 2600 762\nRef 20260930ABCDEF';
assert.deepEqual(matchSlip(split, choices).jobIds, ['A']);

// เลขในวงเล็บ (Waybill) ก็จับได้
assert.deepEqual(matchSlip('บันทึกช่วยจำ ONEYTYOGF5133300', choices).jobIds, ['B']);

// สลิปเดียวจ่ายหลาย BL
assert.deepEqual(matchSlip('บันทึกช่วยจำ: KG1222026-70108 / WHLC026ABC1234', choices).jobIds.sort(), ['C', 'D']);

// พิมพ์ไม่ครบแต่ชี้งานเดียว — รับ
assert.deepEqual(matchSlip('บันทึกช่วยจำ: YOK2600762', choices).jobIds, ['A']);

// พิมพ์ไม่ครบแล้วตรงหลายงาน (70107 กับ 70108 ขึ้นต้นเหมือนกัน) — ไม่เดา
assert.deepEqual(matchSlip('บันทึกช่วยจำ: KG1222026', choices).jobIds, []);

// ไม่มีช่องบันทึกช่วยจำ แต่มีเลขเต็มอยู่ในใบ — จับจากทั้งใบ
assert.deepEqual(matchSlip('โอนสำเร็จ\nWHLC026ABC1234\n5,000.00', choices), {
  memo: '', jobIds: ['D'], from: 'text',
});

// กวาดทั้งใบไม่รับเลขไม่ครบ — เลขอ้างอิงในสลิปอาจบังเอิญไปตรงกับท่อนหนึ่งของ BL
assert.deepEqual(matchSlip('เลขที่รายการ: 2600762XYZ\nจำนวน 100.00', choices).jobIds, []);

// เลขสั้นเกินไปไม่ใช้จับ
assert.deepEqual(matchSlip('บันทึกช่วยจำ: 70107', choices).jobIds, []);

console.log('PASS: slip memo extraction and BL matching');
