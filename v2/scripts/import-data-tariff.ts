/**
 * อัปเดตตารางพิกัดหลัก assets/netbay/DATA TARIFF.xlsx จากชีต datatariff ในไฟล์ Invoice ล่าสุด
 *
 * ทีมแก้ตารางพิกัดในชีต datatariff ของไฟล์ imp3_ มาตลอด ตัวในโฟลเดอร์ assets จึงเก่ากว่า
 * (เดิม 768 กฎ น้ำหนักสูงสุด 9,999 — รถหนักเกินนั้นหาพิกัดไม่เจอ)
 * ใช้ตารางนี้ทั้งหน้า Create Cargo Invoice และ worker สร้าง Draft (เมื่อไฟล์ไม่มีชีต datatariff)
 *
 *   npm run tariff:import -- "test/INVOICE/imp3_xxx.xlsx"
 *
 * เขียนเฉพาะคอลัมน์ที่โปรแกรมใช้ (A:I) — หัวตารางแถว 2 ข้อมูลเริ่มแถว 3 ตามรูปแบบเดิม
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { loadWorkbook, sheetReader } from '../src/lib/draft/sheet';
import { loadTariffRows } from '../src/lib/draft/invoice';

const HEAD = ['trf_num', 'trf_code', 'trf_brand', 'trf_model', 'trf_fuel', 'trf_cc_start', 'trf_cc_end', 'trf_w_start', 'trf_w_end'];

async function main() {
  const src = process.argv[2];
  if (!src) throw new Error('ระบุไฟล์ Excel ที่มีชีต datatariff เช่น npm run tariff:import -- "test/INVOICE/imp3_xxx.xlsx"');
  const wb = await loadWorkbook(readFileSync(src));
  const sheet = wb.getWorksheet('datatariff');
  if (!sheet) throw new Error(`ไฟล์ ${src} ไม่มีชีต datatariff`);
  const ws = sheetReader(wb, sheet);

  const out = new ExcelJS.Workbook();
  const dst = out.addWorksheet('datatariff');
  dst.getRow(2).values = HEAD;
  let n = 0;
  for (let r = 3; r <= ws.maxRow; r++) {
    const v = Array.from({ length: 9 }, (_, i) => ws.value(r, i + 1));
    if (v.every((x) => x === null || x === '')) continue;
    dst.getRow(3 + n).values = v.map((x) => (typeof x === 'string' ? x : typeof x === 'number' ? x : x === null ? null : String(x)));
    n += 1;
  }
  const target = join(process.cwd(), 'assets', 'netbay', 'DATA TARIFF.xlsx');
  await out.xlsx.writeFile(target);

  // อ่านกลับด้วยตัวอ่านเดียวกับที่ระบบใช้ ให้แน่ใจว่าใช้ได้จริง
  const check = await loadWorkbook(readFileSync(target));
  const rules = loadTariffRows(sheetReader(check, check.worksheets[0]));
  console.log(`เขียน ${n} แถว → ${target}\nอ่านกลับได้ ${rules.length} กฎ (แถวที่ช่วง CC/น้ำหนักไม่ครบถูกข้าม เหมือนเดิม)`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
