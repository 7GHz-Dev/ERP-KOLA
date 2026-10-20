/**
 * อ่านไฟล์ Final Invoice (อ่านอย่างเดียว) — ยกมาจาก core/invoice.py + core/layouts.py ของโปรแกรม imp
 *
 * ทุก template มี "ตารางสรุป" อยู่ตำแหน่งเดียวกัน (สูตรใน template แปลงมาให้แล้ว)
 *   P4 ชนิดไฟล์   P5 วันที่ invoice   P6 เลข invoice   P14 เลข BL
 *   แถว 20 ลงไป = รถ 1 คันต่อแถว  (คอลัมน์ P:U และ W:AF)
 * ที่ต่างกันคือ "ช่องเลขเครื่อง" ในส่วน invoice ของผู้ขาย ที่ต้องเติมเลขสุ่ม
 */
import type ExcelJS from 'exceljs';
import { colIndex, loadWorkbook, sheetReader, type Sheet } from './sheet';
import { clean, Dec, fmtDate, pyRepr, pyStr, toDecimal } from './values';

const TYPE_CELL = 'P4';
const DATE_CELL = 'P5';
const INVOICE_CELL = 'P6';
const BL_CELL = 'P14';
export const FIRST_CAR_ROW = 20;

/** ตารางสรุป: ชื่อช่อง -> คอลัมน์ */
export const SUMMARY_COLS = {
  desc1: 'P',        // use_desc_good1  เช่น "USED TOYOTA CROWN,"
  desc2: 'Q',        // use_desc_good2  เช่น "4GR(GASOLINE/2490),2014"
  use_chassis: 'R',  // use_chassis_no
  use_weight: 'T',
  use_price: 'U',
  car_no: 'W',
  brand: 'X',
  model: 'Y',
  chassis: 'Z',
  weight: 'AA',
  year: 'AB',
  cc: 'AC',
  fuel: 'AD',
  price: 'AE',
  tariff: 'AF',
} as const;

type ColumnLayout = { kind: 'column'; headerRow: number; chassisCol: string; engineCol: string };
type BlockLayout = { kind: 'block'; firstRow: number; engineLabel: string };

/** ยกมาจาก set_engin_to_excel() ของโปรแกรมเดิม */
export const LAYOUTS: Record<string, ColumnLayout | BlockLayout> = {
  'MSFZ': { kind: 'column', headerRow: 19, chassisCol: 'E', engineCol: 'J' },
  'JTC': { kind: 'column', headerRow: 19, chassisCol: 'D', engineCol: 'K' },
  'AICHI': { kind: 'block', firstRow: 17, engineLabel: 'ENGINETYPE' },
  'HUAYO': { kind: 'block', firstRow: 17, engineLabel: 'ENGINETYPE' },
  'JAN TRADING': { kind: 'block', firstRow: 16, engineLabel: 'ENGINENO' },
};
const BLOCK = { chassisLabel: 'CHASSISNO', labelCol: 'C', valueCol: 'D' };
const ALIASES: Record<string, string> = { JANTRADING: 'JAN TRADING' };

export type Car = {
  row: number; car_no: number; brand: string; model: string; chassis: string;
  weight: Dec; year: string; cc: number; fuel: string; price: Dec; tariff_cell: string;
  desc1: string; desc2: string; use_chassis: string; use_weight: Dec; use_price: Dec;
};

/** ช่องเลขเครื่องในส่วน invoice ของผู้ขาย (ที่จะเขียนเลขสุ่มลงไป) */
export type EngineCell = {
  row: number; col: number; chassis: string;
  raw: string;     // ข้อความเดิมในช่อง เช่น "HR15" หรือ "LDA-MF6 (GASOLINE/1330)"
  head: string;    // ส่วนเลขเครื่อง เช่น "HR15" / "LDA-MF6"
  /** ช่องนี้มีเลข 7 หลักต่อท้ายแล้ว (เช่นอัปโหลดไฟล์ผลลัพธ์ซ้ำ) */
  existing: { head: string; number: string } | null;
};

/** แถวตารางพิกัด: [ลำดับ, พิกัด, ยี่ห้อ+รุ่น+เชื้อเพลิง, cc เริ่ม, cc ถึง, น้ำหนักเริ่ม, น้ำหนักถึง] */
export type TariffRow = [string, string, string, number, number, number, number];

export type Invoice = {
  file_type: string; invoice_no: string; invoice_date: string; bl_no: string;
  cars: Car[]; engines: EngineCell[];
  /** ชีต datatariff ในไฟล์ (null = ไม่มี ใช้ตารางสำรอง) */
  tariff_rows: TariffRow[] | null;
  errors: string[]; warnings: string[];
};

const FULL_ENGINE = /^(.*\S)-(\d{7})$/;
const label = (v: ReturnType<Sheet['value']>) => clean(v).toUpperCase().replace(/[\s.:]/g, '');
const squash = (s: string) => s.split(/\s+/).filter(Boolean).join(' ');

function normalizeType(v: ReturnType<Sheet['value']>) {
  const t = squash(pyStr(v).toUpperCase());
  return ALIASES[t.replace(/ /g, '')] ?? t;
}

export const tariffKey = (...parts: ReturnType<Sheet['value']>[]) =>
  parts.map(clean).join('').replace(/ /g, '').replace(/-/g, '').toUpperCase();

/** ตารางพิกัด: หัวตารางแถว 2  คอลัมน์ A:I = trf_num, trf_code, brand, model, fuel, cc_start, cc_end, w_start, w_end */
export function loadTariffRows(ws: Sheet): TariffRow[] {
  const rows: TariffRow[] = [];
  for (let r = 3; r <= ws.maxRow; r++) {
    const v = Array.from({ length: 9 }, (_, i) => ws.value(r, i + 1));
    const rng = v.slice(5, 9).map(toDecimal);
    if (!clean(v[1]) || !clean(v[2]) || rng.includes(null)) continue;
    const n = rng.map((d) => Number(d!.trunc()));
    rows.push([clean(v[0]), clean(v[1]), tariffKey(v[2], v[3], v[4]), n[0], n[1], n[2], n[3]]);
  }
  return rows;
}

/** ชีตแรกตามลำดับในไฟล์ (แบบ openpyxl wb.worksheets[0]) — exceljs เรียง worksheets ตามลำดับในไฟล์ให้แล้ว */
export function firstSheet(wb: ExcelJS.Workbook) {
  return wb.worksheets[0];
}

export async function readInvoice(data: Buffer | Uint8Array): Promise<Invoice> {
  const inv: Invoice = { file_type: '', invoice_no: '', invoice_date: '', bl_no: '', cars: [], engines: [],
    tariff_rows: null, errors: [], warnings: [] };
  let wb: ExcelJS.Workbook;
  try {
    wb = await loadWorkbook(data);
  } catch (e) {
    inv.errors.push(`เปิดไฟล์ Excel ไม่ได้: ${e instanceof Error ? e.message : e} (ต้องเป็น .xlsx)`);
    return inv;
  }
  const first = firstSheet(wb);
  if (!first) {
    inv.errors.push('เปิดไฟล์ Excel ไม่ได้: ไม่มีชีตข้อมูล (ต้องเป็น .xlsx)');
    return inv;
  }
  const ws = sheetReader(wb, first);

  inv.file_type = normalizeType(ws.at(TYPE_CELL));
  inv.invoice_date = fmtDate(ws.at(DATE_CELL));
  inv.invoice_no = clean(ws.at(INVOICE_CELL));
  inv.bl_no = clean(ws.at(BL_CELL));
  const tariffSheet = wb.worksheets.find((s) => s.name === 'datatariff');
  if (tariffSheet) inv.tariff_rows = loadTariffRows(sheetReader(wb, tariffSheet));

  const layout = LAYOUTS[inv.file_type];
  if (!layout) {
    inv.errors.push(`ไม่รู้จักชนิดไฟล์ ${pyRepr(inv.file_type)} ในช่อง ${TYPE_CELL} (รองรับ: ${Object.keys(LAYOUTS).join(', ')})`);
    return inv;
  }
  for (const [what, value] of [['เลข Invoice', inv.invoice_no], ['เลข BL', inv.bl_no], ['วันที่ Invoice', inv.invoice_date]]) {
    if (!value) inv.errors.push(`ไม่มี${what} ในตารางสรุป (ช่อง P4-P14)`);
  }

  inv.cars = readCars(ws, inv.errors);
  if (!inv.cars.length && !inv.errors.length) {
    inv.errors.push('ไม่พบรถในตารางสรุป (แถว 20 ลงไป คอลัมน์ W:AF) — ' +
      'ถ้าเพิ่งกรอกข้อมูล ให้เปิดไฟล์ใน Excel กด Save แล้วอัปโหลดใหม่');
  }
  inv.engines = layout.kind === 'column' ? enginesByColumn(ws, layout, inv.errors) : enginesByBlock(ws, layout, inv.errors);
  return inv;
}

function readCars(ws: Sheet, errors: string[]): Car[] {
  const col = Object.fromEntries(Object.entries(SUMMARY_COLS).map(([k, v]) => [k, colIndex(v)])) as Record<keyof typeof SUMMARY_COLS, number>;
  const cars: Car[] = [];
  for (let r = FIRST_CAR_ROW; r <= ws.maxRow; r++) {
    const get = (k: keyof typeof SUMMARY_COLS) => ws.value(r, col[k]);
    const chassis = clean(get('chassis'));
    if (chassis === '' || chassis === '0') continue;     // แถวว่างที่สูตร VLOOKUP คืน 0
    const nums: Record<string, Dec | null> = {};
    const missing: string[] = [];
    for (const k of ['car_no', 'weight', 'year', 'cc', 'price', 'use_weight', 'use_price'] as const) {
      nums[k] = toDecimal(get(k));
      if (nums[k] === null) missing.push(k);
    }
    for (const k of ['brand', 'fuel', 'desc1', 'desc2', 'use_chassis'] as const) if (!clean(get(k))) missing.push(k);
    if (missing.length) {
      errors.push(`แถว ${r} (${chassis}): ข้อมูลไม่ครบหรือไม่ใช่ตัวเลข: ${missing.join(', ')}`);
      continue;
    }
    cars.push({
      row: r,
      car_no: Number(nums.car_no!.trunc()),
      brand: clean(get('brand')),
      model: clean(get('model')),
      chassis,
      weight: nums.weight!,
      year: nums.year!.trunc().toString(),
      cc: Number(nums.cc!.trunc()),
      fuel: clean(get('fuel')),
      price: nums.price!,
      tariff_cell: clean(get('tariff')),
      desc1: clean(get('desc1')),
      desc2: clean(get('desc2')),
      use_chassis: clean(get('use_chassis')),
      use_weight: nums.use_weight!,
      use_price: nums.use_price!,
    });
  }
  return cars;
}

function engineCell(row: number, col: number, chassis: string, raw: string, head: string): EngineCell {
  const m = FULL_ENGINE.exec(head);
  return { row, col, chassis, raw, head, existing: m ? { head: m[1], number: m[2] } : null };
}

/** ข้อความที่จะเขียนกลับลงช่องเลขเครื่อง เมื่อได้เลขเครื่องเต็มแล้ว */
export const engineValueWith = (eng: EngineCell, full: string) => eng.raw.replace(eng.head, () => full);

function enginesByColumn(ws: Sheet, lay: ColumnLayout, errors: string[]): EngineCell[] {
  const cCol = colIndex(lay.chassisCol); const eCol = colIndex(lay.engineCol);
  const hChassis = label(ws.value(lay.headerRow, cCol));
  const hEngine = label(ws.value(lay.headerRow, eCol));
  if (!hChassis.includes('CHASSIS') || !hEngine.includes('ENGINE')) {
    errors.push(`หัวตารางแถว ${lay.headerRow} ไม่ตรง template (คาดว่า ${lay.chassisCol}=CHASSIS, ` +
      `${lay.engineCol}=ENGINE แต่พบ ${pyRepr(hChassis)}, ${pyRepr(hEngine)})`);
    return [];
  }
  const out: EngineCell[] = [];
  for (let r = lay.headerRow + 1; r <= ws.maxRow; r++) {
    const chassis = clean(ws.value(r, cCol));
    if (!chassis) continue;
    const raw = clean(ws.value(r, eCol));
    if (!raw) {
      errors.push(`แถว ${r} (${chassis}): ไม่มีเลขเครื่องในคอลัมน์ ${lay.engineCol}`);
      continue;
    }
    out.push(engineCell(r, eCol, chassis, raw, raw));
  }
  return out;
}

function enginesByBlock(ws: Sheet, lay: BlockLayout, errors: string[]): EngineCell[] {
  const lCol = colIndex(BLOCK.labelCol); const vCol = colIndex(BLOCK.valueCol);
  const out: EngineCell[] = [];
  let chassis: string | null = null;
  for (let r = lay.firstRow; r <= ws.maxRow; r++) {
    const lab = label(ws.value(r, lCol));
    const value = ws.value(r, vCol);
    if (lab === BLOCK.chassisLabel) {
      chassis = clean(value) || null;
    } else if (lab === lay.engineLabel) {
      const raw = squash(pyStr(value));
      const head = raw.split('(')[0].trim();
      if (chassis === null) errors.push(`แถว ${r}: พบเลขเครื่องแต่ไม่มี CHASSIS NO. ก่อนหน้า`);
      else if (!head) errors.push(`แถว ${r} (${chassis}): ไม่มีเลขเครื่องในคอลัมน์ ${BLOCK.valueCol}`);
      else out.push(engineCell(r, vCol, chassis, raw, head));
      chassis = null;
    }
  }
  return out;
}
