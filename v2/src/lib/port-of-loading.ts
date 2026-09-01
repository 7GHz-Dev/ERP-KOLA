/**
 * อ่าน "Port of Loading" จาก BL / Arrival Notice เพื่อเติมเมืองต้นทางให้จดหมายแลก D/O
 *
 * เดิมช่องเมืองต้นทางต้องพิมพ์เองทุกงาน ทั้งที่ค่านั้นมีอยู่แล้วในไฟล์ที่แนบมา
 * ตรงนี้อ่านจากไฟล์ให้ แล้วคืนเป็นตัวพิมพ์ใหญ่ตามที่จดหมายใช้
 *
 * เอกสารแต่ละสายเรือวางข้อความคนละแบบ อ่านได้ไม่ครบทุกใบ
 * ใบที่อ่านไม่ออกคืนค่าว่าง ให้ผู้ใช้กรอกเองเหมือนเดิม — เดาผิดแย่กว่าไม่เดา
 * เพราะเมืองต้นทางผิดบนจดหมายที่ยื่นสายเรือแก้ทีหลังไม่ได้
 */

/** ป้ายที่อยู่ถัดจากค่า ใช้ตัดท้ายเมื่อ pdf.js ต่อข้อความช่องถัดไปมาติดกัน */
const NEXT_LABELS = [
  'PORT OF DISCHARGE', 'PLACE OF DELIVERY', 'PORT OF RECEIPT', 'PLACE OF RECEIPT',
  'FINAL DESTINATION', 'PORT OF DELIVERY', 'DISCHARGE', 'DELIVERY', 'CONSIGNEE',
  'NOTIFY', 'VESSEL', 'VOYAGE', 'ETA', 'TYPE OF MOVEMENT', 'CARGO',
];

/** คำที่เป็นหัวข้อ ไม่ใช่ชื่อเมือง — เจอแล้วแปลว่าจับผิดช่อง */
const LABEL_ONLY = new RegExp(
  `^(${NEXT_LABELS.join('|')}|PORT|PORT OF|PLACE|PLACE OF|OF|LOADING|POL|FCL|LCL|CY|N/A|NIL)$`,
);

/**
 * ตัดค่าที่อ่านมาให้เหลือเฉพาะชื่อเมือง
 *
 * pdf.js คืนข้อความทั้งแถวติดกัน ค่าที่จับได้จึงมักมีป้ายของช่องถัดไปห้อยท้ายมาด้วย
 * เช่น "Hakata,Japan Port of Discharge Laem Chabang" ต้องตัดตั้งแต่ป้ายถัดไปทิ้ง
 */
function trimValue(raw: string): string {
  let v = raw.replace(/\s+/g, ' ').trim();

  for (const label of NEXT_LABELS) {
    const at = v.toUpperCase().indexOf(label);
    if (at >= 0) v = v.slice(0, at);
  }

  // ใบที่วางเป็นตาราง หัวช่องถัดไปจ่อติดกันทันที เหลือเศษป้ายอย่าง "PORT OF"
  // เศษแบบนี้ไม่ใช่ชื่อเมือง ตัดทิ้งให้กลายเป็นค่าว่างไปเลย
  v = v.replace(/\bPORT\s*(OF)?\s*$/i, '').replace(/\bPLACE\s*(OF)?\s*$/i, '');

  // ตัดสัญลักษณ์คั่นช่องและเครื่องหมายท้ายที่ติดมากับการแปลงข้อความ
  v = v.replace(/[|:;]+/g, ' ').replace(/[\s,.\-/]+$/, '').trim();

  // ชื่อเมืองยาวเกินนี้แปลว่าคว้าทั้งย่อหน้ามา ไม่ใช่ชื่อช่อง
  if (v.length > 48) v = v.slice(0, 48).replace(/[\s,][^\s,]*$/, '');

  return v.trim();
}

/** ค่าที่อ่านได้ดูเป็นชื่อเมืองจริงหรือไม่ */
function plausible(value: string): boolean {
  if (value.length < 3 || value.length > 48) return false;
  if (LABEL_ONLY.test(value.toUpperCase())) return false;
  // ต้องมีตัวอักษรติดกันอย่างน้อยสามตัว กันเลขที่อยู่และรหัสตู้
  if (!/[A-Za-z]{3}/.test(value)) return false;
  // ที่อยู่เต็ม ๆ มักมีเลขบ้านหรือเบอร์โทรปนมา
  if (/\bTEL\b|\bFAX\b|@|\d{5,}/i.test(value)) return false;
  return true;
}

/**
 * รูปแบบที่ป้ายกับค่าอยู่ติดกันบนบรรทัดเดียว
 *
 * ครอบเอกสารของ Maersk และ OOCL ที่ใช้อยู่จริง ส่วนใบที่วางเป็นตาราง
 * (หัวตารางรวมกันอยู่แถวหนึ่ง ค่าอยู่อีกแถว เช่นของ ONE) จับด้วยวิธีนี้ไม่ได้
 * จึงปล่อยให้คืนค่าว่างไป ดีกว่าไปหยิบค่าของช่องข้างเคียงมาใส่
 */
const PATTERNS: RegExp[] = [
  /PORT\s+OF\s+LOADING\s*[:\-]?\s*([^\n]{2,90})/i,
  /LOADING\s+PORT\s*[:\-]?\s*([^\n]{2,90})/i,
  /\bPOL\b\s*[:\-]\s*([^\n]{2,90})/i,
  /*
   * EVERGREEN รวมสี่ท่าไว้ช่องเดียวคั่นด้วย / — รับ, ต้นทาง, ปลายทาง, ส่งมอบ
   * เช่น "RCT/POL/POD/DLY: MANILA (NORTH PORT)/ MANILA (NORTH PORT)/ LAEM CHABANG/ LAEM CHABANG"
   * ท่าต้นทางคือช่องที่สอง จึงข้ามช่องแรกไปหยิบตัวถัดมา
   */
  /RCT\s*\/\s*POL[^:]{0,20}:\s*[^/\n]{2,45}\/\s*([^/\n]{2,45})/i,
];

/**
 * อ่านเมืองต้นทางจากข้อความของเอกสาร — คืนตัวพิมพ์ใหญ่ทั้งหมด
 *
 * อ่านไม่ออกคืนค่าว่าง ผู้เรียกต้องไม่เขียนทับค่าที่ผู้ใช้กรอกไว้ด้วยค่าว่างนี้
 */
export function parsePortOfLoading(text: string): string {
  if (!text) return '';
  const flat = text.replace(/\r/g, '');

  for (const re of PATTERNS) {
    for (const m of flat.matchAll(new RegExp(re.source, 'gi'))) {
      const value = trimValue(m[1] ?? '');
      if (plausible(value)) return value.toUpperCase();
    }
  }
  return '';
}

/**
 * ดึงข้อความออกจาก PDF ฝั่งเซิร์ฟเวอร์
 *
 * ตัวอ่านตอนรับงานทำงานในเบราว์เซอร์ แต่จดหมายออกที่เซิร์ฟเวอร์
 * จึงใช้ build ตัว legacy ของ pdf.js ที่ไม่ต้องพึ่ง worker และ DOM
 * อ่านไม่ได้ก็คืนค่าว่าง ไม่ให้จดหมายออกไม่ได้เพราะไฟล์แนบมีปัญหา
 */
export async function extractPdfTextServer(bytes: Buffer): Promise<string> {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(bytes),
      // เอกสารสายเรือหลายใบไม่ฝังฟอนต์มาด้วย ปล่อยให้ pdf.js หาเองแทนการล้มทั้งใบ
      useSystemFonts: true,
      isEvalSupported: false,
    }).promise;

    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i += 1) {
      const content = await (await doc.getPage(i)).getTextContent();
      pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
    }
    return pages.join('\n');
  } catch {
    return '';
  }
}
