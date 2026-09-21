/**
 * จับไฟล์ AN/BL ที่อัปเข้ามา เข้ากับ BL ที่มีอยู่ในระบบแล้ว
 *
 * ใช้กับงานที่นำเข้ามาจากไฟล์ตารางแล้วยังไม่มีไฟล์ PDF แนบ — อัปไฟล์ทีหลังทีละหลายใบ
 * แล้วให้ระบบหาเองว่าใบไหนเป็นของงานไหน โดยอ่านเลข BL หรือ Waybill จากในไฟล์
 *
 * ต่างจากหน้ารับงานตรงที่ "ไม่สร้างงานใหม่" — เลือกได้เฉพาะ BL ที่มีในระบบเท่านั้น
 * ไฟล์ที่จับคู่ไม่ได้จะค้างไว้ให้คนเลือกเอง ไม่ใช่เปิดงานใหม่ให้เงียบ ๆ
 * ซึ่งจะทำให้มีงานซ้ำกับที่นำเข้ามาแล้ว แล้วต้องมาไล่ลบทีหลัง
 *
 * เลือกให้เฉพาะตอนมั่นใจ เหมือนหลักเดียวกับ matchShipper()
 * เจอหลายงานที่เข้าเงื่อนไขถือว่าไม่ชัดพอ คืนว่างให้คนเลือกเอง
 */

import { blKey } from './shipment-import';

/** BL หนึ่งใบที่มีอยู่ในระบบ พร้อมงานที่สังกัด */
export type BlChoice = {
  /** id ของแถวในตาราง bls */
  id: string;
  jobId: string;
  jobNo: string;
  blNo: string;
  vessel: string | null;
  eta: string | null;
  shipperName: string | null;
  /** มีไฟล์หมวดนี้แนบอยู่แล้วหรือยัง — ใช้เตือนว่ากำลังจะทับของเดิม */
  hasFile: boolean;
};

export type BlMatch = {
  choice: BlChoice;
  /** จับได้จากอะไร ใช้บอกผู้ใช้ว่าทำไมระบบเลือกใบนี้ให้ */
  by: 'blNo' | 'waybill';
};

/**
 * ดัชนีเลข BL ทุกแบบที่ใบหนึ่งรู้จัก
 *
 * เลขในไฟล์ตารางเป็น "KG1222026-70107(ONEYTYOGF5133300)" ซึ่งเก็บทั้งก้อน
 * แต่ในไฟล์ PDF จริงจะเจอแค่เลขใดเลขหนึ่ง จึงต้องเทียบได้ทั้งสามแบบ
 *   - ทั้งก้อน           KG122202670107ONEYTYOGF5133300
 *   - เลขหน้าวงเล็บ       KG122202670107
 *   - เลขในวงเล็บ         ONEYTYOGF5133300
 */
function keysOf(blNo: string): Array<{ key: string; by: BlMatch['by'] }> {
  const out: Array<{ key: string; by: BlMatch['by'] }> = [];
  const whole = blKey(blNo);
  if (whole) out.push({ key: whole, by: 'blNo' });

  const inside = /\(([^)]+)\)/.exec(blNo ?? '');
  if (inside) {
    const before = blKey((blNo ?? '').slice(0, inside.index));
    if (before) out.push({ key: before, by: 'blNo' });
    const waybill = blKey(inside[1]);
    if (waybill) out.push({ key: waybill, by: 'waybill' });
  }
  return out;
}

/**
 * หา BL ในระบบที่ตรงกับเลขที่อ่านได้จากไฟล์ — ไม่มั่นใจคืน null
 *
 * `readNumbers` คือเลขทุกตัวที่อ่านได้จากไฟล์เดียวกัน (เลข BL และ Waybill)
 * ลองทีละตัวตามลำดับที่ส่งมา ตัวไหนเจอเจ้าเดียวก็ใช้ตัวนั้น
 *
 * เทียบสองชั้น — ตรงเป๊ะก่อน แล้วค่อยแบบเลขหนึ่งอยู่ในอีกเลข
 * ชั้นหลังจำเป็นเพราะไฟล์ PDF บางใบพิมพ์เลขติดกับคำอื่น เช่น "BLNOKG1222026-70107"
 * แต่บังคับความยาวขั้นต่ำ 8 ตัว ไม่งั้นเลขสั้น ๆ จะไปตรงกับใบอื่นมั่ว
 */
export function matchBl(readNumbers: string[], choices: BlChoice[]): BlMatch | null {
  const index = choices.flatMap((choice) => keysOf(choice.blNo).map((k) => ({ ...k, choice })));

  for (const raw of readNumbers) {
    const target = blKey(raw);
    if (target.length < 6) continue;

    const exact = index.filter((e) => e.key === target);
    // เลขเดียวกันอยู่หลายงานถือว่าไม่ชัดพอ ให้คนเลือกเอง
    if (unique(exact).length === 1) return { choice: exact[0].choice, by: exact[0].by };
    if (exact.length) continue;

    if (target.length >= 8) {
      const partial = index.filter((e) => e.key.length >= 8
        && (e.key.includes(target) || target.includes(e.key)));
      if (unique(partial).length === 1) return { choice: partial[0].choice, by: partial[0].by };
    }
  }
  return null;
}

/** หลายรายการที่ชี้ไป BL ใบเดียวกัน (เลขหน้ากับเลขในวงเล็บ) ถือเป็นเจ้าเดียว */
function unique<T extends { choice: BlChoice }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((e) => {
    if (seen.has(e.choice.id)) return false;
    seen.add(e.choice.id);
    return true;
  });
}

/**
 * เลขทุกตัวที่ควรลองใช้จับคู่ จากผลอ่านไฟล์หนึ่งใบ
 *
 * เรียงเลขที่อ่านมาจากช่องที่ระบุชัดไว้ก่อน แล้วค่อยตามด้วยเลขที่กวาดจากทั้งหน้า
 * เพราะเลขที่กวาดมามีโอกาสเป็นเลขอื่นที่หน้าตาคล้ายกัน เช่น เลขตู้หรือเลข Booking
 */
export function candidateNumbers(parsed: { blNo?: string }, fullText: string): string[] {
  const out: string[] = [];
  if (parsed.blNo) out.push(parsed.blNo);

  /*
   * เลขที่หน้าตาเป็นเลข BL ในเนื้อเอกสาร
   *
   * รูปแบบที่เจอจริงมีสองแบบ — เลขของสายเรือที่ขึ้นต้นด้วยรหัสสี่ตัว (ONEYTYOGF5133300)
   * และเลขของตัวแทนที่มีขีดคั่น (KG1222026-70107) จึงจับทั้งสองแบบ
   */
  const found = fullText.toUpperCase().match(/\b[A-Z]{2,5}\d[A-Z0-9-]{5,}\b/g) ?? [];
  for (const f of found) if (!out.includes(f)) out.push(f);
  return out;
}
