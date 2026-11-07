/**
 * Other cargo — งาน Job type MO (MSFZ - OTHERS) และ TO (TRANSIT - OTHERS)
 *
 * Head Officer (NAMKANG) ทำเองทั้งเส้น ตั้งแต่รับ AN / Waiting list จนส่งชุดปล่อย E-Office ที่เซ็นแล้ว
 *   - ส่ง AN / Final Invoice แล้วอนุมัติให้อัตโนมัติ ไม่ต้องรอใคร
 *   - ไม่เข้าคิวของ Import Officer (PAINT) และ Senior Officer (FAH)
 *   - Head Officer ทำขั้นที่ปกติเป็นของ PAINT / FAH ได้เฉพาะงานกลุ่มนี้ (lib/job-actor.ts)
 *
 * ไฟล์นี้ไม่ import อะไรเลย ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และในเบราว์เซอร์
 * เงื่อนไขฝั่ง SQL อยู่ที่ otherCargo() ใน queries/jobs.ts
 */
export const OTHER_KINDS = {
  msfz: { code: 'MO', label: 'Other cargo, import decl. (MSFZ)', short: 'MSFZ' },
  transit: { code: 'TO', label: 'Other cargo, import decl. (Transit)', short: 'Transit' },
} as const;
export type OtherKind = keyof typeof OTHER_KINDS;
export const OTHER_CARGO_TYPES: string[] = Object.values(OTHER_KINDS).map((k) => k.code);

export function isOtherCargo(jobTypeCode: string | null | undefined): boolean {
  return OTHER_CARGO_TYPES.includes((jobTypeCode ?? '').trim().toUpperCase());
}
