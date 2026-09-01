import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { masterRecords } from '@/db/schema';

/**
 * จดหมายขอแลก D/O ที่ผู้ดูแลแก้เองได้
 *
 * แต่ละสายเรือใช้หัวบริษัทและถ้อยคำต่างกัน แต่โครงจดหมายเหมือนกันหมด
 * จึงเก็บ "ค่ากลาง" ไว้ชุดเดียว แล้วให้แต่ละสายเรือทับเฉพาะช่องที่ต่าง
 * ช่องไหนของสายเรือปล่อยว่าง = ใช้ค่ากลาง ผู้ดูแลจึงไม่ต้องกรอกซ้ำ 25 รอบ
 *
 * เก็บใน master_records เหมือนฟอร์มปะหน้า E-Office — แยกด้วย type นี้
 * คีย์ของสายเรือใช้รูปแบบ `<code>::<field>` ส่วนค่ากลางใช้ `<field>` เฉย ๆ
 */

export const DO_LETTER_TYPE = 'doLetterForm';

/** สายเรือที่มีแบบฟอร์ม — ตรงกับชีตในไฟล์ต้นทางของผู้ใช้ */
export const SHIPPING_LINES = [
  'CNC', 'WAN HAI', 'MAERSK', 'ONE', 'NEX', 'TOKO LINE', 'NAMSUNG', 'OOCL',
  'RCL', 'CEVA', 'KOLA YANG MING', 'ALPINE', 'ENTERPRISE', 'PILOT',
  'M+R FORWARDING', 'TOLL GLOBAL', 'K LINE', 'KMTC', 'COSCO', 'SINOKOR',
  'FUJITRANS', 'SEALS', 'EASTERN', 'JJ', 'CU LINES',
] as const;

/**
 * ชื่อบริษัทตัวแทนสายเรือ — ต่อท้าย "จัดการแผนกขาเข้า บริษัท" บนบรรทัด "เรียน"
 *
 * คัดจากไฟล์ต้นทางของผู้ใช้ ชีตละสายเรือ จึงเป็นชื่อที่ใช้ยื่นจริงกับแต่ละสาย
 * ตัวแทนของบางสายเป็นคนละบริษัทกับชื่อสายเรือ เช่น CNC ยื่นที่ CMA CGM
 * และ RCL ยื่นที่ NGOW HOCK จึงต้องเก็บเป็นตารางแทนการเดาจากชื่อสายเรือ
 *
 * เป็นแค่ค่าตั้งต้น — ผู้ดูแลทับรายสายเรือได้ที่ /master/do-letter เหมือนช่องอื่น
 * สายเรือที่ยังไม่มีชื่อในตารางนี้ปล่อยว่าง ให้กรอกเองบนหน้าตั้งค่า
 */
export const SHIPPING_LINE_COMPANIES: Record<string, string> = {
  'CNC': 'CMA CGM (THAILAND)Co.,Ltd',
  'WAN HAI': 'WAN HAI LINES LTD.',
  'MAERSK': 'MAERSK LINE (THAILAND) LTD.',
  'ONE': 'Ocean Network Express (Thailand). Ltd.',
  'NEX': 'NEX CONTAINER LINE CO., LTD.',
  'TOKO LINE': 'EASTERN SHIPPING AGENCIES CO., LTD.',
  'NAMSUNG': 'NAMSUNG SHIPPING CO.,LTD.',
  'OOCL': 'OOCL CO.,LTD.',
  'RCL': 'NGOW HOCK CO., LTD.',
  'CEVA': 'CEVA FREIGHT (THAILAND) LTD.',
  'KOLA YANG MING': 'Yang Ming Marine Transport Corp.',
  'ALPINE': 'ALPINE SHIPPING (THAILAND) CO.,LTD.',
  'ENTERPRISE': 'ENTERPRISE TRANSPORT INTERNATIONAL CO., LTD',
  'PILOT': 'PILOT CONSOLIDATOR CO., LTD.',
  'M+R FORWARDING': 'M+R FORWARDING (THAILAND) CO., LTD. (Head Office)',
  'TOLL GLOBAL': 'Toll Global Forwarding (Thailand) Limited',
  'K LINE': 'K LINE (THAILAND) LTD.',
  'KMTC': 'KOREA MARINE TRANSPORT CO.,LTD',
  'COSCO': 'COSCO SHIPPING LINE (THAILAND) CO.,LTD.',
  'SINOKOR': 'SINOKOR MERCHANT MARINE CO., LTD. C/O',
  'FUJITRANS': 'FUJITRANS (THAILAND) CO., LTD',
  'SEALS': 'SEALS THAI INTER CO., LTD.',
  'EASTERN': 'Eastern Shipping Agencies Co., Ltd.',
  'JJ': 'JINJIANG SHIPPING AGENCY CO.,LTD.',
  'CU LINES': 'CU LINES (THAILAND) CO., LTD.',
};

export type FormField = {
  key: string;
  label: string;
  group: string;
  fallback: string;
  hint?: string;
  wide?: boolean;
  /** ตั้งได้เฉพาะค่ากลาง ไม่ต้องมีให้แยกรายสายเรือ */
  sharedOnly?: boolean;
};

export const DO_LETTER_GROUPS = ['หัวจดหมาย', 'เนื้อความ', 'ป้ายกำกับ', 'ผู้ลงนาม', 'ข้อความเพิ่มเติม'] as const;

/**
 * จดหมายหนึ่งงานออกสองใบ — ใบของ KOLA และใบของ MAESOT FREEZONE
 *
 * เนื้อความและตำแหน่งทุกอย่างเหมือนกันหมด ต่างแค่หัวจดหมาย ที่อยู่ และผู้ลงนาม
 * จึงเก็บเป็นชุดละบริษัท แล้ววนออกทีละใบด้วยตัววาดตัวเดียวกัน
 * คีย์ของช่องที่ต่างกันใช้รูปแบบ `co<n>.<field>` ส่วนช่องที่ใช้ร่วมกันไม่มีคำนำหน้า
 */
export const LETTER_COMPANIES = [1, 2] as const;
export type CompanyNo = (typeof LETTER_COMPANIES)[number];

/** ช่องที่แยกตามบริษัท — ต่อคำนำหน้า co<n>. ให้ตอนอ่านค่า */
export const COMPANY_FIELDS = ['companyName', 'companyAddress', 'signerName'] as const;

export const companyKey = (co: CompanyNo, field: string) => `co${co}.${field}`;

/**
 * ตำแหน่งผู้ลงนามแยกตามใบ — ใบที่ 2 เลื่อนเองได้ไม่ผูกกับใบที่ 1
 *
 * สองบริษัทเซ็นคนละคน ชื่อยาวไม่เท่ากันและกระดาษหัวจดหมายเว้นที่ต่างกัน
 * เดิมใช้บล็อกเดียวกันทั้งสองใบ ขยับใบหนึ่งอีกใบก็ขยับตาม จึงแยกบล็อกให้คนละชุด
 */
export const signerBlock = (co: CompanyNo) => `signer${co}`;
export const signerTitleBlock = (co: CompanyNo) => `signerTitle${co}`;

/**
 * ช่องข้อความอิสระที่ผู้ดูแลเพิ่มเองได้ — เนื้อความและตำแหน่งกำหนดเองทั้งคู่
 *
 * บางสายเรือขอให้แนบหมายเหตุหรือตราประทับเฉพาะของตัวเอง ซึ่งไม่มีในโครงจดหมายเดิม
 * ให้ช่องว่างไว้ 4 ช่อง ช่องที่ไม่ได้กรอกข้อความจะไม่ถูกวาด จึงไม่กินที่บนกระดาษ
 * แยกรายสายเรือได้เหมือนช่องอื่น — ค่ากลางกรอกไว้ สายเรือไหนไม่ใช้ก็เว้นว่าง
 */
export const CUSTOM_NOTES = [1, 2, 3, 4] as const;
export type CustomNoteNo = (typeof CUSTOM_NOTES)[number];

/** คีย์ข้อความของช่องอิสระ — ตำแหน่งใช้บล็อกชื่อเดียวกัน */
export const customNoteKey = (n: CustomNoteNo) => `note${n}`;
export const customNoteBlock = (n: CustomNoteNo) => `note${n}`;

export const DO_LETTER_FIELDS: FormField[] = [
  { key: companyKey(1, 'companyName'), label: 'ชื่อบริษัท ใบที่ 1', group: 'หัวจดหมาย',
    fallback: 'KOLA SHIPPING CO.,LTD', wide: true },
  { key: companyKey(1, 'companyAddress'), label: 'ที่อยู่ ใบที่ 1', group: 'หัวจดหมาย',
    fallback: '567 MOO 7, THASAILUAT, MAE SOT, TAK, THAILAND 63110  Tel. 087-5252697',
    wide: true, hint: 'ที่อยู่และเบอร์โทรอยู่บรรทัดเดียวกันตามต้นฉบับ' },
  { key: companyKey(2, 'companyName'), label: 'ชื่อบริษัท ใบที่ 2', group: 'หัวจดหมาย',
    fallback: 'MAESOT FREEZONE CO.,LTD', wide: true },
  { key: companyKey(2, 'companyAddress'), label: 'ที่อยู่ ใบที่ 2', group: 'หัวจดหมาย',
    fallback: '888/2 M.7, THASAILOUD MAESOT, TAK,THAILAND 63110 TEL: 092-689-5294 EMAIL: MAESOT.FZ@GMAIL.COM',
    wide: true },

  { key: 'subject', label: 'เรื่อง', group: 'เนื้อความ', fallback: 'ขอแลก D/O', wide: true },
  { key: 'attention', label: 'เรียน', group: 'เนื้อความ',
    fallback: 'จัดการแผนกขาเข้า บริษัท', wide: true,
    hint: 'ระบบจะต่อท้ายด้วยชื่อบริษัทตัวแทนสายเรือให้เอง' },
  { key: 'attentionCompany', label: 'ชื่อบริษัทตัวแทนสายเรือ', group: 'เนื้อความ',
    fallback: '', wide: true,
    hint: 'ต่อท้ายบรรทัด "เรียน" · เว้นว่าง = ใช้ชื่อตามสายเรือที่เลือกไว้ให้แล้ว' },
  { key: 'notice', label: 'ข้อความแจ้งจากผู้ส่งออก', group: 'เนื้อความ', wide: true,
    fallback: 'เนื่องด้วยทางบริษัท {company} ได้รับแจ้งจากผู้ส่งออกที่ต้นทางว่า\nบี / แอล ต้นฉบับได้ทำเป็นลักษณะ:',
    hint: '{company} จะถูกแทนด้วยชื่อบริษัทของใบนั้น' },
  { key: 'options', label: 'ตัวเลือกลักษณะ B/L (บรรทัดละตัวเลือก)', group: 'เนื้อความ', wide: true,
    fallback: 'SURRENDERED OB/L AT ORIGIN PORT\nSEA WAYBILL\nEXPRESS B/L',
    hint: 'ระบบเติม ( ) นำหน้าทุกบรรทัดให้เอง' },
  { key: 'request', label: 'ข้อความขออนุมัติ', group: 'เนื้อความ', wide: true,
    fallback: 'จึงเรียนมาเพื่อโปรดอนุมัติปล่อย D/O ให้กับทางบริษัทฯ โดยปราศจากการใช้ OBL ตามหนังสือฉบับนี้ด้วย  ซึ่งในการนี้ หากมีความเสียหายประการใดเกิดขึ้น ทางบริษัทฯ ยินดีจะรับผิดชอบความเสียหายทุกประการ' },
  { key: 'closingLine', label: 'บรรทัดปิดท้าย', group: 'เนื้อความ', wide: true,
    fallback: 'จึงเรียนเพื่อโปรดดำเนินการ' },

  { key: 'label.subject', label: 'ป้าย "เรื่อง"', group: 'ป้ายกำกับ', fallback: 'เรื่อง' },
  { key: 'label.attention', label: 'ป้าย "เรียน"', group: 'ป้ายกำกับ', fallback: 'เรียน' },
  { key: 'label.blNo', label: 'ป้ายเลขใบตราส่ง', group: 'ป้ายกำกับ', fallback: 'ใบตราส่งสินค้าเลขที่' },
  { key: 'label.origin', label: 'ป้ายเมืองต้นทาง', group: 'ป้ายกำกับ', fallback: 'เมืองต้นทาง' },
  { key: 'label.destination', label: 'ป้ายเมืองปลายทาง', group: 'ป้ายกำกับ', fallback: 'เมืองปลายทาง' },
  { key: 'label.vessel', label: 'ป้ายชื่อเรือ', group: 'ป้ายกำกับ', fallback: 'ชื่อเรือ' },
  { key: 'label.eta', label: 'ป้ายวันที่เรือเข้า', group: 'ป้ายกำกับ', fallback: 'วันที่เรือเข้า' },
  { key: 'label.date', label: 'ป้ายวันที่บนหัวจดหมาย', group: 'ป้ายกำกับ', fallback: 'วันที่',
    hint: 'ระบบเว้นวรรคก่อนวันที่ให้เอง' },
  { key: 'optionMark', label: 'เครื่องหมายหน้าตัวเลือก B/L', group: 'ป้ายกำกับ', fallback: '(  )' },

  { key: 'closing', label: 'คำลงท้าย', group: 'ผู้ลงนาม', fallback: 'ขอแสดงความนับถือ', wide: true },
  { key: companyKey(1, 'signerName'), label: 'ชื่อผู้ลงนาม ใบที่ 1', group: 'ผู้ลงนาม',
    fallback: 'TANAKORN   TASALEE', hint: 'ระบบใส่วงเล็บครอบให้เอง' },
  { key: companyKey(2, 'signerName'), label: 'ชื่อผู้ลงนาม ใบที่ 2', group: 'ผู้ลงนาม',
    fallback: 'อัครเดช ตาสะทึ', hint: 'ระบบใส่วงเล็บครอบให้เอง' },
  { key: 'signerTitle', label: 'ตำแหน่ง (ใช้ทั้งสองใบ)', group: 'ผู้ลงนาม', fallback: 'DIRECTOR' },

  ...CUSTOM_NOTES.map((n) => ({
    key: customNoteKey(n),
    label: `ข้อความเพิ่มเติมที่ ${n}`,
    group: 'ข้อความเพิ่มเติม',
    fallback: '',
    wide: true,
    hint: n === 1
      ? 'เว้นว่าง = ไม่วาดบนจดหมาย · ขึ้นบรรทัดใหม่ได้ · ตั้งตำแหน่งในตารางพิกัดด้านล่าง'
      : undefined,
  })),
];

/**
 * ตำแหน่งของแต่ละบล็อกบนกระดาษ — หน่วยเป็นพอยต์ นับจากมุมบนซ้าย
 *
 * เดิมจดหมายไหลจากบนลงล่างตายตัว ขยับอะไรไม่ได้เลย
 * ตรงนี้ให้ผู้ดูแลเลื่อนเองได้ เพราะกระดาษหัวจดหมายของแต่ละบริษัทเว้นที่ไม่เท่ากัน
 * ค่าที่ไม่ได้ตั้งจะใช้ค่าเริ่มต้นนี้ ซึ่งเป็นระยะของจดหมายที่ใช้อยู่จริง
 */
export type LetterBlock = {
  key: string;
  label: string;
  x: number;
  y: number;
  /** ระยะห่างระหว่างบรรทัดในบล็อกนี้ (บล็อกที่มีหลายบรรทัด) */
  gap?: number;
};

export const LETTER_BLOCKS: LetterBlock[] = [
  { key: 'header', label: 'หัวจดหมาย (ชื่อบริษัท · ที่อยู่)', x: 298, y: 95, gap: 30 },
  { key: 'rule', label: 'เส้นคาดใต้หัวจดหมาย', x: 85, y: 138 },
  { key: 'date', label: 'วันที่ (ชิดขวา)', x: 545, y: 165 },
  { key: 'subject', label: 'เรื่อง', x: 85, y: 188 },
  { key: 'attention', label: 'เรียน', x: 85, y: 218 },
  { key: 'details', label: 'รายละเอียดงาน (B/L · ต้นทาง · ปลายทาง · เรือ · วันเรือเข้า)', x: 85, y: 262, gap: 25 },
  { key: 'notice', label: 'ข้อความแจ้งจากผู้ส่งออก', x: 85, y: 400, gap: 25 },
  { key: 'options', label: 'ตัวเลือกลักษณะ B/L', x: 155, y: 456, gap: 25 },
  { key: 'request', label: 'ข้อความขออนุมัติ', x: 85, y: 545, gap: 25 },
  { key: 'closingLine', label: 'บรรทัดปิดท้าย', x: 85, y: 630, gap: 25 },
  { key: 'closing', label: 'คำลงท้าย (ขอแสดงความนับถือ)', x: 400, y: 700 },
  ...LETTER_COMPANIES.map((co) => ({
    key: signerBlock(co),
    label: `ชื่อผู้ลงนาม ใบที่ ${co} (ในวงเล็บ)`,
    x: 400,
    y: 745,
  })),
  ...LETTER_COMPANIES.map((co) => ({
    key: signerTitleBlock(co),
    label: `ตำแหน่งผู้ลงนาม ใบที่ ${co}`,
    x: 400,
    y: 771,
  })),
  ...CUSTOM_NOTES.map((n) => ({
    key: customNoteBlock(n),
    label: `ข้อความเพิ่มเติมที่ ${n}`,
    x: 85,
    y: 790 + (n - 1) * 18,
    gap: 22,
  })),
];

const BLOCK_BY_KEY = new Map(LETTER_BLOCKS.map((b) => [b.key, b]));

/** โค้ดที่ใช้เก็บพิกัดของแต่ละบล็อกใน master_records */
export const blockCode = (key: string, part: 'x' | 'y' | 'gap') => `pos.${key}.${part}`;

/**
 * ลำดับบรรทัดรายละเอียดงาน — ข้อความป้ายมาจากช่อง label.* ที่ผู้ดูแลแก้ได้
 *
 * เดิมป้ายฝังไว้ในโค้ด สายเรือที่เรียกชื่อช่องต่างออกไปจึงต้องแก้โค้ดตาม
 * ตอนนี้เหลือแค่ลำดับกับคีย์ ส่วนถ้อยคำอ่านจากแบบฟอร์มเหมือนบรรทัดอื่นในจดหมาย
 */
export const DETAIL_ROWS = ['blNo', 'origin', 'destination', 'vessel', 'eta'] as const;
export type DetailRow = (typeof DETAIL_ROWS)[number];

/** คีย์ของป้ายกำกับในแบบฟอร์ม */
export const labelKey = (field: string) => `label.${field}`;

/**
 * ชื่อท่าปลายทางที่จดหมายใช้ — ทุกงานลงที่แหลมฉบัง
 *
 * ค่าท่าปลายทางมาได้หลายทาง ทั้งชื่อไทยจากตารางท่าเรือ ("ท่าเรือแหลมฉบัง (Laem Chabang Port)")
 * และชื่ออังกฤษหลายแบบที่อ่านจากเอกสาร ("Laem Chabang", "LAEMCHABANG", "LCB")
 * จดหมายต้องขึ้นแบบเดียวเสมอ จึงรวบทุกแบบให้เป็นข้อความเดียวตามต้นฉบับ
 */
export const LAEM_CHABANG = 'LAEM CHABANG, THAILAND';

/** คำที่สื่อถึงแหลมฉบัง — เทียบแบบตัดช่องว่างและอักขระพิเศษทิ้ง */
const LAEM_CHABANG_HINTS = ['LAEMCHABANG', 'LAEMCHABANGPORT', 'LCB', 'THLCH'];

/**
 * ทำชื่อท่าปลายทางให้เป็นรูปแบบเดียว
 *
 * เจอคำที่สื่อถึงแหลมฉบัง (รวมชื่อไทย) ก็คืนข้อความมาตรฐาน
 * ท่าอื่นคืนเป็นตัวพิมพ์ใหญ่ไปตามเดิม ไม่ไปดัดแปลงชื่อที่ไม่รู้จัก
 */
export function normalizeDestination(value: string | null): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  if (raw.includes('แหลมฉบัง')) return LAEM_CHABANG;

  const key = raw.toUpperCase().replace(/[^A-Z]/g, '');
  if (LAEM_CHABANG_HINTS.some((h) => key.includes(h))) return LAEM_CHABANG;
  return raw.toUpperCase();
}

/** เดือนภาษาอังกฤษตัวพิมพ์ใหญ่ — จดหมายต้นฉบับใช้รูปแบบ 27 AUGUST 2026 */
const EN_MONTHS = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
];

/**
 * วันที่แบบที่จดหมายใช้ — "27 AUGUST 2026" ปี ค.ศ.
 *
 * รับได้ทั้ง Date และสตริง YYYY-MM-DD ที่มาจากคอลัมน์ date ของฐานข้อมูล
 * สตริงตัดเอาเฉพาะตัวเลขเอง ไม่ผ่าน new Date() เพราะจะโดนเลื่อนตามโซนเวลา
 * อ่านไม่ออกก็คืนค่าเดิมไป ดีกว่าปล่อยช่องว่างบนจดหมาย
 */
export function letterDate(value: Date | string | null): string {
  if (!value) return '';
  if (value instanceof Date) {
    return `${value.getDate()} ${EN_MONTHS[value.getMonth()]} ${value.getFullYear()}`;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!m) return value;
  return `${Number(m[3])} ${EN_MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export function lineKey(line: string, field: string) {
  return `${line}::${field}`;
}

/**
 * จับ shipline ของงานให้ตรงกับสายเรือที่มีแบบฟอร์ม
 *
 * ค่าที่อ่านได้จาก Arrival Notice เขียนไม่เหมือนกันทุกใบ — "WANHAI" กับ "WAN HAI"
 * หรือ "ONE (OCEAN NETWORK EXPRESS)" กับ "ONE" จึงเทียบแบบตัดช่องว่างและวงเล็บทิ้ง
 * ไม่เจอก็คืน null แล้วให้ผู้ใช้เห็นว่ายังไม่มีแบบฟอร์มของสายเรือนั้น
 */
export function matchShippingLine(shipline: string | null): string | null {
  if (!shipline) return null;
  const norm = (v: string) => v.toUpperCase().replace(/\(.*?\)/g, '').replace(/[^A-Z0-9]/g, '');
  const target = norm(shipline);
  if (!target) return null;

  const exact = SHIPPING_LINES.find((l) => norm(l) === target);
  if (exact) return exact;
  // ชื่อในไฟล์อาจยาวกว่า เช่น "SHANGHAI JINJIANG" ที่มีแบบฟอร์มชื่อ "JINJIANG"
  return SHIPPING_LINES.find((l) => target.includes(norm(l)) || norm(l).includes(target)) ?? null;
}

export type DoLetterForm = {
  /** ค่าดิบที่บันทึกไว้ ยังไม่เติมค่าตั้งต้น */
  raw: (key: string) => string;
  /** ค่าที่ใช้จริงของสายเรือนั้น — ของสายเรือ → ค่ากลาง → ค่าตั้งต้นในโค้ด */
  value: (field: string, line?: string) => string;
  /** ค่าของช่องที่แยกตามบริษัท เช่น ชื่อบริษัทและผู้ลงนามของใบนั้น */
  coValue: (co: CompanyNo, field: string, line?: string) => string;
  /** ตำแหน่งของบล็อกหนึ่ง ผสมกับค่าเริ่มต้นแล้ว — ของสายเรือทับค่ากลางได้ */
  block: (key: string, line?: string) => Required<LetterBlock>;
  /** ชื่อบริษัทตัวแทนที่ต่อท้ายบรรทัด "เรียน" — ที่ตั้งเอง → ชื่อตามสายเรือ */
  attentionCompany: (line?: string) => string;
};

export async function loadDoLetterForm(): Promise<DoLetterForm> {
  const rows = await db
    .select({ code: masterRecords.code, value: masterRecords.value })
    .from(masterRecords)
    .where(eq(masterRecords.type, DO_LETTER_TYPE));

  const saved = new Map(rows.map((r) => [r.code ?? '', r.value ?? '']));
  const raw = (key: string) => saved.get(key) ?? '';
  const fallback = new Map(DO_LETTER_FIELDS.map((f) => [f.key, f.fallback]));

  const value = (field: string, line?: string) => {
    if (line) {
      const own = raw(lineKey(line, field));
      if (own) return own;
    }
    return raw(field) || fallback.get(field) || '';
  };

  return {
    raw,
    value,
    coValue: (co, field, line) => value(companyKey(co, field), line),
    /*
     * ค่าที่ตั้งเองมาก่อนเสมอ ไม่งั้นตารางในโค้ดจะไปทับสิ่งที่ผู้ดูแลตั้งใจแก้
     * เว้นว่างไว้จึงค่อยหยิบชื่อตัวแทนของสายเรือนั้นมาเติมให้
     */
    attentionCompany: (line) =>
      value('attentionCompany', line) || (line ? SHIPPING_LINE_COMPANIES[line] ?? '' : ''),
    block: (key, line) => {
      const base = BLOCK_BY_KEY.get(key);
      if (!base) throw new Error(`ไม่รู้จักบล็อก ${key}`);
      // ตัวเลขที่กรอกผิดหรือติดลบให้ถอยไปใช้ค่าเริ่มต้น ดีกว่าวาดหลุดกระดาษ
      const num = (part: 'x' | 'y' | 'gap', fb: number) => {
        const v = Number(value(blockCode(key, part), line));
        return Number.isFinite(v) && v >= 0 && value(blockCode(key, part), line) !== '' ? v : fb;
      };
      return {
        ...base,
        x: num('x', base.x),
        y: num('y', base.y),
        gap: num('gap', base.gap ?? 21),
      };
    },
  };
}

/**
 * บันทึกทั้งแบบฟอร์มในคราวเดียว — ว่าง = ลบทิ้งเพื่อกลับไปใช้ค่าที่สืบทอดมา
 *
 * เดิมบันทึกทีละช่อง ช่องละ SELECT แล้วค่อย UPDATE/INSERT รวมกว่าร้อยรอบต่อการกดหนึ่งครั้ง
 * ฐานข้อมูลอยู่คนละทวีป แต่ละรอบจึงเสียเวลาเดินทางไปกลับ กดบันทึกทีรอหลายวินาที
 * ตรงนี้ยิงสองคำสั่ง — ลบช่องที่ถูกล้าง แล้ว upsert ที่เหลือเป็นชุดเดียว
 * อาศัย unique index (type, code) ให้ ON CONFLICT ตัดสินว่าจะเพิ่มหรือทับ
 */
export async function saveDoLetterValues(
  entries: Map<string, string>,
  newIdFor: () => string,
) {
  const cleared = [...entries].filter(([, v]) => !v).map(([k]) => k);
  const kept = [...entries].filter(([, v]) => v);

  if (cleared.length) {
    await db.delete(masterRecords)
      .where(and(eq(masterRecords.type, DO_LETTER_TYPE), inArray(masterRecords.code, cleared)));
  }

  if (kept.length) {
    await db.insert(masterRecords)
      .values(kept.map(([code, value]) => ({
        id: newIdFor(), type: DO_LETTER_TYPE, code, name: code, value, isActive: true,
      })))
      .onConflictDoUpdate({
        target: [masterRecords.type, masterRecords.code],
        set: { value: sql`excluded.value`, updatedAt: new Date() },
      });
  }
}
