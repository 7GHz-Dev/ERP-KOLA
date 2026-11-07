import { allRules, lookup, similarRules, suggestCcRange } from '@/lib/cargo-invoice/tariff';
import { cargoReader, json } from '@/lib/cargo-invoice/http';

export const dynamic = 'force-dynamic';

type CarIn = { brand?: unknown; model?: unknown; fuel?: unknown; cc?: unknown; weight?: unknown };

/** ขั้น 3: หาพิกัดของรถทุกคัน — รถที่ไม่พบส่งกฎของรุ่นใกล้เคียงไปให้ดูประกอบการเพิ่ม */
export async function POST(request: Request) {
  const user = await cargoReader();
  if (user instanceof Response) return user;
  const body = await request.json().catch(() => null) as { cars?: CarIn[] } | null;
  const cars = Array.isArray(body?.cars) ? body!.cars.slice(0, 500) : [];
  const rules = await allRules();
  const results = cars.map((c) => {
    const car = {
      brand: String(c.brand ?? ''), model: String(c.model ?? ''), fuel: String(c.fuel ?? ''),
      cc: typeof c.cc === 'number' ? c.cc : null, weight: typeof c.weight === 'number' ? c.weight : null,
    };
    const res = lookup(rules, car);
    return {
      ...res,
      similar: res.status === 'missing' ? similarRules(rules, car) : [],
      suggest: res.status === 'missing' ? suggestCcRange(rules, car.cc) : null,
    };
  });
  return json({ results, ruleCount: rules.length });
}
