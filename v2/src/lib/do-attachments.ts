/**
 * หัวข้อ Slip และเอกสารประกอบของชุดแลก D/O
 *
 * แต่ละหัวข้อเป็นหมวดไฟล์ของตัวเอง ไม่ได้เก็บหัวข้อแยกไว้อีกคอลัมน์
 * คอลัมน์ category เป็นข้อความอยู่แล้ว เพิ่มหัวข้อใหม่จึงไม่ต้องแก้โครงฐานข้อมูล
 * และชุดแลกรวมไฟล์ตามหัวข้อได้ตรง ๆ โดยไม่ต้องอ่านช่องอื่นประกอบ
 *
 * ลำดับในรายการคือลำดับที่ถูกรวมเข้าชุดแลก D/O ด้วย
 *
 * เป็นค่าคงที่ล้วน นำเข้าได้ทั้งฝั่งเบราว์เซอร์และเซิร์ฟเวอร์
 */

export type DoAttachKind = 'slip' | 'doc';

export type DoAttachType = { category: string; label: string };

/** หัวข้อ Slip — ค่า DO เป็นหลัก ที่เหลือเลือกเพิ่มจากรายการ */
export const DO_SLIP_TYPES: DoAttachType[] = [
  { category: 'DO_SLIP', label: 'ค่า DO' },
  { category: 'DO_SLIP_DEPOSIT', label: 'ค่ามัดจำตู้' },
  { category: 'DO_SLIP_DEM', label: 'ค่า DEM' },
  { category: 'DO_SLIP_DET', label: 'ค่า DET' },
  { category: 'DO_SLIP_LATE', label: 'ค่าแลก DO ล่าช้า' },
];

/** หัวข้อเอกสารอื่น ๆ — Invoice ของค่าแต่ละตัว และช่องอื่น ๆ ไว้รับที่ไม่เข้าหัวข้อไหน */
export const DO_DOC_TYPES: DoAttachType[] = [
  { category: 'DO_INV_DEPOSIT', label: 'Invoice มัดจำตู้' },
  { category: 'DO_INV_DEM', label: 'Invoice DEM' },
  { category: 'DO_INV_DET', label: 'Invoice DET' },
  { category: 'DO_INV_LATE', label: 'Invoice DO ล่าช้า' },
  { category: 'DO_OTHER', label: 'เอกสารอื่น ๆ' },
];

/**
 * Invoice / Slip ของหัวข้อค่าใช้จ่ายแลก DO (do_charges) — หัวข้อมาจาก Master Data จึงไม่มีหมวดต่อหัวข้อ
 * ใช้หมวดกลางสองหมวด ผูกกับหัวข้อด้วย files.do_charge_id และเก็บชื่อหัวข้อไว้ใน note
 * ไม่อยู่ใน dropdown ของกล่องอัปทั่วไป อัปจากบรรทัดของหัวข้อในแผงยอดชำระเท่านั้น
 */
export const DO_CHARGE_SLIP = 'DO_CHARGE_SLIP';
export const DO_CHARGE_INV = 'DO_CHARGE_INV';
export const DO_CHARGE_CATEGORIES = [DO_CHARGE_INV, DO_CHARGE_SLIP];

export const DO_SLIP_CATEGORIES = [...DO_SLIP_TYPES.map((t) => t.category), DO_CHARGE_SLIP];
export const DO_DOC_CATEGORIES = [...DO_DOC_TYPES.map((t) => t.category), DO_CHARGE_INV];

/**
 * หมวดที่งานหนึ่งมีได้หลายไฟล์พร้อมกัน
 *
 * หมวดอื่นของระบบอัปใหม่แล้วทับไฟล์เดิม (เก็บเป็นเวอร์ชัน) แต่ Slip กับเอกสารแลก D/O
 * มีหลายใบจริง เช่นโอนค่า DO สองรอบ หรือมีทั้ง Invoice DEM และ DET
 * อัปเพิ่มจึงต้องได้ไฟล์เพิ่ม ไม่ใช่ไปแทนใบก่อน
 */
const MULTI = new Set([...DO_SLIP_CATEGORIES, ...DO_DOC_CATEGORIES]);

export function isDoMultiCategory(category: string) {
  return MULTI.has(category);
}

const LABELS = new Map([
  ...[...DO_SLIP_TYPES, ...DO_DOC_TYPES].map((t): [string, string] => [t.category, t.label]),
  [DO_CHARGE_SLIP, 'Slip ค่าใช้จ่าย'], [DO_CHARGE_INV, 'Invoice ค่าใช้จ่าย'],
]);
const ORDER = new Map([...DO_SLIP_CATEGORIES, ...DO_DOC_CATEGORIES].map((c, i) => [c, i]));

/** ชื่อหัวข้อสั้น ๆ ไว้แปะหน้าชื่อไฟล์ เช่น "ค่า DEM" */
export function doAttachLabel(category: string) {
  return LABELS.get(category) ?? category;
}

/** เรียงไฟล์ตามหัวข้อก่อน แล้วตามเวลาที่อัป — ลำดับเดียวกับที่ถูกรวมเข้าชุด */
export function compareDoAttach(
  a: { category: string; uploadedAt?: string | Date | null },
  b: { category: string; uploadedAt?: string | Date | null },
) {
  const byType = (ORDER.get(a.category) ?? 99) - (ORDER.get(b.category) ?? 99);
  if (byType) return byType;
  return new Date(a.uploadedAt ?? 0).getTime() - new Date(b.uploadedAt ?? 0).getTime();
}

export type DoAttachment = {
  id: string;
  category: string;
  fileName: string;
  mimeType: string | null;
  note: string | null;
};
