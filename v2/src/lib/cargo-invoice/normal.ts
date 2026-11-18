/**
 * Final Invoice แบบ NORMAL — ผู้ขายที่ไม่ใช่ JAN TRADING / AICHI (ตามไฟล์ตัวอย่าง "example Normal Final Invoice")
 *
 * ไม่ได้อ่านจากไฟล์ผู้ขาย (ไฟล์อาจเป็นรูป PDF หรือ Excel รูปแบบไหนก็ได้) — คนคีย์จากไฟล์ที่เปิดดูข้าง ๆ
 * แล้วระบบประกอบใบจากแม่แบบ assets/cargo-invoice/normal-template.xlsx
 *
 *   หัวใบ      ชื่อ Shipper + ที่อยู่ (ตั้งที่ Master Data) · Invoice DATE · Invoice NO.
 *   ข้อมูลเรือ  VESSEL · VOYAGE · PORT OF SHIPMENT · PORT OF DESTINATION · DATE OF SHIP · BL · CARRIER — จากงาน (ตารางหลัก)
 *   ตาราง      NO · BRAND · MODEL · CHASSIS NO. · WEIGHT · YEAR · ENGINE NO · CC · FUEL · AMOUNT (สกุลเงิน)
 *   ท้ายตาราง   TOTAL n UNITS · น้ำหนักรวม · ยอดรวม แล้วรายการตู้ (ลำดับ · เลขตู้)
 *
 * หัวตารางอยู่แถว 19 · CHASSIS คอลัมน์ E · ENGINE คอลัมน์ J — แบบเดียวกับ MSFZ ที่ worker Draft ใบขนอ่านอยู่แล้ว (LAYOUTS NORMAL)
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { engineDesc } from './edit';
import type { CargoCar, CargoInvoice } from './parse';

const TEMPLATE = path.join(process.cwd(), 'assets', 'cargo-invoice', 'normal-template.xlsx');
const FIRST_ROW = 20;
/** แถวของแม่แบบที่ใช้เป็นต้นแบบรูปแบบ: แถวรถ · แถว TOTAL · แถวรายการตู้ */
const STYLE_ROW = { car: 20, total: 23, box: 25 };
const COLS = 13;   // A:M

export type NormalCar = {
  brand: string; model: string; chassis: string; weight: number | null; year: number | null;
  /** ข้อความเลขเครื่องที่พิมพ์ลงใบ เช่น F33A-1555956 */
  engine: string; cc: number | null; fuel: string; amount: number | null; container: string;
};

export type NormalDoc = {
  shipper: { name: string; address: string };
  invoiceNo: string; invoiceDate: string; currency: string;
  vessel: string; voyage: string; portOfLoading: string; portOfDestination: string;
  dateOfShip: string; blNo: string; carrier: string;
  cars: NormalCar[];
  /** เลขตู้ของงานตามลำดับ — พิมพ์เป็นรายการท้ายใบ */
  containers: string[];
};

type Style = Partial<ExcelJS.Style>;
const copy = (s: Style): Style => JSON.parse(JSON.stringify(s ?? {}));

/** ไฟล์ Final Invoice (ยังไม่มีตารางสรุป — ผู้เรียกเขียนต่อด้วย writeSummary) */
export async function buildNormalWorkbook(doc: NormalDoc): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await readFile(TEMPLATE) as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  const styleOf = (row: number) => Array.from({ length: COLS }, (_, i) => copy(ws.getRow(row).getCell(i + 1).style));
  const carStyle = styleOf(STYLE_ROW.car);
  const totalStyle = styleOf(STYLE_ROW.total);
  const boxStyle = styleOf(STYLE_ROW.box);
  const addrStyle = copy(ws.getCell('A2').style);
  const heights = { car: ws.getRow(STYLE_ROW.car).height, total: ws.getRow(STYLE_ROW.total).height, box: ws.getRow(STYLE_ROW.box).height };

  // ล้างส่วนตารางของแม่แบบทั้งหมดก่อน แล้วเขียนใหม่ตามจำนวนรถ
  for (let r = FIRST_ROW; r <= Math.max(ws.rowCount, 60); r++) {
    ws.getRow(r).eachCell({ includeEmpty: true }, (c) => { c.value = null; c.style = {}; });
  }

  ws.getCell('A1').value = doc.shipper.name;
  doc.shipper.address.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 4).forEach((line, i) => {
    const cell = ws.getCell(`A${2 + i}`);
    cell.value = line;
    cell.style = copy(addrStyle);
  });
  ws.getCell('M5').value = doc.invoiceDate;
  ws.getCell('M6').value = doc.invoiceNo;
  ws.getCell('J8').value = doc.vessel;
  ws.getCell('J9').value = doc.voyage;
  ws.getCell('J10').value = doc.portOfLoading;
  ws.getCell('J11').value = doc.portOfDestination;
  ws.getCell('J12').value = doc.dateOfShip;
  ws.getCell('J12').numFmt = '@';
  ws.getCell('J14').value = doc.blNo;
  ws.getCell('J15').value = doc.carrier;
  ws.getCell('M19').value = `AMOUNT (${doc.currency})`;

  const put = (row: number, styles: Style[], values: Record<number, ExcelJS.CellValue>, height?: number) => {
    const r = ws.getRow(row);
    for (let c = 1; c <= COLS; c++) {
      const cell = r.getCell(c);
      cell.style = copy(styles[c - 1]);
      if (c in values) cell.value = values[c];
    }
    if (height) r.height = height;
  };
  const money = '#,##0.00';
  doc.cars.forEach((car, i) => {
    put(FIRST_ROW + i, carStyle, {
      1: i + 1, 2: car.brand, 3: car.model, 5: car.chassis, 8: car.weight, 9: car.year,
      10: car.engine, 11: car.cc, 12: car.fuel, 13: car.amount,
    }, heights.car);
    ws.getCell(FIRST_ROW + i, 13).numFmt = money;
  });
  const last = FIRST_ROW + doc.cars.length - 1;
  const totalRow = last + 2;
  const sum = (k: 'weight' | 'amount') => doc.cars.reduce((s, c) => s + (c[k] ?? 0), 0);
  put(totalRow, totalStyle, {
    1: 'TOTAL', 2: `${doc.cars.length} UNITS`,
    8: { formula: `SUM(H${FIRST_ROW}:H${last})`, result: sum('weight') },
    13: { formula: `SUM(M${FIRST_ROW}:M${last})`, result: sum('amount') },
  }, heights.total);
  ws.getCell(totalRow, 13).numFmt = money;
  doc.containers.forEach((box, i) => put(totalRow + 2 + i, boxStyle, { 1: i + 1, 2: box }, heights.box));

  const end = totalRow + 2 + Math.max(doc.containers.length, 1);
  ws.pageSetup.printArea = `A1:M${Math.max(end, 34)}`;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** ข้อมูลใบสำหรับเขียนตารางสรุป (writeSummary) — โครงเดียวกับที่ parse.ts อ่านจากใบผู้ขาย */
export function normalInvoice(doc: NormalDoc): CargoInvoice {
  return {
    pattern: 'NORMAL', supplier: doc.shipper.name, invoiceNo: doc.invoiceNo, invoiceDate: doc.invoiceDate,
    blNo: doc.blNo, bookingNo: '', vessel: [doc.vessel, doc.voyage].filter(Boolean).join(' V.'), currency: doc.currency,
    sheets: ['invoice'], containers: doc.containers, charges: [],
    stated: { units: doc.cars.length, weight: null, amount: null }, errors: [], warnings: [],
    cars: doc.cars.map((c, i): CargoCar => ({
      no: i + 1, container: c.container, brand: c.brand, model: c.model, chassis: c.chassis, engine: c.engine,
      fuel: c.fuel, cc: c.cc, year: c.year, weight: c.weight, price: c.amount,
      desc1: `USED ${c.brand} ${c.model},`, desc2: engineDesc(c.engine, c.fuel, c.cc, c.year),
      sheet: 'invoice', row: FIRST_ROW + i, cells: [], layoutProblems: [], problems: [],
    })),
  };
}
