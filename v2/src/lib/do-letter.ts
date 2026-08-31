import { and, eq } from 'drizzle-orm';
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

export const DO_LETTER_GROUPS = ['หัวจดหมาย', 'เนื้อความ', 'ผู้ลงนาม'] as const;

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
    hint: 'ระบบจะต่อท้ายด้วยชื่อบริษัทสายเรือให้เอง' },
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

  { key: 'closing', label: 'คำลงท้าย', group: 'ผู้ลงนาม', fallback: 'ขอแสดงความนับถือ', wide: true },
  { key: companyKey(1, 'signerName'), label: 'ชื่อผู้ลงนาม ใบที่ 1', group: 'ผู้ลงนาม',
    fallback: 'TANAKORN   TASALEE', hint: 'ระบบใส่วงเล็บครอบให้เอง' },
  { key: companyKey(2, 'signerName'), label: 'ชื่อผู้ลงนาม ใบที่ 2', group: 'ผู้ลงนาม',
    fallback: 'อัครเดช ตาสะทึ', hint: 'ระบบใส่วงเล็บครอบให้เอง' },
  { key: 'signerTitle', label: 'ตำแหน่ง (ใช้ทั้งสองใบ)', group: 'ผู้ลงนาม', fallback: 'DIRECTOR' },
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
  { key: 'signer', label: 'ชื่อผู้ลงนาม และตำแหน่ง', x: 400, y: 745, gap: 26 },
];

const BLOCK_BY_KEY = new Map(LETTER_BLOCKS.map((b) => [b.key, b]));

/** โค้ดที่ใช้เก็บพิกัดของแต่ละบล็อกใน master_records */
export const blockCode = (key: string, part: 'x' | 'y' | 'gap') => `pos.${key}.${part}`;

/** ป้ายกำกับรายละเอียดงานในจดหมาย — ตามต้นฉบับที่ใช้อยู่ */
export const DETAIL_LABELS = {
  blNo: 'ใบตราส่งสินค้าเลขที่',
  origin: 'เมืองต้นทาง',
  destination: 'เมืองปลายทาง',
  vessel: 'ชื่อเรือ',
  eta: 'วันที่เรือเข้า',
} as const;

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

/** บันทึกค่าเดียว — ว่าง = ลบทิ้งเพื่อกลับไปใช้ค่าที่สืบทอดมา */
export async function saveDoLetterValue(key: string, value: string, newIdFor: () => string) {
  const [existing] = await db
    .select({ id: masterRecords.id })
    .from(masterRecords)
    .where(and(eq(masterRecords.type, DO_LETTER_TYPE), eq(masterRecords.code, key)))
    .limit(1);

  if (!value) {
    if (existing) await db.delete(masterRecords).where(eq(masterRecords.id, existing.id));
    return;
  }
  if (existing) {
    await db.update(masterRecords)
      .set({ value, updatedAt: new Date() })
      .where(eq(masterRecords.id, existing.id));
  } else {
    await db.insert(masterRecords).values({
      id: newIdFor(), type: DO_LETTER_TYPE, code: key, name: key, value, isActive: true,
    });
  }
}
