/**
 * สร้างแบบร่างพื้นที่อ่านค่า AN/BL จากไฟล์ตัวอย่างจริง แล้วเขียนลง Master Data
 *
 * ทำไมต้องมีสคริปต์นี้ — กรอบเก็บเป็นพิกัดสัดส่วนของหน้ากระดาษ ซึ่งดูจากข้อความ
 * ในไฟล์อย่างเดียวไม่รู้ ต้องรู้ว่าคำนั้นอยู่ตรงไหนบนหน้าจริง ๆ
 * การนั่งลากกรอบทีละช่อง 14 แบบ x ~10 ช่อง ใช้เวลาทั้งวันและลากเหลื่อมได้ง่าย
 *
 * สคริปต์นี้ทำแทน — บอกว่า "ค่าที่ถูกต้องของใบนี้คืออะไร" แล้วมันไปหาเองว่าคำนั้น
 * อยู่พิกัดไหนในไฟล์ แล้วคำนวณกรอบครอบให้พอดี พิกัดจึงมาจากเอกสารจริงเสมอ
 * ไม่ใช่ค่าที่เดาเอา ซึ่งจะทำให้ดึงค่าผิดช่องมาใส่ฟอร์ม — แย่กว่าไม่มีกรอบเลย
 *
 * รัน:
 *   npx tsx --tsconfig tsconfig.json scripts/build-parse-templates.ts <โฟลเดอร์ไฟล์ตัวอย่าง>
 *   เติม --write  เพื่อเขียนลงฐานข้อมูลจริง (ไม่ใส่ = ลองดูผลเฉย ๆ ไม่แตะฐาน)
 *   เติม --json <ไฟล์>  เพื่อบันทึกกรอบเป็นไฟล์ไว้ตรวจหรือย้ายเครื่อง
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';
import {
  EVERY_PAGE, LAST_PAGE, fieldLabel, matchTemplate, readByTemplate,
  type ParseTemplate, type TemplateArea, type TemplateFieldKey, type TextPiece,
} from '../src/lib/parse-template';
import {
  PADDING, boxOf, findAllByPage, findValue, padWithoutTouching, stretchForDrift,
} from '../src/lib/auto-frame';

/* ---------------- อ่านไฟล์ PDF ออกมาเป็นชิ้นข้อความพร้อมพิกัด ---------------- */

/**
 * อ่านพิกัดแบบเดียวกับที่หน้าจอลากกรอบใช้ (ParseTemplateEditor)
 * ต้องตรงกันเป๊ะ ไม่งั้นกรอบที่สคริปต์สร้างจะเหลื่อมจากกรอบที่คนลากเอง
 */
async function piecesOf(file: string): Promise<{ pieces: TextPiece[]; text: string; pages: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, isEvalSupported: false,
  }).promise;

  const pieces: TextPiece[] = [];
  const texts: string[] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    for (const it of content.items as Array<Record<string, any>>) {
      if (!('str' in it) || !String(it.str).trim()) continue;
      const [, , , , x, yBottom] = it.transform as number[];
      const h = it.height || 8;
      pieces.push({
        page: i,
        left: x / vp.width,
        right: (x + it.width) / vp.width,
        top: (vp.height - (yBottom + h)) / vp.height,
        bottom: (vp.height - yBottom) / vp.height,
        str: String(it.str),
      });
    }
    texts.push((content.items as Array<Record<string, any>>).map((t) => ('str' in t ? t.str : '')).join(' '));
  }
  return { pieces, text: texts.join('\n'), pages: doc.numPages };
}

/* ---------------- นิยามของแต่ละแบบร่าง ---------------- */

/**
 * ค่าที่ถูกต้องของไฟล์ตัวอย่างแต่ละใบ — อ่านด้วยตาจากเอกสารจริง
 *
 * สคริปต์เอาค่าพวกนี้ไปหาว่าอยู่พิกัดไหนในไฟล์ แล้วสร้างกรอบครอบให้
 * ช่องไหนไม่ใส่ = ใบนั้นไม่มีค่านั้น หรือยังไม่ได้ตรวจ
 * ปล่อยให้ตัวอ่านอัตโนมัติทำงานต่อ แบบร่างจึงไม่เคยทำให้อ่านได้น้อยลงกว่าเดิม
 */
type Spec = {
  /** ชื่อไฟล์ตัวอย่าง (ไม่ต้องใส่ .pdf) */
  file: string;
  name: string;
  /** คำที่ต้องเจอครบทุกคำจึงถือว่าเป็นแบบนี้ */
  match: string[];
  values: Partial<Record<TemplateFieldKey, string>>;
  /** ช่องที่มีหลายค่า — เลขตู้กับเลขซีล */
  lists?: { containers?: string[]; seals?: string[] };
  /**
   * โหมดหน้าของช่องที่ไม่ใช่ "หน้าที่เจอค่านั้น"
   *   every = ทุกหน้า (ค่าที่ไล่ข้ามหน้าตามความยาวรายการสินค้า)
   *   last  = หน้าสุดท้าย (ยอดรวมท้ายใบที่เลขหน้าไม่แน่นอน)
   */
  pageMode?: Partial<Record<TemplateFieldKey, 'every' | 'last'>>;
};

const SPECS: Spec[] = [
  /* ---- WAN HAI ---- */
  {
    file: 'wanhai_bl_1',
    name: 'WAN HAI — Bill of Lading',
    match: ['WAN HAI', 'BILL OF LADING'],
    values: {
      blNo: '011GX04250',
      shipperName: 'KANSAI GROUP CORPORATION',
      vessel: 'WAN HAI 278',
      voyage: 'S058',
      eta: 'AUG 22 2026',
      portOfLoading: 'HAKATA',
      grossWeight: '16,900.000',
      unitAmount: '13 UNITS',
    },
    lists: {
      containers: ['BEAU5919353', 'CAIU7682429', 'WHSU8043983'],
      seals: ['WHA5270332', 'WHA5280886', 'WHA5270442'],
    },
  },
  {
    file: 'wanhai_an_1',
    name: 'WAN HAI — Arrival Notice',
    // "ARRIVAL NOTICE" บนใบนี้เป็นภาพ ไม่ใช่ข้อความ ใช้คำที่อยู่ในชั้นข้อความจริง
    match: ['WAN HAI LINES', 'Est. Arrival Date'],
    values: {
      blNo: '011GX05220',
      shipperName: 'AICHI AUTOMOBILES CO.,LTD',
      vessel: 'WAN HAI 176',
      voyage: 'S111',
      eta: 'SEP 07 2026',
      portOfLoading: 'NAGOYA, JAPAN',
      grossWeight: '48,660.000',
      unitAmount: '39 UNT',
    },
    lists: {
      /*
       * ใบนี้เก็บ เลขตู้ + ขนาดตู้ + เลขซีล ไว้ชิ้นเดียวกันทั้งแถว
       * จึงใส่ทั้งแถว กรอบครอบทั้งคอลัมน์ แล้วตัวอ่านแยกตู้กับซีลออกจากกันเอง
       */
      containers: [
        'BEAU4309192 40SD96 WHA3947400', 'BEAU5984997 40SD96 WHA3947234',
        'CAIU4328730 40SD96 WHA3958776', 'TCKU7544413 40SD96 WHA3947208',
        'WHSU5577537 40SD96 WHA3947371', 'WHSU5594597 40SD96 WHA3947354',
        'WHSU6311270 40SD96 WHA3947387', 'WHSU6561643 40SD96 WHA3959837',
      ],
      seals: [
        'BEAU4309192 40SD96 WHA3947400', 'BEAU5984997 40SD96 WHA3947234',
        'CAIU4328730 40SD96 WHA3958776', 'TCKU7544413 40SD96 WHA3947208',
        'WHSU5577537 40SD96 WHA3947371', 'WHSU5594597 40SD96 WHA3947354',
        'WHSU6311270 40SD96 WHA3947387', 'WHSU6561643 40SD96 WHA3959837',
      ],
    },
  },

  /* ---- ONE (Ocean Network Express) ---- */
  {
    /*
     * ใช้ One_BL_1 ไม่ใช่ One_BL_2 — ใบที่สองเป็น PDF สแกน (ภาพล้วน)
     * pdf.js อ่านข้อความไม่ได้เลย จึงลากกรอบไม่ได้ ดู docs/PARSE-TEMPLATE-SEED.md
     */
    file: 'One_BL_1',
    name: 'ONE — Sea Waybill',
    /*
     * ต้องมี "COPY NON NEGOTIABLE" ด้วย
     * ใบ Arrival Notice ของ ONE ก็มีคำว่า SEA WAYBILL กับ ONEY อยู่เหมือนกัน
     * (มันอ้างถึงเลข Sea Waybill ในใบ) ใช้แค่สองคำนั้นจึงจับใบ AN มาเป็นแบบนี้ด้วย
     */
    match: ['SEA WAYBILL', 'ONEY', 'COPY NON NEGOTIABLE'],
    values: {
      blNo: 'ONEYOSAG38202600',
      // ไฟล์นี้เก็บชื่อเรือกับเที่ยวเรือไว้ชิ้นเดียวกัน แยกกรอบไม่ได้
      // ใส่ทั้งก้อนให้ช่องชื่อเรือ ส่วนเที่ยวเรือมีชิ้น [26027W] แยกต่างหากอยู่แล้ว
      vessel: 'YONG SHUN 26027W',
      voyage: '26027W',
      portOfLoading: 'TOMAKOMAI',
      grossWeight: '59840.000KGS',
    },
    lists: {
      containers: [
        'TRHU7919360', 'TGBU9827910', 'TCKU7227321', 'TCLU4891925', 'ONEU0631002',
        'KKFU8080952', 'ONEU5836350', 'FFAU6538953', 'ONEU0635950', 'BEAU5290173',
      ],
      seals: [
        'JPF112061', 'JPF112065', 'JPF111770', 'JPF112005', 'JPF112028',
        'JPF112023', 'JPF112034', 'JPF112042', 'JPF112050', 'JPF111944',
      ],
    },
  },
  {
    file: 'One_AN_1',
    name: 'ONE — Arrival Notice',
    match: ['ARRIVAL NOTICE', 'OCEAN NETWORK EXPRESS'],
    values: {
      blNo: 'ONEYOSAG10215700',
      shipperName: 'JAN TRADING CO.',
      vessel: 'ADDISON',
      voyage: '050S',
      portOfLoading: 'YOKOHAMA',
    },
  },

  /* ---- MAERSK ---- */
  {
    file: 'maersk_bl_1',
    name: 'MAERSK — Waybill',
    match: ['MAERSK', 'NON-NEGOTIABLE WAYBILL'],
    values: {
      blNo: '271756831',
      shipperName: 'KANSAI GROUP CORPORATION',
      vessel: 'MAERSK NARVIK',
      voyage: '626S',
      portOfLoading: 'OSAKA',
      grossWeight: '17840.000',
      unitAmount: '12 UNITS',
    },
  },
  {
    file: 'maersk_1',
    name: 'MAERSK — Arrival Notice',
    match: ['MAERSK', 'ARRIVAL', 'NOTICE'],
    values: {
      blNo: '270911631',
      shipperName: 'AE TRADING COMPANY',
      vessel: 'NORDAGER MAERSK',
      voyage: '622S',
      portOfLoading: 'KOBE',
      grossWeight: '50390.000',
    },
  },

  /* ---- EVERGREEN ---- */
  {
    file: 'Evergreen_waybill_1',
    name: 'EVERGREEN — Sea Waybill',
    // คำว่า SEA WAYBILL บนใบนี้เป็นภาพ ใช้ EGLV + ป้ายท้ายใบที่มีเฉพาะแบบนี้แทน
    match: ['EGLV', 'ATTACHED LIST PAGE'],
    values: {
      blNo: '022600116508',
      // ชื่อเรือกับเที่ยวเรืออยู่ชิ้นเดียวกันในไฟล์นี้เช่นกัน
      vessel: 'EVER BLINK 1207-084A',
      portOfLoading: 'NAGOYA - AICHI',
      grossWeight: '58,310.000',
    },
    lists: {
      containers: [
        'EGSU6006975', 'EGSU6000690', 'EITU1955370', 'EGHU8416548', 'EMCU8629949',
        'EMCU9926031', 'EITU9233985', 'EITU9303357', 'TRHU8730128', 'EGSU6351776',
      ],
    },
  },
  {
    file: 'Evergreen_an_1',
    name: 'EVERGREEN — Arrival Notice',
    match: ['EVERGREEN', 'ARRIVAL NOTICE', 'EGLV'],
    values: {
      /*
       * ใบนี้ pdf.js รวมเครื่องหมาย ":" ของป้ายไว้กับค่าในชิ้นเดียวกัน
       * ใส่ให้ตรงกับที่อยู่ในไฟล์ แล้ว stripLabel() ตัด ":" ออกตอนอ่านจริง
       */
      blNo: ': EGLV060600120711',
      shipperName: ': MAYA FZE INTERNATIONAL CORPORATION',
      vessel: ': EVER BASIS 0851-076N',
      eta: '2026-06-22',
    },
    lists: {
      containers: ['EGSU9902234', 'EITU8158974'],
      seals: ['EMCSCD8974', 'EMCSCD8964'],
    },
  },

  /* ---- OOCL ---- */
  {
    file: 'OOCL_WAYBILL_1',
    name: 'OOCL — Sea Waybill',
    match: ['OOCL', 'SEA WAYBILL'],
    values: {
      blNo: 'OOLU2323370880',
      shipperName: 'AE TRADING COMPANY',
      vessel: 'IRENES RAINBOW',
      voyage: '030S',
      portOfLoading: 'KOBE',
      // น้ำหนักติดหน่วยมาในชิ้นเดียวกัน ตัวอ่านตัดหน่วยออกให้เอง
      grossWeight: '49850KGS',
    },
    lists: {
      containers: [
        'OOCU6803000', 'FCIU9671632', 'TIIU7578398', 'OOCU9672007',
        'GCXU5157124', 'MAGU5272454', 'TEMU6358297',
      ],
      seals: [
        'OOLLBC2546', 'OOLLBC2550', 'OOLLBC4631', 'OOLLBC5493',
        'OOLLBC5488', 'OOLLBC3426', 'OOLLBC5570',
      ],
    },
  },
  {
    file: 'OOCL_AN_1',
    name: 'OOCL — Arrival Notice',
    match: ['OOCL', 'ARRIVAL NOTICE', 'OOLU'],
    values: {
      blNo: 'OOLU2323370880',
      shipperName: 'AE TRADING COMPANY',
      vessel: 'IRENES RAINBOW',
      voyage: '030S',
      portOfLoading: 'Kobe',
      grossWeight: '49850 KG',
    },
    lists: {
      containers: [
        'OOCU6803000', 'FCIU9671632', 'TIIU7578398', 'OOCU9672007',
        'GCXU5157124', 'MAGU5272454', 'TEMU6358297',
      ],
      seals: [
        'OOLLBC2546', 'OOLLBC2550', 'OOLLBC4631', 'OOLLBC5493',
        'OOLLBC5488', 'OOLLBC3426', 'OOLLBC5570',
      ],
    },
  },

  /* ---- CNC / CMA CGM ---- */
  {
    file: 'Waybill_cnc_1',
    name: 'CNC — Waybill',
    match: ['WAYBILL', 'CMA CGM', 'NON NEGOTIABLE'],
    values: {
      blNo: 'AMP0555586',
      shipperName: 'JAN TRADING CO.',
      vessel: 'WILLIAM',
      voyage: '0CG7NS1NC',
      portOfLoading: 'YOKOHAMA - KANAGAWA',
      grossWeight: '29190.000',
    },
    lists: {
      containers: ['APHU7304090', 'CMAU4724360', 'ECMU5519763', 'CMAU7198551', 'TEMU8489254'],
    },
    /*
     * ใบ CNC ยาวไม่เท่ากันทุกใบ ขึ้นกับว่ามีสินค้ากี่รายการ (ใบนี้ 4 หน้า ใบอื่นมี 7)
     * ยอดรวมทั้งใบอยู่ท้ายสุดเสมอ ส่วนเลขตู้ไล่ข้ามหน้าไปเรื่อย ๆ
     */
    pageMode: { grossWeight: 'last', containers: 'every' },
  },
  {
    file: 'cnc_1',
    name: 'CNC — Arrival Notice',
    match: ['ARRIVAL NOTICE', 'CMA CGM', 'B/L-NO'],
    values: {
      blNo: 'AMP0559733',
      shipperName: 'NAZAR JAPAN CO.',
      vessel: 'ASL HONG KONG',
      voyage: '0CG7XS1NC',
      eta: '06-SEP-26',
      portOfLoading: 'KOBE',
    },
    lists: {
      containers: ['BMOU5793059', 'GAOU7032063', 'TRHU6415024'],
      seals: ['J0000794', 'J0000053', 'J0000850'],
    },
    // ตารางตู้อยู่หน้าสุดท้ายเสมอ แต่จำนวนหน้าก่อนหน้านั้นไม่แน่นอน
    pageMode: { containers: 'last', seals: 'last' },
  },

  /* ---- NAMSUNG ---- */
  {
    file: 'Namsung_1',
    name: 'NAMSUNG — Bill of Lading',
    match: ['NAMSUNG', 'BILL OF LADING'],
    values: {
      blNo: 'NSSLKNILC26Q0020',
      shipperName: 'FUKUOKA TRADING CO.,LTD.',
      vessel: 'SUNNY CANNA',
      voyage: '2601W',
      eta: 'FEB 13 2026',
      portOfLoading: 'NIIGATA(HIGASHI) - N',
      grossWeight: '26,000.0000',
    },
    lists: {
      containers: ['BEAU4941938', 'NSSU7025720', 'NSSU7042310', 'TRHU8748087'],
      seals: ['NS976736', 'NS976738', 'NS976664', 'NS976737'],
    },
  },

  /* ---- KNOT GLOBAL ---- */
  {
    file: 'Knot Global_1',
    name: 'KNOT GLOBAL — Bill of Lading',
    // "Bill of Lading" บนใบนี้เป็นภาพ ใช้ชื่อบริษัททั้งสองแห่งที่อยู่ในชั้นข้อความ
    match: ['KNOT GLOBAL', 'KNOT GLOBAL HOLDINGS'],
    values: {
      blNo: 'KG1222026-69605',
      shipperName: 'GMT BRIGHT CO.,LTD.',
      vessel: 'NYK FUJI',
      voyage: '0139W',
      eta: 'August/24/2026',
      portOfLoading: 'YOKOHAMA ,JAPAN',
      grossWeight: '31,270.000 KGS',
      unitAmount: '10 UNITS',
    },
    lists: {
      containers: ['TCLU1585562', 'DRYU9472886', 'ONEU0881336'],
      seals: ['JPF233463', 'JPF233425', 'JPF244401'],
    },
  },
];

/* ---------------- สร้างกรอบจากไฟล์จริง ---------------- */

function pageFor(spec: Spec, field: TemplateFieldKey, found: number): number {
  const mode = spec.pageMode?.[field];
  if (mode === 'last') return LAST_PAGE;
  if (mode === 'every') return EVERY_PAGE;
  return found;
}

type Built = { spec: Spec; template: ParseTemplate; misses: string[]; pages: number };

async function build(spec: Spec, dir: string): Promise<Built | null> {
  const file = path.join(dir, `${spec.file}.pdf`);
  if (!fs.existsSync(file)) {
    console.log(`  ⚠ ไม่พบไฟล์ ${spec.file}.pdf — ข้ามแบบนี้ไป`);
    return null;
  }

  const { pieces, text, pages } = await piecesOf(file);
  const areas: TemplateArea[] = [];
  const misses: string[] = [];

  for (const [key, want] of Object.entries(spec.values) as Array<[TemplateFieldKey, string]>) {
    const hit = findValue(pieces, want);
    if (!hit) { misses.push(`${fieldLabel(key)} ("${want}")`); continue; }
    const p = PADDING[key];
    const box = padWithoutTouching(boxOf(hit), p.x, p.y, hit[0].page, hit, pieces);
    areas.push({ field: key, page: pageFor(spec, key, hit[0].page), ...box });
  }

  for (const key of ['containers', 'seals'] as const) {
    const wants = spec.lists?.[key];
    if (!wants?.length) continue;

    const byPage = findAllByPage(pieces, wants);
    if (!byPage.size) { misses.push(`${fieldLabel(key)} (หาไม่เจอสักตัว)`); continue; }

    const p = PADDING[key];
    for (const [page, group] of byPage) {
      const box = padWithoutTouching(boxOf(group), p.x, p.y, page, group, pieces);
      areas.push({ field: key, page: pageFor(spec, key, page), ...stretchForDrift(box, key) });
    }

    const missing = wants.filter((w) => !findValue(pieces, w));
    if (missing.length) misses.push(`${fieldLabel(key)} ขาด ${missing.length}/${wants.length} ตัว`);
  }

  const template: ParseTemplate = {
    id: 'draft', name: spec.name, match: spec.match, areas, isActive: true,
  };

  // ตรวจทันทีว่าคำที่ใช้จับแบบตรงกับไฟล์ตัวอย่างของตัวเองจริง
  if (!matchTemplate([template], text)) {
    misses.push('คำที่ใช้จับแบบไม่ตรงกับไฟล์ตัวอย่างของตัวเอง');
  }

  return { spec, template, misses, pages };
}

/* ---------------- เขียนลง Master Data ---------------- */

const PARSE_TEMPLATE_TYPE = 'parseTemplate';

function serialize(areas: TemplateArea[]): string {
  // ปัดทศนิยมให้สั้นลง ละเอียดกว่านี้ไม่มีผลกับการอ่าน แต่ทำให้ JSON ยาวขึ้นเปล่า ๆ
  const round = (v: number) => Math.round(v * 10000) / 10000;
  return JSON.stringify(areas.map((a) => ({
    field: a.field, page: a.page, x: round(a.x), y: round(a.y), w: round(a.w), h: round(a.h),
  })));
}

const newId = () => `MD${randomBytes(6).toString('hex').toUpperCase()}`;

async function save(built: Built[]) {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

  const existing = await sql<{ id: string; name: string }[]>`
    select id, name from master_records where type = ${PARSE_TEMPLATE_TYPE}`;
  const byName = new Map(existing.map((r) => [r.name, r.id]));

  let added = 0; let updated = 0;
  for (const { template } of built) {
    if (!template.areas.length) continue;
    const value = serialize(template.areas);
    const description = template.match.join('\n');
    const id = byName.get(template.name);

    if (id) {
      // เขียนทับของเดิมที่ชื่อเดียวกัน ไม่สร้างซ้ำ — รันสคริปต์ซ้ำได้โดยไม่มีขยะ
      await sql`
        update master_records
        set description = ${description}, value = ${value}, is_active = true, updated_at = now()
        where id = ${id}`;
      updated += 1;
    } else {
      await sql`
        insert into master_records (id, type, code, name, description, value, is_active)
        values (${newId()}, ${PARSE_TEMPLATE_TYPE}, null, ${template.name}, ${description}, ${value}, true)`;
      added += 1;
    }
  }

  await sql.end();
  console.log(`\nบันทึกลง Master Data แล้ว — เพิ่มใหม่ ${added} แบบ · ทับของเดิม ${updated} แบบ`);
}

/* ---------------- ตัวรัน ---------------- */

async function main() {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const jsonIdx = args.indexOf('--json');
  const jsonAt = jsonIdx >= 0 ? (args[jsonIdx + 1] ?? '') : '';
  /*
   * โฟลเดอร์คือค่าที่ไม่ใช่ธง และไม่ใช่ชื่อไฟล์ที่ตามหลัง --json
   * ต้องเช็ค jsonIdx >= 0 ก่อน ไม่งั้นตอนไม่ได้ใส่ --json ค่าจะเป็น -1
   * แล้ว -1 + 1 = 0 ทำให้ตัวแรกซึ่งเป็นโฟลเดอร์ถูกข้ามไป
   */
  const skipIdx = jsonIdx >= 0 ? jsonIdx + 1 : -1;
  const dir = args.find((a, i) => !a.startsWith('--') && i !== skipIdx);

  if (!dir) {
    console.log('ใส่โฟลเดอร์ไฟล์ตัวอย่างด้วย เช่น:\n'
      + '  npx tsx --tsconfig tsconfig.json scripts/build-parse-templates.ts ./test/BL --write');
    process.exit(1);
  }
  if (!fs.existsSync(dir)) {
    console.log(`ไม่พบโฟลเดอร์ ${dir}`);
    process.exit(1);
  }

  console.log(`อ่านไฟล์ตัวอย่างจาก ${dir}\n`);
  const built: Built[] = [];

  for (const spec of SPECS) {
    const out = await build(spec, dir);
    if (!out) continue;
    built.push(out);

    const fields = [...new Set(out.template.areas.map((a) => a.field))];
    console.log(`${spec.name}  (${out.pages} หน้า)`);
    console.log(`  กรอบ ${out.template.areas.length} · ช่อง ${fields.map(fieldLabel).join(', ')}`);

    // อ่านกลับด้วยกรอบที่เพิ่งสร้าง เพื่อยืนยันว่ากรอบนี้อ่านค่าได้จริง ไม่ใช่แค่สร้างได้
    const { pieces } = await piecesOf(path.join(dir, `${spec.file}.pdf`));
    const back = readByTemplate(out.template, pieces);
    const got: string[] = [];
    for (const [k, v] of Object.entries(back.values)) got.push(`${fieldLabel(k)}=${v}`);
    if (back.containers.length) got.push(`ตู้ ${back.containers.length} ตู้`);
    if (back.seals.length) got.push(`ซีล ${back.seals.length} เส้น`);
    console.log(`  อ่านกลับได้: ${got.join(' · ') || '(ไม่ได้อะไรเลย)'}`);
    if (out.misses.length) console.log(`  ⚠ หาไม่เจอ: ${out.misses.join(' · ')}`);
    console.log('');
  }

  if (jsonAt) {
    fs.writeFileSync(jsonAt, JSON.stringify(built.map((b) => ({
      name: b.template.name, match: b.template.match, areas: b.template.areas,
    })), null, 2));
    console.log(`เขียนกรอบลง ${jsonAt} แล้ว`);
  }

  const usable = built.filter((b) => b.template.areas.length);
  console.log(`รวม ${usable.length}/${SPECS.length} แบบที่สร้างกรอบได้`);

  if (write) await save(built);
  else console.log('\n(ยังไม่ได้เขียนลงฐานข้อมูล — เติม --write เมื่อผลข้างบนดูถูกต้องแล้ว)');
}

loadEnv();
main().catch((e) => { console.error(e); process.exit(1); });
