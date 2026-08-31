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
 * ช่องของแบบฟอร์ม — ถ้อยคำตั้งต้นถอดมาจากจดหมายจริงที่ใช้อยู่
 * ค่าที่เป็นของแต่ละงาน (B/L, เรือ, ท่า, วันเรือเข้า) ระบบเติมให้เอง ไม่ต้องตั้งที่นี่
 */
export const DO_LETTER_FIELDS: FormField[] = [
  { key: 'companyName', label: 'ชื่อบริษัท (หัวจดหมาย)', group: 'หัวจดหมาย',
    fallback: 'KOLA SHIPPING CO.,LTD', wide: true },
  { key: 'companyAddress', label: 'ที่อยู่', group: 'หัวจดหมาย',
    fallback: '567 MOO 7, THASAILUAT, MAE SOT, TAK, THAILAND 63110', wide: true },
  { key: 'companyContact', label: 'โทรศัพท์ / อีเมล', group: 'หัวจดหมาย',
    fallback: 'Tel. 087-5252697', wide: true },

  { key: 'subject', label: 'เรื่อง', group: 'เนื้อความ', fallback: 'ขอแลก D/O', wide: true },
  { key: 'attention', label: 'เรียน', group: 'เนื้อความ',
    fallback: 'จัดการแผนกขาเข้า', wide: true,
    hint: 'ระบบจะต่อท้ายด้วยชื่อบริษัทสายเรือให้เอง' },
  { key: 'request', label: 'ข้อความขออนุมัติ', group: 'เนื้อความ', wide: true,
    fallback: 'จึงเรียนมาเพื่อโปรดอนุมัติปล่อย D/O ให้กับทางบริษัทฯ โดยปราศจากการใช้ OBL' },
  { key: 'liability', label: 'ข้อความรับผิดชอบ', group: 'เนื้อความ', wide: true,
    fallback: 'หากมีความเสียหายประการใดเกิดขึ้น ทางบริษัทฯ ยินดีจะรับผิดชอบความเสียหายทุกประการ' },

  { key: 'signerName', label: 'ชื่อผู้ลงนาม', group: 'ผู้ลงนาม', fallback: 'TANAKORN TASALEE' },
  { key: 'signerTitle', label: 'ตำแหน่ง', group: 'ผู้ลงนาม', fallback: 'DIRECTOR' },
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
  { key: 'header', label: 'หัวจดหมาย (ชื่อบริษัท · ที่อยู่ · ติดต่อ)', x: 70, y: 62, gap: 18 },
  { key: 'date', label: 'วันที่ (ชิดขวา)', x: 525, y: 138 },
  { key: 'subject', label: 'เรื่อง', x: 70, y: 168 },
  { key: 'attention', label: 'เรียน', x: 70, y: 190 },
  { key: 'details', label: 'รายละเอียดงาน (B/L · เรือ · ท่า · วันเรือเข้า)', x: 70, y: 226, gap: 21 },
  { key: 'body', label: 'ข้อความขออนุมัติ และความรับผิดชอบ', x: 70, y: 356, gap: 21 },
  { key: 'closing', label: 'ขอแสดงความนับถือ', x: 430, y: 452 },
  { key: 'signer', label: 'ชื่อผู้ลงนาม และตำแหน่ง', x: 430, y: 508, gap: 20 },
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
