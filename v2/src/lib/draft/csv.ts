/**
 * พิกัดศุลกากร + mapping รถ -> CSV สำหรับนำเข้า NETBAY — ยกมาจาก core/tariff.py + core/netbay_csv.py ของ imp
 *
 * รูปแบบไฟล์เหมือนโปรแกรมเดิมทุกอย่าง:
 *   บรรทัด 1  หัวคอลัมน์จาก csv_template.xlsx (shippingMark ตัวที่ 2 เป็น shippingMark.1)
 *   บรรทัด 2  "//" ตามด้วย N/A
 *   บรรทัด 3+ รถ 1 คันต่อบรรทัด  ค่าคงที่ (610, MAESOT FREE ZONE, ...) มาจากแถว 3 ของ template
 *   ช่องว่าง = N/A   encoding TIS-620   บรรทัดลงท้าย \r\n
 *
 * ไฟล์ข้อมูลอยู่ที่ assets/netbay/ — แก้ไฟล์ Excel แล้วเปิด worker ใหม่
 *   csv_template.xlsx   ค่าคงที่ของ CSV (แถว 3) เช่น FX_permitNo1
 *   brand_country.xlsx  ยี่ห้อที่ไม่ได้ผลิตในญี่ปุ่น -> originCountry
 *   DATA TARIFF.xlsx    ตารางพิกัดสำรอง เมื่อ invoice ไม่มีชีต datatariff
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Car, Invoice, TariffRow } from './invoice';
import { firstSheet, loadTariffRows, tariffKey } from './invoice';
import { loadWorkbook, sheetReader } from './sheet';
import { clean, Dec, fmtNumber, pyRepr } from './values';

export const NA = 'N/A';
export const AMBIGUOUS = '0000XXXX';
const THAI_CAR = 'รถยนต์เก่าใช้แล้วนำเข้ามาเพื่อปรับสภาพและส่งออก';
const THAI_TRUCK = 'รถบรรทุกเก่าใช้แล้วนำเข้ามาเพื่อปรับสภาพและส่งออก';

export type CsvTemplate = { columns: string[]; defaults: string[] };
export type DraftData = { csv: CsvTemplate; brandCountry: Record<string, string>; tariff: TariffRow[]; tariffFile: string };

export const DATA_DIR = join(process.cwd(), 'assets', 'netbay');

/** ชื่อซ้ำ -> ชื่อ.1 แบบเดียวกับที่ pandas ทำในโปรแกรมเดิม */
function dedupe(names: string[]) {
  const seen: Record<string, number> = {};
  return names.map((n) => {
    if (n in seen) { seen[n] += 1; return `${n}.${seen[n]}`; }
    seen[n] = 0;
    return n;
  });
}

async function sheetOf(path: string) {
  const wb = await loadWorkbook(readFileSync(path));
  return { wb, ws: sheetReader(wb, firstSheet(wb)), raw: firstSheet(wb) };
}

export async function loadDraftData(dir = DATA_DIR): Promise<DraftData> {
  // csv_template: แถว 1 หัวคอลัมน์ · แถว 3 ค่าคงที่
  const t = await sheetOf(join(dir, 'csv_template.xlsx'));
  const width = t.raw.columnCount;
  const header = Array.from({ length: width }, (_, i) => clean(t.ws.value(1, i + 1)));
  while (header.length && !header[header.length - 1]) header.pop();
  const csv = { columns: dedupe(header), defaults: header.map((_, i) => clean(t.ws.value(3, i + 1)) || NA) };

  // brand_country: แถว 2 = รหัสประเทศ ใต้ลงไป = ยี่ห้อรถของประเทศนั้น (ไม่อยู่ในรายการ = JP)
  const b = await sheetOf(join(dir, 'brand_country.xlsx'));
  const brandCountry: Record<string, string> = {};
  for (let c = 1; c <= b.raw.columnCount; c++) {
    for (let r = 3; r <= b.ws.maxRow; r++) {
      const brand = clean(b.ws.value(r, c));
      if (brand) brandCountry[brand.toUpperCase()] = clean(b.ws.value(2, c));
    }
  }

  const tariffFile = 'DATA TARIFF.xlsx';
  const tf = await sheetOf(join(dir, tariffFile));
  return { csv, brandCountry, tariff: loadTariffRows(tf.ws), tariffFile };
}

/** คืน [พิกัด, หมายเหตุ]  หมายเหตุว่าง = เจอพิกัดเดียว */
export function lookupTariff(rows: TariffRow[], car: Car): [string, string] {
  const key = tariffKey(car.brand, car.model, car.fuel);
  const w = car.weight.toNumber();
  const hits = rows.filter((t) => t[2] === key && t[3] <= car.cc && car.cc <= t[4] && t[5] <= w && w <= t[6]);
  const codes = Array.from(new Set(hits.map((t) => t[1]))).sort();
  if (codes.length === 1) return ['0000' + codes[0], ''];
  if (codes.length > 1) return [AMBIGUOUS, `เจอหลายพิกัด (${codes.join(', ')}) ลำดับ ${hits.map((t) => t[0]).join(', ')}`];
  return [car.tariff_cell || 'XXXX',
    `ไม่พบพิกัดสำหรับ ${car.brand} ${car.model} ${car.fuel} ${car.cc}CC ${car.weight.toString()}KG`];
}

/** "HR15-1234567(GASOLINE/1490),2011" -> ["HR15(GASOLINE/1490),2011", "HR15-1234567"] */
export function splitEngine(desc2: string): [string, string] {
  const p = desc2.lastIndexOf('(');
  const dash = desc2.slice(0, p).lastIndexOf('-');
  return [desc2.slice(0, dash) + desc2.slice(p), desc2.split('(')[0]];
}

/** "HR15(GASOLINE/1490),2011" -> "HR15-1234567(GASOLINE/1490),2011"  (ค่าเดียวกับที่สูตรใน Excel คำนวณ) */
export function addNumber(desc2: string, number: string) {
  const p = desc2.indexOf('(');
  return `${desc2.slice(0, p)}-${number}${desc2.slice(p)}`;
}

/** รถ 1 คัน -> {ชื่อคอลัมน์ CSV: ค่า}  เฉพาะช่องที่ไม่ใช่ค่าคงที่ */
export function mapCar(car: Car, inv: Invoice, tariffCode: string, desc2Full: string, brandCountry: Record<string, string>) {
  const [endesc2, engine] = splitEngine(desc2Full);
  const v: Record<string, string> = {
    invoiceNo: inv.invoice_no,
    invoiceDate: inv.invoice_date,
    invoiceItem: String(car.car_no),
    productCode: `${car.cc}CC`,
    ins_tariffCode: tariffCode,
    englishDescriptionOfGoods: car.desc1.split(' ,').join(','),
    endesc2,
    brandName: car.brand,
    customsProductCode: car.fuel,
    productYear: car.year,
    productAttribute1: car.use_chassis,
    productAttribute2: engine,
    netWeight: fmtNumber(car.use_weight),
    itemGrossWeight: fmtNumber(car.use_weight),
    invoiceAmountForeign: fmtNumber(car.use_price),
  };
  const heading = tariffCode.slice(4, 8);
  if (heading === '8703') {
    v.thaiDescriptionOfGoods = THAI_CAR;
  } else if (heading === '8704') {
    v.thaiDescriptionOfGoods = THAI_TRUCK;
    if (car.use_weight.toNumber() > 5000) {
      v.ins_privilegeCode = '999';
      v.ins_tariffSequence = '65001';
    }
  }
  const country = brandCountry[car.brand.toUpperCase()];
  if (country) v.originCountry = country;
  return v;
}

export function buildRows(template: CsvTemplate, mapped: Record<string, string>[]) {
  const index: Record<string, number> = {};
  template.columns.forEach((n, i) => { index[n] = i; });
  return mapped.map((m) => {
    const row = template.defaults.slice();
    for (const [name, value] of Object.entries(m)) {
      if (!(name in index)) throw new Error(`csv_template ไม่มีคอลัมน์ ${name}`);
      row[index[name]] = value !== '' ? value : NA;
    }
    return row;
  });
}

const csvField = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function csvText(template: CsvTemplate, rows: string[][]) {
  const lines = [template.columns, ['//', ...Array(template.columns.length - 1).fill(NA)], ...rows];
  return lines.map((r) => r.map(csvField).join(',') + '\r\n').join('');
}

/** ตัวอักษร -> ไบต์ TIS-620 (แบบ codec tis-620 ของ Python)  เข้ารหัสไม่ได้ -> -1 */
function tisByte(cp: number) {
  if (cp < 0xA0) return cp;
  if ((cp >= 0x0E01 && cp <= 0x0E3A) || (cp >= 0x0E3F && cp <= 0x0E5B)) return cp - 0x0D60;
  return -1;
}

export class EncodingError extends Error {}

/** ข้อความ CSV -> ไบต์ TIS-620  ตัวที่เข้ารหัสไม่ได้ -> EncodingError แบบเดียวกับโปรแกรมเดิม */
export function encodeTis620(text: string): Buffer {
  const chars = Array.from(text);
  const out = Buffer.alloc(chars.length);
  for (let i = 0; i < chars.length; i++) {
    const b = tisByte(chars[i].codePointAt(0)!);
    if (b < 0) {
      let j = i + 1;
      while (j < chars.length && tisByte(chars[j].codePointAt(0)!) < 0) j++;
      const line = chars.slice(0, i).filter((c) => c === '\n').length + 1;
      throw new EncodingError(`ตัวอักษร ${pyRepr(chars.slice(i, j).join(''))} บรรทัด ${line} เข้ารหัส tis-620 ไม่ได้`);
    }
    out[i] = b;
  }
  return out;
}

export type Totals = { package_amount: string; package_unit: string; gross_weight: string; price: string; currency: string };

/** ยอดรวมสำหรับกรอกหัวใบขน NETBAY (คำนวณจากแถว CSV แบบโปรแกรมเดิม) */
export function totals(template: CsvTemplate, rows: string[][]): Totals {
  const col: Record<string, number> = {};
  template.columns.forEach((n, i) => { col[n] = i; });
  const sum = (name: string) => rows.reduce((acc, r) => {
    const d = Dec.parse(r[col[name]]);
    if (!d) throw new Error(`คอลัมน์ ${name} ไม่ใช่ตัวเลข: ${r[col[name]]}`);
    return acc.add(d);
  }, Dec.fromInt(0));
  return {
    package_amount: fmtNumber(sum('packageAmount')),
    package_unit: rows[0][col.packageUnit],
    gross_weight: fmtNumber(sum('itemGrossWeight')),
    price: fmtNumber(sum('invoiceAmountForeign')),
    currency: rows[0][col.currency],
  };
}
