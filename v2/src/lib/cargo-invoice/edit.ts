/**
 * แก้รายการรถหลังจัดเรียงแล้ว — ใช้ทั้งหน้าเว็บ (แก้ในตาราง · ตรวจทันที) และเซิร์ฟเวอร์ (ใช้ค่าที่แก้ตอน Preview / บันทึก)
 *
 * ไม่ import อะไรที่ผูกกับเซิร์ฟเวอร์ (exceljs / jszip) หน้าเว็บจึงเรียกได้
 * เซิร์ฟเวอร์ยังอ่านไฟล์ใหม่ทุกครั้ง แล้วเอาเฉพาะค่าในช่องที่แก้ได้จากหน้าเว็บมาทับ — ตำแหน่งช่องในไฟล์ ตู้ ลำดับรถ มาจากไฟล์เสมอ
 */
import type { CargoCar } from './parse';

/** ช่องที่แก้ได้ในตาราง ตามลำดับคอลัมน์ */
export const EDIT_FIELDS = ['brand', 'model', 'chassis', 'engine', 'fuel', 'cc', 'year', 'weight', 'price'] as const;
export type EditField = (typeof EDIT_FIELDS)[number];
export type CarEdit = Pick<CargoCar, EditField>;
const NUMERIC: EditField[] = ['cc', 'year', 'weight', 'price'];

/**
 * เชื้อเพลิงตามตารางพิกัด (มีแค่ GASOLINE · PETROL · DIESEL) — รถไฮบริดแยกด้วยชื่อรุ่น ("FIT HYBRID") ไม่ใช่เชื้อเพลิง
 * JAN TRADING เขียน "HYBRID-GASOLINE" จึงต้องเหลือ GASOLINE ไม่งั้นหาพิกัดไม่เจอ
 */
export function normalizeFuel(raw: string) {
  const f = raw.toUpperCase().replace(/\s+/g, '');
  if (/HYBRID/.test(f)) {
    if (/DIESEL/.test(f)) return 'DIESEL';
    if (/PETROL/.test(f)) return 'PETROL';
    return 'GASOLINE';
  }
  return f;
}

/** use_desc_good2 แบบที่สูตรเดิมประกอบ: "4GR(GASOLINE/2490),2012" — ไม่มีช่องว่าง ไม่มี "CC" */
export const engineDesc = (engine: string, fuel: string, cc: number | null, year: number | null) =>
  `${engine}(${fuel}/${cc ?? ''}),${year ?? ''}`;

/** ค่าที่คนพิมพ์ → ค่าที่ระบบใช้: ข้อความตัดช่องว่างหัวท้ายเป็นตัวพิมพ์ใหญ่ · ตัวเลขตัดลูกน้ำ/หน่วยออก */
export function cleanEdit(field: EditField, raw: unknown): string | number | null {
  if (NUMERIC.includes(field)) {
    if (raw === null || raw === undefined || raw === '') return null;
    const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/KGS?|CC|[¥￥$,\s]/gi, ''));
    return Number.isFinite(n) ? n : null;
  }
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
  if (field === 'engine') return s.replace(/\s+/g, '');
  if (field === 'fuel') return normalizeFuel(s);
  return s;
}

/** รถคันใหม่จากค่าที่แก้ — ประกอบ use_desc_good1/2 ใหม่ให้ตรงกับค่า */
export function applyCarEdit(car: CargoCar, edit: Partial<Record<EditField, unknown>>): CargoCar {
  const next = { ...car } as CargoCar;
  for (const f of EDIT_FIELDS) {
    if (!(f in edit)) continue;
    (next as unknown as Record<string, unknown>)[f] = cleanEdit(f, edit[f]);
  }
  next.desc1 = `USED ${next.brand} ${next.model},`;
  next.desc2 = next.fuel ? engineDesc(next.engine, next.fuel, next.cc, next.year) : `${next.engine},${next.year ?? ''}`;
  return next;
}

/** ปัญหาของค่าในแต่ละคัน (ไม่รวมปัญหาโครงไฟล์ เช่นหาตู้ไม่เจอ) — ตามลำดับรถ */
export function fieldProblems(cars: CarEdit[]): string[][] {
  const seen = new Map<string, number>();
  return cars.map((car, i) => {
    const out: string[] = [];
    if (!car.brand) out.push('ไม่มียี่ห้อ');
    if (!car.chassis) out.push('ไม่มีเลขตัวถัง (CHASSIS)');
    if (!car.engine) out.push('ไม่มีเลขเครื่อง (ENGINE)');
    if (!car.fuel) out.push('ไม่มีชนิดเชื้อเพลิง');
    if (!car.cc) out.push('ไม่มี CC');
    if (!car.year || car.year < 1950 || car.year > 2100) out.push('ปีรถไม่ถูกต้อง');
    if (!car.weight) out.push('ไม่มีน้ำหนัก');
    if (car.price === null) out.push('ไม่มีราคา');
    const key = car.chassis.replace(/\s/g, '').toUpperCase();
    if (key) {
      if (seen.has(key)) out.push(`เลขตัวถังซ้ำกับคันที่ ${seen.get(key)! + 1}`);
      else seen.set(key, i);
    }
    return out;
  });
}

/** ปัญหาทั้งหมดของรถทุกคัน = ปัญหาโครงไฟล์ (คงเดิม) + ปัญหาของค่า (ตรวจใหม่) */
export function withProblems<T extends CargoCar>(cars: T[]): T[] {
  const fp = fieldProblems(cars);
  return cars.map((c, i) => ({ ...c, problems: [...c.layoutProblems, ...fp[i]] }));
}

/** รถทุกคันหลังใส่ค่าที่แก้จากหน้าเว็บ — จำนวนต้องเท่ากับรถในไฟล์ (ไม่เพิ่ม/ลดคันจากหน้าเว็บ) */
export function applyEdits(cars: CargoCar[], edits: unknown): CargoCar[] {
  if (edits === null || edits === undefined || edits === '') return cars;
  if (!Array.isArray(edits) || edits.length !== cars.length) {
    throw new Error('จำนวนรถที่แก้ไม่ตรงกับรถในไฟล์ — อ่านไฟล์ใหม่อีกครั้ง');
  }
  return withProblems(cars.map((c, i) => applyCarEdit(c, (edits[i] ?? {}) as Record<EditField, unknown>)));
}

/** ช่องที่เปลี่ยนจากค่าที่อ่านได้ในไฟล์ */
export const changedFields = (before: CarEdit, after: CarEdit) =>
  EDIT_FIELDS.filter((f) => (before[f] ?? '') !== (after[f] ?? ''));
