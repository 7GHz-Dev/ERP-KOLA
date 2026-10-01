/**
 * ค่าที่ระบบรู้จักของช่องสถานะต่าง ๆ ในงาน — ใช้ทั้งเป็นตัวเลือกบนหน้าแก้ไข JOB
 * และใช้ตรวจฝั่งเซิร์ฟเวอร์ว่าค่าที่ส่งมาเป็นค่าที่คิวงานต่าง ๆ อ่านออก
 *
 * ค่านอกชุดนี้ทำให้งานหายไปจากทุกคิวโดยไม่มีใครรู้ จึงไม่ให้พิมพ์เอง
 * เป็นค่าคงที่ล้วน นำเข้าได้ทั้งฝั่งเบราว์เซอร์และเซิร์ฟเวอร์
 */
export type Choice = { value: string; label: string };

export const SURRENDER_STATUSES: Choice[] = [
  { value: 'PENDING', label: 'รอตรวจ Surrender' },
  { value: 'CLEARED', label: 'Surrender เคลียร์แล้ว' },
  { value: 'ISSUE', label: 'Surrender มีปัญหา' },
];

export const CUSTOMS_STATUSES: Choice[] = [
  { value: 'NOT_STARTED', label: 'ยังไม่เริ่ม' },
  { value: 'DRAFT', label: 'ทำ Draft แล้ว' },
  { value: 'FILED', label: 'ยื่นใบขนแล้ว' },
];

export const RELEASE_STATUSES: Choice[] = [
  { value: 'PENDING', label: 'ยังไม่ปล่อย' },
  { value: 'RELEASED', label: 'ปล่อยของแล้ว' },
];

export const DRAFT_STATUSES: Choice[] = [
  { value: '', label: '— ยังไม่มี Draft —' },
  { value: 'CREATED', label: 'สร้างแล้ว (CREATED)' },
  { value: 'SENT_TO_HUB', label: 'ส่งให้ระบบสร้าง (SENT_TO_HUB)' },
  { value: 'SUBMITTED', label: 'ส่งให้ FAH ตรวจ (SUBMITTED)' },
  { value: 'REJECTED', label: 'ถูกตีกลับ (REJECTED)' },
];

export const SOURCE_TYPES: Choice[] = [
  { value: '', label: '-' },
  { value: 'AN', label: 'Arrival Notice' },
  { value: 'BL', label: 'Bill of Lading' },
];
