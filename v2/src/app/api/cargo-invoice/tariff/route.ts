import { allRules, lookup, similarRules, suggestCcRange } from '@/lib/cargo-invoice/tariff';
import { cargoReader, json } from '@/lib/cargo-invoice/http';
import { checkCarCodes } from '@/lib/cargo-invoice/car-codes';

export const dynamic = 'force-dynamic';

type CarIn = { brand?: unknown; model?: unknown; fuel?: unknown; cc?: unknown; weight?: unknown; chassis?: unknown; engine?: unknown };

/**
 * ขั้น 3: หาพิกัดของรถทุกคัน — รถที่ไม่พบส่งกฎของรุ่นใกล้เคียงไปให้ดูประกอบการเพิ่ม
 * พร้อมคำเตือนว่า ยี่ห้อ · รุ่น · รหัส Chassis · รหัสเครื่อง สัมพันธ์กันไหม (mismatch — เตือนอย่างเดียว)
 */
export async function POST(request: Request) {
  const user = await cargoReader();
  if (user instanceof Response) return user;
  const body = await request.json().catch(() => null) as { cars?: CarIn[] } | null;
  const cars = Array.isArray(body?.cars) ? body!.cars.slice(0, 500) : [];
  const rules = await allRules();
  // ตรวจความสัมพันธ์ไม่ได้ (เช่นฐานข้อมูลช้า) ก็ยังหาพิกัดได้ตามปกติ
  const mismatch = await checkCarCodes(cars.map((c) => ({
    brand: String(c.brand ?? ''), model: String(c.model ?? ''), chassis: String(c.chassis ?? ''), engine: String(c.engine ?? ''),
  })), rules).catch(() => cars.map(() => [] as string[]));
  const results = cars.map((c, i) => {
    const car = {
      brand: String(c.brand ?? ''), model: String(c.model ?? ''), fuel: String(c.fuel ?? ''),
      cc: typeof c.cc === 'number' ? c.cc : null, weight: typeof c.weight === 'number' ? c.weight : null,
    };
    const res = lookup(rules, car);
    return {
      ...res,
      similar: res.status === 'missing' ? similarRules(rules, car) : [],
      suggest: res.status === 'missing' ? suggestCcRange(rules, car.cc) : null,
      mismatch: mismatch[i] ?? [],
    };
  });
  return json({ results, ruleCount: rules.length });
}
