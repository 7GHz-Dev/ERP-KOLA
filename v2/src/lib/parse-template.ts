import { clean, toIsoDate } from '@/lib/parse-arrival';

/**
 * แบบร่างพื้นที่อ่านค่า — บอกระบบว่า "ค่าของช่องนี้อยู่ตรงนี้บนหน้ากระดาษ"
 *
 * ตัวอ่านอัตโนมัติใน parse-arrival.ts เดาจากรูปแบบข้อความ ซึ่งพอใช้กับใบที่เคยเจอ
 * แต่ทุกครั้งที่สายเรือเปลี่ยนหน้าตาเอกสารก็ต้องกลับไปแก้ regex แล้ว deploy ใหม่
 * ไฟล์นี้เปิดทางให้ผู้ดูแลลากกรอบบนหน้าเอกสารเองว่าค่าไหนอยู่ตรงไหน
 * ระบบจึงอ่านใบแบบใหม่ได้โดยไม่ต้องแก้โค้ด
 *
 * พิกัดเก็บเป็น "สัดส่วนของหน้า" (0–1) ไม่ใช่พอยต์
 * เพราะเอกสารเดียวกันมาเป็น A4 ก็มี Letter ก็มี และบางใบถูกสแกนย่อขยายมา
 * สัดส่วนจึงยังตรงอยู่แม้ขนาดกระดาษไม่เท่ากัน
 */

/** ช่องที่ลากกรอบกำหนดได้ — ชุดเดียวกับที่ตัวอ่านอัตโนมัติเติมให้ */
export const TEMPLATE_FIELDS = [
  { key: 'blNo', label: 'เลข BL', hint: 'เช่น MAEU270801589' },
  { key: 'shipperName', label: 'ชื่อ Shipper', hint: 'ชื่อบริษัทผู้ส่งออก ระบบจะไปจับกับ Master Data ให้' },
  { key: 'vessel', label: 'ชื่อเรือ', hint: 'เช่น MAERSK NAMSOS' },
  { key: 'voyage', label: 'เที่ยวเรือ', hint: 'เช่น 628S' },
  { key: 'eta', label: 'ETA วันเรือเข้า', hint: 'รับได้หลายรูปแบบ เช่น 01/08/2026 หรือ AUG 01 2026' },
  { key: 'portOfLoading', label: 'Port of Loading', hint: 'เมืองต้นทาง เช่น HAKATA' },
  { key: 'grossWeight', label: 'น้ำหนักรวม', hint: 'ตัวเลข ลูกน้ำคั่นหลักพันได้' },
  { key: 'unitAmount', label: 'จำนวนหน่วย', hint: 'จำนวนคัน/หีบห่อ' },
  { key: 'containers', label: 'เลขตู้', hint: 'กรอบเดียวครอบได้หลายตู้ ระบบแยกให้เอง' },
  { key: 'seals', label: 'เลขซีล', hint: 'เรียงตามลำดับเดียวกับเลขตู้' },
] as const;

export type TemplateFieldKey = (typeof TEMPLATE_FIELDS)[number]['key'];

/** กรอบอยู่หน้าสุดท้าย ไม่ว่าเอกสารใบนั้นจะมีกี่หน้า */
export const LAST_PAGE = -1;
/** กรอบใช้กับทุกหน้า สำหรับค่าที่ไล่ต่อกันข้ามหน้า */
export const EVERY_PAGE = 0;

/** ชื่อโหมดหน้าที่เอาไปแสดงบนหน้าจอ */
export function pageLabel(page: number, totalPages?: number): string {
  if (page === EVERY_PAGE) return 'ทุกหน้า';
  if (page === LAST_PAGE) return totalPages ? `หน้าสุดท้าย (${totalPages})` : 'หน้าสุดท้าย';
  return `หน้า ${page}`;
}

export const TEMPLATE_FIELD_KEYS = TEMPLATE_FIELDS.map((f) => f.key) as readonly TemplateFieldKey[];

export function fieldLabel(key: string): string {
  return TEMPLATE_FIELDS.find((f) => f.key === key)?.label ?? key;
}

/**
 * กรอบหนึ่งกรอบบนหน้าเอกสาร
 *
 * x/y/w/h เป็นสัดส่วนของหน้า นับจากมุมบนซ้าย เหมือนที่คนมองหน้ากระดาษ
 * (pdf.js นับจากมุมล่างซ้าย ตัวแปลงพิกัดจัดการให้ในไฟล์นี้ที่เดียว)
 */
export type TemplateArea = {
  field: TemplateFieldKey;
  /**
   * หน้าที่กรอบนี้อยู่ — เอกสารสายเรือมีจำนวนหน้าไม่เท่ากันทุกใบ
   * ระบุเป็นเลขหน้าตายตัวอย่างเดียวจึงไม่พอ
   *
   *   1, 2, 3…  หน้าที่ระบุ (นับจากหน้าแรก)
   *   LAST_PAGE  หน้าสุดท้าย ไม่ว่าใบนั้นจะมีกี่หน้า
   *              เช่นยอดรวมทั้งใบของ CNC ที่อยู่ท้ายสุดเสมอ แต่ใบหนึ่งมี 2 หน้า อีกใบมี 7 หน้า
   *   EVERY_PAGE ทุกหน้า ใช้กับค่าที่ไล่ต่อกันข้ามหน้า
   *              เช่นเลขตู้ของ CNC ที่ขึ้นหน้าใหม่เรื่อย ๆ ตามความยาวรายการสินค้า
   */
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

/**
 * แบบร่างของเอกสารหนึ่งรูปแบบ
 *
 * match = ข้อความที่ต้องเจอในหน้าเอกสารจึงจะถือว่าเป็นแบบนี้
 * ผู้ใช้ไม่ต้องเลือกแบบเองตอนอัปโหลด ระบบจับให้จากข้อความในไฟล์
 */
export type ParseTemplate = {
  id: string;
  name: string;
  /** คำที่ต้องเจอครบทุกคำจึงเข้าเงื่อนไข — คนละบรรทัดกันได้ */
  match: string[];
  areas: TemplateArea[];
  isActive: boolean;
};

/** ชิ้นข้อความหนึ่งชิ้นที่ pdf.js อ่านได้ พร้อมพิกัดเป็นสัดส่วนของหน้า */
export type TextPiece = {
  page: number;
  /** ซ้าย/บน/ขวา/ล่าง เป็นสัดส่วน 0–1 นับจากมุมบนซ้าย */
  left: number;
  top: number;
  right: number;
  bottom: number;
  str: string;
};

/**
 * ข้อความที่อยู่ในกรอบ
 *
 * นับว่าอยู่ในกรอบเมื่อ "จุดกลาง" ของชิ้นข้อความตกในกรอบ ไม่ใช่ต้องทั้งชิ้น
 * เพราะ pdf.js คืนความกว้างของชิ้นตามกล่องฟอนต์ ซึ่งมักล้นขอบช่องจริงไปเล็กน้อย
 * ถ้าบังคับว่าต้องอยู่ในกรอบทั้งชิ้น ผู้ใช้จะต้องลากกรอบเผื่อไว้มากจนไปคาบค่าช่องข้าง ๆ
 *
 * เรียงผลตามการอ่านของคน — บรรทัดบนก่อนล่าง ในบรรทัดเดียวกันซ้ายก่อนขวา
 * pdf.js คืนชิ้นข้อความตามลำดับที่ฝังในไฟล์ ซึ่งบางใบสลับคอลัมน์ขวามาก่อนซ้าย
 */
export function piecesInArea(pieces: TextPiece[], area: TemplateArea): TextPiece[] {
  /*
   * แปลงโหมดหน้าให้เป็นเลขหน้าจริงของเอกสารใบนี้ก่อน
   * หน้าสุดท้ายต้องดูจากจำนวนหน้าที่อ่านมาได้ ไม่ใช่ค่าที่เก็บไว้ในแบบร่าง
   */
  const lastPage = pieces.reduce((max, p) => Math.max(max, p.page), 0);
  const onPage = (page: number) => {
    if (area.page === EVERY_PAGE) return true;
    if (area.page === LAST_PAGE) return page === lastPage;
    return page === area.page;
  };

  const inside = pieces.filter((p) => {
    if (!onPage(p.page)) return false;
    const cx = (p.left + p.right) / 2;
    const cy = (p.top + p.bottom) / 2;
    return cx >= area.x && cx <= area.x + area.w && cy >= area.y && cy <= area.y + area.h;
  });

  /*
   * ถือว่าอยู่บรรทัดเดียวกันเมื่อขอบบนต่างกันไม่ถึงครึ่งความสูงของชิ้น
   * ใช้ความสูงจริงของชิ้นเป็นเกณฑ์ ไม่ใช่ค่าคงที่ เพราะขนาดตัวอักษรต่างกันมากในใบเดียว
   */
  return inside.sort((a, b) => {
    // กรอบแบบทุกหน้าเก็บข้อความจากหลายหน้า ต้องเรียงหน้าก่อน ไม่งั้นค่าหน้าหลังไปแทรกหน้าแรก
    if (a.page !== b.page) return a.page - b.page;
    const lineH = Math.max(a.bottom - a.top, b.bottom - b.top, 0.004);
    if (Math.abs(a.top - b.top) > lineH / 2) return a.top - b.top;
    return a.left - b.left;
  });
}

/**
 * ข้อความในกรอบ
 *
 * pdf.js หั่นข้อความเป็นชิ้นตามการจัดระยะตัวอักษรในไฟล์ ไม่ใช่ตามคำ
 * ชื่อบริษัทเดียวจึงกลับมาเป็น "CO.,L" + "TD." ซึ่งถ้าต่อด้วยช่องว่างทุกชิ้น
 * จะได้ "CO.,L TD." ที่มีช่องว่างโผล่กลางคำ
 *
 * ดูจากพิกัดว่าสองชิ้นชนกันบนกระดาษจริงไหม — ชนกันคือคำเดียวที่ถูกหั่น ต่อตรง ๆ
 *
 * วัดจากเอกสารจริงแล้วสองกรณีนี้แยกกันชัด (เทียบเป็นสัดส่วนของความสูงตัวอักษร)
 *   ช่องว่างจริงระหว่างคำ   +0.32 ถึง +0.39   ("KOLA" | "SHIPPING")
 *   คำเดียวที่ถูกหั่น       -0.11             ("CO.,L" + "TD.")
 * ชิ้นที่ถูกหั่นกลางคำจะ "เหลื่อมกัน" คือขอบซ้ายของชิ้นหลังอยู่ก่อนขอบขวาของชิ้นหน้า
 * จึงใช้แค่ว่าเหลื่อมกันหรือไม่เป็นเกณฑ์ ไม่ต้องเดาความกว้างของช่องว่างในแต่ละฟอนต์
 */
export function textInArea(pieces: TextPiece[], area: TemplateArea): string {
  const inside = piecesInArea(pieces, area);
  let out = '';
  let previous: TextPiece | null = null;

  for (const piece of inside) {
    if (previous) {
      const sameLine = piece.page === previous.page
        && Math.abs(piece.top - previous.top) <= (piece.bottom - piece.top) / 2;
      const glue = sameLine && piece.left < previous.right;
      if (!glue) out += ' ';
    }
    out += piece.str;
    previous = piece;
  }

  return out.replace(/\s+/g, ' ').trim();
}

/**
 * แบบร่างที่ตรงกับเอกสารนี้
 *
 * เทียบแบบไม่สนตัวพิมพ์เล็กใหญ่และยุบช่องว่างซ้ำ เพราะ pdf.js แทรกช่องว่างไม่เหมือนกันทุกใบ
 * ตรงหลายแบบให้เอาแบบที่ระบุคำไว้มากที่สุด ถือว่าเจาะจงกว่า
 */
export function matchTemplate(templates: ParseTemplate[], text: string): ParseTemplate | null {
  const haystack = text.toUpperCase().replace(/\s+/g, ' ');
  const hits = templates.filter((t) =>
    t.isActive &&
    t.match.length > 0 &&
    t.match.every((word) => haystack.includes(word.toUpperCase().replace(/\s+/g, ' ').trim())));
  if (!hits.length) return null;
  return hits.sort((a, b) => b.match.length - a.match.length)[0];
}

/* ---------------- แปลงข้อความในกรอบให้เป็นค่าที่ใช้ได้ ---------------- */

/**
 * ข้อความในกรอบยังมีป้ายของช่องติดมาด้วย เพราะคนลากกรอบมักคลุมป้ายไปพร้อมค่า
 * ตัดป้ายที่รู้จักออกให้ ผู้ใช้จึงลากกรอบหยาบ ๆ ได้โดยไม่ต้องเล็งให้พอดีค่าเป๊ะ ๆ
 *
 * ตัดเฉพาะป้ายที่อยู่ "ต้น" ข้อความ ไม่ตัดกลางข้อความ
 * เพราะชื่อบริษัทบางชื่อมีคำพวกนี้อยู่จริง เช่น "OCEAN NETWORK EXPRESS"
 */
const LABEL_PREFIX = new RegExp(
  '^(?:'
  + 'B\\s*/?\\s*L\\s*(?:NO\\.?|NUMBER)?|BILL\\s*OF\\s*LADING(?:\\s*NO\\.?)?|WAYBILL\\s*(?:NO\\.?|NUMBER)?'
  + '|SHIPPER(?:\\s*/\\s*EXPORTER)?|EXPORTER|CONSIGNOR'
  + '|VESSEL(?:\\s*NAME)?|VOY(?:AGE)?(?:\\s*NO\\.?)?|VSL|V\\.'
  + '|ETA|ESTIMATED\\s*(?:TIME\\s*OF\\s*)?ARRIVAL|EST\\.?\\s*ARRIVAL(?:\\s*DATE)?|ARRIVAL\\s*DATE'
  + '|PORT\\s*OF\\s*LOADING|POL|PLACE\\s*OF\\s*RECEIPT|LOADING\\s*PORT'
  + '|GROSS\\s*WEIGHT|G\\.?\\s*W\\.?|WEIGHT|TOTAL'
  + '|CONTAINER(?:\\s*NO\\.?)?|CNTR(?:\\s*NO\\.?)?|SEAL(?:\\s*NO\\.?)?'
  + '|QUANTITY|QTY|UNIT|PACKAGES?|PKGS?|NO\\.?\\s*OF\\s*(?:UNITS?|PKGS?)'
  + ')\\s*[:.\\-]?\\s*',
  'i',
);

function stripLabel(raw: string): string {
  let v = clean(raw);
  // ป้ายซ้อนกันได้ เช่น "B/L No. :" แล้วตามด้วย "WAYBILL NUMBER"
  for (let i = 0; i < 3; i += 1) {
    const next = v.replace(LABEL_PREFIX, '');
    if (next === v) break;
    v = clean(next);
  }
  return v;
}

/** ตัวเลขที่ปนหน่วยมาด้วย เช่น "16,350.00 KGS" หรือ "5 UNITS" */
function numberFrom(raw: string): string {
  const m = clean(raw).replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  if (!m) return '';
  const n = Number(m[0]);
  if (!Number.isFinite(n) || n <= 0) return '';
  // ตัดศูนย์ท้ายทศนิยมที่ไม่มีความหมาย เพราะช่องในระบบเก็บเป็นตัวเลข
  return String(n);
}

/**
 * ค่าของช่องหนึ่งจากข้อความในกรอบ
 *
 * แต่ละชนิดช่องล้างต่างกัน — วันที่แปลงรูปแบบ ตัวเลขตัดหน่วย รหัสตัดช่องว่างใน
 * ช่องที่คืนค่าว่างแปลว่าในกรอบไม่มีอะไรที่ใช้ได้ ปล่อยให้ตัวอ่านอัตโนมัติหรือคนกรอกต่อ
 */
export function valueFromText(field: TemplateFieldKey, raw: string): string | string[] {
  const text = stripLabel(raw);
  if (!text) return field === 'containers' || field === 'seals' ? [] : '';

  switch (field) {
    case 'blNo':
      /*
       * เลข BL เป็นรหัสตัวเดียว — pdf.js มักหั่นเป็นหลายชิ้น ("MAEU" แล้ว "270801589")
       * ยุบช่องว่างทั้งหมดจึงได้รหัสกลับมาเต็ม
       */
      return text.replace(/\s+/g, '').toUpperCase();

    case 'voyage':
      return text.replace(/\s+/g, '').toUpperCase();

    case 'eta':
      return toIsoDate(text);

    case 'grossWeight':
    case 'unitAmount':
      return numberFrom(text);

    case 'containers':
      /*
       * เลขตู้เป็น 4 ตัวอักษร + 7 ตัวเลข ตามมาตรฐาน ISO 6346
       *
       * ต้องอ่านทีละคำ ห้ามยุบช่องว่างทั้งก้อนก่อนแล้วค่อยจับ
       * เพราะกรอบเลขตู้มักคาบบรรทัด "SEAL M5003182" ที่อยู่ใต้กัน
       * ยุบช่องว่างแล้วจะกลายเป็น "SEALM5003182" ซึ่งเข้ารูปแบบเลขตู้พอดี
       * ได้ตู้ปลอม "EALM5003182" ติดมาด้วยทุกใบ
       */
      return [...new Set(
        text.toUpperCase().split(/[^A-Z0-9]+/)
          .filter((token) => /^[A-Z]{4}\d{7}$/.test(token)),
      )];

    case 'seals':
      /*
       * เลขซีลไม่มีรูปแบบมาตรฐาน แยกด้วยตัวคั่นแล้วเอาที่ดูเป็นรหัสจริง
       * ตัดเลขตู้ออก เพราะกรอบเลขซีลมักอยู่ติดกับคอลัมน์เลขตู้
       */
      return text.toUpperCase().split(/[\s,;/|]+/)
        .map((v) => v.trim())
        .filter((v) => v.length >= 4 && v.length <= 20 && /\d/.test(v) && !/^[A-Z]{4}\d{7}$/.test(v));

    case 'vessel':
    case 'shipperName':
    case 'portOfLoading':
    default:
      return text.toUpperCase();
  }
}

/**
 * อ่านค่าทุกช่องตามแบบร่าง
 *
 * คืนเฉพาะช่องที่อ่านได้ ช่องที่กรอบว่างหรือล้างแล้วไม่เหลืออะไรจะไม่อยู่ในผล
 * ผู้เรียกจึงแยกออกได้ว่า "แบบร่างไม่ได้กำหนดช่องนี้" กับ "กำหนดแล้วแต่อ่านไม่ได้"
 */
export function readByTemplate(
  template: ParseTemplate, pieces: TextPiece[],
): { values: Partial<Record<TemplateFieldKey, string>>; containers: string[]; seals: string[]; missing: TemplateFieldKey[] } {
  const values: Partial<Record<TemplateFieldKey, string>> = {};
  let containers: string[] = [];
  let seals: string[] = [];
  const missing: TemplateFieldKey[] = [];

  for (const area of template.areas) {
    const got = valueFromText(area.field, textInArea(pieces, area));
    if (Array.isArray(got)) {
      if (!got.length) { missing.push(area.field); continue; }
      /*
       * เลขตู้และเลขซีลลากได้หลายกรอบ เพราะบางใบไล่ตู้เป็นหลายแถวคนละที่
       * จึงต้องสะสมจากทุกกรอบ ไม่ใช่ทับกัน — ทับกันจะเหลือแต่กรอบสุดท้าย
       * เรียงตามลำดับกรอบที่ลากไว้ เพื่อให้ซีลยังจับคู่กับตู้ได้ตรงคัน
       */
      if (area.field === 'containers') containers = [...containers, ...got];
      else seals = [...seals, ...got];
      continue;
    }
    if (!got) { missing.push(area.field); continue; }
    values[area.field] = got;
  }

  // ตู้เดียวกันอาจอยู่ในกรอบที่คาบเกี่ยวกันสองกรอบ ตัดซ้ำทิ้งหลังรวมครบแล้ว
  return { values, containers: [...new Set(containers)], seals: [...new Set(seals)], missing };
}

/* ---------------- รวมค่าจากกรอบกับตัวอ่านอัตโนมัติ ---------------- */

/** ผลอ่านของตัวอ่านอัตโนมัติ — รับเป็นรูปแบบนี้เพื่อไม่ต้องผูกกับ ParsedArrival ตรง ๆ */
export type AutoRead = {
  carrier: string;
  blNo: string;
  portOfLoading: string;
  shipperName: string;
  blType: string;
  vessel: string;
  voyage: string;
  eta: string;
  grossWeight: string;
  unitAmount: string;
  containers: string[];
  seals: string[];
};

export type CombinedRead = AutoRead & {
  /** ชื่อแบบร่างที่ใช้ — ว่างแปลว่าไม่มีแบบไหนตรง ใช้ตัวอ่านอัตโนมัติทั้งใบ */
  templateName: string;
  /** ช่องที่ค่ามาจากกรอบ ไม่ใช่จากตัวอ่านอัตโนมัติ */
  fromTemplate: TemplateFieldKey[];
};

/**
 * ค่าสุดท้ายที่เอาไปเติมในฟอร์ม
 *
 * ค่าจากกรอบมาก่อน เพราะเป็นสิ่งที่ผู้ดูแลชี้เองว่าอยู่ตรงนั้น
 * ส่วนตัวอ่านอัตโนมัติเป็นการเดาจากรูปแบบข้อความ
 *
 * ช่องที่แบบร่างไม่ได้กำหนด หรือกำหนดแล้วแต่อ่านไม่ได้ ยังใช้ค่าจากตัวอ่านอัตโนมัติ
 * แบบร่างจึงไม่เคยทำให้อ่านได้น้อยลงกว่าเดิม มีแต่เพิ่มขึ้น
 */
export function combineRead(
  auto: AutoRead, template: ParseTemplate | null, pieces: TextPiece[],
): CombinedRead {
  if (!template) return { ...auto, templateName: '', fromTemplate: [] };

  const read = readByTemplate(template, pieces);
  const out: CombinedRead = { ...auto, templateName: template.name, fromTemplate: [] };

  for (const [key, value] of Object.entries(read.values) as Array<[TemplateFieldKey, string]>) {
    if (!value) continue;
    if (key === 'containers' || key === 'seals') continue;
    (out as unknown as Record<string, string>)[key] = value;
    out.fromTemplate.push(key);
  }

  if (read.containers.length) {
    out.containers = read.containers;
    out.fromTemplate.push('containers');
    /*
     * เลขซีลเรียงคู่กับเลขตู้ตามลำดับ พอเลขตู้มาจากกรอบแล้ว
     * ซีลที่ตัวอ่านอัตโนมัติจับไว้อาจไม่ได้เรียงตรงกับตู้ชุดใหม่
     * ถ้าแบบร่างไม่ได้กำหนดกรอบซีลไว้ด้วย จึงล้างซีลทิ้งแทนที่จะจับคู่ผิดคัน
     */
    if (!read.seals.length) out.seals = [];
  }
  if (read.seals.length) {
    out.seals = read.seals;
    out.fromTemplate.push('seals');
  }

  return out;
}
