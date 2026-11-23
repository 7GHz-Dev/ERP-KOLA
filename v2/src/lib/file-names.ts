/**
 * ชื่อไฟล์ที่ระบบสร้างเอง — ตั้งตามที่ทีมใช้เรียก
 *
 *   Final Invoice      AMP0568992_FNInv_19.58.xlsx   (BL _FNInv _เวลาที่สร้าง HH.MM เวลาไทย) · PDF ที่แปลงคู่กันใช้ชื่อเดียวกัน .pdf
 *   ชุด E-Office รวม    AMP0568992_รวมชุดE.pdf
 *
 * ยังไม่มี BL ใช้เลข Job แทน · ตัดตัวอักษรที่ใช้ในชื่อไฟล์ไม่ได้ (\ / : * ? " < > |) ออก
 */
export function blForName(blNo: string | null | undefined, jobNo: string) {
  const bl = (blNo ?? '').replace(/[\\/:*?"<>|\r\n]/g, '-').replace(/\s+/g, ' ').trim();
  return bl || jobNo;
}

/** เวลาไทย HH.MM เช่น 19.58 */
export function bangkokHourMinute(at = new Date()) {
  return new Date(at.getTime() + 7 * 3_600_000).toISOString().slice(11, 16).replace(':', '.');
}

export const finalInvoiceName = (blNo: string | null | undefined, jobNo: string, ext: 'xlsx' | 'pdf' = 'xlsx', at = new Date()) =>
  `${blForName(blNo, jobNo)}_FNInv_${bangkokHourMinute(at)}.${ext}`;

export const eofficeMergedName = (blNo: string | null | undefined, jobNo: string) =>
  `${blForName(blNo, jobNo)}_รวมชุดE.pdf`;
