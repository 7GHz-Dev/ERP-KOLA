/**
 * จับชื่อผู้ส่งออกที่อ่านจากไฟล์ ให้ตรงกับรายชื่อใน Master Data
 *
 * ชื่อในเอกสารกับในระบบไม่เคยตรงกันเป๊ะ — เอกสารมี "AICHI AUTOMOBILES CO.,LTD"
 * ส่วนในระบบเก็บว่า "AICHI AUTOMOBILES" และบางใบ pdf.js แทรกช่องว่างกลางคำ
 * ("TMA CO.,L TD.") จึงเทียบแบบตัดคำต่อท้ายที่เป็นรูปแบบบริษัทและอักขระพิเศษทิ้ง
 *
 * เลือกให้เฉพาะตอนมั่นใจ ไม่งั้นปล่อยว่างให้เลือกเอง — เลือกผิดบริษัทให้แล้ว
 * ผู้ใช้มักกดผ่านโดยไม่ทันสังเกต ซึ่งแย่กว่าไม่เลือกให้เลย
 */

/** คำต่อท้ายที่บอกรูปแบบบริษัท ไม่ได้ช่วยแยกว่าเป็นเจ้าไหน */
const SUFFIX = /\b(CO|LTD|LTD'?S|LIMITED|INC|CORP|CORPORATION|COMPANY|LLC|FZE|PTE|PVT|INTL|INTERNATIONAL|TRADING|INDUSTRIES|GROUP)\b/g;

/** เหลือแต่ตัวอักษรและตัวเลข ตัดช่องว่างที่ pdf.js แทรกเกินมาด้วย */
const squeeze = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** คำต่อท้ายเดียวกัน แต่ใช้กับข้อความที่ยุบช่องว่างแล้ว */
const SUFFIX_SQUEEZED = /(CO|LTD|LIMITED|INC|CORP|CORPORATION|COMPANY|LLC|FZE|PTE|PVT|INTL|INTERNATIONAL|TRADING|INDUSTRIES|GROUP)/g;

/**
 * คำหลักที่ใช้แยกว่าเป็นบริษัทไหน — ตัดคำต่อท้ายทั่วไปออกแล้ว
 *
 * ตัดสองรอบ เพราะ pdf.js แทรกช่องว่างกลางคำได้ ("TMA CO.,L TD")
 * ทำให้ \b ของรอบแรกไม่เจอ "LTD" ที่ถูกหั่นเป็น "L TD"
 * รอบสองยุบช่องว่างก่อนแล้วค่อยตัด จึงเก็บกรณีพวกนี้ได้
 */
function core(value: string): string {
  const once = squeeze(value.toUpperCase().replace(SUFFIX, ' '));
  return once.replace(SUFFIX_SQUEEZED, '');
}

export type ShipperChoice = { id: string; name: string };

/**
 * หา Shipper ที่ตรงที่สุด — ไม่มั่นใจคืน null
 *
 * ไล่จากตรงเป๊ะ ไปหาแบบชื่อหนึ่งอยู่ในอีกชื่อ
 * ถ้าเข้าเงื่อนไขหลายเจ้า ถือว่าไม่ชัดพอ คืน null ให้เลือกเอง
 */
export function matchShipper(
  readName: string | null | undefined,
  choices: ShipperChoice[],
): ShipperChoice | null {
  const raw = squeeze(readName ?? '');
  const target = core(readName ?? '');
  if (raw.length < 3) return null;

  /*
   * เทียบสองชั้น — ทั้งชื่อเต็มและชื่อที่ตัดคำต่อท้ายออกแล้ว
   *
   * ตัดคำต่อท้ายช่วยให้ "AICHI AUTOMOBILES CO.,LTD" ตรงกับ "AICHI AUTOMOBILES"
   * แต่พังกับชื่อที่คำต่อท้ายเป็นส่วนหนึ่งของชื่อจริง เช่น
   * "MAYA FZE INTERNATIONAL CORPORATION" ที่เหลือแค่ "MAYA" หลังตัด
   * จึงเก็บชื่อเต็มไว้เทียบด้วย เจอทางไหนก่อนก็ใช้ทางนั้น
   */
  const keyOf = (name: string) => ({ full: squeeze(name), key: core(name) });

  // ตรงเป๊ะถือว่าชัดพอ แม้ชื่อจะสั้นอย่าง "TMA" ที่เหลือ 3 ตัวหลังตัดคำต่อท้าย
  const exact = choices.filter((c) => {
    const k = keyOf(c.name);
    return k.full === raw || (k.key.length >= 3 && k.key === target);
  });
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;

  // ชื่อในเอกสารมักยาวกว่าที่เก็บไว้ เพราะมีคำต่อท้ายและสาขาพ่วงมา
  const partial = choices.filter((c) => {
    const k = keyOf(c.name);
    if (k.full.length >= 6 && (raw.includes(k.full) || k.full.includes(raw))) return true;
    return k.key.length >= 6 && target.length >= 6
      && (target.includes(k.key) || k.key.includes(target));
  });
  return partial.length === 1 ? partial[0] : null;
}
