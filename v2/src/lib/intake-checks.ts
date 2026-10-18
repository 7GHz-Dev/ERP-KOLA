/**
 * ตรวจเลขตู้และเลข BL ตอนรับงาน — ฟังก์ชันล้วน ใช้ได้ทั้งหน้าจอและฝั่งเซิร์ฟเวอร์
 *
 * เลขตู้ซ้ำในงานเดียวกันเป็นความผิดเสมอ (ตู้เดียวอยู่สองแถวไม่ได้) จึงห้ามบันทึก
 * ส่วนเลข BL ซ้ำกับงานที่มีอยู่แล้ว ส่วนใหญ่คือรับงานเดิมซ้ำ แต่บางกรณีตั้งใจ จึงแค่เตือนให้ยืนยัน
 */

/** เทียบเลขตู้โดยไม่สนช่องว่าง ขีด และตัวพิมพ์ — "TRHU 628740-6" กับ "trhu6287406" คือตู้เดียวกัน */
export function normalizeContainerNo(value: string): string {
  return String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** เลขตู้ที่ซ้ำกันในรายการ (คืนแบบปรับรูปแล้ว ตัวละครั้ง) */
export function duplicateContainers(list: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const raw of list) {
    const no = normalizeContainerNo(raw);
    if (!no) continue;
    if (seen.has(no)) dup.add(no);
    seen.add(no);
  }
  return [...dup];
}

/**
 * ตัดเลขตู้ซ้ำออก เก็บแถวแรกของแต่ละตู้ไว้
 * ใช้กับค่าที่ตัวอ่าน PDF ส่งมา — เอกสารบางใบพิมพ์รายการตู้ซ้ำสองที่ ตัวอ่านจึงเก็บมาสองรอบ
 */
export function dedupeContainers<T>(rows: T[], containerNo: (row: T) => string) {
  const seen = new Set<string>();
  const kept: T[] = [];
  const removed: string[] = [];
  for (const row of rows) {
    const no = normalizeContainerNo(containerNo(row));
    if (no && seen.has(no)) { removed.push(no); continue; }
    if (no) seen.add(no);
    kept.push(row);
  }
  return { kept, removed };
}

/** เทียบเลข BL โดยไม่สนช่องว่างและตัวพิมพ์ */
export function normalizeBlNo(value: string): string {
  return String(value ?? '').toUpperCase().replace(/\s+/g, '');
}

/**
 * สายเรือที่เลข BL ซ้ำได้ตามปกติ ไม่ต้องเตือน
 * SEALS ใช้เลข BL ชุดเดียวกันกับหลายงาน
 */
export function isBlDuplicateExempt(shipline: string | null | undefined): boolean {
  return /(^|[^A-Z])SEALS([^A-Z]|$)/.test(String(shipline ?? '').toUpperCase());
}

export type DuplicateBl = { blNo: string; jobNo: string };

/** ข้อความเตือนเลข BL ซ้ำ — ใช้ทั้งกล่องยืนยันบนหน้าจอและข้อความจากเซิร์ฟเวอร์ */
export function duplicateBlMessage(found: DuplicateBl[]): string {
  return found.map((d) => `${d.blNo} (งาน ${d.jobNo})`).join(', ');
}
