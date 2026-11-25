import { claimAmount, claimEta } from './do-claim';
import type { DoAttachment } from './do-attachments';

/**
 * ค่าใช้จ่ายแลก DO หลายหัวข้อต่อ BL — ค่าคงที่และตัวช่วยที่ใช้ได้ทั้งเบราว์เซอร์และเซิร์ฟเวอร์
 *
 * หัวข้อมาจาก Master Data (type = doCharges) เพิ่ม/แก้ชื่อ/ปิดใช้ได้ที่ตั้งค่าระบบ
 * แต่ละหัวข้อของงานมี Invoice และ Slip โอนของตัวเอง (files.do_charge_id)
 */

export const DO_CHARGE_MASTER = 'doCharges';
/** หมายเหตุสั้น ๆ ต่อท้ายหัวข้อ เช่น ค่าอื่นๆ: ค่าล้างตู้ */
export const DO_CHARGE_NOTE_MAX = 60;

export type DoChargeTopic = { id: string; name: string };

export type DoCharge = {
  id: string;
  topicId: string | null;
  topicName: string;
  amount: string;
  note: string | null;
  claimedAt: string | null;
  invoices: DoAttachment[];
  slips: DoAttachment[];
};

/** "ค่า Demurrage" · "ค่าอื่นๆ: ค่าล้างตู้" */
export function chargeLabel(c: Pick<DoCharge, 'topicName' | 'note'>) {
  const note = (c.note ?? '').trim();
  return note ? `${c.topicName}: ${note}` : c.topicName;
}

/** "+1,500 (ค่า Demurrage)+20,000 (ค่ามัดจำตู้)" */
function chargeParts(charges: Array<Pick<DoCharge, 'amount' | 'topicName' | 'note'>>) {
  return charges.map((c) => `+${claimAmount(c.amount)} (${chargeLabel(c)})`).join('');
}

/** ยอดค่า DO ต่อด้วยทุกหัวข้อ — ใช้ในตาราง / การ์ด และบรรทัดแรกของข้อความเบิก */
export function claimSummary(amount: string | number | null | undefined, charges: Array<Pick<DoCharge, 'amount' | 'topicName' | 'note'>>) {
  return `${claimAmount(amount)}${chargeParts(charges)}`;
}

export type ClaimTextInput = {
  blNo: string | null;
  eta: string | Date | null;
  shipline: string | null;
  amount: string | number | null;
  charges: Array<Pick<DoCharge, 'amount' | 'topicName' | 'note'>>;
};

/**
 * ข้อความเบิกสองบรรทัด รูปแบบเดิมของทีม แต่ละหัวข้อเขียนแยกก้อนพร้อมชื่อหัวข้อ ไม่บวกรวมให้
 *   CULVYOK2600762=18,400+20,000 (ค่ามัดจำตู้)+1,500 (ค่า Demurrage)
 *   ETA 7/9/2026 ของ CU LINES
 */
export function claimText({ blNo, eta, shipline, amount, charges }: ClaimTextInput): string {
  return `${blNo ?? ''}=${claimSummary(amount, charges)}\nETA ${claimEta(eta)} ของ ${shipline ?? ''}`;
}

/**
 * ข้อความเบิกค่าใช้จ่ายที่เพิ่มหลังตั้งเบิกไปแล้ว — เฉพาะหัวข้อที่ยังไม่ได้ตั้งเบิก
 *   CULVYOK2600762 (เพิ่มเติม)=1,500 (ค่า Demurrage)+800 (ค่า Detention)
 *   ETA 7/9/2026 ของ CU LINES
 */
export function extraClaimText({ blNo, eta, shipline, charges }: Omit<ClaimTextInput, 'amount'>): string {
  const parts = chargeParts(charges).replace(/^\+/, '');
  return `${blNo ?? ''} (เพิ่มเติม)=${parts}\nETA ${claimEta(eta)} ของ ${shipline ?? ''}`;
}
