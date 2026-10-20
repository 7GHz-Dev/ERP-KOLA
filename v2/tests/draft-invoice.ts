/**
 * อ่าน Final Invoice -> ตรวจ -> CSV -> เติมเลขเครื่องลง Excel  ต้องได้ผลตรงกับโปรแกรม imp (Python) ทุกไบต์
 *
 * tests/fixtures/draft/<ชื่อ>.xlsx           invoice สมมติ (ไม่มีข้อมูลลูกค้า)
 *                      <ชื่อ>.expected.json   ผลของ imp: ผลตรวจ ข้อความเตือน รถทุกคัน ยอดรวม ช่องที่เขียนลง Excel
 *                      <ชื่อ>.csv             CSV ของ imp (TIS-620) เมื่อใช้เลขสุ่มชุด NUMBERS
 * golden files สร้างจาก imp commit 59b4da8 (core/pipeline.py) — ไม่ต้องมี Python ตอนรันเทสต์
 *
 *   npm run test:draft
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { analyze, buildCsv, excelUpdates, lineDict, NEW, type EngineRow } from '../src/lib/draft/analyze';
import { encodeTis620, loadDraftData } from '../src/lib/draft/csv';
import { patchWorkbook } from '../src/lib/draft/excel-patch';
import { readInvoice } from '../src/lib/draft/invoice';
import { colLetters } from '../src/lib/draft/sheet';
import { Dec, fmtNumber } from '../src/lib/draft/values';

const DIR = join(__dirname, 'fixtures', 'draft');
const NUMBERS = Array.from({ length: 50 }, (_, i) => String(4810731 + 7919 * i));
const TODAY = new Date('2026-10-20T12:00:00+07:00');

async function main() {
  /* ---- ค่าเล็ก ๆ ที่ต้องเหมือน Python ---- */
  assert.equal(fmtNumber(Dec.parse('172700.50')!), '172700.5');
  assert.equal(fmtNumber(Dec.parse('1E+3')!), '1000');
  assert.equal(Dec.parse('1140.0')!.toString(), '1140.0');
  assert.equal(encodeTis620('รถ,1').toString('hex'), 'c3b62c31');      // 'รถ,1'.encode('tis-620') ของ Python
  assert.throws(() => encodeTis620('ÖÖ'), /ตัวอักษร 'ÖÖ' บรรทัด 1 เข้ารหัส tis-620 ไม่ได้/);

  const data = await loadDraftData();
  assert.equal(data.csv.columns.length, 54);
  assert.ok(data.tariff.length > 700 && Object.keys(data.brandCountry).length > 10);

  const names = readdirSync(DIR).filter((f) => f.endsWith('.expected.json')).map((f) => f.replace('.expected.json', ''));
  assert.ok(names.length >= 8, 'ต้องมี golden files');
  for (const name of names) {
    const exp = JSON.parse(readFileSync(join(DIR, `${name}.expected.json`), 'utf8'));
    const rows = exp.rows as EngineRow[];
    const db = {
      find: (n: string) => rows.filter((r) => r.number === n),
      history: (c: string) => rows.filter((r) => r.chassis === c).sort((a, b) => b.date.localeCompare(a.date)),
    };
    const buf = readFileSync(join(DIR, `${name}.xlsx`));
    const inv = await readInvoice(buf);
    const a = analyze(inv, data, db, { reuseBl: exp.reuse_bl, today: TODAY });
    const got = {
      ok: a.ok, file_type: inv.file_type, invoice_no: inv.invoice_no, invoice_date: inv.invoice_date, bl_no: inv.bl_no,
      errors: a.errors, warnings: a.warnings, cars: a.lines.map(lineDict), new_count: a.new_count,
    };
    for (const k of Object.keys(got) as (keyof typeof got)[]) assert.deepEqual(got[k], exp[k], `${name}: ${k}`);
    if (!a.ok) { console.log(`✓ ${name} (ผลตรวจตรง · ${a.errors.length} ข้อผิดพลาด)`); continue; }

    let i = 0;
    for (const line of a.lines) {
      if (line.status !== NEW) continue;
      line.number = NUMBERS[i++];
      line.full_engine = `${line.engine.head}-${line.number}`;
    }
    const csv = buildCsv(a, data);
    assert.ok(existsSync(join(DIR, `${name}.csv`)));
    assert.ok(csv.bytes.equals(readFileSync(join(DIR, `${name}.csv`))), `${name}: CSV ต้องตรงทุกไบต์`);
    assert.deepEqual(csv.totals, exp.totals, `${name}: ยอดรวม`);
    assert.deepEqual(a.lines.map(lineDict), exp.cars_after, `${name}: รถหลังออกเลข`);
    const up = excelUpdates(a);
    assert.deepEqual(up.values.map((u) => [u.row, u.col, u.value]), exp.updates, `${name}: ช่องเลขเครื่อง`);

    // ไฟล์ Excel ที่เขียนแล้ว: ช่องเลขเครื่องได้ค่าใหม่ ช่องอื่นเหมือนเดิม
    const out = await patchWorkbook(buf, up.values, up.cached);
    const [before, after] = [new ExcelJS.Workbook(), new ExcelJS.Workbook()];
    await before.xlsx.load(buf as unknown as ArrayBuffer);
    await after.xlsx.load(out as unknown as ArrayBuffer);
    const want = new Map(up.values.map((u) => [`${colLetters(u.col)}${u.row}`, u.value]));
    before.worksheets[0].eachRow((row) => row.eachCell((cell) => {
      const now = after.worksheets[0].getCell(cell.address).value;
      if (want.has(cell.address)) assert.equal(now, want.get(cell.address), `${name}: ${cell.address}`);
      else assert.deepEqual(now, cell.value, `${name}: ${cell.address} ต้องไม่เปลี่ยน`);
    }));
    assert.equal(after.worksheets.length, before.worksheets.length);
    console.log(`✓ ${name} (CSV ตรงทุกไบต์ · ${a.lines.length} คัน · เลขใหม่ ${a.new_count})`);
  }
  console.log('ผ่านทั้งหมด');
}

main().catch((e) => { console.error(e); process.exit(1); });
