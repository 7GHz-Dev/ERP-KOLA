/**
 * Create Cargo Invoice — อ่าน Invoice 3 รูปแบบ · พิกัด · เขียนตารางสรุปกลับให้ worker อ่านได้
 *   npm run test:cargo-invoice
 *
 * ไฟล์ตัวอย่างอยู่ที่ test/INVOICE (ไฟล์ imp3_ ที่ทีมผูกสูตรไว้ + CSV ที่ worker สร้างจริง)
 *   1. ค่าที่อ่านจากส่วน invoice ของผู้ขาย = ค่าที่สูตร VLOOKUP ในไฟล์คำนวณไว้ (ตารางสรุป P:AF)
 *   2. พิกัดที่หาได้ = พิกัดใน CSV จริง (รถที่ CSV เป็น XXXX ต้องขึ้นว่า "ไม่พบ" ให้คนเพิ่ม)
 *   3. เขียนตารางสรุปแล้ว ตัวอ่านของ worker (readInvoice) อ่านได้ครบ และพิกัดที่เลือกถูกใช้ตรง ๆ
 *   4. ไฟล์ดิบจากผู้ขาย (ไม่มีตารางสรุปเลย) ก็เขียนและอ่านกลับได้
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { parseCargoInvoice, invoiceDate, splitEngineType } from '../src/lib/cargo-invoice/parse';
import { baseRules, lookup } from '../src/lib/cargo-invoice/tariff';
import { writeSummary } from '../src/lib/cargo-invoice/write';
import { readInvoice } from '../src/lib/draft/invoice';
import { lookupTariff } from '../src/lib/draft/csv';
import { loadWorkbook, sheetReader } from '../src/lib/draft/sheet';
import { clean } from '../src/lib/draft/values';

const DIR = 'test/INVOICE/';
const SAMPLES = [
  { xlsx: 'imp3_NSSLKNILC26Q0230.xlsx', csv: 'NSSLKNILC26Q0230.csv', pattern: 'MSFZ', cars: 12, invoice: 'FUKUOKA260230', date: '17/09/2026', bl: 'NSSLKNILC26Q0230', boxes: 2 },
  { xlsx: 'imp3_OOLU2340232290.xlsx', csv: 'OOLU2340232290.csv', pattern: 'AICHI', cars: 24, invoice: 'AICHI 348', date: '06/10/2026', bl: 'OOLU2340232290', boxes: 5 },
  { xlsx: 'imp3_EGLV022600137459.xlsx', csv: 'EGLV022600137459.csv', pattern: 'JAN TRADING', cars: 20, invoice: 'Y.THA098/26EV', date: '09/09/2026', bl: 'EGLV022600137459', boxes: 5 },
];

/** CSV ของ NETBAY (TIS-620) → เลขตัวถัง -> พิกัด */
function csvTariffs(file: string) {
  const lines = readFileSync(DIR + file, 'latin1').split(/\r?\n/).slice(2).filter(Boolean);
  return new Map(lines.map((l) => {
    const f = l.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((x) => x.replace(/,$/, '').replace(/^"|"$/g, ''));
    return [f[32], f[19]] as [string, string];
  }));
}

const norm = (s: unknown) => clean(s as never).replace(/ ,/g, ',');

async function main() {
  assert.equal(invoiceDate('DATE  Sep, 09, 2026'), '09/09/2026');
  assert.equal(invoiceDate('DATE : 06/10/2026'), '06/10/2026');
  assert.equal(invoiceDate('2026-10-08'), '08/10/2026');
  assert.deepEqual(splitEngineType('LDA-1571303(GASOLINE/1330)'), { engine: 'LDA-1571303', fuel: 'GASOLINE', cc: 1330 });

  const rules = await baseRules();
  assert.ok(rules.length >= 852, `ตารางพิกัดหลักต้องเป็นชุดใหม่ (852 กฎ) ได้ ${rules.length}`);

  for (const s of SAMPLES) {
    const buf = readFileSync(DIR + s.xlsx);
    const inv = await parseCargoInvoice(buf);
    assert.deepEqual(inv.errors, [], `${s.xlsx}: ${inv.errors.join(' / ')}`);
    assert.deepEqual(inv.warnings, [], `${s.xlsx}: ${inv.warnings.join(' / ')}`);
    assert.equal(inv.pattern, s.pattern);
    assert.equal(inv.invoiceNo, s.invoice);
    assert.equal(inv.invoiceDate, s.date);
    assert.equal(inv.blNo, s.bl);
    assert.equal(inv.cars.length, s.cars);
    assert.equal(inv.containers.length, s.boxes);
    assert.ok(inv.cars.every((c) => !c.problems.length), `${s.xlsx}: มีรถที่อ่านไม่ครบ`);

    // 1. เทียบกับตารางสรุปที่สูตรในไฟล์คำนวณไว้
    const wb = await loadWorkbook(buf);
    const ws = sheetReader(wb, wb.worksheets[0]);
    inv.cars.forEach((car, i) => {
      const r = 20 + i;
      const want = {
        desc1: norm(ws.at(`P${r}`)), desc2: norm(ws.at(`Q${r}`)), chassis: clean(ws.at(`Z${r}`)),
        brand: clean(ws.at(`X${r}`)), model: clean(ws.at(`Y${r}`)), weight: Number(clean(ws.at(`AA${r}`))),
        year: Number(clean(ws.at(`AB${r}`))), cc: Number(clean(ws.at(`AC${r}`))), fuel: clean(ws.at(`AD${r}`)),
        price: Number(clean(ws.at(`AE${r}`))), container: clean(ws.at(`AG${r}`)),
      };
      const got = {
        desc1: norm(car.desc1), desc2: norm(car.desc2), chassis: car.chassis, brand: car.brand, model: car.model,
        weight: car.weight, year: car.year, cc: car.cc, fuel: car.fuel, price: car.price, container: car.container,
      };
      assert.deepEqual(got, want, `${s.xlsx} คันที่ ${car.no}`);
    });

    // 2. พิกัดเทียบกับ CSV ที่ใช้จริง
    const expected = csvTariffs(s.csv);
    const tariffs: string[] = [];
    for (const car of inv.cars) {
      const res = lookup(rules, car);
      const exp = expected.get(car.chassis);
      if (exp === 'XXXX') assert.equal(res.status, 'missing', `${s.xlsx} ${car.chassis} ควรไม่พบพิกัด`);
      else if (exp) assert.equal(`0000${res.code}`, exp, `${s.xlsx} ${car.chassis}`);
      // รถที่ยังไม่มีพิกัด ใส่พิกัดสมมุติไว้ทดสอบการเขียน
      tariffs.push(res.code || '87032290');
    }

    // 3. เขียนตารางสรุป แล้วให้ตัวอ่านของ worker อ่าน
    const written = await writeSummary(buf, inv, tariffs);
    const back = await readInvoice(written);
    assert.deepEqual(back.errors, [], `${s.xlsx} อ่านกลับ: ${back.errors.join(' / ')}`);
    assert.equal(back.file_type, s.pattern);
    assert.equal(back.invoice_no, s.invoice);
    assert.equal(back.bl_no, s.bl);
    assert.equal(back.cars.length, s.cars);
    back.cars.forEach((c, i) => {
      assert.equal(c.chassis, inv.cars[i].chassis);
      assert.equal(c.tariff_cell, `0000${tariffs[i]}`);
      assert.deepEqual(lookupTariff([], c), [`0000${tariffs[i]}`, ''], 'worker ใช้พิกัดที่เลือกไว้ตรง ๆ');
    });

    // 4. ไฟล์ดิบ: ตัดคอลัมน์ O:AI ทิ้งทั้งหมด (ไม่มีตารางสรุป ไม่มีสูตร) แล้วทำซ้ำ
    const zip = await JSZip.loadAsync(buf);
    const path = Object.keys(zip.files).find((p) => /xl\/worksheets\/sheet1\.xml$/.test(p))!;
    const stripped = (await zip.file(path)!.async('string'))
      .replace(/<c\b[^>]*\br="(O|P|Q|R|S|T|U|V|W|X|Y|Z|A[A-I])\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, '');
    zip.file(path, stripped);
    if (zip.file('xl/calcChain.xml')) zip.remove('xl/calcChain.xml');
    const raw = await zip.generateAsync({ type: 'nodebuffer' });
    const rawInv = await parseCargoInvoice(raw);
    // MSFZ เอาเรือ/สายเรือมาจากสูตร VLOOKUP ในคอลัมน์ M (ไม่ได้ตัด) จึงยังอ่านได้ — ส่วนอื่นต้องเหมือนเดิม
    assert.equal(rawInv.cars.length, s.cars, `${s.xlsx} ไฟล์ดิบ`);
    const rawBack = await readInvoice(await writeSummary(raw, rawInv, tariffs));
    assert.deepEqual(rawBack.errors, [], `${s.xlsx} ไฟล์ดิบอ่านกลับ: ${rawBack.errors.join(' / ')}`);
    assert.equal(rawBack.cars.length, s.cars);
    assert.equal(rawBack.cars[s.cars - 1].tariff_cell, `0000${tariffs[s.cars - 1]}`);
    console.log(`✓ ${s.pattern}: ${s.cars} คัน · ตรงกับสูตรเดิม · พิกัดตรง CSV · เขียน/อ่านกลับได้ (ทั้งไฟล์ผูกสูตรและไฟล์ดิบ)`);
  }
}

main().then(() => console.log('ผ่านทั้งหมด')).catch((e) => { console.error(e); process.exit(1); });
