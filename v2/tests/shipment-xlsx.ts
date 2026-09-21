import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { readSheet, toDrafts } from '../src/lib/shipment-import';
import { readXlsx } from '../src/lib/shipment-xlsx';
import { TEMPLATE_COLUMNS } from '../src/lib/template-columns';

/**
 * ตรวจการอ่านไฟล์ตารางงานที่เป็น Excel
 *
 * สร้างไฟล์ .xlsx จริงด้วย exceljs แล้วอ่านกลับ ไม่ได้ทดสอบกับข้อมูลที่แต่งไว้ในหน่วยความจำ
 * เพราะจุดที่พลาดง่ายอยู่ในชั้นที่ Excel แปลงค่าให้เอง — วันที่ที่กลายเป็น Date object
 * สูตรที่ต้องเอาผลลัพธ์ ไม่ใช่ตัวสูตร และแถวว่างที่ทำให้เลขแถวไม่ตรงกับที่คนเห็น
 *
 * เทียบผลกับตัวอ่าน CSV ด้วย เพราะทั้งสองทางต้องให้งานออกมาเหมือนกันทุกประการ
 * ต่างแค่วิธีแกะช่องออกจากไฟล์
 */

/** แถวจริงจากไฟล์ของผู้ใช้ เรียงตามคอลัมน์ โดยมีเลขลำดับแถวนำหน้าเหมือนของจริง */
const ROWS: Array<Array<string | number>> = [
  [1834, 'AMIN JP', '22/9/26', 'MSFZ - รถยนต์เก่า', 'Y', 'S', '', '', '', 'FUJI STAR', 1,
    'KG1222026-70107(ONEYTYOGF5133300)', 'ONEU5972378', 4, '17,145', 'KNOT GOLBAL',
    'BANGKOK BRIDGE V.0518W', '', 5527, '', 'MSFZ', 'KOLA', 1, '-', '', '', '', ''],
  [1835, 'SALIM', '22/9/26', 'MSFZ - รถยนต์เก่า', 'Y', '', '', '', '', 'ANISA TRADING', 1,
    'KG1222026-69979(ONEYTYOGF5134400)', 'TRHU5857910', 3, '12,920', 'KNOT GOLBAL',
    'BANGKOK BRIDGE V.0518W', '', 5532, '', 'MSFZ', 'KOLA', 1, '-', '', '', '', ''],
];

async function buildXlsx(
  fill: (ws: ExcelJS.Worksheet) => void,
): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  fill(ws);
  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}

/** ไฟล์ที่ไม่มีหัวคอลัมน์ — แบบเดียวกับที่ผู้ใช้ส่งมา */
async function noHeaderTest() {
  const bytes = await buildXlsx((ws) => { for (const r of ROWS) ws.addRow(r); });
  const { rows, hasHeader } = await readXlsx(bytes);

  assert.equal(hasHeader, false);
  assert.equal(rows.length, 2);
  // เลขลำดับแถว 1834 ต้องถูกตัด ไม่ใช่เลื่อนไปเป็น CUSTOMER
  assert.equal(rows[0].cell.CUSTOMER, 'AMIN JP');
  assert.equal(rows[0].cell.SHIPPER, 'FUJI STAR');
  assert.equal(rows[0].cell['BILL OF LADING'], 'KG1222026-70107(ONEYTYOGF5133300)');
  assert.equal(rows[0].cell.WEIGHT, '17,145');
  assert.equal(rows[0].cell.VESSEL, 'BANGKOK BRIDGE V.0518W');
  assert.equal(rows[0].cell['ประเภท'], 'MSFZ - รถยนต์เก่า');
  assert.equal(rows[0].cell.CONSIGNEE, 'MSFZ');

  const { drafts } = toDrafts(rows);
  assert.equal(drafts[0].blNo, 'KG1222026-70107(ONEYTYOGF5133300)');
  assert.equal(drafts[0].waybillNo, 'ONEYTYOGF5133300');
  assert.equal(drafts[0].vessel, 'BANGKOK BRIDGE');
  assert.equal(drafts[0].voyage, '0518W');
  assert.equal(drafts[0].eta, '2026-09-22');
  assert.equal(drafts[0].grossWeight, '17145');
  assert.deepEqual(drafts[0].containers, ['ONEU5972378']);

  console.log('PASS: Excel ที่ไม่มีหัวคอลัมน์ — ตัดเลขลำดับแถวและอ่านค่าได้ครบ');
}

/** ไฟล์ที่มีหัวคอลัมน์ — แบบที่ระบบ export ออกไปแล้วเปิดใน Excel */
async function headerTest() {
  const bytes = await buildXlsx((ws) => {
    ws.addRow([...TEMPLATE_COLUMNS]);
    // ไม่มีเลขลำดับแถวนำหน้า เพราะไฟล์ที่ export ออกไปไม่มีคอลัมน์นั้น
    for (const r of ROWS) ws.addRow(r.slice(1));
  });
  const { rows, hasHeader } = await readXlsx(bytes);

  assert.equal(hasHeader, true);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].cell.SHIPPER, 'FUJI STAR');
  assert.equal(rows[0].cell['BILL OF LADING'], 'KG1222026-70107(ONEYTYOGF5133300)');
  // แถวแรกหลังหัวคอลัมน์คือแถวที่ 2 ใน Excel
  assert.equal(rows[0].lineNo, 2);

  console.log('PASS: Excel ที่มีหัวคอลัมน์ — จับคู่ตามชื่อคอลัมน์');
}

/** ผลจาก Excel กับ CSV ต้องออกมาเหมือนกัน ไม่ใช่ใกล้เคียงกัน */
async function sameAsCsvTest() {
  const bytes = await buildXlsx((ws) => { for (const r of ROWS) ws.addRow(r); });
  const fromXlsx = toDrafts((await readXlsx(bytes)).rows).drafts;

  const csv = ROWS.map((r) => r.map((c) => {
    const s = String(c);
    return /[",\n]/.test(s) ? `"${s}"` : s;
  }).join(',')).join('\n');
  const fromCsv = toDrafts(readSheet(csv).rows).drafts;

  assert.deepEqual(fromXlsx, fromCsv, 'Excel กับ CSV ต้องให้งานเหมือนกันทุกช่อง');
  console.log('PASS: Excel กับ CSV ให้ผลตรงกันทุกช่อง');
}

/**
 * ค่าที่ Excel แปลงรูปให้เอง ซึ่ง CSV ไม่มีปัญหานี้
 * เป็นจุดที่พังเงียบที่สุดถ้าไม่ดัก — ได้ "[object Object]" เข้าฐานข้อมูลไป
 */
async function cellShapeTest() {
  const bytes = await buildXlsx((ws) => {
    const row = ws.addRow([
      1, 'AMIN JP', '', 'MSFZ - รถยนต์เก่า', 'Y', '', '', '', '', 'FUJI STAR', 1,
      'KG1-1', 'ONEU1', 4, '', 'KNOT', 'V V.1', '', '', '', 'MSFZ', 'KOLA', '', '', '', '', '', '',
    ]);
    // ETA เป็น Date object แบบที่ Excel เก็บวันที่จริง
    row.getCell(3).value = new Date(Date.UTC(2026, 8, 22));
    // WEIGHT เป็นสูตร — ต้องได้ผลลัพธ์ ไม่ใช่ตัวสูตร
    row.getCell(15).value = { formula: 'SUM(1000,7145)', result: 8145 } as ExcelJS.CellValue;
    // SHIPPER เป็น rich text ที่จัดรูปแบบคนละสีในช่องเดียว
    row.getCell(10).value = {
      richText: [{ text: 'FUJI ' }, { text: 'STAR' }],
    } as ExcelJS.CellValue;
  });

  const { rows } = await readXlsx(bytes);
  assert.equal(rows[0].cell.ETA, '2026-09-22', 'วันที่ที่ Excel เก็บเป็น Date ต้องอ่านได้');
  assert.equal(rows[0].cell.WEIGHT, '8145', 'สูตรต้องเอาผลลัพธ์ ไม่ใช่ตัวสูตร');
  assert.equal(rows[0].cell.SHIPPER, 'FUJI STAR', 'rich text ต้องต่อกลับเป็นข้อความเดียว');

  const { drafts } = toDrafts(rows);
  assert.equal(drafts[0].eta, '2026-09-22');
  assert.equal(drafts[0].grossWeight, '8145');

  console.log('PASS: ค่าที่ Excel แปลงรูป — วันที่ สูตร และ rich text');
}

/** แถวว่างคั่นกลาง ทำให้เลขแถวที่คนเห็นใน Excel ไม่ตรงกับลำดับที่อ่านมา */
async function blankRowTest() {
  const bytes = await buildXlsx((ws) => {
    ws.addRow(ROWS[0]);
    ws.addRow([]);
    ws.addRow([]);
    ws.addRow(ROWS[1]);
  });
  const { rows } = await readXlsx(bytes);

  assert.equal(rows.length, 2, 'แถวว่างต้องไม่กลายเป็นแถวข้อมูล');
  assert.equal(rows[0].lineNo, 1);
  // แถวที่สองอยู่บรรทัด 4 ใน Excel ไม่ใช่บรรทัด 2
  assert.equal(rows[1].lineNo, 4, 'เลขแถวต้องตรงกับที่ผู้ใช้เห็นใน Excel');
  assert.equal(rows[1].cell.SHIPPER, 'ANISA TRADING');

  console.log('PASS: แถวว่างคั่นกลาง — เลขแถวยังตรงกับที่เห็นใน Excel');
}

/** ไฟล์ที่เปิดไม่ได้ ต้องบอกเหตุผลที่ผู้ใช้ทำอะไรต่อได้ ไม่ใช่ error ดิบของ library */
async function badFileTest() {
  await assert.rejects(
    () => readXlsx(new TextEncoder().encode('ไม่ใช่ไฟล์ Excel').buffer as ArrayBuffer),
    /เปิดไฟล์ Excel ไม่ได้/,
  );
  console.log('PASS: ไฟล์เสีย — ขึ้นข้อความที่อ่านรู้เรื่อง');
}

async function main() {
  await noHeaderTest();
  await headerTest();
  await sameAsCsvTest();
  await cellShapeTest();
  await blankRowTest();
  await badFileTest();
  console.log('\nทั้งหมดผ่าน');
}

main().catch((e) => {
  console.error('ล้มเหลว:', e);
  process.exit(1);
});
