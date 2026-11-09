/**
 * อ่าน Invoice สินค้า (Excel ของผู้ขาย) ทุกรูปแบบให้เป็นรายการรถแบบเดียวกัน
 *
 * แทนสูตร VLOOKUP ในไฟล์ imp3_ เดิม — อ่านจากส่วน invoice ของผู้ขายทางซ้ายตรง ๆ
 * ไม่พึ่งตารางสรุป P:AF ที่ต้องเปิด Excel ให้สูตรคำนวณก่อน จึงรับได้ทั้งไฟล์ที่ผูกสูตรแล้วและไฟล์ดิบจากผู้ขาย
 *
 *   แบบตาราง (MSFZ · JTC)          แถวหัวตาราง MAKE / MODEL / CHASSIS NO. … แล้วรถแถวละคันจนถึง TOTAL
 *                                   ตู้: คอลัมน์ก่อน CHASSIS เป็นลำดับตู้ จับกับรายการเลขตู้ใต้ TOTAL
 *   แบบก้อน (AICHI · JAN TRADING · HUAYO)  รถคันละหลายแถว: USED ยี่ห้อ / CHASSIS NO. / ENGINE … / REG YEAR
 *                                   ตู้: แถวที่คอลัมน์ A เป็นเลขตู้ รถที่ตามมาอยู่ตู้นั้นจนเจอเลขตู้ถัดไป
 *                                   AICHI รุ่นใหม่แยกตู้ละชีต ("1", "2." …) แต่ละชีตมี TOTAL ของตัวเอง — อ่านทุกชีตแล้วรวมกัน
 *                                   แถวที่มีแต่ยอดเงิน (ค่า Forwarding · ค่าเฟรท) = ค่าใช้จ่ายอื่นในใบ ไม่ใช่รถ
 *
 * ช่อง B/L NO. ในใบผู้ขายมักเว้นว่าง (ออก invoice ก่อนได้เลข BL) — ไม่ถือเป็นข้อผิดพลาด หน้าเว็บหางานจากเลขตู้แทน
 *
 * ค่าที่ได้ต้องตรงกับที่สูตรในไฟล์เดิมคำนวณ (ทดสอบเทียบกับตารางสรุปในไฟล์ตัวอย่าง tests/cargo-invoice.ts)
 */
import type ExcelJS from 'exceljs';
import { colLetters, loadWorkbook, sheetReader, type Sheet } from '@/lib/draft/sheet';
import { clean, pad2, toDecimal, type CellValue } from '@/lib/draft/values';

export type CargoCar = {
  /** ลำดับรถในใบ (1, 2, 3 …) */
  no: number;
  container: string;
  brand: string;
  model: string;
  chassis: string;
  /** เลขเครื่องเต็ม เช่น 1MZ-1888209 */
  engine: string;
  fuel: string;
  cc: number | null;
  year: number | null;
  weight: number | null;
  price: number | null;
  /** use_desc_good1 / use_desc_good2 ตามที่สูตรเดิมประกอบ (ใช้ในใบขน) */
  desc1: string;
  desc2: string;
  /** ชีตและแถวในไฟล์ที่รถคันนี้เริ่ม — บอกคนตรวจว่าไปดูตรงไหนในไฟล์ */
  sheet: string;
  row: number;
  problems: string[];
};

export type CargoInvoice = {
  pattern: string;
  supplier: string;
  invoiceNo: string;
  /** dd/mm/yyyy */
  invoiceDate: string;
  blNo: string;
  /** BOOKING NO. ในหัวใบ (ถ้ามี) — แสดงช่วยคนหางาน */
  bookingNo: string;
  vessel: string;
  /** ชีตที่อ่านรายการรถ (ส่วนใหญ่ชีตเดียว) */
  sheets: string[];
  /** เลขตู้ตามลำดับที่ปรากฏในใบ */
  containers: string[];
  cars: CargoCar[];
  /**
   * ยอดเงินในใบที่ไม่ใช่ราคารถ
   *   inTotal = true  บวกอยู่ในยอด TOTAL (เช่น "Forwarding, Dray, Loading Chg. etc.")
   *   inTotal = false แค่แจ้งไว้ (เช่นค่าเฟรทในแถว TOTAL ของ JAN TRADING ซึ่งรวมอยู่ในราคา CIF ของรถแล้ว)
   */
  charges: Array<{ label: string; amount: number; inTotal: boolean; sheet: string; row: number }>;
  /** ยอดรวมที่ผู้ขายเขียนไว้ในแถว TOTAL — ใช้เทียบกับยอดที่บวกจากรายการรถ */
  stated: { units: number | null; weight: number | null; amount: number | null };
  errors: string[];
  warnings: string[];
};

export const PATTERNS = ['MSFZ', 'JTC', 'AICHI', 'JAN TRADING', 'HUAYO'] as const;
const TABLE_PATTERNS = new Set(['MSFZ', 'JTC']);

const CONTAINER = /^[A-Z]{4}\d{7}$/;
const upper = (v: CellValue) => clean(v).toUpperCase();
/** ป้ายกำกับในไฟล์ เทียบแบบไม่สนช่องว่าง จุด โคลอน */
const label = (v: CellValue) => upper(v).replace(/[\s.:]/g, '');
const asContainer = (v: CellValue) => {
  const s = upper(v).replace(/[\s-]/g, '');
  return CONTAINER.test(s) ? s : '';
};
/** ตัวเลขในใบ — ตัดหน่วยและสกุลเงินออก: "1,520 KGS" · "4 UNITS" · "¥183,000" · "JPY 75,000" */
const num = (v: CellValue): number | null => {
  const d = toDecimal(typeof v === 'string' ? v.replace(/KGS?|UNITS?|JPY|USD|[¥￥$€£]/gi, '').trim() : v);
  return d ? d.toNumber() : null;
};

/**
 * เชื้อเพลิงตามตารางพิกัด (มีแค่ GASOLINE · PETROL · DIESEL) — รถไฮบริดแยกด้วยชื่อรุ่น ("FIT HYBRID") ไม่ใช่เชื้อเพลิง
 * JAN TRADING เขียน "HYBRID-GASOLINE" จึงต้องเหลือ GASOLINE ไม่งั้นหาพิกัดไม่เจอ
 */
export function normalizeFuel(raw: string) {
  const f = raw.toUpperCase().replace(/\s+/g, '');
  if (/HYBRID/.test(f)) {
    if (/DIESEL/.test(f)) return 'DIESEL';
    if (/PETROL/.test(f)) return 'PETROL';
    return 'GASOLINE';
  }
  return f;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** วันที่ในหัว invoice → dd/mm/yyyy  รับ 17/09/2026 · 2026-09-17 · "Sep, 09, 2026" · เซลล์วันที่ */
export function invoiceDate(v: CellValue): string {
  if (v && typeof v === 'object') return clean(v);
  const s = clean(v).replace(/^(INVOICE\s*)?DATE\s*:?\s*/i, '').trim();
  let m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return `${pad2(+m[1])}/${pad2(+m[2])}/${m[3]}`;
  m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return `${pad2(+m[3])}/${pad2(+m[2])}/${m[1]}`;
  m = /([A-Za-z]{3})[a-z]*\.?,?\s*(\d{1,2}),?\s*(\d{4})/.exec(s);
  if (m && MONTHS.includes(m[1].toUpperCase())) return `${pad2(+m[2])}/${pad2(MONTHS.indexOf(m[1].toUpperCase()) + 1)}/${m[3]}`;
  return s;
}

/**
 * "LDA-1571303(GASOLINE/1330)" · "4GR (GASOLINE/2490 CC)" · "LEB-H1 (HYBRID-GASOLINE/1490 CC)" → { engine, fuel, cc }
 * fuel ปรับให้ตรงตารางพิกัดแล้ว (ดู normalizeFuel)
 */
export function splitEngineType(raw: string) {
  const s = raw.replace(/\s+/g, '');
  const m = /^(.*?)\((.*?)\/(\d+)(?:CC)?\)/i.exec(s);
  if (!m) return { engine: s.split('(')[0], fuel: '', cc: null as number | null };
  return { engine: m[1], fuel: normalizeFuel(m[2]), cc: Number(m[3]) };
}

/** use_desc_good2 แบบที่สูตรเดิมประกอบ: "4GR(GASOLINE/2490),2012" — ไม่มีช่องว่าง ไม่มี "CC" */
export const engineDesc = (engine: string, fuel: string, cc: number | null, year: number | null) =>
  `${engine}(${fuel}/${cc ?? ''}),${year ?? ''}`;

/** ข้อความแรกที่ไม่ว่างในแถว (ช่วงคอลัมน์ที่ให้) — หัว invoice มักถูก merge ข้ามหลายช่อง */
function firstText(ws: Sheet, row: number, from = 1, to = 20): string {
  for (let c = from; c <= to; c++) {
    const s = clean(ws.value(row, c));
    if (s) return s;
  }
  return '';
}

/** หาค่าที่ต่อจากป้าย เช่น "NO." → ช่องถัดไปทางขวาที่ไม่ว่าง  หรือป้ายกับค่าอยู่ในช่องเดียวกัน "INVOICE NO. : AICHI 348" */
function findLabelled(ws: Sheet, maxRow: number, test: RegExp, fromCol = 1): { value: CellValue; text: string } | null {
  for (let r = 1; r <= maxRow; r++) {
    for (let c = fromCol; c <= 16; c++) {
      const raw = clean(ws.value(r, c));
      const m = test.exec(raw);
      if (!m) continue;
      const rest = raw.slice(m.index + m[0].length).trim();
      if (rest) return { value: rest, text: rest };
      for (let k = c + 1; k <= c + 6; k++) {
        const v = ws.value(r, k);
        if (clean(v)) return { value: v, text: clean(v) };
      }
    }
  }
  return null;
}

function detectPattern(ws: Sheet): string {
  // ไฟล์ imp3_ เดิมเขียนชนิดไว้ที่ P4 — เชื่อค่านั้นก่อนถ้ารู้จัก
  const p4 = upper(ws.at('P4')).replace(/\s+/g, ' ');
  const alias = p4.replace(/ /g, '') === 'JANTRADING' ? 'JAN TRADING' : p4;
  if ((PATTERNS as readonly string[]).includes(alias)) return alias;
  const head = [1, 2, 3].map((r) => firstText(ws, r)).join(' ').toUpperCase();
  if (head.includes('AICHI')) return 'AICHI';
  if (head.includes('JAN TRADING')) return 'JAN TRADING';
  if (head.includes('HUAYO')) return 'HUAYO';
  if (tableHeader(ws)) return 'MSFZ';
  return '';
}

/* ---------------- แบบตาราง ---------------- */

type TableCols = { row: number; make: number; model: number; chassis: number; weight: number; year: number;
  engine: number; cc: number; fuel: number; amount: number; no: number; box: number };

function tableHeader(ws: Sheet): TableCols | null {
  for (let r = 1; r <= Math.min(ws.maxRow, 60); r++) {
    const cols: Record<string, number> = {};
    for (let c = 1; c <= 20; c++) {
      const l = label(ws.value(r, c));
      if (!l) continue;
      if (l === 'MAKE') cols.make = c;
      else if (l === 'MODEL') cols.model = c;
      else if (l.startsWith('CHASSIS')) cols.chassis = c;
      else if (l.startsWith('WEIGHT')) cols.weight = c;
      else if (l === 'YEAR') cols.year = c;
      else if (l.startsWith('ENGINE')) cols.engine = c;
      else if (l === 'CC') cols.cc = c;
      else if (l === 'FUEL') cols.fuel = c;
      else if (l.startsWith('AMOU') || l.startsWith('PRICE')) cols.amount ??= c;
    }
    const need = ['make', 'model', 'chassis', 'weight', 'year', 'engine', 'cc', 'fuel', 'amount'];
    if (need.every((k) => cols[k])) {
      return { row: r, ...(cols as Omit<TableCols, 'row' | 'no' | 'box'>), no: 1, box: cols.chassis - 1 } as TableCols;
    }
  }
  return null;
}

function readTable(ws: Sheet, inv: CargoInvoice) {
  const h = tableHeader(ws);
  if (!h) { inv.errors.push('ไม่พบหัวตาราง MAKE / MODEL / CHASSIS NO. ในไฟล์'); return; }

  let totalRow = 0;
  const boxIndex: number[] = [];
  for (let r = h.row + 1; r <= ws.maxRow; r++) {
    if (label(ws.value(r, 1)) === 'TOTAL') { totalRow = r; break; }
    const chassis = clean(ws.value(r, h.chassis));
    if (!chassis) continue;
    const brand = clean(ws.value(r, h.make));
    const model = clean(ws.value(r, h.model));
    const engine = clean(ws.value(r, h.engine)).replace(/\s+/g, '');
    const fuel = normalizeFuel(upper(ws.value(r, h.fuel)));
    const cc = num(ws.value(r, h.cc));
    const year = num(ws.value(r, h.year));
    inv.cars.push({
      no: num(ws.value(r, h.no)) ?? inv.cars.length + 1,
      container: '', brand, model, chassis, engine, fuel, cc, year,
      weight: num(ws.value(r, h.weight)),
      price: num(ws.value(r, h.amount)),
      desc1: `USED ${brand} ${model},`,
      desc2: engineDesc(engine, fuel, cc, year),
      sheet: ws.name, row: r, problems: [],
    });
    boxIndex.push(num(ws.value(r, h.box)) ?? 0);
  }

  if (totalRow) {
    inv.stated.units = num(/(\d+)\s*UNITS?/i.exec(firstText(ws, totalRow, 2, 6))?.[1] ?? null);
    inv.stated.weight = num(ws.value(totalRow, h.weight));
    inv.stated.amount = num(ws.value(totalRow, h.amount));
  }

  // รายการตู้ใต้ TOTAL: คอลัมน์ A = ลำดับ  คอลัมน์ B = เลขตู้
  const boxes = new Map<number, string>();
  for (let r = (totalRow || h.row) + 1; r <= Math.min(ws.maxRow, (totalRow || h.row) + 40); r++) {
    const idx = num(ws.value(r, 1));
    const no = asContainer(ws.value(r, 2));
    if (idx !== null && no) boxes.set(idx, no);
  }
  inv.containers = [...boxes.values()];
  inv.cars.forEach((car, i) => {
    car.container = boxes.get(boxIndex[i]) ?? '';
    if (!car.container) car.problems.push(`ไม่พบเลขตู้ลำดับ ${boxIndex[i] || '-'} ในรายการตู้ใต้ TOTAL`);
  });
}

/* ---------------- แบบก้อน ---------------- */

/** แถวหัวตาราง WEIGHT / ITEM / DESCRIPTION — 0 = ชีตนี้ไม่ใช่หน้า invoice (เช่น datatariff) */
export function blockHeaderRow(ws: Sheet): number {
  for (let r = 1; r <= Math.min(ws.maxRow, 60); r++) {
    if (label(ws.value(r, 1)) === 'WEIGHT' && label(ws.value(r, 2)) === 'ITEM') return r;
  }
  return 0;
}

/** ยอดรวมของชีตหนึ่ง (แถว TOTAL) — null = ชีตนั้นไม่ได้เขียนไว้ */
type Stated = CargoInvoice['stated'];

/** ป้ายแถวรายละเอียดของรถ — ไม่ใช่ค่าใช้จ่ายอื่น */
const CAR_DETAIL = /^(CHASSIS|ENGINE|REGYEAR|YEAR|COLOU?R|MILEAGE|CONTAINER)/;

function readBlocks(ws: Sheet, raw: ExcelJS.Worksheet, inv: CargoInvoice): Stated {
  const stated: Stated = { units: null, weight: null, amount: null };
  const header = blockHeaderRow(ws);
  if (!header) { inv.errors.push(`ชีต ${ws.name}: ไม่พบหัวตาราง WEIGHT / ITEM / DESCRIPTION`); return stated; }

  let container = '';
  let car: CargoCar | null = null;
  let engineRaw = '';
  const finish = () => {
    if (!car) return;
    const e = splitEngineType(engineRaw);
    car.engine = e.engine;
    car.fuel = e.fuel;
    car.cc = e.cc;
    car.desc2 = e.fuel ? engineDesc(e.engine, e.fuel, e.cc, car.year) : `${engineRaw.replace(/\s+/g, '')},${car.year ?? ''}`;
    if (!engineRaw) car.problems.push('ไม่มีเลขเครื่อง (ENGINE)');
    inv.cars.push(car);
    car = null;
    engineRaw = '';
  };
  const charge = (r: number, text: string, amount: number | null, inTotal: boolean) => {
    if (amount !== null && amount !== 0 && text) inv.charges.push({ label: text, amount, inTotal, sheet: ws.name, row: r });
  };

  for (let r = header + 1; r <= ws.maxRow; r++) {
    const a = ws.value(r, 1);
    const c = clean(ws.value(r, 3));
    const lab = label(ws.value(r, 3));
    if (label(a) === 'TOTAL' || label(ws.value(r, 2)) === 'TOTAL') {
      finish();
      // JAN TRADING เขียนค่าเฟรทไว้ในแถว TOTAL: "FREIGHT CHARGES (¥120,742 PER VAN)" | ¥482,968 — รวมในราคา CIF แล้ว ไม่บวกซ้ำ
      charge(r, c, num(ws.value(r, 7)), false);
      // ยอดรวมอยู่แถวถัดไป: น้ำหนัก (A) · จำนวนคัน (คอลัมน์ไหนก็ได้ที่มีคำว่า UNITS) · ยอดเงิน (G)
      const next = r + 1;
      stated.weight = num(ws.value(next, 1));
      for (let k = 2; k <= 8; k++) {
        const u = /(\d+)\s*UNITS?/i.exec(clean(ws.value(next, k)));
        if (u) { stated.units = Number(u[1]); break; }
      }
      /*
       * ยอดเงินรวมที่เป็นสูตร SUM ไม่เอามาเทียบ — ไฟล์ AICHI รุ่นเก่าเก็บราคาซ้ำไว้ในช่องที่ถูก merge ทุกแถวของรถ
       * Excel จึงบวกราคาคันเดียวหลายรอบ ได้ยอดเกินจริงหลายเท่า ทั้งที่ราคารายคันถูกต้อง
       */
      const amountCell = raw.getCell(next, 7).value as { formula?: string; sharedFormula?: string } | null;
      stated.amount = amountCell && typeof amountCell === 'object' && (amountCell.formula || amountCell.sharedFormula)
        ? null : num(ws.value(next, 7));
      break;
    }
    const box = asContainer(a);
    if (box && !c) {
      finish();
      container = box;
      if (!inv.containers.includes(box)) inv.containers.push(box);
      continue;
    }
    // แถวเริ่มรถต้องมีน้ำหนัก (A) หรือรหัสรายการ (B) — แถว "USED VEHICLES" ใต้หัวตารางเป็นคำอธิบาย ไม่ใช่รถ
    if (/^USED\s/i.test(c) && (num(a) !== null || clean(ws.value(r, 2)))) {
      finish();
      const brand = c.replace(/^USED\s+/i, '').trim();
      const model = clean(ws.value(r, 4));
      car = {
        no: inv.cars.length + 1, container, brand, model, chassis: '', engine: '', fuel: '',
        cc: null, year: null, weight: num(a), price: num(ws.value(r, 7)) ?? num(ws.value(r, 6)),
        desc1: `USED ${brand} ${model},`, desc2: '', sheet: ws.name, row: r, problems: [],
      };
      if (!container) car.problems.push('ไม่พบเลขตู้ก่อนรถคันนี้');
      continue;
    }
    // แถวที่มียอดเงินแต่ไม่ใช่รถ เช่น "Forwarding, Dray, Loading Chg. etc." | 300000
    // ไม่นับแถวเลขอ้างอิงใต้รถ ("3831023452100213 / 20-12-2026") และช่องราคาที่ถูก merge ลงมาจากแถวรถ (ยอดเท่าราคารถคันนั้น)
    const amount = num(ws.value(r, 7));
    if (amount !== null && c && !CAR_DETAIL.test(lab) && !/^\d{6,}/.test(c) && amount !== car?.price) {
      finish();
      charge(r, c, amount, true);
      continue;
    }
    if (!car) continue;
    const d = ws.value(r, 4);
    if (lab.startsWith('CHASSIS')) car.chassis = clean(d);
    else if (lab.startsWith('ENGINE') && clean(d)) engineRaw = clean(d);
    else if (lab.startsWith('REGYEAR') || lab === 'YEAR') car.year = num(d);
  }
  finish();
  return stated;
}

/* ---------------- ตรวจ ---------------- */

function check(inv: CargoInvoice) {
  const seen = new Map<string, number>();
  for (const car of inv.cars) {
    if (!car.brand) car.problems.push('ไม่มียี่ห้อ');
    if (!car.chassis) car.problems.push('ไม่มีเลขตัวถัง (CHASSIS)');
    if (!car.fuel) car.problems.push('ไม่มีชนิดเชื้อเพลิง');
    if (!car.cc) car.problems.push('ไม่มี CC');
    if (!car.year || car.year < 1950 || car.year > 2100) car.problems.push('ปีรถไม่ถูกต้อง');
    if (!car.weight) car.problems.push('ไม่มีน้ำหนัก');
    if (car.price === null) car.problems.push('ไม่มีราคา');
    const key = car.chassis.replace(/\s/g, '').toUpperCase();
    if (key) {
      if (seen.has(key)) car.problems.push(`เลขตัวถังซ้ำกับคันที่ ${seen.get(key)}`);
      else seen.set(key, car.no);
    }
  }
  for (const [what, value] of [['เลข Invoice', inv.invoiceNo], ['วันที่ Invoice', inv.invoiceDate]]) {
    if (!value) inv.errors.push(`อ่าน${what}จากหัวใบไม่ได้`);
  }
  // ผู้ขายมักออก invoice ก่อนได้เลข BL — ตอนบันทึกใช้ BL ของงานที่เลือกแทน
  if (!inv.blNo) inv.warnings.push('ช่อง B/L NO. ในใบว่าง — ระบบหางานจากเลขตู้แทน และใช้เลข BL ของงานที่เลือกตอนบันทึก');
  if (!inv.cars.length && !inv.errors.length) inv.errors.push('ไม่พบรายการรถในไฟล์');

  // เทียบยอดที่บวกเองกับยอดที่ผู้ขายเขียนไว้ — ไม่ตรงแปลว่าอ่านตกหล่นหรือใบมีปัญหา
  const sum = (k: 'weight' | 'price') => inv.cars.reduce((s, c) => s + (c[k] ?? 0), 0);
  const close = (a: number, b: number) => Math.abs(a - b) < 0.5;
  if (inv.stated.units !== null && inv.stated.units !== inv.cars.length) {
    inv.warnings.push(`จำนวนรถที่อ่านได้ ${inv.cars.length} คัน ไม่ตรงกับแถว TOTAL (${inv.stated.units} UNITS)`);
  }
  if (inv.stated.weight !== null && !close(inv.stated.weight, sum('weight'))) {
    inv.warnings.push(`น้ำหนักรวม ${sum('weight').toLocaleString()} KGS ไม่ตรงกับแถว TOTAL (${inv.stated.weight.toLocaleString()})`);
  }
  const extra = inv.charges.filter((c) => c.inTotal).reduce((s, c) => s + c.amount, 0);
  if (inv.stated.amount !== null && !close(inv.stated.amount, sum('price') + extra)) {
    inv.warnings.push(`ราคารวม ${sum('price').toLocaleString()}${extra ? ` + ค่าใช้จ่ายอื่น ${extra.toLocaleString()}` : ''} ` +
      `ไม่ตรงกับแถว TOTAL (${inv.stated.amount.toLocaleString()})`);
  }
  if (inv.stated.units === null && inv.stated.weight === null && inv.stated.amount === null) {
    inv.warnings.push('ไม่พบแถว TOTAL ในใบ — เทียบยอดรวมไม่ได้');
  }
}

export async function parseCargoInvoice(data: Buffer | Uint8Array): Promise<CargoInvoice> {
  const inv: CargoInvoice = {
    pattern: '', supplier: '', invoiceNo: '', invoiceDate: '', blNo: '', bookingNo: '', vessel: '', sheets: [],
    containers: [], cars: [], charges: [], stated: { units: null, weight: null, amount: null }, errors: [], warnings: [],
  };
  let wb: ExcelJS.Workbook;
  try {
    wb = await loadWorkbook(data);
  } catch (e) {
    inv.errors.push(`เปิดไฟล์ Excel ไม่ได้ (ต้องเป็น .xlsx): ${e instanceof Error ? e.message : e}`);
    return inv;
  }
  const first = wb.worksheets[0];
  if (!first) { inv.errors.push('ไฟล์ไม่มีชีตข้อมูล'); return inv; }
  const ws = sheetReader(wb, first);

  inv.pattern = detectPattern(ws);
  inv.supplier = firstText(ws, 1);
  if (!inv.pattern) {
    inv.errors.push(`ไม่รู้จักรูปแบบ Invoice นี้ (รองรับ: ${PATTERNS.join(', ')}) — ส่งไฟล์ตัวอย่างให้ผู้ดูแลเพิ่มรูปแบบ`);
    return inv;
  }

  const head = Math.min(ws.maxRow, 20);
  if (TABLE_PATTERNS.has(inv.pattern)) {
    inv.invoiceNo = findLabelled(ws, head, /^(INVOICE\s*)?NO\b\.?\s*:?$/i)?.text ?? '';
    inv.invoiceDate = invoiceDate(findLabelled(ws, head, /^(INVOICE\s*)?DATE\s*:?$/i)?.value ?? null);
    inv.blNo = (findLabelled(ws, head, /^B\/?L(\s*NO\.?)?\s*:?$/i)?.text ?? '').replace(/\s/g, '');
    inv.vessel = findLabelled(ws, head, /^VESSEL\s*:?$/i)?.text ?? '';
  } else {
    // ที่อยู่ผู้ขายก็ขึ้นต้นด้วย "NO. 9-49 …" — ลอง "INVOICE NO" ก่อน แล้วค่อยหา "NO." เฉพาะหัวฝั่งขวา (คอลัมน์ D ขึ้นไป)
    inv.invoiceNo = (findLabelled(ws, head, /^INVOICE\s*NO\b\.?\s*:?/i)?.text
      ?? findLabelled(ws, head, /^NO\b\.?\s*:?/i, 4)?.text ?? '').replace(/^:\s*/, '');
    inv.invoiceDate = invoiceDate(findLabelled(ws, head, /^DATE\b/i)?.value ?? null);
    for (let r = 1; r <= head; r++) {
      for (let c = 1; c <= 10; c++) {
        const text = clean(ws.value(r, c));
        const book = /BOOKING\s*NO\.?\s*:?\s*([A-Z0-9-]+)/i.exec(text);
        if (book && !inv.bookingNo) inv.bookingNo = book[1].toUpperCase();
        if (inv.blNo || !/^B\/L\s*NO\b/i.test(text)) continue;
        // "B/L NO. : OOLU2340232290" ในช่องเดียว หรือเลขอยู่ช่องถัดไป — ช่องว่างแล้วตามด้วย BOOKING NO. = ใบยังไม่มีเลข BL
        const same = /B\/L\s*NO\.?\s*:?\s*([A-Z0-9-]+)/i.exec(text);
        const next = [1, 2].map((k) => clean(ws.value(r, c + k))).find(Boolean) ?? '';
        const value = same?.[1] ?? (/BOOKING/i.test(next) ? '' : /^[A-Z0-9-]{6,}$/i.exec(next.replace(/\s/g, ''))?.[0] ?? '');
        inv.blNo = value.toUpperCase();
      }
    }
    inv.vessel = (findLabelled(ws, head, /^SHIPPED\s*PER\s*:?$/i)?.text ?? '').replace(/"/g, '').replace(/\s+/g, ' ');
  }

  if (TABLE_PATTERNS.has(inv.pattern)) {
    inv.sheets = [ws.name];
    readTable(ws, inv);
  } else {
    // ทุกชีตที่เป็นหน้า invoice (มีหัวตาราง WEIGHT / ITEM) — AICHI แยกตู้ละชีต · ชีตอื่นเช่น datatariff ข้าม
    const pages = wb.worksheets.map((raw) => ({ raw, ws: sheetReader(wb, raw) }))
      .filter((p, i) => i === 0 || blockHeaderRow(p.ws));
    const totals = pages.map((p) => {
      inv.sheets.push(p.ws.name);
      return readBlocks(p.ws, p.raw, inv);
    });
    // รวมยอด TOTAL ของทุกชีต — ชีตไหนไม่ได้เขียนยอดไว้ ก็เทียบยอดนั้นไม่ได้
    for (const k of ['units', 'weight', 'amount'] as const) {
      const vals = totals.map((t) => t[k]);
      inv.stated[k] = vals.every((v) => v !== null) ? vals.reduce((s, v) => s! + v!, 0) : null;
    }
  }
  check(inv);
  return inv;
}

/** ช่องในไฟล์ที่ส่วนนี้อ่าน — ใช้แสดงคำแนะนำเวลาอ่านไม่ได้ */
export const cellRef = (row: number, col: number) => `${colLetters(col)}${row}`;
