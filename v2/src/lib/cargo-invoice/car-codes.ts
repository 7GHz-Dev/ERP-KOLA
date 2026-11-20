import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { engineNumbers, masterRecords } from '@/db/schema';
import { tariffKey } from '@/lib/draft/invoice';
import { enginePrefix } from './engine-format';
import type { TariffRule } from './tariff';

/**
 * ตรวจว่า ยี่ห้อ · รุ่น · รหัสหน้า Chassis No. (ก่อนขีด) · รหัสเครื่อง สัมพันธ์กันไหม — เตือนอย่างเดียว ไม่บล็อกการบันทึก
 *
 * ยึด DATA TARIFF เป็นหลักสำหรับยี่ห้อ / รุ่น (ต้องมีในตารางพิกัด)
 * แต่ DATA TARIFF ไม่มีรหัส Chassis กับรหัสเครื่อง จึงเรียนรู้จากใบที่บันทึก Final Invoice แล้ว:
 *   ทุกครั้งที่บันทึก จำชุด ยี่ห้อ+รุ่น ↔ รหัส Chassis ↔ รหัสเครื่อง ไว้ (master_records type=carCodes แถวละหนึ่งชุด)
 *   คู่ Chassis ↔ เครื่อง ตั้งต้นจากเลขเครื่องที่ระบบเคยออก (engine_numbers) ได้ทันทีโดยไม่ต้องรอ
 * ชุดที่จำผิด PAINT ปิดได้ที่ข้อมูลอ้างอิง > ยี่ห้อ/รุ่น ↔ Chassis ↔ เครื่อง
 *
 * ช่วงแรกรุ่นที่ยังไม่เคยบันทึกจะเทียบได้น้อย — ยิ่งบันทึกมากยิ่งเตือนแม่น
 */

export const CAR_CODE_TYPE = 'carCodes';

export type CarCode = { id: string; brand: string; model: string; chassis: string; engine: string; count: number; isActive: boolean; updatedAt: string };

/** รหัสหน้าเลขตัวถังก่อนขีด: "ZVW30-1234567" → "ZVW30" · ไม่มีขีด = บอกไม่ได้ว่ารหัสหน้าคือส่วนไหน */
export function chassisPrefix(chassis: string): string {
  const s = chassis.replace(/\s+/g, '').toUpperCase();
  const i = s.indexOf('-');
  return i > 0 ? s.slice(0, i) : '';
}

export const engineCode = (engine: string) => enginePrefix(engine).toUpperCase();

const modelKey = (brand: string, model: string) => tariffKey(brand, model);
const label = (brand: string, model: string) => `${brand} ${model}`.trim();

type CarIn = { brand: string; model: string; chassis: string; engine: string };

export async function listCarCodes(activeOnly = true): Promise<CarCode[]> {
  const rows = await db.select().from(masterRecords)
    .where(activeOnly ? and(eq(masterRecords.type, CAR_CODE_TYPE), eq(masterRecords.isActive, true)) : eq(masterRecords.type, CAR_CODE_TYPE));
  const out: CarCode[] = [];
  for (const r of rows) {
    try {
      const v = JSON.parse(r.value ?? '') as Omit<CarCode, 'id' | 'isActive' | 'updatedAt'>;
      out.push({ ...v, id: r.id, isActive: r.isActive, updatedAt: r.updatedAt.toISOString() });
    } catch { /* แถวเสียข้ามไป */ }
  }
  return out.sort((a, b) => a.brand.localeCompare(b.brand) || a.model.localeCompare(b.model) || a.chassis.localeCompare(b.chassis));
}

/** คู่ Chassis ↔ เครื่อง จากเลขเครื่องที่ระบบเคยออก (ไม่มียี่ห้อ/รุ่น) */
async function historyPairs(): Promise<Array<{ chassis: string; engine: string }>> {
  // ข้อมูลเก่ามีช่องว่างปน ("1MZ  ") และพิมพ์ผิดนาน ๆ ครั้ง ("IMZ") — ตัดช่องว่าง และนับเฉพาะคู่ที่เจออย่างน้อย 2 คัน
  const rows = await db.select({
    chassis: sql<string>`regexp_replace(upper(split_part(${engineNumbers.chassis}, '-', 1)), '\\s', '', 'g')`,
    engine: sql<string>`regexp_replace(upper(split_part(${engineNumbers.fullEngine}, '-', 1)), '\\s', '', 'g')`,
  }).from(engineNumbers)
    .where(sql`position('-' in ${engineNumbers.chassis}) > 1 and ${engineNumbers.fullEngine} like '%-%'`)
    .groupBy(sql`1`, sql`2`)
    .having(sql`count(*) >= 2`);
  return rows.filter((r) => r.chassis && r.engine);
}

/** รหัสเครื่องเขียนได้หลายแบบ ("1MZ" · "1MZFE") — ถือว่าตรงกันถ้าตัวหนึ่งขึ้นต้นด้วยอีกตัว (ยาว 3 ตัวขึ้นไป) */
const hasEngine = (set: Set<string>, en: string) =>
  [...set].some((x) => x === en || (Math.min(x.length, en.length) >= 3 && (x.startsWith(en) || en.startsWith(x))));
const add = (m: Map<string, Set<string>>, k: string, v: string) => { if (!m.has(k)) m.set(k, new Set()); m.get(k)!.add(v); };
const list = (s: Set<string> | undefined, max = 5) => {
  const a = [...(s ?? [])];
  return a.slice(0, max).join(', ') + (a.length > max ? ' …' : '');
};

/**
 * คำเตือนของรถแต่ละคัน (ลำดับเดียวกับที่ส่งมา) — [] = ไม่พบอะไรผิด หรือยังไม่มีข้อมูลให้เทียบ
 */
export async function checkCarCodes(cars: CarIn[], rules: TariffRule[]): Promise<string[][]> {
  const [known, pairs] = await Promise.all([listCarCodes(), historyPairs().catch(() => [])]);

  // DATA TARIFF — ยี่ห้อ / ยี่ห้อ+รุ่น ที่มีในตารางพิกัด
  const brands = new Set(rules.map((r) => tariffKey(r.brand)));
  const models = new Set(rules.map((r) => modelKey(r.brand, r.model)));

  const chassisOfModel = new Map<string, Set<string>>();
  const engineOfModel = new Map<string, Set<string>>();
  const modelsOfChassis = new Map<string, Set<string>>();
  const modelsOfEngine = new Map<string, Set<string>>();
  const engineOfChassis = new Map<string, Set<string>>();
  for (const k of known) {
    const mk = modelKey(k.brand, k.model);
    if (k.chassis) { add(chassisOfModel, mk, k.chassis); add(modelsOfChassis, k.chassis, label(k.brand, k.model)); }
    if (k.engine) { add(engineOfModel, mk, k.engine); add(modelsOfEngine, k.engine, label(k.brand, k.model)); }
    if (k.chassis && k.engine) add(engineOfChassis, k.chassis, k.engine);
  }
  for (const p of pairs) add(engineOfChassis, p.chassis, p.engine);

  return cars.map((car) => {
    const out: string[] = [];
    const name = label(car.brand, car.model);
    const mk = modelKey(car.brand, car.model);
    const ch = chassisPrefix(car.chassis);
    const en = car.engine ? engineCode(car.engine) : '';

    if (car.brand && !brands.has(tariffKey(car.brand))) out.push(`ยี่ห้อ ${car.brand} ไม่มีใน DATA TARIFF`);
    else if (car.model && !models.has(mk)) out.push(`รุ่น ${car.model} ไม่มีใน DATA TARIFF ของ ${car.brand}`);

    // รหัส Chassis ↔ ยี่ห้อ+รุ่น
    const chOfThis = chassisOfModel.get(mk);
    if (ch && chOfThis?.size && !chOfThis.has(ch)) {
      const owner = modelsOfChassis.get(ch);
      out.push(`Chassis ${ch} ไม่เคยใช้กับ ${name} (เคยใช้ ${list(chOfThis)})${owner ? ` — ${ch} เคยเป็นของ ${list(owner, 3)}` : ''}`);
    } else if (ch && !chOfThis?.size) {
      const owner = modelsOfChassis.get(ch);
      if (owner?.size) out.push(`Chassis ${ch} เคยเป็นของ ${list(owner, 3)} ไม่ใช่ ${name}`);
    }

    // รหัสเครื่อง ↔ ยี่ห้อ+รุ่น
    const enOfThis = engineOfModel.get(mk);
    if (en && enOfThis?.size && !hasEngine(enOfThis, en)) {
      const owner = modelsOfEngine.get(en);
      out.push(`เครื่อง ${en} ไม่เคยใช้กับ ${name} (เคยใช้ ${list(enOfThis)})${owner ? ` — ${en} เคยเป็นของ ${list(owner, 3)}` : ''}`);
    } else if (en && !enOfThis?.size) {
      const owner = modelsOfEngine.get(en);
      if (owner?.size) out.push(`เครื่อง ${en} เคยเป็นของ ${list(owner, 3)} ไม่ใช่ ${name}`);
    }

    // รหัส Chassis ↔ รหัสเครื่อง
    const enOfCh = engineOfChassis.get(ch);
    if (ch && en && enOfCh?.size && !hasEngine(enOfCh, en)) out.push(`Chassis ${ch} เคยคู่กับเครื่อง ${list(enOfCh)} ไม่ใช่ ${en}`);

    return out;
  });
}

/** จำชุดจากใบที่บันทึก Final Invoice แล้ว — ชุดที่ PAINT เคยปิดไว้ บันทึกซ้ำแล้วกลับมาใช้ใหม่ */
export async function learnCarCodes(cars: CarIn[]) {
  const seen = new Map<string, Omit<CarCode, 'id' | 'isActive' | 'updatedAt'>>();
  for (const c of cars) {
    const brand = c.brand.trim().toUpperCase();
    const model = c.model.trim().toUpperCase();
    const chassis = chassisPrefix(c.chassis);
    const engine = c.engine ? engineCode(c.engine) : '';
    if (!brand || !model || (!chassis && !engine)) continue;
    const code = `${modelKey(brand, model)}|${chassis}|${engine}`;
    const cur = seen.get(code);
    seen.set(code, cur ? { ...cur, count: cur.count + 1 } : { brand, model, chassis, engine, count: 1 });
  }
  for (const [code, v] of seen) {
    const id = `CC-${createHash('sha1').update(code).digest('hex').slice(0, 20)}`;
    const name = `${v.brand} ${v.model} · ${v.chassis || '-'} · ${v.engine || '-'}`;
    await db.insert(masterRecords)
      .values({ id, type: CAR_CODE_TYPE, code, name, value: JSON.stringify(v) })
      .onConflictDoUpdate({
        target: [masterRecords.type, masterRecords.code],
        set: {
          // นับจำนวนคันสะสม · เปิดกลับถ้าเคยถูกปิด
          value: sql`jsonb_set(${masterRecords.value}::jsonb, '{count}', to_jsonb(coalesce((${masterRecords.value}::jsonb->>'count')::int, 0) + ${v.count}))::text`,
          isActive: true, updatedAt: new Date(),
        },
      });
  }
}

export async function setCarCodeActive(id: string, isActive: boolean) {
  await db.update(masterRecords).set({ isActive, updatedAt: new Date() })
    .where(and(eq(masterRecords.type, CAR_CODE_TYPE), eq(masterRecords.id, id)));
}
