/**
 * Job type ที่ Port Release Partner ภายนอกปล่อยสินค้าเอง — MUO (MSFZ - USED CAR OTHER SHIPPINGS)
 *
 * งานพวกนี้ Partner (KMW · A&M · BLUE MARINE …) แลก DO และลากตู้เอง
 *   - FAH ไม่ต้องอัปโหลด Invoice DO
 *   - ไม่เข้าคิวแลก DO ของ ANN / ตั้งเบิกของ MAY และไม่แจ้งกลุ่ม LINE แลก DO
 *   - ส่งชุดปล่อย E-Office ให้ Partner แล้วไม่ไปโผล่ที่หน้าจัดการลากตู้
 *   - ทะเบียนงานลงสีส้มตามตารางเดิม
 *
 * ไฟล์นี้ไม่ import อะไรเลย ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และในเบราว์เซอร์
 * เงื่อนไขฝั่ง SQL อยู่ที่ notPartnerRelease() ใน queries/jobs.ts
 */
export const PARTNER_RELEASE_JOB_TYPE = 'MUO';

export function isPartnerRelease(jobTypeCode: string | null | undefined): boolean {
  return (jobTypeCode ?? '').trim().toUpperCase() === PARTNER_RELEASE_JOB_TYPE;
}

/** ขนทางรถ (ไม่มีเรือ) — ทะเบียนงานลงสีม่วงตามตารางเดิม */
export function isByTruck(shipline: string | null | undefined, vessel?: string | null): boolean {
  const truck = (v: string | null | undefined) => /^BY\s*TRUCK$/i.test((v ?? '').trim());
  return truck(shipline) || truck(vessel);
}

/**
 * ลำดับ JOB TYPE ในช่องเลือกและหน้า Master Data (ตามที่ทีมกำหนด ไม่ใช่ตามตัวอักษร)
 *   MSFZ - Used car (Kola sp) → (Other sp) → Other goods (Kola sp) → (Other sp) → Transit - Used car → Other goods → Shipment export
 * รหัสที่ไม่อยู่ในรายการ (เพิ่มใหม่ภายหลัง) ต่อท้ายตามรหัส
 */
export const JOB_TYPE_ORDER = ['MU', 'MUO', 'MO', 'MOO', 'TU', 'TO', 'SHEX'];

export function sortJobTypes<T extends { code: string | null; name: string }>(list: T[]): T[] {
  const rank = (c: string | null) => {
    const i = JOB_TYPE_ORDER.indexOf((c ?? '').trim().toUpperCase());
    return i < 0 ? JOB_TYPE_ORDER.length : i;
  };
  return [...list].sort((a, b) => rank(a.code) - rank(b.code) || (a.code ?? '').localeCompare(b.code ?? '') || a.name.localeCompare(b.name));
}
