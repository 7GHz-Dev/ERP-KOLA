/**
 * ตรวจ Final Invoice + เตรียมข้อมูลรถทีละคัน — ยกมาจาก core/pipeline.py ของ imp
 *
 * ไม่อ่าน/เขียนฐานข้อมูลเอง: ผู้เรียกโหลดเลขเครื่องที่เกี่ยวข้องมาให้ในรูป EngineLookup
 * (worker ถาม ERP ผ่าน engineLookup ของ /api/worker)
 */
import { addNumber, buildRows, csvText, encodeTis620, EncodingError, lookupTariff, mapCar, totals, type DraftData } from './csv';
import { engineValueWith, SUMMARY_COLS, type Car, type EngineCell, type Invoice } from './invoice';
import { colIndex } from './sheet';
import { fmtNumber, pyRepr } from './values';

export const NEW = 'new';
export const REUSE = 'reuse';
export const KEEP = 'keep';
export const AGAIN = 'again';
export type Status = typeof NEW | typeof REUSE | typeof KEEP | typeof AGAIN;

export const STATUS_TEXT: Record<Status, string> = {
  new: 'สุ่มใหม่',
  reuse: 'ใช้เลขเดิม',            // เลขในไฟล์เคยออกให้ chassis นี้แล้ว
  keep: 'มีเลขแล้ว',              // เลขครบในไฟล์แต่ไม่อยู่ในฐานข้อมูล -> ใช้ตามไฟล์และบันทึกเพิ่ม
  again: 'ใช้เลขเดิมของ BL นี้',   // ไฟล์ยังไม่มีเลข แต่ chassis เคยได้เลขใน BL เดียวกัน -> เติมเลขเดิม
};
/** สถานะที่ต้องเติมเลขลงช่องเลขเครื่องและ use_desc_good2 */
const FILL: Status[] = [NEW, AGAIN];

/** เลขเครื่องที่ออกไปแล้ว 1 แถว (ตาราง engine_numbers) */
export type EngineRow = { number: string; full: string; chassis: string; date: string; bl: string };

export type EngineLookup = {
  /** แถวทั้งหมดที่ใช้เลข 7 หลักนี้ */
  find(number: string): EngineRow[];
  /** เลขที่เคยออกให้ chassis นี้ (ใหม่สุดก่อน) */
  history(chassis: string): EngineRow[];
};

export type Line = {
  car: Car; engine: EngineCell; tariff: string; status: Status;
  number: string;        // เลข 7 หลัก (ว่าง = ยังไม่สุ่ม)
  full_engine: string;   // เลขเครื่องเต็ม เช่น HR15-1234567
};

export type Analysis = {
  invoice: Invoice; lines: Line[]; errors: string[]; warnings: string[];
  ok: boolean; new_count: number;
};

const norm = (s: string) => s.replace(/\s/g, '').toUpperCase();

/** เลขและ chassis ที่ต้องโหลดจากฐานข้อมูลก่อนเรียก analyze() */
export function lookupKeys(inv: Invoice) {
  return {
    numbers: inv.engines.filter((e) => e.existing).map((e) => e.existing!.number),
    chassis: inv.cars.map((c) => c.chassis),
  };
}

/**
 * ตรวจไฟล์ + เตรียมข้อมูล  ไม่เขียนอะไร
 * reuseBl = chassis ที่เคยได้เลขใน BL เดียวกัน ใช้เลขเดิม (สร้าง Draft ซ้ำแล้วเลขไม่เปลี่ยน)
 */
export function analyze(inv: Invoice, data: DraftData, db: EngineLookup, opts: { reuseBl?: boolean; today?: Date } = {}): Analysis {
  const a: Analysis = { invoice: inv, lines: [], errors: [...inv.errors], warnings: [...inv.warnings], ok: false, new_count: 0 };
  if (!inv.cars.length || !inv.engines.length) {
    if (!a.errors.length) a.errors.push(`ไม่พบช่องเลขเครื่องในส่วน invoice ของ template ${inv.file_type}`);
    return finish(a);
  }
  if (inv.tariff_rows === null) a.warnings.push(`ไฟล์ไม่มีชีต datatariff — ใช้ตารางพิกัดจาก ${data.tariffFile}`);
  const tariffRows = inv.tariff_rows ?? data.tariff;

  if (inv.cars.length !== inv.engines.length) {
    a.errors.push(`ตารางสรุป (แถว 20 ลงไป) มี ${inv.cars.length} คัน แต่ invoice มีเลขเครื่อง ${inv.engines.length} คัน — ` +
      'ตรวจว่าสูตรในตารางสรุปลากครบทุกคัน');
    return finish(a);
  }

  const thisYear = (opts.today ?? new Date()).getFullYear();
  const seenChassis: Record<string, number> = {};
  const seenNumbers: Record<string, number> = {};
  inv.cars.forEach((car, i) => {
    const eng = inv.engines[i];
    const tag = `คันที่ ${car.car_no} (${car.chassis})`;
    if (norm(car.chassis) !== norm(eng.chassis) || norm(car.use_chassis) !== norm(eng.chassis)) {
      a.errors.push(`${tag}: chassis ในตารางสรุปไม่ตรงกับ invoice แถว ${eng.row} (${eng.chassis})`);
      return;
    }
    if (/[^\x00-\x7f]/.test(car.chassis)) a.errors.push(`${tag}: เลข chassis มีตัวอักษรแปลก ${pyRepr(car.chassis)}`);
    if (!car.desc2.includes('(')) {
      a.errors.push(`${tag}: use_desc_good2 ไม่มีวงเล็บ (${car.desc2})`);
      return;
    }
    if (norm(car.desc2.split('(')[0]) !== norm(eng.head)) {
      a.errors.push(`${tag}: use_desc_good2 "${car.desc2}" ไม่ตรงกับเลขเครื่อง "${eng.head}" — เปิดไฟล์ใน Excel กด Save แล้วอัปโหลดใหม่`);
      return;
    }
    const year = parseInt(car.year, 10);
    if (!(year >= 1980 && year <= thisYear)) a.warnings.push(`${tag}: ปีผลิต ${car.year} ผิดปกติ`);
    if (car.cc <= 0 || car.cc >= 11000 || (car.cc >= 1980 && car.cc <= thisYear && car.cc % 10)) {
      a.warnings.push(`${tag}: CC ${car.cc} ผิดปกติ (อาจกรอกปีผิดช่อง)`);
    }
    if (car.chassis in seenChassis) a.warnings.push(`${tag}: chassis ซ้ำกับคันที่ ${seenChassis[car.chassis]} ในไฟล์เดียวกัน`);
    seenChassis[car.chassis] = car.car_no;

    const [code, note] = lookupTariff(tariffRows, car);
    if (note) a.warnings.push(`${tag}: ${note}`);

    const line: Line = { car, engine: eng, tariff: code, status: NEW, number: '', full_engine: '' };
    if (eng.existing) {
      line.number = eng.existing.number;
      line.full_engine = eng.head;
      const used = db.find(line.number);
      if (used.some((r) => r.chassis === car.chassis)) {
        line.status = REUSE;
      } else if (used.length) {
        a.errors.push(`${tag}: เลข ${eng.head} ถูกใช้กับ chassis ${used[0].chassis} แล้ว`);
      } else {
        line.status = KEEP;
        a.warnings.push(`${tag}: เลขเครื่อง ${eng.head} มีเลขครบแล้วแต่ไม่อยู่ในฐานข้อมูล — ใช้ตามไฟล์และบันทึกเพิ่ม`);
      }
      if (line.number in seenNumbers) a.errors.push(`${tag}: เลข ${line.number} ซ้ำกับคันที่ ${seenNumbers[line.number]}`);
      seenNumbers[line.number] = car.car_no;
    } else {
      const old = db.history(car.chassis);
      const same = opts.reuseBl
        ? old.filter((r) => norm(r.bl || '') === norm(inv.bl_no) && (r.full || '') === `${eng.head}-${r.number}`)
        : [];
      if (same.length) {
        line.status = AGAIN;
        line.number = same[0].number;
        line.full_engine = same[0].full;
        if (line.number in seenNumbers) a.errors.push(`${tag}: เลข ${line.number} ซ้ำกับคันที่ ${seenNumbers[line.number]}`);
        seenNumbers[line.number] = car.car_no;
      } else if (old.length) {
        a.warnings.push(`${tag}: chassis นี้เคยได้เลข ${old[0].full} (${(old[0].date || '').slice(0, 10)}) — ` +
          'รอบนี้จะสุ่มเลขใหม่ ถ้าต้องการเลขเดิมให้อัปโหลดไฟล์ Excel ที่ได้จากรอบก่อน');
      }
    }
    a.lines.push(line);
  });

  if (!a.errors.length) {
    try {     // ลองสร้าง CSV ด้วยเลขสมมติ เพื่อหาปัญหา (เช่นตัวอักษรที่เข้ารหัสไม่ได้) ก่อนจองเลขจริง
      buildCsv(a, data, true);
    } catch (e) {
      if (!(e instanceof EncodingError)) throw e;
      a.errors.push(`สร้าง CSV ไม่ได้: ${e.message}`);
    }
  }
  return finish(a);
}

function finish(a: Analysis) {
  a.ok = !a.errors.length && a.lines.length > 0;
  a.new_count = a.lines.filter((l) => l.status === NEW).length;
  return a;
}

export const desc2Full = (line: Line) => (FILL.includes(line.status) ? addNumber(line.car.desc2, line.number) : line.car.desc2);
export const previewEngine = (line: Line) => line.full_engine || `${line.engine.head}-xxxxxxx`;

/** CSV ทั้งไฟล์  placeholder = ใช้เลข 0000000 แทนเลขที่ยังไม่ได้สุ่ม */
export function buildCsv(a: Analysis, data: DraftData, placeholder = false) {
  const mapped = a.lines.map((line) => {
    const d2 = placeholder && line.status === NEW ? addNumber(line.car.desc2, '0000000') : desc2Full(line);
    return mapCar(line.car, a.invoice, line.tariff, d2, data.brandCountry);
  });
  const rows = buildRows(data.csv, mapped);
  const text = csvText(data.csv, rows);
  return { text, bytes: encodeTis620(text), totals: totals(data.csv, rows) };
}

export type CellUpdate = { row: number; col: number; value: string };

/** ช่องที่ต้องเขียนลง Excel: เลขเครื่อง (คันที่เติมเลข) + ค่าที่คำนวณไว้ของสูตร use_desc_good2 */
export function excelUpdates(a: Analysis, placeholder = false) {
  const values: CellUpdate[] = []; const cached: CellUpdate[] = [];
  for (const line of a.lines) {
    if (!FILL.includes(line.status)) continue;
    const number = placeholder && line.status === NEW ? '0000000' : line.number;
    const full = placeholder && line.status === NEW ? `${line.engine.head}-0000000` : line.full_engine;
    values.push({ row: line.engine.row, col: line.engine.col, value: engineValueWith(line.engine, full) });
    cached.push({ row: line.car.row, col: colIndex(SUMMARY_COLS.desc2), value: addNumber(line.car.desc2, number) });
  }
  return { values, cached };
}

export function lineDict(l: Line) {
  return {
    car_no: l.car.car_no, brand: l.car.brand, model: l.car.model, chassis: l.car.chassis,
    year: l.car.year, cc: l.car.cc, fuel: l.car.fuel,
    weight: fmtNumber(l.car.use_weight), price: fmtNumber(l.car.use_price),
    tariff: l.tariff, engine_before: l.engine.raw, engine: previewEngine(l),
    status: l.status, status_text: STATUS_TEXT[l.status],
  };
}

/** ชื่อไฟล์จากเลข BL (แบบ _safe ของโปรแกรมเดิม) */
export const safeName = (name: string) => name.replace(/[^\p{L}\p{N}_.-]+/gu, '_').replace(/^_+|_+$/g, '') || 'invoice';
