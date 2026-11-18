/**
 * Create Cargo Invoice — อ่าน Invoice ของผู้ขาย · พิกัด · เขียนตารางสรุป · worker สร้าง Draft ต่อได้
 *   npm run test:cargo-invoice
 *
 * ไฟล์ตัวอย่างอยู่ที่ test/INVOICE (ไฟล์ดิบจากผู้ขาย ไม่มีตารางสรุป)
 *   AICHI        แยกตู้ละชีต ("1", "2.") แต่ละชีตมี TOTAL ของตัวเอง · ENGINE TYPE "KF(GASOLINE/650 CC)" · ราคามี ¥
 *   JAN TRADING  ชีตเดียว 4 ตู้ · ENGINE NO. "4GR (GASOLINE/2490 CC)" · มีแถวสี/เลขอ้างอิง · ค่า Forwarding บวกใน TOTAL
 *   ทั้งสองใบช่อง B/L NO. ว่าง (ออก invoice ก่อนได้เลข BL)
 *
 *   1. อ่านรถครบ ค่าถูก ยอดรวมตรงแถว TOTAL
 *   2. พิกัดหาได้ (รุ่น HYBRID ใช้เชื้อเพลิง GASOLINE ตามตาราง)
 *   3. เขียนตารางสรุปแล้ว ตัวอ่านของ worker เห็นรถและช่องเลขเครื่องครบ (ข้ามชีต) และใช้พิกัดที่เลือกตรง ๆ
 *   4. worker ตรวจผ่าน แล้วเติมเลขเครื่องกลับลงช่องที่ถูกชีต
 *   5. JAN TRADING จัดหน้า Final Invoice: BL ของงาน · เลขเครื่อง LDA-1234567(GASOLINE/1330) · ตัดแถว COLOR / ค่าใช้จ่ายอื่น
 *      แล้ว worker เห็นเลขเครื่องครบ (ใช้เลขเดิม ไม่สุ่มซ้ำ) และแปลง PDF ได้
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { engineDesc, invoiceDate, normalizeFuel, parseCargoInvoice, splitEngineType } from '../src/lib/cargo-invoice/parse';
import { baseRules, lookup } from '../src/lib/cargo-invoice/tariff';
import { writeSummary } from '../src/lib/cargo-invoice/write';
import ExcelJS from 'exceljs';
import { enginePrefix, existingEngineNumber, finalEngineText } from '../src/lib/cargo-invoice/engine-format';
import { finalizeJanTrading } from '../src/lib/cargo-invoice/jan-trading';
import { analyze, excelUpdates, NEW, REUSE } from '../src/lib/draft/analyze';
import { xlsxToPdf } from '../src/lib/xlsx-pdf';
import { loadDraftData, lookupTariff } from '../src/lib/draft/csv';
import { patchWorkbook } from '../src/lib/draft/excel-patch';
import { readInvoice } from '../src/lib/draft/invoice';
import { loadWorkbook, sheetReader } from '../src/lib/draft/sheet';
import { clean } from '../src/lib/draft/values';

const DIR = 'test/INVOICE/';
const TODAY = new Date('2026-11-09T12:00:00+07:00');

type Spot = { no: number; sheet: string; container: string; brand: string; model: string; chassis: string;
  engine: string; fuel: string; cc: number; year: number; weight: number; price: number; desc2: string };

const SAMPLES: Array<{
  xlsx: string; pattern: string; invoice: string; date: string; booking: string; vessel: string;
  sheets: string[]; boxes: string[]; cars: number; stated: { units: number; weight: number; amount: number };
  charges: Array<{ amount: number; inTotal: boolean }>; spots: Spot[];
}> = [
  {
    xlsx: 'example AICHI cargo invoice.xlsx', pattern: 'AICHI', invoice: 'AICHI 323', date: '22/10/2026',
    booking: '2340232300', vessel: 'IRENES RESPECT V.007S', sheets: ['1', '2.'], boxes: ['WBPU7029762', 'CSNU7016204'],
    cars: 9, stated: { units: 9, weight: 11030, amount: 2758335 }, charges: [],
    spots: [
      { no: 1, sheet: '1', container: 'WBPU7029762', brand: 'DAIHATSU', model: 'HIJET', chassis: 'S500P-0014861', engine: 'KF',
        fuel: 'GASOLINE', cc: 650, year: 2015, weight: 960, price: 299810, desc2: 'KF(GASOLINE/650),2015' },
      { no: 3, sheet: '1', container: 'WBPU7029762', brand: 'HONDA', model: 'VEZEL HYBRID', chassis: 'RU3-1202192', engine: 'LEB-H1',
        fuel: 'GASOLINE', cc: 1490, year: 2016, weight: 1310, price: 513450, desc2: 'LEB-H1(GASOLINE/1490),2016' },
      { no: 9, sheet: '2.', container: 'CSNU7016204', brand: 'NISSAN', model: 'X-TRAIL', chassis: 'NT32-045681', engine: 'MR20',
        fuel: 'GASOLINE', cc: 1990, year: 2016, weight: 1510, price: 451025, desc2: 'MR20(GASOLINE/1990),2016' },
    ],
  },
  {
    xlsx: 'example JAN TRADING cargo invoice.xlsx', pattern: 'JAN TRADING', invoice: 'K.THA100/26EV', date: '28/09/2026',
    booking: '022600156399', vessel: 'EVER BOOMY VOY. 1214-094A', sheets: ['buyers_invoice'],
    boxes: ['EGHU9400438', 'EMCU1757742', 'EGSU1212741', 'SKIU9092730'],
    cars: 17, stated: { units: 17, weight: 23550, amount: 4450500 },
    charges: [{ amount: 300000, inTotal: true }, { amount: 482968, inTotal: false }],
    spots: [
      { no: 1, sheet: 'buyers_invoice', container: 'EGHU9400438', brand: 'TOYOTA', model: 'MARK X', chassis: 'GRX130-6057080', engine: '4GR',
        fuel: 'GASOLINE', cc: 2490, year: 2012, weight: 1520, price: 183000, desc2: '4GR(GASOLINE/2490),2012' },
      { no: 2, sheet: 'buyers_invoice', container: 'EGHU9400438', brand: 'HONDA', model: 'FIT HYBRID', chassis: 'GP5-1001942', engine: 'LEB-H1',
        fuel: 'GASOLINE', cc: 1490, year: 2013, weight: 1140, price: 135000, desc2: 'LEB-H1(GASOLINE/1490),2013' },
      { no: 15, sheet: 'buyers_invoice', container: 'SKIU9092730', brand: 'MAZDA', model: 'CX-5', chassis: 'KE2FW-106013', engine: 'SH',
        fuel: 'DIESEL', cc: 2180, year: 2012, weight: 1510, price: 149000, desc2: 'SH(DIESEL/2180),2012' },
      { no: 17, sheet: 'buyers_invoice', container: 'SKIU9092730', brand: 'TOYOTA', model: 'TOYOACE', chassis: 'YY201-0003979', engine: '3Y',
        fuel: 'GASOLINE', cc: 1990, year: 1996, weight: 2160, price: 40000, desc2: '3Y(GASOLINE/1990),1996' },
    ],
  },
];

async function main() {
  /* ---- ค่าเล็ก ๆ ---- */
  assert.equal(invoiceDate('DATE  Sep, 28, 2026'), '28/09/2026');
  assert.equal(invoiceDate('DATE : 22/10/2026'), '22/10/2026');
  assert.equal(invoiceDate('2026-10-08'), '08/10/2026');
  assert.deepEqual(splitEngineType('LDA-1571303(GASOLINE/1330)'), { engine: 'LDA-1571303', fuel: 'GASOLINE', cc: 1330 });
  assert.deepEqual(splitEngineType('KF(GASOLINE/650 CC)'), { engine: 'KF', fuel: 'GASOLINE', cc: 650 });
  assert.deepEqual(splitEngineType('4GR (GASOLINE/2490 CC)'), { engine: '4GR', fuel: 'GASOLINE', cc: 2490 });
  assert.deepEqual(splitEngineType('LEB-H1 (HYBRID-GASOLINE/1490 CC)'), { engine: 'LEB-H1', fuel: 'GASOLINE', cc: 1490 });
  assert.equal(normalizeFuel('HYBRID-DIESEL'), 'DIESEL');
  assert.equal(normalizeFuel('petrol'), 'PETROL');
  assert.equal(engineDesc('4GR', 'GASOLINE', 2490, 2012), '4GR(GASOLINE/2490),2012');

  const rules = await baseRules();
  assert.ok(rules.length >= 852, `ตารางพิกัดหลักต้องเป็นชุดใหม่ (852 กฎ) ได้ ${rules.length}`);
  const data = await loadDraftData();
  const emptyDb = { find: () => [], history: () => [] };

  for (const s of SAMPLES) {
    const buf = readFileSync(DIR + s.xlsx);

    /* 1. อ่านใบ */
    const inv = await parseCargoInvoice(buf);
    assert.deepEqual(inv.errors, [], `${s.xlsx}: ${inv.errors.join(' / ')}`);
    assert.equal(inv.warnings.length, 1, `${s.xlsx}: เตือนได้เรื่องเดียวคือ BL ว่าง — ได้ ${inv.warnings.join(' / ')}`);
    assert.match(inv.warnings[0], /B\/L NO\. ในใบว่าง/);
    assert.equal(inv.blNo, '');
    assert.equal(inv.pattern, s.pattern);
    assert.equal(inv.invoiceNo, s.invoice);
    assert.equal(inv.invoiceDate, s.date);
    assert.equal(inv.bookingNo, s.booking);
    assert.equal(inv.vessel, s.vessel);
    assert.deepEqual(inv.sheets, s.sheets);
    assert.deepEqual(inv.containers, s.boxes);
    assert.equal(inv.cars.length, s.cars);
    assert.deepEqual(inv.stated, s.stated);
    assert.deepEqual(inv.charges.map(({ amount, inTotal }) => ({ amount, inTotal })), s.charges);
    assert.ok(inv.cars.every((c) => !c.problems.length), `${s.xlsx}: ${inv.cars.filter((c) => c.problems.length).map((c) => `#${c.no} ${c.problems}`)}`);
    assert.deepEqual(inv.cars.map((c) => c.no), inv.cars.map((_, i) => i + 1), 'ลำดับรถต่อเนื่องข้ามชีต');
    for (const want of s.spots) {
      const car = inv.cars[want.no - 1];
      const got = Object.fromEntries(Object.keys(want).map((k) => [k, car[k as keyof typeof car]]));
      assert.deepEqual(got, want, `${s.xlsx} คันที่ ${want.no}`);
    }
    for (const box of s.boxes) assert.ok(inv.cars.some((c) => c.container === box), `${s.xlsx}: ตู้ ${box} ต้องมีรถ`);

    /* 2. พิกัด — รุ่นที่ยังไม่มีในตารางหลัก คนเพิ่มจากหน้าเว็บ (ทดสอบใส่พิกัดสมมุติไว้เขียนไฟล์) */
    const missing: string[] = [];
    const tariffs = inv.cars.map((car) => {
      const res = lookup(rules, car);
      if (res.status === 'missing') missing.push(`${car.brand} ${car.model} ${car.cc}`);
      return res.code || res.candidates[0]?.code || '87032290';
    });
    assert.ok(missing.length < inv.cars.length / 3, `${s.xlsx}: หาพิกัดไม่เจอเยอะผิดปกติ ${missing.join(', ')}`);
    const fit = inv.cars.find((c) => c.model === 'FIT HYBRID');
    if (fit) assert.equal(lookup(rules, fit).code, '87036092', 'HYBRID-GASOLINE ต้องหาเป็น GASOLINE แล้วได้พิกัดไฮบริด');

    /* 3. เขียนตารางสรุป (BL ใช้ของงานที่เลือก — save route ใส่ให้) แล้วให้ตัวอ่านของ worker อ่าน */
    const blNo = `TEST${s.pattern.replace(/\s/g, '')}01`;
    const written = await writeSummary(buf, { ...inv, blNo }, tariffs);
    const back = await readInvoice(written);
    assert.deepEqual(back.errors, [], `${s.xlsx} อ่านกลับ: ${back.errors.join(' / ')}`);
    assert.equal(back.file_type, s.pattern);
    assert.equal(back.invoice_no, s.invoice);
    assert.equal(back.bl_no, blNo);
    assert.equal(back.cars.length, s.cars);
    assert.equal(back.engines.length, s.cars, `${s.xlsx}: ช่องเลขเครื่องต้องครบทุกคัน (ทุกชีต)`);
    assert.deepEqual([...new Set(back.engines.map((e) => e.sheet))], s.sheets);
    back.cars.forEach((c, i) => {
      assert.equal(c.chassis, inv.cars[i].chassis);
      assert.equal(back.engines[i].chassis, inv.cars[i].chassis);
      assert.equal(c.tariff_cell, `0000${tariffs[i]}`);
      assert.deepEqual(lookupTariff([], c), [`0000${tariffs[i]}`, ''], 'worker ใช้พิกัดที่เลือกไว้ตรง ๆ');
    });

    /* 4. worker ตรวจผ่าน แล้วเติมเลขเครื่องลงช่องในชีตที่ถูกต้อง */
    const a = analyze(back, data, emptyDb, { today: TODAY });
    assert.deepEqual(a.errors, [], `${s.xlsx} worker: ${a.errors.join(' / ')}`);
    assert.ok(a.ok);
    a.lines.forEach((line, i) => {
      assert.equal(line.status, NEW);
      line.number = String(4810731 + i);
      line.full_engine = `${line.engine.head}-${line.number}`;
    });
    const up = excelUpdates(a);
    const patched = await patchWorkbook(written, up.values, up.cached);
    const wb = await loadWorkbook(patched);
    for (const [i, line] of a.lines.entries()) {
      const ws = sheetReader(wb, wb.getWorksheet(line.engine.sheet)!);
      const cell = clean(ws.value(line.engine.row, line.engine.col));
      assert.ok(cell.startsWith(`${line.engine.head}-${4810731 + i}`), `${s.xlsx} ชีต ${line.engine.sheet} แถว ${line.engine.row}: ${cell}`);
    }
    const again = await readInvoice(patched);
    assert.equal(again.engines.filter((e) => e.existing).length, s.cars, 'อ่านไฟล์ที่เติมเลขแล้วซ้ำ เห็นเลขครบทุกคัน');

    console.log(`✓ ${s.pattern}: ${s.cars} คัน ${s.boxes.length} ตู้ ${s.sheets.length} ชีต · ยอดตรง TOTAL · worker เติมเลขเครื่องถูกชีต` +
      (missing.length ? ` · ยังไม่มีพิกัด: ${missing.join(', ')}` : ' · พิกัดครบ'));
  }
}

/** 5. Final Invoice แบบ JAN TRADING — ทำแบบเดียวกับ save route (เลขเครื่องสมมติแทนการออกเลขจากฐานข้อมูล) */
async function janFinal() {
  assert.equal(enginePrefix('LDA-MF6'), 'LDA');
  assert.equal(enginePrefix('4GR'), '4GR');
  assert.equal(enginePrefix('LDA-1585235'), 'LDA');
  assert.equal(existingEngineNumber('LDA-1585235'), '1585235');
  assert.equal(existingEngineNumber('LDA-MF6'), null);
  assert.equal(finalEngineText({ engine: 'LDA-MF6', fuel: 'GASOLINE', cc: 1330 }, '1585235'), 'LDA-1585235(GASOLINE/1330)');
  assert.equal(finalEngineText({ engine: 'KF', fuel: 'GASOLINE', cc: 650 }), 'KF-xxxxxxx(GASOLINE/650)');

  const src = readFileSync(`${DIR}example JAN TRADING cargo invoice Original.xlsx`);
  const inv = await parseCargoInvoice(src);
  assert.equal(inv.pattern, 'JAN TRADING');
  assert.equal(inv.cars.length, 17);
  const blNo = 'EGLV022600156399';
  const numbers = inv.cars.map((_, i) => String(1585235 + i));
  const total = inv.cars.reduce((t, c) => t + (c.price ?? 0), 0);
  assert.equal(total, 4150500, 'ราคารถรวม (ไม่รวม Forwarding 300,000)');
  const cars = inv.cars.map((c, i) => {
    const engine = `${enginePrefix(c.engine)}-${numbers[i]}`;
    return { ...c, engine, desc2: engineDesc(engine, c.fuel, c.cc, c.year) };
  });
  const laid = await finalizeJanTrading(src, { blNo, engines: cars.map((c, i) => finalEngineText(inv.cars[i], numbers[i])), total });
  const out = await writeSummary(laid, { ...inv, blNo, cars }, cars.map(() => '87032290'));

  /* หน้าใบ */
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(out as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  const text = (r: number, c: number) => {
    const v = ws.getCell(r, c).value as unknown;
    return v === null || v === undefined ? '' : String(typeof v === 'object' ? (v as { result?: unknown }).result ?? '' : v).trim();
  };
  const all: string[] = [];
  for (let r = 1; r <= ws.rowCount; r++) for (let c = 1; c <= 7; c++) all.push(text(r, c));
  assert.ok(!all.some((t) => /^COLOU?R$/i.test(t)), 'ไม่มีแถว COLOR');
  assert.ok(!all.some((t) => /\/ \d{2}-\d{2}-\d{4}$/.test(t)), 'ไม่มีแถวเลขอ้างอิงใต้ COLOR');
  assert.ok(!all.some((t) => /Forwarding|FREIGHT|PER CONTAINER|Other Charges/i.test(t)), 'ไม่มีแถวค่าใช้จ่ายอื่น');
  assert.equal(text(12, 4), `B/L NO ${blNo}`);
  // คันแรก: 4 แถว ผสาน A B E F G
  assert.deepEqual([18, 19, 20, 21].map((r) => text(r, 3)), ['USED TOYOTA', 'CHASSIS NO.', 'ENGINE NO.', 'REG YEAR']);
  assert.equal(text(20, 4), '4GR-1585235(GASOLINE/2490)');
  for (const col of ['A', 'B', 'E', 'F', 'G']) assert.ok(ws.getCell(`${col}21`).isMerged, `${col}18:${col}21 ต้องผสาน`);
  // HONDA FIT SHUTTLE HYBRID: LDA-MF6 (HYBRID-GASOLINE/1330 CC) → LDA-…(GASOLINE/1330)
  const fit = inv.cars.findIndex((c) => c.engine === 'LDA-MF6');
  const engines = all.filter((t, i) => i % 7 === 3 && all[i - 1] === 'ENGINE NO.');
  assert.equal(engines.length, 17);
  assert.equal(engines[fit], `LDA-${numbers[fit]}(GASOLINE/1330)`);
  assert.ok(engines.every((e) => /^[A-Z0-9]+-\d{7}\([A-Z]+\/\d+\)$/.test(e)), engines.join(' '));
  assert.equal(ws.pageSetup.printArea, 'A1:G97');

  /* อ่านกลับ: ยอดตรง ไม่มีค่าใช้จ่ายค้าง */
  const back = await parseCargoInvoice(out);
  assert.deepEqual([back.errors, back.warnings, back.charges], [[], [], []]);
  assert.deepEqual(back.stated, { units: 17, weight: 23550, amount: 4150500 });
  assert.equal(back.blNo, blNo);

  /* worker: เห็นเลขเครื่องครบ — ฐานข้อมูลมีเลขของตัวถังเดิม (save route บันทึกไว้) จึงใช้เลขเดิมทุกคัน */
  const draft = await readInvoice(out);
  assert.deepEqual(draft.errors, []);
  assert.equal(draft.bl_no, blNo);
  assert.equal(draft.engines.filter((e) => e.existing).length, 17);
  const rows = inv.cars.map((c, i) => ({ number: numbers[i], full: `${enginePrefix(c.engine)}-${numbers[i]}`, chassis: c.chassis, date: '', bl: blNo }));
  const db = { find: (n: string) => rows.filter((r) => r.number === n), history: (c: string) => rows.filter((r) => r.chassis === c) };
  const data = await loadDraftData();
  const a = analyze(draft, data, db, { today: TODAY });
  assert.deepEqual(a.errors, []);
  assert.ok(a.lines.every((l) => l.status === REUSE), 'worker ไม่สุ่มเลขใหม่');
  assert.ok(a.lines[0].car.desc2.startsWith('4GR-1585235(GASOLINE/2490)'), a.lines[0].car.desc2);

  const pdf = await xlsxToPdf(out);
  assert.ok(pdf && pdf.length > 1000, 'แปลง PDF ได้');
  console.log('✓ JAN TRADING Final Invoice: 17 คัน 4 แถว/คัน · เลขเครื่องใหม่ · ตัด COLOR และค่าใช้จ่าย · TOTAL 4,150,500 · worker ใช้เลขเดิม · PDF');
}

main().then(janFinal).then(() => console.log('ผ่านทั้งหมด')).catch((e) => { console.error(e); process.exit(1); });
