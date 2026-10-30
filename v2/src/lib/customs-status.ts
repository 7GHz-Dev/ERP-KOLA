/**
 * สถานะใบขนใน NETBAY — รหัสตรงกับ <option value> ของช่อง Status บนหน้า Import Declaration
 *
 * ตัว monitor ใบขน (scripts/customs-monitor.ts) อ่านสถานะนี้จากแถวของ Ref No. แล้วส่งเข้า ERP
 * หน้าคิว Automation ใช้ไฟล์เดียวกันแสดงป้ายสี ทั้งสองฝั่งจึงเรียกสถานะเดียวกันด้วยชื่อเดียวกัน
 * ไฟล์นี้ไม่แตะฐานข้อมูล worker ในเครื่อง import ได้ตรง ๆ
 */

export const NETBAY_STATUS = {
  ACCEPT: 'Customs Accept',
  CANCEL_REJECT: 'Cannot Cancel',
  CANCELED: 'Declaration Canceled',
  ERROR: 'Error Schema',
  IMPREJECT: 'Customer Reject',
  PREPARE: 'Draft Document',
  REJECT: 'Customs Reject',
  SEND: 'Waiting Response',
  SEND_CANCEL: 'Sending Cancel',
  VALIDATED: 'เอกสารพร้อมส่ง',
  DRAFT_CANCEL: 'Cancel Draft',
} as const;

export type NetbayStatusCode = keyof typeof NETBAY_STATUS;

/** ค้น Ref No. แล้วไม่เจอแถว — ไม่ใช่สถานะของ NETBAY แต่ต้องแสดงในคิวเหมือนกัน */
export const NOT_FOUND = 'NOT_FOUND';

/**
 * กลุ่มของสถานะ — กำหนดสีป้ายและสิ่งที่ตัว monitor ทำต่อ
 *
 * done      ดึงเลขใบขน + PDF แล้วปิดงาน
 * waiting   ยังอยู่ระหว่างทาง เช็กต่อ
 * problem   ต้องมีคนแก้ใน NETBAY — แสดงป้ายแดงแล้วเช็กต่อ แก้แล้วกด Send ใหม่จน ACCEPT ระบบดึงให้เอง
 * canceled  ใบขนถูกยกเลิก จะไม่มีวัน ACCEPT — หยุดเช็กแล้วคืนงานให้ FAH ตรวจใหม่
 *           ถ้าเช็กต่อ ตัว monitor จะไม่มีวันจบเพราะมีงานค้างตลอด
 */
export type StatusGroup = 'done' | 'waiting' | 'problem' | 'canceled' | 'unknown';

const GROUPS: Record<NetbayStatusCode, StatusGroup> = {
  ACCEPT: 'done',
  PREPARE: 'waiting',
  VALIDATED: 'waiting',
  SEND: 'waiting',
  SEND_CANCEL: 'waiting',
  REJECT: 'problem',
  IMPREJECT: 'problem',
  ERROR: 'problem',
  CANCEL_REJECT: 'problem',
  CANCELED: 'canceled',
  DRAFT_CANCEL: 'canceled',
};

export function isStatusCode(code: string | null | undefined): code is NetbayStatusCode {
  return Boolean(code) && Object.prototype.hasOwnProperty.call(NETBAY_STATUS, code!);
}

export function statusGroup(code: string | null | undefined): StatusGroup {
  return isStatusCode(code) ? GROUPS[code] : 'unknown';
}

/** ข้อความบนป้าย — รหัสที่ไม่รู้จักแสดงตามที่เจอ ให้เห็นว่า NETBAY มีสถานะใหม่ */
export function netbayStatusLabel(code: string | null | undefined): string {
  if (!code) return 'ยังไม่ได้เช็ก';
  if (code === NOT_FOUND) return 'ไม่พบใน NETBAY';
  return isStatusCode(code) ? NETBAY_STATUS[code] : code;
}

/** สีป้ายตามชุดเดียวกับป้ายสถานะงาน (globals.css) */
export function netbayStatusTone(code: string | null | undefined): 'approved' | 'pending' | 'rejected' | 'neutral' {
  if (!code) return 'neutral';
  const group = statusGroup(code);
  if (group === 'done') return 'approved';
  if (group === 'waiting') return 'pending';
  return 'rejected';
}

/*
 * ยาวก่อนสั้น — CANCEL_REJECT ต้องเจอก่อน REJECT และ SEND_CANCEL ก่อน SEND
 * ไม่งั้นรูปชื่อ cancel_reject.gif จะถูกอ่านเป็น REJECT
 */
const CODES_LONGEST_FIRST = (Object.keys(NETBAY_STATUS) as NetbayStatusCode[])
  .sort((a, b) => b.length - a.length);

/**
 * อ่านรหัสสถานะจากรูปป้ายในคอลัมน์ STATUS — ป้ายเป็นรูปภาพ ไม่มีข้อความให้อ่าน
 *
 * ลองจากชื่อไฟล์รูปก่อน (เช่น .../ACCEPT.gif หรือ st_accept.png) แล้วค่อย title/alt
 * ทั้งแบบรหัสและแบบข้อความบนป้าย (Customs Accept) · ไม่รู้จัก = null ให้ผู้เรียกตรวจทางอื่นต่อ
 *
 * รหัสต้องไม่ติดตัวอักษรอื่นทั้งหน้าและหลัง IMPREJECT จึงไม่ถูกอ่านเป็น REJECT
 */
export function parseStatusImage(img: { src?: string | null; title?: string | null; alt?: string | null }): NetbayStatusCode | null {
  const stem = (img.src ?? '').split(/[?#]/)[0].split('/').pop()?.replace(/\.[a-z0-9]+$/i, '') ?? '';
  const texts = [stem, img.title ?? '', img.alt ?? ''].map((s) => s.trim()).filter(Boolean);

  for (const text of texts) {
    const upper = text.toUpperCase();
    for (const code of CODES_LONGEST_FIRST) {
      if (new RegExp(`(^|[^A-Z])${code}($|[^A-Z])`).test(upper)) return code;
    }
    const label = text.toLowerCase().replace(/\s+/g, ' ');
    for (const code of CODES_LONGEST_FIRST) {
      if (NETBAY_STATUS[code].toLowerCase() === label) return code;
    }
  }
  return null;
}

/** เลขใบขนขาเข้า เช่น A0300691008769 — ตัวอักษร 1 ตัวตามด้วยตัวเลข 13 หลัก */
export const DECLARATION_NO = /^[A-Z]\d{13}$/;
