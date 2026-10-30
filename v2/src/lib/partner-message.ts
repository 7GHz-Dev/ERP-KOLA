/**
 * ข้อความที่ส่งให้ Port Release Partner พร้อมชุดปล่อย E-Office ที่เซ็นแล้ว
 *
 * แยกจาก partner-notify.ts (ซึ่งแตะฐานข้อมูล/อีเมล/LINE) เพื่อทดสอบข้อความได้ตรง ๆ
 * Partner หลายรายเป็นบริษัทต่างชาติ จึงเขียนอังกฤษนำ ไทยตาม
 */

export type PartnerJob = {
  jobNo: string;
  blNo: string | null;
  declarationNo: string | null;
  consigneeName: string | null;
  vessel: string | null;
  containerNos: string[];
};

/**
 * SHIPME — Port Release Partner พื้นฐานของงาน MU (MSFZ) เป็นบริษัทในเครือ
 * ช่องทางของ SHIPME คือการเชื่อมกับ ERP SHIPME (ทำภายหลัง) ไม่ใช่ Email/LINE
 * จับจากชื่อ ไม่ผูกรหัส เผื่อ Master ถูกสร้างใหม่ (แบบเดียวกับค่าเริ่มต้นที่หน้า FAH)
 */
export function isShipmePartner(name: string | null | undefined): boolean {
  // ทั้งคำเท่านั้น — "KMW GROUP SHIPMENT" มีคำว่า SHIPME อยู่ข้างในแต่ไม่ใช่ SHIPME
  return /\bshipme\b/i.test(name ?? '');
}

/** อีเมลหลายรายการในช่องเดียว — คั่นด้วย , ; เว้นวรรค หรือขึ้นบรรทัด · ตัดตัวซ้ำและตัวที่ไม่ใช่อีเมล */
export function parseEmails(text: string | null | undefined): string[] {
  const seen = new Set<string>();
  for (const part of (text ?? '').split(/[\s,;]+/)) {
    const email = part.trim().toLowerCase();
    if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) seen.add(email);
  }
  return [...seen];
}

function lines(job: PartnerJob): string[] {
  return [
    `BL No.: ${job.blNo || '-'}`,
    `Job No.: ${job.jobNo}`,
    job.declarationNo ? `Customs Declaration No.: ${job.declarationNo}` : '',
    job.consigneeName ? `Consignee: ${job.consigneeName}` : '',
    job.vessel ? `Vessel: ${job.vessel}` : '',
    job.containerNos.length ? `Container: ${job.containerNos.join(', ')}` : '',
  ].filter(Boolean);
}

export function partnerMail(job: PartnerJob): { subject: string; text: string } {
  return {
    subject: `Release set (E-Office, signed) — BL ${job.blNo || job.jobNo}`,
    text: [
      'Dear Partner,',
      '',
      'Please find attached the signed E-Office release set for the shipment below.',
      'แนบชุดปล่อย E-Office ที่เซ็นแล้วของรายการด้านล่าง',
      '',
      ...lines(job),
      '',
      'KOLA SHIPPING CO.,LTD.',
      '(This email was sent automatically from KOLA ERP.)',
    ].join('\n'),
  };
}

export function partnerLineMessage(job: PartnerJob, link: string | null, days: number): string {
  return [
    '📄 Release set (E-Office, signed) / ชุดปล่อย E-Office เซ็นแล้ว',
    '',
    ...lines(job),
    '',
    link
      ? `Download (valid ${days} days / ใช้ได้ ${days} วัน):\n${link}`
      : 'ดาวน์โหลดไฟล์ไม่ได้ในขณะนี้ — กรุณาติดต่อ KOLA',
  ].join('\n');
}
