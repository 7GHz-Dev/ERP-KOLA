/**
 * สถานะใบขนใน NETBAY — รหัสตรงกับ <option value> ของช่อง Status บนหน้า Import Declaration
 * ยกเว้น AUDIT_LOADED / AUDIT_CHECKED ซึ่งเป็นป้ายที่ไม่มีในช่อง Status (ตั้งชื่อเอง ไม่ใช้กรองใน NETBAY)
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
  AUDIT_LOADED: 'Audit Loaded 04',
  AUDIT_CHECKED: 'Audit Checked 03',
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
  // ผ่านขั้นกรมศุลฯ รับแล้ว มีเลขใบขนแล้ว — ดึงเลข + PDF ได้เหมือน Customs Accept
  AUDIT_LOADED: 'done',
  AUDIT_CHECKED: 'done',
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

/**
 * รูปป้ายสถานะของ NETBAY (sha256 ของไฟล์ GIF) — ตรงกันทุกไบต์ = รู้สถานะแน่นอน ไม่ต้องเดาจากชื่อไฟล์
 * ไฟล์ต้นฉบับเก็บไว้ที่ assets/netbay/status/<รหัส>.gif (ได้จากหน้าจริง)
 * ยังไม่มีรูปของ IMPREJECT · SEND_CANCEL · DRAFT_CANCEL — เจอเมื่อไหร่ใช้ชื่อไฟล์/ช่อง Status แทน
 */
const STATUS_IMAGE_SHA256: Record<string, NetbayStatusCode> = {
  be59a2547785381be06d2c0fac53e14fc7310c69e495de1adc9a9934f9ef20e9: 'ACCEPT',
  '0a778e8c227b81e126019669adf7e1233ac00fcecb16d1e8b76296cde9f2e748': 'AUDIT_CHECKED',
  '7771198d7fb5a148929fc33e38192abd850ae7ea8a377fb253469abe3036a015': 'AUDIT_LOADED',
  '964fffb1213846613fff8e35cbc77fc4c8e8069f8fd3c7d41a19e2d0f6a8f18b': 'CANCELED',
  '895dacffb5cf133b840fea3467e188e0e375a3035682db1bec5590526d1f70ee': 'CANCEL_REJECT',
  '819adef2fc894703604e4931a9f9609fc9f67e19914bb07e02b0b501eca341b4': 'ERROR',
  '31d5fd28cd91782795fde58434d5dabfc0cc2f40fb6663e9f722409894282985': 'PREPARE',
  '5317e984dacaa2655e42346c8f5320cb0e6d9f791da89bc5ae7fb15f0711a890': 'REJECT',
  '9d2124bbca19816a96533aa74ad9ad28cf7abd7953ae829778aab54c8f6aa8d8': 'SEND',
  '42e616fce6c0c29ad97beb6821e1efe33c9748fb2a7805b304367cd67622926b': 'VALIDATED',
};

/** สถานะจาก sha256 (hex) ของไฟล์รูปป้าย — ไม่รู้จัก = null */
export function statusFromImageHash(sha256: string): NetbayStatusCode | null {
  return STATUS_IMAGE_SHA256[sha256.toLowerCase()] ?? null;
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

/**
 * แถบเขียวด้านบนของหน้าใบขน (เปิดจากหน้ารายการ) — "REF QELS100015985  Decl A0310691002615  Status Customs Accept  Job No."
 * เลขใบขนเอาจากตรงนี้: คอลัมน์ DECLARATION NO ในหน้ารายการว่างได้แม้กรมศุลฯ รับแล้ว
 *
 * ตัวอักษรบนแถบห่างกันมาก (อาจเป็นช่องว่างจริง) จึงตัดช่องว่างทิ้งทั้งหมดก่อนแล้วหาเลขที่ตามหลัง "Decl" ทันที
 * ต้องติดกับ "Decl" เท่านั้น — หน้าเดียวกันมีเลขรูปแบบเดียวกันที่ไม่ใช่เลขใบขน (Export Tax Incentives ID F5306349580001)
 * "Declaration Control" (ชื่อหน้า) ไม่ติดเลขจึงไม่ถูกจับ · ถ้าเลขอยู่ในช่อง input ดูช่องที่ชื่อมี decl/dcl
 */
export function parseDeclarationHeader(text: string, inputs: [string, string][] = []): {
  declarationNo: string | null; status: NetbayStatusCode | null;
} {
  const flat = text.replace(/\s+/g, '');
  const m = /Decl(?:No)?\.?:?([A-Z]\d{13})(?!\d)/.exec(flat);
  const fromInput = inputs.find(([name, value]) => /decl|dcl/i.test(name) && !/type/i.test(name) && DECLARATION_NO.test(value.trim()));
  const declarationNo = m?.[1] ?? fromInput?.[1].trim() ?? null;

  // ยาวก่อนสั้น เหมือนรูปป้าย · หน้าอาจมีคำว่า Status หลายที่ — เอาที่แรกที่ตามด้วยชื่อสถานะที่รู้จัก
  const labels = (Object.keys(NETBAY_STATUS) as NetbayStatusCode[])
    .sort((a, b) => NETBAY_STATUS[b].length - NETBAY_STATUS[a].length)
    .map((code) => [code, NETBAY_STATUS[code].replace(/\s+/g, '').toLowerCase()] as const);
  let status: NetbayStatusCode | null = null;
  for (let at = flat.indexOf('Status'); at >= 0 && !status; at = flat.indexOf('Status', at + 1)) {
    const after = flat.slice(at + 'Status'.length).replace(/^:/, '').toLowerCase();
    status = labels.find(([, label]) => after.startsWith(label))?.[0] ?? null;
  }
  return { declarationNo, status };
}
