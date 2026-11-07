/**
 * เขียนผลที่จัดเรียงแล้วลง "ตารางสรุป" ของไฟล์ Invoice — รูปแบบเดียวกับที่สูตร VLOOKUP ในไฟล์ imp3_ เดิมสร้าง
 *
 *   P4 ชนิดไฟล์  P5 วันที่  P6 เลข invoice  P14 เลข BL
 *   แถว 19 หัวตาราง · แถว 20 ลงไปรถคันละแถว P:U (use_*) และ W:AG (ข้อมูลรถ + พิกัด + ตู้)
 *
 * worker สร้าง Draft ใบขน (lib/draft/invoice.ts) อ่านตารางนี้อยู่แล้ว ไม่ต้องแก้ฝั่งนั้น
 * พิกัดเขียนเต็ม 12 หลัก ("0000" + 8 หลัก) ลง AF — worker ใช้ค่านี้ตรง ๆ แทนการค้นจากตาราง (ดู lookupTariff)
 *
 * แก้ XML เฉพาะช่องที่เขียน แบบเดียวกับ excel-patch.ts — รูปแบบ รูปภาพ ชีตอื่น ส่วน invoice ของผู้ขายไม่ถูกแตะ
 * ไฟล์จึงยังแปลงเป็น PDF สำหรับชุด E-Office ได้เหมือนเดิม
 * ช่องที่เดิมเป็นสูตรจะกลายเป็นค่าคงที่ — ตั้งแต่นี้หน้าเว็บเป็นตัวจัดเรียง ไม่ใช่สูตรในไฟล์
 */
import JSZip from 'jszip';
import { firstSheetPath } from '@/lib/draft/excel-patch';
import { colIndex } from '@/lib/draft/sheet';
import type { CargoCar, CargoInvoice } from './parse';

type Value = string | number | null;

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
const splitRef = (ref: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
  return { col: colIndex(m[1]), row: Number(m[2]) };
};

export const SUMMARY_HEADER: Record<string, string> = {
  P: 'use_desc_good1', Q: 'use_desc_good2', R: 'use_chassis_no', S: 'use_brand', T: 'use_weight', U: 'use_price',
  W: 'car_no', X: 'brand', Y: 'model', Z: 'chassis_no', AA: 'weight', AB: 'year', AC: 'cc', AD: 'fuel',
  AE: 'price', AF: 'tariff', AG: 'container',
};
const SUMMARY_COLS = Object.keys(SUMMARY_HEADER);
const FIRST_ROW = 20;

/** ค่าที่จะเขียนของรถหนึ่งคัน — ตรงกับที่สูตรเดิมคำนวณ */
function carCells(car: CargoCar, tariff12: string): Record<string, Value> {
  return {
    P: car.desc1, Q: car.desc2, R: car.chassis, S: car.brand, T: car.weight, U: car.price,
    W: car.no, X: car.brand, Y: car.model, Z: car.chassis, AA: car.weight, AB: car.year, AC: car.cc,
    AD: car.fuel, AE: car.price, AF: tariff12, AG: car.container,
  };
}

function cellXml(ref: string, style: string | null, v: Value) {
  const s = style ? ` s="${style}"` : '';
  if (v === null || v === '') return `<c r="${ref}"${s}/>`;
  if (typeof v === 'number') return `<c r="${ref}"${s}><v>${v}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;
}

const CELL = /<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g;
const ROW = /<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g;

/**
 * เขียนหลายช่องลงชีต — สร้างแถว/ช่องที่ยังไม่มีให้ เรียงตามลำดับที่ Excel ต้องการ
 * คืนรหัสสูตรร่วม (shared formula) ที่ช่องหลักถูกเขียนทับ — ช่องลูกของสูตรนั้นต้องถูกแปลงเป็นค่าด้วย
 */
function writeCells(xml: string, updates: Map<string, Value>) {
  const byRow = new Map<number, Map<number, { ref: string; value: Value }>>();
  for (const [ref, value] of updates) {
    const { row, col } = splitRef(ref);
    if (!byRow.has(row)) byRow.set(row, new Map());
    byRow.get(row)!.set(col, { ref, value });
  }
  const brokenShared = new Set<string>();
  let formulaRemoved = false;

  const open = /<sheetData\s*\/>|<sheetData>/.exec(xml);
  if (!open) throw new Error('ไฟล์ Excel ไม่มีส่วนข้อมูลของชีต');
  if (open[0].endsWith('/>')) xml = xml.replace(open[0], '<sheetData></sheetData>');
  const start = xml.indexOf('<sheetData>') + '<sheetData>'.length;
  const end = xml.indexOf('</sheetData>');
  const rowsXml = xml.slice(start, end);

  const rows: Array<{ n: number; xml: string }> = [];
  for (const m of rowsXml.matchAll(ROW)) rows.push({ n: Number(attr(m[0], 'r')), xml: m[0] });

  const rewriteRow = (n: number, rowXml: string | null) => {
    const wants = byRow.get(n)!;
    let head = rowXml ? /^<row\b[^>]*?>/.exec(rowXml)?.[0] ?? `<row r="${n}">` : `<row r="${n}">`;
    if (head.endsWith('/>')) head = head.slice(0, -2) + '>';
    // spans บอกช่วงคอลัมน์ของแถว — เพิ่มช่องนอกช่วงแล้วค่าเดิมจะผิด ลบทิ้งให้ Excel คำนวณเอง
    head = head.replace(/\s+spans="[^"]*"/, '');
    const cells: Array<{ col: number; xml: string }> = [];
    if (rowXml && !/^<row\b[^>]*\/>$/.test(rowXml)) {
      for (const c of rowXml.matchAll(CELL)) cells.push({ col: splitRef(attr(c[0], 'r')!).col, xml: c[0] });
    }
    for (const [col, { ref, value }] of wants) {
      const i = cells.findIndex((c) => c.col === col);
      const old = i >= 0 ? cells[i].xml : null;
      if (old) {
        const f = /<f\b[^>]*>/.exec(old);
        if (f) {
          formulaRemoved = true;
          if (attr(f[0], 't') === 'shared' && attr(f[0], 'ref')) brokenShared.add(attr(f[0], 'si')!);
        }
      }
      const style = old ? attr(/^<c\b[^>]*>/.exec(old)![0], 's') : null;
      const next = cellXml(ref, style, value);
      if (i >= 0) cells[i] = { col, xml: next };
      else cells.push({ col, xml: next });
    }
    cells.sort((a, b) => a.col - b.col);
    return `${head}${cells.map((c) => c.xml).join('')}</row>`;
  };

  const done = new Set<number>();
  const outRows = rows.map((r) => {
    if (!byRow.has(r.n)) return r;
    done.add(r.n);
    return { n: r.n, xml: rewriteRow(r.n, r.xml) };
  });
  for (const n of byRow.keys()) if (!done.has(n)) outRows.push({ n, xml: rewriteRow(n, null) });
  outRows.sort((a, b) => a.n - b.n);

  xml = xml.slice(0, start) + outRows.map((r) => r.xml).join('') + xml.slice(end);

  /*
   * ช่องหลักของสูตรร่วมถูกเขียนทับแล้ว ช่องลูกที่อ้างสูตรนั้น (<f t="shared" si="n"/>) จะไม่มีสูตรให้ใช้
   * Excel จะฟ้องว่าไฟล์เสีย — ตัดสูตรออกเหลือค่าที่คำนวณไว้ (<v>) ซึ่งเป็นค่าที่เห็นอยู่แล้ว
   */
  if (brokenShared.size) {
    xml = xml.replace(CELL, (c) => {
      const f = /<f\b[^>]*\/>|<f\b[^>]*>[\s\S]*?<\/f>/.exec(c);
      if (!f || attr(f[0], 't') !== 'shared' || !brokenShared.has(attr(f[0], 'si') ?? '')) return c;
      return c.replace(f[0], '');
    });
  }
  return { xml, formulaRemoved: formulaRemoved || brokenShared.size > 0 };
}

/** แถวสรุปเก่าที่เกินจำนวนรถจริง (สูตรเผื่อไว้ในไฟล์เดิม) — ไล่ลงไปจนเจอแถวที่ W และ Z ว่าง */
function staleRows(xml: string, from: number): number[] {
  const out: number[] = [];
  const rowMap = new Map<number, string>();
  for (const m of xml.matchAll(ROW)) rowMap.set(Number(attr(m[0], 'r')), m[0]);
  for (let n = from; n < from + 2000; n++) {
    const row = rowMap.get(n);
    const has = (col: string) => {
      const c = row ? new RegExp(`<c\\b[^>]*\\br="${col}${n}"[^>]*?(?:/>|>([\\s\\S]*?)</c>)`).exec(row) : null;
      const v = c?.[1] ? /<v>([^<]*)<\/v>|<t[^>]*>([^<]*)<\/t>/.exec(c[1]) : null;
      const text = (v?.[1] ?? v?.[2] ?? '').trim();
      return Boolean(text) && text !== '0' && !text.startsWith('#');
    };
    if (!has('W') && !has('Z')) break;
    out.push(n);
  }
  return out;
}

/**
 * เขียนตารางสรุปลงไฟล์ — tariffs คือพิกัด 8 หลักของรถแต่ละคัน (ลำดับเดียวกับ inv.cars)
 */
export async function writeSummary(data: Buffer | Uint8Array, inv: CargoInvoice, tariffs: string[]): Promise<Buffer> {
  const zip = await JSZip.loadAsync(data);
  const sheetPath = await firstSheetPath(zip);
  const original = await zip.file(sheetPath)!.async('string');

  const updates = new Map<string, Value>([
    ['P4', inv.pattern], ['P5', inv.invoiceDate], ['P6', inv.invoiceNo], ['P14', inv.blNo],
    ...SUMMARY_COLS.map((c) => [`${c}19`, SUMMARY_HEADER[c]] as [string, Value]),
  ]);
  inv.cars.forEach((car, i) => {
    const cells = carCells(car, `0000${tariffs[i]}`);
    for (const c of SUMMARY_COLS) updates.set(`${c}${FIRST_ROW + i}`, cells[c]);
  });
  for (const n of staleRows(original, FIRST_ROW + inv.cars.length)) {
    for (const c of SUMMARY_COLS) updates.set(`${c}${n}`, null);
  }

  const { xml, formulaRemoved } = writeCells(original, updates);
  zip.file(sheetPath, xml);

  // calcChain ที่ยังอ้างสูตรที่ถูกลบ ทำให้ Excel ฟ้องว่าไฟล์เสีย — ลบทิ้ง Excel สร้างใหม่เองตอนเปิด
  if (formulaRemoved && zip.file('xl/calcChain.xml')) {
    zip.remove('xl/calcChain.xml');
    const relsPath = 'xl/_rels/workbook.xml.rels';
    zip.file(relsPath, (await zip.file(relsPath)!.async('string')).replace(/<Relationship\b[^>]*calcChain[^>]*\/>/g, ''));
    const ct = '[Content_Types].xml';
    zip.file(ct, (await zip.file(ct)!.async('string')).replace(/<Override\b[^>]*\/xl\/calcChain\.xml[^>]*\/>/g, ''));
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
