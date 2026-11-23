/**
 * Create Cargo Invoice — อ่าน Invoice ของผู้ขาย · พิกัด · เขียนตารางสรุป · worker สร้าง Draft ต่อได้
 *   npm run test:cargo-invoice
 *
 * ไฟล์ตัวอย่างอยู่ที่ test/INVOICE (ไฟล์ดิบจากผู้ขาย ไม่มีตารางสรุป)
 *   AICHI        แยกตู้ละชีต ("1" … "6") แต่ละชีตมี TOTAL ของตัวเอง · ENGINE TYPE "KF(GASOLINE/650 CC)" · ราคามี ¥
 *   JAN TRADING  ชีตเดียว 4 ตู้ · ENGINE NO. "4GR (GASOLINE/2490 CC)" · มีแถวสี/เลขอ้างอิง · ค่า Forwarding บวกใน TOTAL
 *   ทั้งสองใบช่อง B/L NO. ว่าง (ออก invoice ก่อนได้เลข BL)
 *
 *   1. อ่านรถครบ ค่าถูก ยอดรวมตรงแถว TOTAL
 *   2. พิกัดหาได้ (รุ่น HYBRID ใช้เชื้อเพลิง GASOLINE ตามตาราง)
 *   3. เขียนตารางสรุปแล้ว ตัวอ่านของ worker เห็นรถและช่องเลขเครื่องครบ (ข้ามชีต) และใช้พิกัดที่เลือกตรง ๆ
 *   4. worker ตรวจผ่าน แล้วเติมเลขเครื่องกลับลงช่องที่ถูกชีต
 *   5. JAN TRADING จัดหน้า Final Invoice: BL ของงาน · เลขเครื่อง LDA-1234567(GASOLINE/1330) · ตัดแถว COLOR / ค่าใช้จ่ายอื่น
 *      แล้ว worker เห็นเลขเครื่องครบ (ใช้เลขเดิม ไม่สุ่มซ้ำ) และแปลง PDF ได้
 *   6. แก้ค่าในตาราง: ค่าที่แก้เขียนลงใบตรงช่องตามรูปแบบเดิม (¥ · KGS · USED · เลขเครื่อง+เชื้อเพลิง+CC) ทุกชีต
 *      และ Preview ประกอบไฟล์ทางเดียวกับบันทึก (เลขเครื่อง xxxxxxx)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sanitizeInvoice } from '../src/lib/cargo-invoice/ai-read';
import { engineDesc, invoiceDate, normalizeFuel, parseCargoInvoice, splitEngineType } from '../src/lib/cargo-invoice/parse';
import { baseRules, lookup } from '../src/lib/cargo-invoice/tariff';
import { writeSummary } from '../src/lib/cargo-invoice/write';
import ExcelJS from 'exceljs';
import { enginePrefix, existingEngineNumber, finalEngineText } from '../src/lib/cargo-invoice/engine-format';
import { finalizeLayout } from '../src/lib/cargo-invoice/final-layout';
import { applyEdits, changedFields, EDIT_FIELDS } from '../src/lib/cargo-invoice/edit';
import { buildFinalInvoice } from '../src/lib/cargo-invoice/final';
import { buildNormalWorkbook, normalInvoice, type NormalDoc } from '../src/lib/cargo-invoice/normal';
import { draftCsv } from '../src/lib/cargo-invoice/draft-csv';
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
    xlsx: 'example AICHI cargo invoice Original.xlsx', pattern: 'AICHI', invoice: 'AICHI 325', date: '05/11/2026',
    booking: '2342184670', vessel: 'IRENES RAINBOW V.037S', sheets: ['1', '2', '3', '4', '5', '6'],
    boxes: ['CSGU7134867', 'SEGU6530270', 'SEKU4649054', 'MAGU5179399', 'CSNU6715819', 'CSNU6842177'],
    cars: 29, stated: { units: 29, weight: 36570, amount: 7797851 }, charges: [],
    spots: [
      { no: 1, sheet: '1', container: 'CSGU7134867', brand: 'HONDA', model: 'FIT SHUTTLE HYBRID', chassis: 'GP2-1001011', engine: 'LDA-MF6',
        fuel: 'GASOLINE', cc: 1330, year: 2011, weight: 1200, price: 233620, desc2: 'LDA-MF6(GASOLINE/1330),2011' },
      { no: 9, sheet: '2', container: 'SEGU6530270', brand: 'HONDA', model: 'VEZEL HYBRID', chassis: 'RU4-1018715', engine: 'LEB-H1',
        fuel: 'GASOLINE', cc: 1490, year: 2014, weight: 1380, price: 560350, desc2: 'LEB-H1(GASOLINE/1490),2014' },
      { no: 29, sheet: '6', container: 'CSNU6842177', brand: 'TOYOTA', model: 'WISH', chassis: 'ZGE25-6000663', engine: '2ZR',
        fuel: 'GASOLINE', cc: 1790, year: 2013, weight: 1450, price: 430310, desc2: '2ZR(GASOLINE/1790),2013' },
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
  const laid = await finalizeLayout(src, {
    pattern: 'JAN TRADING', blNo, engines: cars.map((c, i) => finalEngineText(inv.cars[i], numbers[i])), total, weight: 23550, units: 17,
  });
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
  // WEIGHT · ITEM · QUANTITY · UNIT PRICE · AMOUNT อยู่บรรทัดแรกของคัน — ไม่ผสานแนวตั้งแล้ว
  for (const col of ['A', 'B', 'E', 'F', 'G']) assert.ok(!ws.getCell(`${col}19`).isMerged, `${col}18 ต้องไม่ผสานลงมา`);
  assert.deepEqual(['A', 'B', 'E', 'F', 'G'].map((c) => text(18, c.charCodeAt(0) - 64)), ['1,520 KGS', 'H1', '1 UNIT', '¥183,000', '¥183,000']);
  // เส้นแบ่ง: บางเหนือคัน · หนาเหนือตู้
  assert.equal(ws.getCell('D18').border?.top?.style, 'thin');
  assert.equal(ws.getCell('D22').border?.top?.style, 'thin');
  assert.equal(ws.getCell('C17').border?.top?.style, 'medium');
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

/** 6. แก้ค่าในตาราง → เขียนลงใบ */
async function editedFinal() {
  const editsOf = (cars: Awaited<ReturnType<typeof parseCargoInvoice>>['cars']) =>
    cars.map((c) => Object.fromEntries(EDIT_FIELDS.map((f) => [f, c[f]])));

  /* JAN TRADING: แก้รุ่น ราคา น้ำหนัก เชื้อเพลิงของคันแรก */
  const src = readFileSync(`${DIR}example JAN TRADING cargo invoice Original.xlsx`);
  const inv = await parseCargoInvoice(src);
  const original = inv.cars;
  const edits = editsOf(inv.cars);
  Object.assign(edits[0], { model: 'mark x zio', price: '190,000', weight: '1,600', fuel: 'diesel' });
  inv.cars = applyEdits(inv.cars, edits);
  assert.deepEqual(changedFields(original[0], inv.cars[0]), ['model', 'fuel', 'weight', 'price']);
  assert.equal(inv.cars[0].model, 'MARK X ZIO');
  assert.equal(inv.cars[0].desc2, '4GR(DIESEL/2490),2012');
  assert.ok(inv.cars.every((c) => !c.problems.length));
  assert.throws(() => applyEdits(original, edits.slice(1)), /จำนวนรถ/);
  const bad = applyEdits(original, editsOf(original).map((e, i) => (i === 1 ? { ...e, chassis: original[0].chassis } : e)));
  assert.match(bad[1].problems.join(), /เลขตัวถังซ้ำกับคันที่ 1/);

  inv.blNo = 'EGLV022600156399';
  const out = await buildFinalInvoice(src, inv, original, { tariffs: inv.cars.map(() => '87032290'), engineNumbers: null });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(out as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  const v = (ref: string) => String(ws.getCell(ref).value ?? '');
  assert.equal(v('D18'), 'MARK X ZIO');
  assert.equal(v('A18'), '1,600 KGS');
  assert.equal(v('F18'), '¥190,000');
  assert.equal(v('G18'), '¥190,000');
  assert.equal(v('D20'), '4GR-xxxxxxx(DIESEL/2490)', 'Preview ยังไม่ออกเลขเครื่อง');
  assert.equal(v('A90'), '23,630 KGS', 'น้ำหนักรวมใหม่');
  assert.equal(v('G90'), '¥4,157,500', 'ยอดรวมใหม่');
  const back = await parseCargoInvoice(out);
  assert.deepEqual([back.cars[0].model, back.cars[0].fuel, back.cars[0].weight, back.cars[0].price], ['MARK X ZIO', 'DIESEL', 1600, 190000]);
  assert.deepEqual(back.warnings, []);
  assert.ok((await xlsxToPdf(out))!.length > 1000);

  /* AICHI (ตู้ละชีต): แก้เลขตัวถังและ CC ของคันในชีตที่สอง — เขียนลงชีตนั้นก่อนต่อชีต ช่องเลขเครื่องได้ CC ใหม่ */
  const aSrc = readFileSync(`${DIR}example AICHI cargo invoice Original.xlsx`);
  const a = await parseCargoInvoice(aSrc);
  const k = a.cars.findIndex((c) => c.sheet !== '1');
  assert.ok(k > 0);
  const aEdits = editsOf(a.cars);
  Object.assign(aEdits[k], { chassis: 'TEST-123456', cc: '1500' });
  const aOriginal = a.cars;
  a.cars = applyEdits(a.cars, aEdits);
  a.blNo = 'TESTAICHI01';
  const aOut = await buildFinalInvoice(aSrc, a, aOriginal, { tariffs: a.cars.map(() => '87032290'), engineNumbers: null });
  const aBack = await parseCargoInvoice(aOut);
  assert.equal(aBack.cars[k].chassis, 'TEST-123456');
  assert.equal(aBack.cars[k].cc, 1500);
  assert.deepEqual(aBack.sheets, ['1'], 'Final Invoice AICHI ต่อทุกตู้เป็นชีตเดียว');
  assert.deepEqual(aBack.cars.map((c, i) => (i === k ? null : c.chassis)), aOriginal.map((c, i) => (i === k ? null : c.chassis)), 'คันอื่นไม่เปลี่ยน');
  const draft = await readInvoice(aOut);
  assert.equal(draft.cars[k].chassis, 'TEST-123456', 'ตารางสรุปใช้ค่าที่แก้');

  console.log('✓ แก้ค่าในตาราง: เขียนลงใบตามรูปแบบเดิม (¥ · KGS · เลขเครื่อง) ทุกชีต · TOTAL JAN คำนวณใหม่ · Preview ใช้ xxxxxxx · PDF');
}

/** 7. AICHI Final Invoice: ต่อทุกชีตเป็นชีตเดียว · INVOICE NO. รันของระบบ · BL ของงาน · เลขเครื่อง · ยอดรวมทั้ง BL */
async function aichiFinal() {
  const src = readFileSync(`${DIR}example AICHI cargo invoice Original.xlsx`);
  const inv = await parseCargoInvoice(src);
  assert.equal(inv.sheets.length, 6);
  inv.blNo = 'OOLU2342184670';
  inv.invoiceNo = 'AICHI 351';
  const numbers = inv.cars.map((_, i) => String(5646105 + i));
  const original = inv.cars;
  const out = await buildFinalInvoice(src, inv, original, { tariffs: inv.cars.map(() => '87032290'), engineNumbers: numbers });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(out as unknown as ArrayBuffer);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['1'], 'ชีตตู้อื่นต่อเข้าชีตแรกแล้วลบออก');
  const ws = wb.worksheets[0];
  const v = (ref: string) => String(ws.getCell(ref).value ?? '').trim();
  assert.equal(v('E5'), 'INVOICE NO. : AICHI 351');
  assert.equal(v('A13'), 'B/L NO. OOLU2342184670');
  // ตู้แรกเหมือนตัวอย่าง: CONTAINER NO / เลขตู้ / คันละ 6 แถว — ค่าบรรทัดแรก ไม่ผสาน · ราคาไม่ซ้ำลงมา
  assert.deepEqual([v('A17'), v('A18'), v('A19'), v('B19'), v('E19'), v('G19')], ['CONTAINER NO', 'CSGU7134867', '1200 KGS', 'A1', '1 UNIT', '233620']);
  assert.ok(!ws.getCell('G20').isMerged && v('G20') === '' && v('F24') === '');
  assert.equal(v('D22'), 'LDA-5646105(GASOLINE/1330)');
  assert.equal(v('C22'), 'ENGINE TYPE.');
  // ตู้ที่สองต่อท้ายตู้แรกแบบตัวอย่าง (แถว 49)
  assert.deepEqual([v('A49'), v('A50'), v('D54')], ['CONTAINER NO', 'SEGU6530270', 'LDA-5646110(GASOLINE/1330)']);
  assert.equal(ws.getCell('A49').border?.top?.style, 'medium', 'เส้นหนาเหนือตู้');
  // แถวสุดท้าย: ยอดรวมทั้ง BL
  const totalRow = ws.getColumn(1).values.findIndex((x) => String(x ?? '').trim() === 'TOTAL');
  assert.deepEqual([v(`A${totalRow + 1}`), v(`E${totalRow + 1}`), v(`G${totalRow + 1}`)], ['36,570 KGS', '29 UNITS', '7797851']);
  assert.equal(ws.pageSetup.printArea, `A1:G${totalRow + 1}`);

  const back = await parseCargoInvoice(out);
  assert.deepEqual([back.errors, back.warnings], [[], []]);
  assert.deepEqual([back.invoiceNo, back.blNo, back.cars.length, back.sheets], ['AICHI 351', 'OOLU2342184670', 29, ['1']]);
  assert.deepEqual(back.stated, { units: 29, weight: 36570, amount: 7797851 });
  assert.deepEqual(back.containers, inv.containers);
  const draft = await readInvoice(out);
  assert.deepEqual(draft.errors, []);
  assert.equal(draft.engines.filter((e) => e.existing).length, 29, 'worker เห็นเลขเครื่องครบ');
  assert.ok((await xlsxToPdf(out))!.length > 1000);
  console.log('✓ AICHI Final Invoice: 6 ชีตต่อเป็นชีตเดียว · AICHI 351 · BL ของงาน · เลขเครื่อง · ค่าบรรทัดแรก · เส้นแบ่งตู้ · ยอดรวมทั้ง BL · PDF');
}

/** 8. NORMAL (คีย์เอง) + CSV Draft ใบขน */
async function normalFinal() {
  const doc: NormalDoc = {
    shipper: { name: 'LEGEND MOTORS FZCP', address: 'PO BOX 41391 DUCAMZ DUBAI, UAE\nTEL: 04-1234567' },
    invoiceNo: 'YKMA1289', invoiceDate: '13/08/2026', currency: 'USD',
    vessel: 'IRENES RAINBOW', voyage: '037S', portOfLoading: 'KHOR FAKKEN, UNITED ARAB EMIRATES', portOfDestination: 'LAEM CHABANG',
    dateOfShip: '14/08/2026', blNo: 'EMIVAEESAD270818', carrier: 'CNC', containers: ['ESDU6077465'],
    cars: [
      { brand: 'TOYOTA', model: 'LAND CRUISER', chassis: 'JTMAA7BJ4S4118676', weight: 2610, year: 2025, engine: 'F33A-1555956', cc: 3300, fuel: 'DIESEL', amount: 75000, container: 'ESDU6077465' },
      { brand: 'TOYOTA', model: 'LAND CRUISER', chassis: 'JTMAA7BJ9S4118124', weight: 2530, year: 2025, engine: 'F33A-6157844', cc: 3300, fuel: 'DIESEL', amount: 78000, container: 'ESDU6077465' },
    ],
  };
  const out = await writeSummary(await buildNormalWorkbook(doc), normalInvoice(doc), ['87033371', '87033371']);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(out as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  const v = (ref: string) => String((ws.getCell(ref).value as { result?: unknown } | null)?.result ?? ws.getCell(ref).value ?? '');
  assert.deepEqual([v('A1'), v('A2'), v('A3'), v('M5'), v('M6')], ['LEGEND MOTORS FZCP', 'PO BOX 41391 DUCAMZ DUBAI, UAE', 'TEL: 04-1234567', '13/08/2026', 'YKMA1289']);
  assert.deepEqual(['J8', 'J9', 'J10', 'J11', 'J12', 'J14', 'J15'].map(v), ['IRENES RAINBOW', '037S', 'KHOR FAKKEN, UNITED ARAB EMIRATES', 'LAEM CHABANG', '14/08/2026', 'EMIVAEESAD270818', 'CNC']);
  // แบบใหม่: แถวหัวตู้ "CONTAINER NO : …" ก่อนรถของตู้นั้น (example Normal Final Invoice.xlsx)
  assert.deepEqual([v('A20'), v('B21'), v('E21'), v('J21'), v('M19'), v('A24'), v('B24'), v('H24'), v('M24'), v('B26')],
    ['CONTAINER NO : ESDU6077465', 'TOYOTA', 'JTMAA7BJ4S4118676', 'F33A-1555956', 'AMOUNT (USD)', 'TOTAL', '2 UNITS', '5140', '153000', 'ESDU6077465']);
  assert.equal((ws.getCell('H24').value as { formula?: string }).formula, 'SUM(H21:H22)');
  const back = await parseCargoInvoice(out);
  assert.deepEqual([back.pattern, back.currency, back.errors, back.cars.length, back.cars[1].container, back.cars[1].problems], ['NORMAL', 'USD', [], 2, 'ESDU6077465', []]);
  const draft = await readInvoice(out);
  assert.deepEqual([draft.errors, draft.file_type, draft.currency, draft.engines.filter((e) => e.existing).length], [[], 'NORMAL', 'USD', 2]);
  assert.ok((await xlsxToPdf(out))!.length > 1000);

  const csv = await draftCsv(out);
  const col = (name: string) => csv.columns.indexOf(name);
  assert.equal(csv.rows.length, 2);
  assert.equal(csv.rows[0][col('currency')], 'USD', 'สกุลเงินจาก P7');
  assert.equal(csv.rows[0][col('productAttribute2')], 'F33A-1555956');
  assert.equal(csv.rows[1][col('invoiceAmountForeign')], '78000');
  assert.equal(csv.fileName, 'EMIVAEESAD270818.csv');
  assert.ok(csv.base64, 'ดาวน์โหลดได้ (TIS-620)');

  // หลายตู้: หัวตู้ขึ้นใหม่ทุกครั้งที่ตู้เปลี่ยน · อ่านกลับได้ตู้ถูกคัน · worker / CSV อ่านครบทุกคัน
  const two: NormalDoc = {
    ...doc, containers: ['ESDU6077465', 'TCNU2495509'],
    cars: [
      { ...doc.cars[0], container: 'ESDU6077465' },
      { ...doc.cars[1], container: 'TCNU2495509' },
      { ...doc.cars[1], chassis: 'JTMAA7BJ1S4119999', engine: 'F33A-1234567', container: 'TCNU2495509' },
    ],
  };
  const out2 = await writeSummary(await buildNormalWorkbook(two), normalInvoice(two), ['87033371', '87033371', '87033371']);
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(out2 as unknown as ArrayBuffer);
  const v2 = (ref: string) => String((wb2.worksheets[0].getCell(ref).value as { result?: unknown } | null)?.result ?? wb2.worksheets[0].getCell(ref).value ?? '');
  assert.deepEqual(['A20', 'A21', 'E21', 'A22', 'A23', 'E23', 'A24', 'E24', 'A26', 'B26', 'H26', 'B28', 'B29'].map(v2),
    ['CONTAINER NO : ESDU6077465', '1', 'JTMAA7BJ4S4118676', 'CONTAINER NO : TCNU2495509', '2', 'JTMAA7BJ9S4118124', '3', 'JTMAA7BJ1S4119999',
      'TOTAL', '3 UNITS', '7670', 'ESDU6077465', 'TCNU2495509']);
  assert.deepEqual(normalInvoice(two).cars.map((c) => c.row), [21, 23, 24]);
  const back2 = await parseCargoInvoice(out2);
  assert.deepEqual([back2.errors, back2.cars.map((c) => c.container), back2.cars.flatMap((c) => c.problems)],
    [[], ['ESDU6077465', 'TCNU2495509', 'TCNU2495509'], []]);
  const draft2 = await readInvoice(out2);
  assert.deepEqual([draft2.errors, draft2.cars.length, draft2.engines.filter((e) => e.existing).length], [[], 3, 3]);
  assert.equal((await draftCsv(out2)).rows.length, 3);

  // CSV ของ JAN TRADING ก่อนบันทึก: เลขเครื่อง 0000000 · สกุลเงิน JPY
  const src = readFileSync(`${DIR}example JAN TRADING cargo invoice Original.xlsx`);
  const inv = await parseCargoInvoice(src);
  inv.blNo = 'EGLV022600156399';
  const jan = await buildFinalInvoice(src, inv, inv.cars, { tariffs: inv.cars.map(() => '87032290'), engineNumbers: inv.cars.map(() => '0000000') });
  const jcsv = await draftCsv(jan);
  assert.equal(jcsv.rows.length, 17);
  assert.equal(jcsv.rows[0][jcsv.columns.indexOf('currency')], 'JPY');
  assert.equal(jcsv.rows[0][jcsv.columns.indexOf('productAttribute2')], '4GR-0000000');
  assert.ok(jcsv.warnings.some((w) => /0000000/.test(w)), 'บอกว่ายังไม่ได้บันทึก');
  console.log('✓ NORMAL Final Invoice: หัวใบ · ข้อมูลเรือ · ตาราง · TOTAL · ตู้ · USD · worker อ่านได้ · PDF · CSV Draft ใบขน (NORMAL + JAN)');
}

/** ค่าที่ AI อ่าน Invoice NORMAL ต้องผ่านการกรองก่อนถึงฟอร์ม */
async function aiSanitize() {
  const out = sanitizeInvoice({
    supplier: ' sun motors fzco ', invoiceNo: 'SM 2026-118', invoiceDate: '2026-11-03', currency: 'usd', blNo: 'aaa 1234567',
    cars: [
      { brand: 'toyota', model: 'prius', chassis: 'ZVW30 1234567', engine: '2ZR-FXE', year: '2012', cc: '1,800 cc',
        fuel: 'Hybrid Gasoline', weight: '1,350 KG', amount: '$2,450.00', container: 'tcnu 123456-7' },
      { brand: 'HONDA', model: 'FIT', chassis: 'GP1-100', year: '1800', cc: '-5', weight: '5', amount: '', container: 'ABC' },
      { brand: '', model: '', chassis: '' },
    ],
  });
  assert.equal(out.supplier, 'SUN MOTORS FZCO');
  assert.equal(out.invoiceNo, 'SM2026-118');
  assert.equal(out.invoiceDate, '03/11/2026');
  assert.equal(out.currency, 'USD');
  assert.equal(out.cars.length, 2, 'แถวว่างทิ้ง');
  assert.deepEqual(out.cars[0], {
    brand: 'TOYOTA', model: 'PRIUS', chassis: 'ZVW301234567', engine: '2ZR-FXE', fuel: 'GASOLINE',
    year: 2012, cc: 1800, weight: 1350, price: 2450, container: 'TCNU1234567',
  });
  // ค่าผิดรูปทิ้ง: ปี 1800 · CC ติดลบ · น้ำหนัก 5 กก. · เลขตู้ไม่เข้ารูป
  assert.deepEqual([out.cars[1].year, out.cars[1].cc, out.cars[1].weight, out.cars[1].price, out.cars[1].container], [null, null, null, null, '']);
  assert.equal(sanitizeInvoice({ invoiceDate: '3 Nov 2026', currency: 'US$' }).invoiceDate, '');
  console.log('✓ AI อ่าน Invoice NORMAL: กรองค่าผิดรูป');
}

main().then(janFinal).then(editedFinal).then(aichiFinal).then(normalFinal).then(aiSanitize).then(() => console.log('ผ่านทั้งหมด')).catch((e) => { console.error(e); process.exit(1); });
