import type { TemplateFieldKey, TemplateArea, TextPiece } from '@/lib/parse-template';

/**
 * สร้างกรอบอ่านค่าให้เองจากไฟล์ตัวอย่าง
 *
 * หน้าตั้งค่าให้ผู้ดูแลลากกรอบเองทีละช่อง ซึ่งแม่นแต่ช้า — สายเรือหนึ่งมีทั้ง BL
 * และ AN คนละหน้าตา ช่องละ 10 กรอบ กว่าจะครบทุกสายใช้เวลาทั้งวัน
 *
 * ไฟล์นี้ทำแทนได้เมื่อเรารู้ "ค่าที่ถูกต้อง" ของใบตัวอย่างอยู่แล้ว
 * มันไปหาว่าค่านั้นอยู่พิกัดไหนในไฟล์จริง แล้วคำนวณกรอบครอบให้
 * พิกัดจึงมาจากเอกสารจริงเสมอ ไม่ใช่ค่าที่เดาจากการดูข้อความอย่างเดียว
 * ซึ่งจะได้กรอบที่วางผิดตำแหน่งแล้วดึงค่าผิดช่องมาใส่ฟอร์ม — แย่กว่าไม่มีกรอบเลย
 */

/** เทียบข้อความแบบไม่สนตัวพิมพ์ วรรค และเครื่องหมาย เพราะ pdf.js แทรกไม่เหมือนกันทุกใบ */
const norm = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');

export type Box = { x: number; y: number; w: number; h: number };

/** กรอบที่ครอบชิ้นข้อความกลุ่มหนึ่งพอดี */
export function boxOf(group: TextPiece[]): Box {
  const left = Math.min(...group.map((p) => p.left));
  const right = Math.max(...group.map((p) => p.right));
  const top = Math.min(...group.map((p) => p.top));
  const bottom = Math.max(...group.map((p) => p.bottom));
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** ขยายกรอบเผื่อไว้ โดยไม่ให้ล้นออกนอกหน้ากระดาษ */
export function pad(box: Box, padX: number, padY: number): Box {
  const x = Math.max(0, box.x - padX);
  const y = Math.max(0, box.y - padY);
  return {
    x,
    y,
    w: Math.min(1 - x, box.w + padX * 2),
    h: Math.min(1 - y, box.h + padY * 2),
  };
}

/**
 * ขยายกรอบเท่าที่ยังไม่ไปคาบชิ้นข้อความอื่น
 *
 * การอ่านนับว่าชิ้นไหนอยู่ในกรอบจาก "จุดกลาง" ของชิ้น กรอบที่เผื่อกว้างไปนิดเดียว
 * จึงดูดชิ้นข้างเคียงเข้ามาทั้งชิ้น — เจอจริงกับ OOCL ที่ช่องเที่ยวเรือ "030S"
 * อยู่ใต้ชื่อเรือ พอเผื่อกรอบ 0.015 ไปคาบจุดกลางของชิ้น [RAINBOW 030S] ที่อยู่ข้าง ๆ
 * ได้เที่ยวเรือเป็น "RAINBOW030S" และเจอแบบเดียวกันที่ EVERGREEN ("INK1207-084A")
 *
 * จึงเผื่อแบบ "ชนแล้วหยุด" — ขยายไปจนเกือบถึงจุดกลางของชิ้นที่อยู่ถัดไป
 * แล้วหยุดตรงนั้น ได้กรอบที่กว้างที่สุดเท่าที่ยังปลอดภัย
 */
export function padWithoutTouching(
  box: Box, padX: number, padY: number, page: number, own: TextPiece[], all: TextPiece[],
): Box {
  const ownSet = new Set(own);
  const wanted = pad(box, padX, padY);

  // เผื่อเท่าที่ยังไม่ถึงจุดกลางของชิ้นอื่นที่อยู่แถวเดียวกัน
  let left = wanted.x;
  let right = wanted.x + wanted.w;

  for (const p of all) {
    if (p.page !== page || ownSet.has(p)) continue;
    const cy = (p.top + p.bottom) / 2;
    // สนใจเฉพาะชิ้นที่อยู่ในช่วงความสูงของกรอบ — คนละบรรทัดไม่เกี่ยว
    if (cy < wanted.y || cy > wanted.y + wanted.h) continue;

    const cx = (p.left + p.right) / 2;
    // กันไว้นิดหนึ่ง (1 ใน 1000 ของหน้า) ให้จุดกลางอยู่นอกกรอบแน่ ๆ
    const margin = 0.001;
    if (cx <= box.x && cx + margin > left) left = cx + margin;
    if (cx >= box.x + box.w && cx - margin < right) right = cx - margin;
  }

  // ไม่ยอมให้แคบกว่ากรอบเดิมที่ครอบค่าพอดี
  const x = Math.min(left, box.x);
  const w = Math.max(right, box.x + box.w) - x;
  return { x, y: wanted.y, w, h: wanted.h };
}

/**
 * ยืดกรอบแนวตั้งให้คลุมช่วงที่ตารางเลื่อนไปได้
 *
 * ใช้กับช่องที่อยู่ในตารางท้ายเอกสารเท่านั้น (เลขตู้ เลขซีล)
 * ช่องหัวกระดาษอย่างเลข BL หรือชื่อเรืออยู่ตำแหน่งเดิมทุกใบ ไม่ต้องยืด
 * และยืดไม่ได้ด้วย เพราะจะไปกินป้ายหรือค่าช่องอื่นที่อยู่ติดกัน
 */
export function stretchForDrift(box: Box, field: TemplateFieldKey): Box {
  if (!DRIFTING_FIELDS.has(field)) return box;
  const y = Math.max(0, box.y - DRIFT_UP);
  const bottom = Math.min(1, box.y + box.h + DRIFT_DOWN);
  return { x: box.x, y, w: box.w, h: bottom - y };
}

/**
 * ค่าแต่ละชนิดเผื่อกรอบไม่เท่ากัน
 *
 * เผื่อ "แนวนอน" ได้เยอะ เพราะค่าจริงยาวไม่เท่ากันในแต่ละใบ
 * (เลขตู้ 4 ตู้กับ 10 ตู้ · ชื่อเรือสั้นยาวต่างกัน) กรอบที่พอดีเป๊ะกับใบตัวอย่าง
 * จะตัดค่าที่ยาวกว่าของใบถัดไปทิ้ง
 *
 * แต่เผื่อ "แนวตั้ง" ต้องน้อยมาก เพราะเอกสารเดินเรือวางบรรทัดชิดกัน
 * ป้ายของช่องอยู่เหนือค่าแค่บรรทัดเดียว เผื่อบนล่างมากไปจะดูดป้ายเข้ามาด้วย
 * วัดจาก MAERSK จริงแล้ว เผื่อ 0.006 ได้ป้าย "NOTIFY PARTY (COMPLETE NAME AND
 * ADDRESS)" ติดมาหน้าชื่อ Shipper ส่วน 0.002 ได้ชื่อล้วน
 */
export const PADDING: Record<TemplateFieldKey, { x: number; y: number }> = {
  blNo: { x: 0.012, y: 0.002 },
  shipperName: { x: 0.030, y: 0.002 },
  vessel: { x: 0.025, y: 0.002 },
  voyage: { x: 0.015, y: 0.002 },
  eta: { x: 0.015, y: 0.002 },
  portOfLoading: { x: 0.025, y: 0.002 },
  grossWeight: { x: 0.015, y: 0.002 },
  unitAmount: { x: 0.012, y: 0.002 },
  // เลขตู้ไล่เป็นหลายบรรทัด กรอบจึงสูงอยู่แล้ว เผื่อเพิ่มเล็กน้อยให้ตู้แถวใหม่ของใบอื่น
  containers: { x: 0.020, y: 0.006 },
  seals: { x: 0.020, y: 0.006 },
};

/**
 * ช่องที่ "ตารางเลื่อนขึ้นลง" ได้ตามความยาวของเนื้อหาข้างบน
 *
 * ตารางตู้อยู่ท้ายส่วนรายละเอียดสินค้า ซึ่งยาวไม่เท่ากันทุกใบ
 * วัดจาก EVERGREEN Arrival Notice จริง 4 ใบ แถวตู้อยู่ที่
 * top = 0.656 · 0.684 · 0.741 · 0.884 — เลื่อนลงได้ถึง 23% ของความสูงหน้า
 *
 * กรอบที่ครอบพอดีใบตัวอย่างจึงพลาดใบอื่นเกือบหมด
 * ช่องพวกนี้ต้องยืดกรอบให้คลุมทั้งช่วงที่ตารางเลื่อนไปได้ ไม่ใช่แค่ตำแหน่งในใบเดียว
 *
 * ยืดแล้วไม่เสี่ยงเหมือนช่องอื่น เพราะตัวอ่านคัดด้วยรูปแบบอีกชั้น —
 * เลขตู้ต้องเข้ารูป ISO 6346 (4 ตัวอักษร + 7 ตัวเลข) ข้อความอื่นที่กวาดติดมาถูกทิ้ง
 */
const DRIFTING_FIELDS: ReadonlySet<TemplateFieldKey> = new Set(['containers', 'seals']);

/** ยืดกรอบลงล่างเท่านี้ (สัดส่วนของหน้า) เผื่อตารางเลื่อนตามความยาวเนื้อหา */
const DRIFT_DOWN = 0.26;
/** และเผื่อขึ้นบนเล็กน้อย เผื่อใบที่เนื้อหาสั้นกว่าใบตัวอย่าง */
const DRIFT_UP = 0.10;

/** ถือว่าอยู่บรรทัดเดียวกันเมื่อขอบบนต่างกันไม่ถึงครึ่งความสูงของชิ้น */
function sameLine(a: TextPiece, b: TextPiece): boolean {
  const lineH = Math.max(a.bottom - a.top, b.bottom - b.top, 0.004);
  return Math.abs(a.top - b.top) <= lineH / 2;
}

/** เรียงแบบคนอ่าน — บรรทัดบนก่อนล่าง ในบรรทัดเดียวกันซ้ายก่อนขวา */
function readingOrder(list: TextPiece[]): TextPiece[] {
  return [...list].sort((a, b) => {
    if (!sameLine(a, b)) return a.top - b.top;
    return a.left - b.left;
  });
}

/**
 * ค่าที่สั้นกว่านี้ไม่ปลอดภัยพอจะใช้หาพิกัด
 *
 * ค่าอย่างจำนวนหน่วย "33" หรือ "12" เป็นตัวเลขสองหลักที่โผล่ได้ทั่วหน้ากระดาษ
 * — เลขหน้า ปีรถ น้ำหนัก ลำดับรายการ ล้วนมีโอกาสตรงทั้งนั้น
 * ตัวแรกที่เจอจึงมักไม่ใช่ช่องที่เราต้องการ แล้วได้กรอบที่วางผิดที่อย่างมั่นใจ
 *
 * กรอบผิดอันตรายกว่าไม่มีกรอบ เพราะค่าจากกรอบมาก่อนตัวอ่านอัตโนมัติ
 * ของที่เคยอ่านถูกจึงถูกทับด้วยค่าผิด — ยอมไม่สร้างกรอบให้ดีกว่า
 */
const MIN_SAFE_LENGTH = 3;

/**
 * หาชิ้นข้อความที่ประกอบกันเป็นค่าที่ต้องการ
 *
 * pdf.js หั่นข้อความตามการจัดระยะตัวอักษรในไฟล์ ไม่ใช่ตามคำ — เลข BL เดียว
 * จึงกลับมาเป็น "MAEU" + "270801589" คนละชิ้น จับทีละชิ้นจึงไม่เจอ
 * ต้องไล่ต่อชิ้นที่อยู่บรรทัดเดียวกันไปเรื่อย ๆ จนได้ค่าที่ต้องการครบพอดี
 *
 * ต่อได้เฉพาะชิ้นในบรรทัดเดียวกัน — ถ้ายอมข้ามบรรทัด ค่าที่ขึ้นต้นเหมือนกัน
 * แต่อยู่คนละที่จะถูกต่อมั่วเป็นกรอบยักษ์ที่ครอบครึ่งหน้า
 *
 * คืน null เมื่อค่าสั้นเกินกว่าจะมั่นใจ หรือหาไม่เจอ — ผู้เรียกข้ามช่องนั้นไป
 */
export function findValue(pieces: TextPiece[], want: string): TextPiece[] | null {
  const target = norm(want);
  if (target.length < MIN_SAFE_LENGTH) return null;

  const byPage = new Map<number, TextPiece[]>();
  for (const p of pieces) {
    if (!byPage.has(p.page)) byPage.set(p.page, []);
    byPage.get(p.page)!.push(p);
  }

  /*
   * ชิ้นที่ "ตรงเป๊ะทั้งชิ้น" มาก่อนเสมอ และหาทั้งเอกสารก่อนค่อยไล่แบบอื่น
   *
   * ต้องตรงเป๊ะเท่านั้น — เคยยอมรับชิ้นที่มีค่า "อยู่ข้างใน" ด้วย เพื่อจับกรณี
   * [B/L No: 011GX05220] ที่ pdf.js รวมป้ายกับค่าไว้ชิ้นเดียว
   * แต่กลายเป็นบ่อเกิดของค่าสกปรกหลายแบบ — หา "JAN TRADING CO."
   * ได้อีเมล [JAN-JAPAN@JANTRADINGCO.JP] มาแทน
   *
   * ทางที่ถูกกว่าคือเขียนค่าใน SPECS ให้ตรงกับที่อยู่ในไฟล์จริง
   * (ใส่ 'EVER BLINK 1207-084A' ไปเลยถ้าไฟล์เก็บไว้ชิ้นเดียว)
   * แล้วปล่อยให้ stripLabel() ตัดป้ายตอนอ่านจริง
   *
   * และต้องกวาดทั้งเอกสารก่อน ไม่ใช่จบทีละหน้า —
   * OOCL Waybill มี [RAINBOW 030S] อยู่หน้า 1 แต่ [030S] ชิ้นเดี่ยวอยู่หน้า 2
   * ถ้าจบที่หน้า 1 จะได้กรอบที่คาบชื่อเรือ แล้วเที่ยวเรือกลายเป็น "RAINBOW030S"
   */
  const pages = [...byPage.entries()].sort((a, b) => a[0] - b[0]);

  for (const [, list] of pages) {
    const exact = readingOrder(list).find((p) => norm(p.str) === target);
    if (exact) return [exact];
  }

  for (const [, list] of pages) {
    const sorted = readingOrder(list);

    // ค่าถูกหั่นข้ามหลายชิ้น ต้องไล่ต่อจนครบ
    for (let i = 0; i < sorted.length; i += 1) {
      const head = norm(sorted[i].str);
      if (!head) continue;

      /*
       * ชิ้นแรกต้องเป็น "ท้าย" ของค่า หรือทั้งชิ้นเป็นส่วนต้นของค่า
       * ยอมให้ชิ้นแรกมีป้ายนำหน้าได้ เช่น [Loading VSL/VOY][: EVER BASIS 0851-076N]
       * ที่ค่าเริ่มกลางชิ้นที่สอง
       */
      const startAt = head.indexOf(target.slice(0, Math.min(head.length, target.length)));
      const tail = startAt >= 0 ? head.slice(startAt) : '';
      if (!tail || !target.startsWith(tail)) continue;

      const group: TextPiece[] = [sorted[i]];
      let acc = tail;

      for (let j = i + 1; j <= i + 12 && j < sorted.length && acc.length < target.length; j += 1) {
        if (!sameLine(sorted[j], group[0])) break;
        acc += norm(sorted[j].str);
        group.push(sorted[j]);
      }

      /*
       * ต้องได้ครบพอดีเท่านั้น ห้ามเกิน
       *
       * เคยยอมให้ชิ้นสุดท้ายล้นท้ายค่าได้ (เผื่อ [49850KGS] ที่ค่าจริงคือ 49850)
       * แต่ทำให้กรอบชื่อเรือ "BRIGHT TSUBAKI" กลืนชิ้นเที่ยวเรือ "031S" ที่อยู่ถัดไป
       * เข้ามาด้วย แล้วทั้งชื่อเรือและเที่ยวเรือได้ค่าผิดทั้งคู่
       *
       * ค่าที่ติดหน่วยมาในชิ้นเดียวกันถูกจับด้วยทางลัด "ค่าอยู่ข้างในชิ้น" ข้างบนแล้ว
       * ตรงนี้จึงเข้มงวดได้ ไม่เสียอะไร
       */
      if (acc === target) return group;
    }
  }
  return null;
}

/**
 * หาหลายค่าที่ควรอยู่กรอบเดียวกัน เช่นเลขตู้ทั้งใบ
 *
 * คืนเป็นกรอบแยกตามหน้า เพราะบางใบไล่ตู้ข้ามหน้าไปตามความยาวรายการสินค้า
 * รวมเป็นกรอบเดียวข้ามหน้าไม่ได้ พิกัดของคนละหน้าไม่ได้อยู่ระนาบเดียวกัน
 */
export function findAllByPage(pieces: TextPiece[], wants: string[]): Map<number, TextPiece[]> {
  const byPage = new Map<number, TextPiece[]>();
  for (const want of wants) {
    const hit = findValue(pieces, want);
    if (!hit) continue;
    const { page } = hit[0];
    if (!byPage.has(page)) byPage.set(page, []);
    byPage.get(page)!.push(...hit);
  }
  return byPage;
}

/** กรอบของช่องหนึ่ง จากค่าที่รู้อยู่แล้วว่าถูกต้อง — คืน null เมื่อหาค่านั้นในไฟล์ไม่เจอ */
export function frameFor(
  pieces: TextPiece[], field: TemplateFieldKey, want: string,
): TemplateArea | null {
  const hit = findValue(pieces, want);
  if (!hit) return null;
  const p = PADDING[field];
  const box = padWithoutTouching(boxOf(hit), p.x, p.y, hit[0].page, hit, pieces);
  return { field, page: hit[0].page, ...stretchForDrift(box, field) };
}
