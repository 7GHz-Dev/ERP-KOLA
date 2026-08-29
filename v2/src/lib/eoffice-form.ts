import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { masterRecords } from '@/db/schema';

/**
 * แบบฟอร์มปะหน้า (คำร้องขอนำของเข้าเขตปลอดอากร) ที่ผู้ดูแลแก้เองได้
 *
 * เดิมข้อความและตำแหน่งทุกบรรทัดฝังอยู่ในโค้ดสองที่ — ตัววาด PDF กับหน้าจอ A4
 * พอด่านเปลี่ยนถ้อยคำ เปลี่ยนชื่อผู้ลงนาม หรือขอให้ขยับตาราง ต้องแก้โค้ดแล้ว deploy ใหม่
 * ตรงนี้ย้ายมาเก็บเป็นค่าตั้งต้นในฐานข้อมูล แก้ได้เองที่หน้า /master/eoffice
 * ช่องไหนยังไม่เคยแก้ก็ใช้ค่าตามแบบฟอร์มที่ด่านใช้อยู่เป็นค่าเริ่มต้น
 */

/** เก็บใน master_records แยกด้วย type นี้ — ไม่อยู่ใน MASTER_TYPES เพราะมีหน้าจอของตัวเอง */
export const EOFFICE_FORM_TYPE = 'eofficeForm';

export type FieldKind = 'text' | 'number';

export type FormField = {
  key: string;
  label: string;
  group: string;
  kind: FieldKind;
  fallback: string;
  hint?: string;
  /** ข้อความยาวที่ควรได้ช่องเต็มแถว */
  wide?: boolean;
  /**
   * ช่องนี้ยังใช้อยู่ตอนอัปโหลดแบบฟอร์มพื้นหลังมาแล้วหรือไม่
   * ข้อความและระยะเกือบทั้งหมดเป็นของโหมดวาดเอง พอมีพื้นหลังแล้วตัวกระดาษมาจากไฟล์
   */
  bothModes?: boolean;
};

/**
 * ขนาดตัวอักษรเป็นพอยต์ของ Angsana New ซึ่งเป็นฟอนต์ที่แบบฟอร์มนี้ใช้
 * Angsana New กว้างราวสองในสามของฟอนต์ไทยทั่วไปที่พอยต์เท่ากัน ตัวเลขจึงสูงกว่าที่คุ้นตา
 * (22 pt ของ Angsana New เห็นเท่ากับ 15 pt ของ Sarabun)
 */
export const EOFFICE_FORM_FIELDS: FormField[] = [
  /* ---------- หัวเรื่อง ---------- */
  {
    key: 'title', group: 'หัวเรื่อง', kind: 'text', wide: true,
    label: 'ชื่อเรื่องกลางหน้า',
    fallback: 'คำร้องขอนำของที่นำเข้ามาในราชอาณาจักรเข้าไปในเขตปลอดอากร',
  },
  {
    key: 'bookNo', group: 'หัวเรื่อง', kind: 'text',
    label: 'เล่มที่',
    fallback: '0869', bothModes: true,
    hint: 'เลขหน้าของ เลขที่ 0869 / 0028 — เลขหลังระบบรันให้เอง',
  },
  {
    key: 'subject', group: 'หัวเรื่อง', kind: 'text', wide: true,
    label: 'เรื่อง',
    fallback: 'ขอนำของที่นำเข้ามาในราชอาณาจักรเข้าเขตปลอดอากร',
  },
  {
    key: 'attention', group: 'หัวเรื่อง', kind: 'text',
    label: 'เรียน',
    fallback: 'นายด่านศุลกากรแม่สอด',
  },

  /* ---------- ผู้ประกอบการ ---------- */
  { key: 'companyName', group: 'ผู้ประกอบการ', kind: 'text', label: 'ชื่อบริษัท', fallback: 'แม่สอดฟรีโซน จำกัด' },
  { key: 'licenseNo', group: 'ผู้ประกอบการ', kind: 'text', label: 'เลขที่ใบรับรอง', fallback: '97-2567' },
  { key: 'addressNo', group: 'ผู้ประกอบการ', kind: 'text', label: 'เลขที่', fallback: '888/2' },
  { key: 'moo', group: 'ผู้ประกอบการ', kind: 'text', label: 'หมู่ที่', fallback: '7' },
  { key: 'tambon', group: 'ผู้ประกอบการ', kind: 'text', label: 'ตำบล', fallback: 'ท่าสายลวด' },
  { key: 'amphoe', group: 'ผู้ประกอบการ', kind: 'text', label: 'อำเภอ', fallback: 'แม่สอด' },
  { key: 'province', group: 'ผู้ประกอบการ', kind: 'text', label: 'จังหวัด', fallback: 'ตาก' },
  { key: 'postcode', group: 'ผู้ประกอบการ', kind: 'text', label: 'รหัสไปรษณีย์', fallback: '63110' },
  {
    key: 'zoneName', group: 'ผู้ประกอบการ', kind: 'text',
    label: 'ชื่อเขตปลอดอากร', fallback: 'แม่สอดฟรีโซน',
    hint: 'ใช้ในประโยค เข้าเขตปลอดอากร <ชื่อ> ตามใบขน',
  },
  {
    key: 'purpose', group: 'ผู้ประกอบการ', kind: 'text', wide: true,
    label: 'วัตถุประสงค์', fallback: 'เพื่อปรับสภาพก่อนส่งออกไปต่างประเทศ',
  },

  /* ---------- ตารางรายละเอียดของ ---------- */
  { key: 'colPackage', group: 'ตารางรายละเอียดของ', kind: 'text', label: 'หัวคอลัมน์ที่ 1', fallback: 'จำนวนหีบห่อ' },
  { key: 'colWeight', group: 'ตารางรายละเอียดของ', kind: 'text', label: 'หัวคอลัมน์ที่ 2', fallback: 'น้ำหนักสุทธิ' },
  { key: 'colValue', group: 'ตารางรายละเอียดของ', kind: 'text', label: 'หัวคอลัมน์ที่ 3', fallback: 'ราคาของ' },
  { key: 'colGoods', group: 'ตารางรายละเอียดของ', kind: 'text', label: 'หัวคอลัมน์ที่ 4', fallback: 'ชนิดของ' },

  /* ---------- ท้ายเรื่องและลงชื่อ ---------- */
  {
    key: 'closing', group: 'ท้ายเรื่องและลงชื่อ', kind: 'text',
    label: 'บรรทัดปิดเรื่อง', fallback: 'จึงเรียนมาเพื่อโปรดพิจารณา',
  },
  {
    key: 'routeTo', group: 'ท้ายเรื่องและลงชื่อ', kind: 'text',
    label: 'เรียนถึง (มุมซ้ายล่าง)', fallback: 'เรียน เรือตรี ชุมพล',
    hint: 'ชื่อที่กรอกตอนสร้างคำร้องจะต่อท้ายบรรทัดนี้ ถ้าจะกรอกชื่อทุกใบให้ตั้งเป็น "เรียน คุณ"',
  },
  {
    key: 'routeNote', group: 'ท้ายเรื่องและลงชื่อ', kind: 'text',
    label: 'บรรทัดใต้เรียนถึง', fallback: 'เพื่อดำเนินการตามระเบียบ',
  },
  {
    key: 'regards', group: 'ท้ายเรื่องและลงชื่อ', kind: 'text',
    label: 'คำลงท้าย', fallback: 'ขอแสดงความนับถือ',
  },
  {
    key: 'signLine', group: 'ท้ายเรื่องและลงชื่อ', kind: 'text', wide: true,
    label: 'บรรทัดลงชื่อ', fallback: '( ลงชื่อ ) ..................................... ตัวแทน/ผู้จัดการ',
  },
  {
    key: 'signName', group: 'ท้ายเรื่องและลงชื่อ', kind: 'text', wide: true,
    label: 'ชื่อผู้ลงนาม', fallback: '( นายอัครเดช ตาสะหลี )  ประทับตรา',
  },
  {
    key: 'officerLeft', group: 'ท้ายเรื่องและลงชื่อ', kind: 'text', wide: true,
    label: 'หัวช่องเจ้าหน้าที่ (ซ้าย)', fallback: 'บันทึกการอนุญาตของพนักงานศุลกากร',
  },
  {
    key: 'officerRight', group: 'ท้ายเรื่องและลงชื่อ', kind: 'text', wide: true,
    label: 'หัวช่องเจ้าหน้าที่ (ขวา)', fallback: 'บันทึกการตรวจสอบพนักงานศุลกากร',
  },

  /* ---------- ขนาดตัวอักษร ---------- */
  { key: 'titleSize', group: 'ขนาดตัวอักษร (พอยต์)', kind: 'number', label: 'ชื่อเรื่อง', fallback: '26' },
  { key: 'bodySize', group: 'ขนาดตัวอักษร (พอยต์)', kind: 'number', label: 'เนื้อความ', fallback: '22' },
  { key: 'tableSize', group: 'ขนาดตัวอักษร (พอยต์)', kind: 'number', label: 'ในตาราง', fallback: '20' },
  { key: 'officerSize', group: 'ขนาดตัวอักษร (พอยต์)', kind: 'number', label: 'หัวช่องเจ้าหน้าที่', fallback: '19' },
  {
    key: 'overlaySize', group: 'ขนาดตัวอักษร (พอยต์)', kind: 'number',
    label: 'ค่าที่เติมบนแบบฟอร์มพื้นหลัง', fallback: '22', bothModes: true,
    hint: 'ใช้เฉพาะตอนอัปโหลดแบบฟอร์มพื้นหลังไว้',
  },

  /* ---------- ระยะและการจัดวาง ---------- */
  {
    key: 'marginX', group: 'ระยะและการจัดวาง (พอยต์)', kind: 'number',
    label: 'ขอบซ้าย-ขวา', fallback: '45', hint: '1 ซม. เท่ากับ 28 พอยต์',
  },
  {
    key: 'topY', group: 'ระยะและการจัดวาง (พอยต์)', kind: 'number',
    label: 'ขอบบนถึงบรรทัดแรก', fallback: '55',
  },
  {
    key: 'lineGap', group: 'ระยะและการจัดวาง (พอยต์)', kind: 'number',
    label: 'ระยะห่างระหว่างบรรทัด', fallback: '24',
    hint: 'ระยะอื่นทั้งหน้าคิดเป็นสัดส่วนจากค่านี้',
  },
  {
    key: 'indent', group: 'ระยะและการจัดวาง (พอยต์)', kind: 'number',
    label: 'ระยะย่อหน้า', fallback: '45',
  },
  {
    key: 'tableColWidth', group: 'ระยะและการจัดวาง (พอยต์)', kind: 'number',
    label: 'ความกว้าง 3 คอลัมน์แรก', fallback: '110',
    hint: 'คอลัมน์ชนิดของกินที่เหลือทั้งหมด',
  },
  {
    key: 'tableHeadHeight', group: 'ระยะและการจัดวาง (พอยต์)', kind: 'number',
    label: 'ความสูงหัวตาราง', fallback: '26',
  },
  {
    key: 'tableBodyHeight', group: 'ระยะและการจัดวาง (พอยต์)', kind: 'number',
    label: 'ความสูงแถวข้อมูล', fallback: '30',
  },
  {
    key: 'signGap', group: 'ระยะและการจัดวาง (พอยต์)', kind: 'number',
    label: 'ที่ว่างสำหรับเซ็นชื่อ', fallback: '70',
  },
  {
    key: 'officerHeight', group: 'ระยะและการจัดวาง (พอยต์)', kind: 'number',
    label: 'ความสูงช่องเจ้าหน้าที่', fallback: '120',
  },
];

const BY_KEY = new Map(EOFFICE_FORM_FIELDS.map((f) => [f.key, f]));

/** ลำดับกลุ่มตามที่ประกาศไว้ หน้าจอแก้ไขเรียงตามนี้ */
export const EOFFICE_FORM_GROUPS = EOFFICE_FORM_FIELDS.reduce<string[]>((groups, f) => {
  if (!groups.includes(f.group)) groups.push(f.group);
  return groups;
}, []);

/* ---------------- แบบฟอร์มพื้นหลังที่อัปโหลดเข้ามา ---------------- */

/** โค้ดที่ไม่ใช่ช่องกรอก ระบบเขียนเองตอนอัปโหลดไฟล์ */
export const TEMPLATE_KEY = 'templateKey';
export const TEMPLATE_NAME = 'templateName';
export const TEMPLATE_AT = 'templateUploadedAt';

export type SlotAlign = 'left' | 'center';

/**
 * ค่าที่ระบบเติมลงบนแบบฟอร์มพื้นหลัง
 *
 * พิกัดนับจากมุมบนซ้ายของหน้า หน่วยเป็นพอยต์ (1 ซม. เท่ากับ 28.35 พอยต์)
 * ซึ่งกลับด้านกับที่ PDF ใช้จริง แต่ตรงกับที่คนวัดจากกระดาษ
 *
 * ความกว้างเป็น 0 คือไม่จำกัด ถ้าใส่ไว้ข้อความที่ยาวเกินจะถูกย่อให้พอดีช่อง
 *
 * ค่าเริ่มต้นวัดจากแบบฟอร์มปะหน้าที่ด่านใช้จริง (กระดาษ Letter 612 x 792)
 * ถ้าไฟล์ที่อัปโหลดคนละขนาดหรือคนละรุ่น ต้องขยับเอง
 * ใช้ปุ่มดูตัวอย่างพร้อมเส้นพิกัดในหน้าตั้งค่าอ่านเลขได้เลย
 */
export type OverlaySlot = {
  key: string;
  label: string;
  /** ข้อความตัวอย่างบนหน้าดูตัวอย่าง */
  sample: string;
  x: number;
  y: number;
  w: number;
  align: SlotAlign;
};

export const OVERLAY_SLOTS: OverlaySlot[] = [
  { key: 'requestNo', label: 'เลขที่คำร้อง', sample: '0869 / 0028', x: 476, y: 109, w: 0, align: 'left' },
  { key: 'day', label: 'วันที่', sample: '28', x: 410, y: 142, w: 0, align: 'left' },
  { key: 'month', label: 'เดือน', sample: 'สิงหาคม', x: 457, y: 142, w: 0, align: 'left' },
  { key: 'year', label: 'พ.ศ.', sample: '2569', x: 535, y: 142, w: 0, align: 'left' },
  {
    key: 'entryNo', label: 'เลขที่ใบขนสินค้าขาเข้า', sample: 'A26082875462',
    x: 145, y: 329, w: 0, align: 'left',
  },
  { key: 'packageCount', label: 'จำนวนหีบห่อ', sample: '4 UNIT', x: 64, y: 385, w: 76, align: 'center' },
  { key: 'netWeight', label: 'น้ำหนักสุทธิ', sample: '5840 KGM', x: 140, y: 385, w: 95, align: 'center' },
  { key: 'goodsValue', label: 'ราคาของ', sample: '15 USD', x: 235, y: 385, w: 61, align: 'center' },
  {
    key: 'goodsType', label: 'ชนิดของ', sample: 'USED CAR (รายละเอียดตามใบขนฯ แนบ)',
    x: 302, y: 385, w: 246, align: 'left',
  },
  {
    key: 'attentionName', label: 'ชื่อที่จ่าหน้าถึง (เรียน คุณ ...)', sample: 'สมชาย ใจดี',
    x: 108, y: 440, w: 0, align: 'left',
  },
];

const SLOT_BY_KEY = new Map(OVERLAY_SLOTS.map((s) => [s.key, s]));

/** โค้ดที่ใช้เก็บพิกัดของแต่ละค่าใน master_records */
export const slotCode = (key: string, part: 'x' | 'y' | 'w' | 'align') => `pos.${key}.${part}`;

export type EofficeFormValues = Record<string, string>;

export type EofficeForm = {
  /** ข้อความของช่องนี้ ถ้ายังไม่เคยแก้จะได้ค่าตามแบบฟอร์มเดิม */
  t(key: string): string;
  /** ตัวเลขของช่องนี้ ค่าที่กรอกผิดหรือไม่เป็นบวกจะถอยไปใช้ค่าเริ่มต้น */
  n(key: string): number;
  /** ค่าดิบของโค้ดที่ไม่ใช่ช่องกรอก เช่นที่อยู่ไฟล์แบบฟอร์มพื้นหลัง */
  raw(code: string): string;
  /** พิกัดของค่าหนึ่งบนแบบฟอร์มพื้นหลัง ผสมกับค่าเริ่มต้นแล้ว */
  slot(key: string): OverlaySlot;
  /** อัปโหลดแบบฟอร์มพื้นหลังไว้แล้วหรือยัง */
  hasTemplate: boolean;
  /** ค่าดิบเท่าที่บันทึกไว้จริง ใช้เติมลงหน้าจอแก้ไข */
  values: EofficeFormValues;
};

export function readForm(values: EofficeFormValues): EofficeForm {
  const raw = (code: string) => (values[code] ?? '').trim();

  const pick = (key: string) => {
    const field = BY_KEY.get(key);
    if (!field) throw new Error(`ไม่รู้จักช่อง ${key} ของฟอร์มปะหน้า`);
    return raw(key) || field.fallback;
  };

  const num = (code: string, fallback: number) => {
    // ต้องเช็คค่าว่างก่อน เพราะ Number('') ได้ 0 ซึ่งเป็นพิกัดที่ใช้ได้จริง
    // ถ้าไม่เช็ค ช่องที่ยังไม่เคยตั้งจะกลายเป็น 0 แล้วค่าไปกองที่มุมกระดาษ
    const saved = raw(code);
    if (!saved) return fallback;
    const parsed = Number(saved);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const alignOf = (key: string, fallback: SlotAlign): SlotAlign => {
    const saved = raw(slotCode(key, 'align'));
    return saved === 'center' || saved === 'left' ? saved : fallback;
  };

  return {
    values,
    raw,
    t: pick,
    n: (key) => {
      const parsed = Number(pick(key));
      return Number.isFinite(parsed) && parsed > 0 ? parsed : Number(BY_KEY.get(key)!.fallback);
    },
    slot: (key) => {
      const base = SLOT_BY_KEY.get(key);
      if (!base) throw new Error(`ไม่รู้จักค่า ${key} บนแบบฟอร์มพื้นหลัง`);
      return {
        ...base,
        x: num(slotCode(key, 'x'), base.x),
        y: num(slotCode(key, 'y'), base.y),
        // ความกว้างเป็น 0 ได้ แปลว่าไม่จำกัด จึงยอมรับค่าที่ไม่ติดลบทั้งหมด
        w: Math.max(0, num(slotCode(key, 'w'), base.w)),
        align: alignOf(key, base.align),
      };
    },
    hasTemplate: Boolean(raw(TEMPLATE_KEY)),
  };
}

/** ค่าที่บันทึกไว้ทั้งหมด ผสมกับค่าเริ่มต้นแล้ว */
export async function loadEofficeForm(): Promise<EofficeForm> {
  const rows = await db
    .select({ code: masterRecords.code, value: masterRecords.value })
    .from(masterRecords)
    .where(and(eq(masterRecords.type, EOFFICE_FORM_TYPE), eq(masterRecords.isActive, true)));

  const values: EofficeFormValues = {};
  for (const row of rows) if (row.code) values[row.code] = row.value ?? '';
  return readForm(values);
}
