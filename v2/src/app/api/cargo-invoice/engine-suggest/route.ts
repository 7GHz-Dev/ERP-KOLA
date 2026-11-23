import { cargoReader, json } from '@/lib/cargo-invoice/http';
import { suggestEngines } from '@/lib/cargo-invoice/engine-suggest';

export const dynamic = 'force-dynamic';

/** รหัสเครื่องแนะนำ (ส่วนหน้าขีด) ของรถที่ยังไม่มี ENGINE NO. — ตามลำดับรถที่ส่งมา */
export async function POST(request: Request) {
  const user = await cargoReader();
  if (user instanceof Response) return user;
  const body = await request.json().catch(() => null) as { cars?: unknown } | null;
  const cars = (Array.isArray(body?.cars) ? body!.cars.slice(0, 200) : []).map((c) => {
    const x = (c ?? {}) as Record<string, unknown>;
    const s = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 80);
    return { brand: s(x.brand), model: s(x.model), chassis: s(x.chassis).replace(/\s/g, '') };
  });
  if (!cars.length) return json({ hints: [] });
  try {
    return json({ hints: await suggestEngines(cars) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
