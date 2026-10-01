import assert from 'node:assert/strict';
import { readBlRows, readContainerRows } from '../src/lib/admin-job-rows';

/**
 * แถว BL และตู้ในหน้าแก้ไข JOB ของ ADMIN
 *
 * สิ่งที่ต้องรับประกัน — ติ๊กลบแถวไหนต้องลบแถวนั้น ไม่ใช่แถวตามลำดับ
 * แถวใหม่ที่เพิ่มแล้วไม่ได้กรอกต้องถูกข้าม และแถวที่กรอกไม่ครบต้องถูกปฏิเสธ ไม่ใช่บันทึกค่าว่าง
 */
const form = (pairs: Array<[string, string]>) => {
  const fd = new FormData();
  for (const [k, v] of pairs) fd.append(k, v);
  return fd;
};

// สามใบ ติ๊กลบใบที่สอง — ต้องเหลือใบที่หนึ่งกับสาม ตามลำดับเดิม
let rows = readBlRows(form([
  ['bl_id', 'BL-1'], ['bl_no', 'AAA'], ['bl_shipper', 'S1'],
  ['bl_id', 'BL-2'], ['bl_no', 'BBB'], ['bl_shipper', ''],
  ['bl_id', 'BL-3'], ['bl_no', ' CCC '], ['bl_shipper', 'S3'],
  ['bl_remove', 'BL-2'],
]));
assert.deepEqual(rows, [
  { id: 'BL-1', blNo: 'AAA', shipperId: 'S1' },
  { id: 'BL-3', blNo: 'CCC', shipperId: 'S3' },
], 'ติ๊กลบต้องลบตาม id ไม่ใช่ตามลำดับ และตัดช่องว่างหัวท้าย');

// แถวใหม่ว่างถูกข้าม · แถวใหม่ที่กรอกถูกเก็บ
rows = readBlRows(form([
  ['bl_id', ''], ['bl_no', ''], ['bl_shipper', ''],
  ['bl_id', ''], ['bl_no', 'NEW1'], ['bl_shipper', 'S9'],
]));
assert.deepEqual(rows, [{ id: '', blNo: 'NEW1', shipperId: 'S9' }]);

// ใบเดิมที่ลบเลขทิ้งแต่ไม่ได้ติ๊กลบ — ต้องปฏิเสธ ไม่ใช่บันทึก BL เลขว่าง
assert.throws(() => readBlRows(form([['bl_id', 'BL-1'], ['bl_no', ''], ['bl_shipper', 'S1']])), /ต้องมีเลข BL/);
// ใบใหม่เลือก Shipper แต่ไม่ได้ใส่เลข ก็ต้องปฏิเสธเหมือนกัน
assert.throws(() => readBlRows(form([['bl_id', ''], ['bl_no', ''], ['bl_shipper', 'S1']])), /ต้องมีเลข BL/);
assert.deepEqual(readBlRows(form([])), [], 'ไม่มีแถวเลยต้องได้รายการว่าง');

// ตู้ — ลบตาม id · ตัวพิมพ์ใหญ่ · ตัดลูกน้ำในน้ำหนัก · แถวใหม่ว่างข้าม
const cts = readContainerRows(form([
  ['ct_id', 'CT-1'], ['ct_no', 'abcu1234567'], ['ct_type', '40HC'], ['ct_seal', 'S-1'], ['ct_weight', '12,500.5'],
  ['ct_id', 'CT-2'], ['ct_no', 'XYZU7654321'], ['ct_type', '20GP'], ['ct_seal', ''], ['ct_weight', ''],
  ['ct_id', ''], ['ct_no', ''], ['ct_type', ''], ['ct_seal', ''], ['ct_weight', ''],
  ['ct_remove', 'CT-2'],
]));
assert.deepEqual(cts, [
  { id: 'CT-1', containerNo: 'ABCU1234567', containerType: '40HC', sealNo: 'S-1', weight: '12500.5' },
]);
assert.throws(() => readContainerRows(form([
  ['ct_id', 'CT-1'], ['ct_no', 'A'], ['ct_type', ''], ['ct_seal', ''], ['ct_weight', 'หนัก'],
])), /ตัวเลข/);
assert.throws(() => readContainerRows(form([
  ['ct_id', ''], ['ct_no', ''], ['ct_type', ''], ['ct_seal', 'S-9'], ['ct_weight', ''],
])), /ต้องมีเลขตู้/, 'กรอก Seal แต่ไม่มีเลขตู้ต้องปฏิเสธ');

console.log('PASS: ติ๊กลบตาม id · ข้ามแถวว่าง · ปฏิเสธแถวกรอกไม่ครบ');
