/**
 * แปลง src/lib/DATA_BRAND MODEL CHASSIS.xlsx (ชีต Prefix_Rules) → src/lib/cargo-invoice/chassis-rules.json
 *
 * หน้า Create FN Invoice (NORMAL) ใช้เทียบ BRAND · MODEL กับรหัสหน้า CHASSIS NO. ทันทีที่พิมพ์ (ฝั่งเบราว์เซอร์)
 * จึงเก็บเป็น JSON เล็ก ๆ แทนการเปิด Excel ทุกครั้ง
 *
 * รันเองอัตโนมัติก่อน next build (npm prebuild) — แก้ไฟล์ Excel แล้ว deploy ข้อมูลก็ตามมาเอง
 * รันเอง: npm run chassis:rules
 */
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

const SRC = path.join(process.cwd(), 'src', 'lib', 'DATA_BRAND MODEL CHASSIS.xlsx');
const OUT = path.join(process.cwd(), 'src', 'lib', 'cargo-invoice', 'chassis-rules.json');

/** [รหัส, ชนิด (D = ก่อนขีด · V = 8 ตัวแรกของ VIN), ยี่ห้อทั้งหมด, รุ่นทั้งหมด] */
type Rule = [string, 'D' | 'V', string[], string[]];

const text = (v: ExcelJS.CellValue): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('result' in v) return text(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    return '';
  }
  return String(v);
};
const split = (s: string) => s.split(';').map((x) => x.trim().toUpperCase()).filter(Boolean);

async function main() {
  if (!existsSync(SRC)) {
    console.log(`chassis-rules: ไม่พบ ${path.relative(process.cwd(), SRC)} — ใช้ JSON เดิม`);
    return;
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(SRC);
  const ws = wb.getWorksheet('Prefix_Rules') ?? wb.worksheets[0];
  const rules: Rule[] = [];
  ws.eachRow((row, r) => {
    if (r === 1) return;
    const key = text(row.getCell(1).value).replace(/\s+/g, '').toUpperCase();
    const kind = text(row.getCell(2).value);
    if (!key) return;
    const brands = split(text(row.getCell(4).value) || text(row.getCell(3).value));
    const models = split(text(row.getCell(5).value));
    rules.push([key, /^Prefix/i.test(kind) ? 'D' : 'V', brands, models]);
  });
  if (rules.length < 100) throw new Error(`chassis-rules: อ่านได้แค่ ${rules.length} แถว — ตรวจชีต Prefix_Rules`);
  writeFileSync(OUT, `${JSON.stringify(rules)}\n`);
  console.log(`chassis-rules: ${rules.length} รหัส → ${path.relative(process.cwd(), OUT)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
