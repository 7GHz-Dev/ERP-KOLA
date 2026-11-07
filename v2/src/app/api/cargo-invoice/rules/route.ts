import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { masterRecords } from '@/db/schema';
import { logActivity, newId } from '@/lib/actions/common';
import { addedRules, TARIFF_CODE, TARIFF_TYPE } from '@/lib/cargo-invoice/tariff';
import { tariffKey } from '@/lib/draft/invoice';
import { cargoUser, json } from '@/lib/cargo-invoice/http';

export const dynamic = 'force-dynamic';

/**
 * เพิ่มกฎพิกัดของรถรุ่นใหม่ — เก็บใน master_records type=tariffs ใช้ได้ทันทีทั้งระบบ
 * กฎ = ยี่ห้อ + รุ่น + เชื้อเพลิง + ช่วง CC + ช่วงน้ำหนัก → พิกัด 8 หลัก
 */
export async function POST(request: Request) {
  const user = await cargoUser();
  if (user instanceof Response) return user;
  const b = await request.json().catch(() => null) as Record<string, unknown> | null;
  const text = (k: string) => String(b?.[k] ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  const int = (k: string) => Math.trunc(Number(String(b?.[k] ?? '').replace(/,/g, '')));
  const rule = {
    code: String(b?.code ?? '').replace(/\D/g, '').replace(/^0000(?=\d{8}$)/, ''),
    brand: text('brand'), model: text('model'), fuel: text('fuel'),
    ccMin: int('ccMin'), ccMax: int('ccMax'), wMin: int('wMin'), wMax: int('wMax'),
  };
  if (!TARIFF_CODE.test(rule.code)) return json({ error: 'พิกัดต้องเป็นตัวเลข 8 หลักขึ้นต้นด้วย 87 เช่น 87032290' }, 400);
  if (!rule.brand || !rule.model || !rule.fuel) return json({ error: 'กรอกยี่ห้อ รุ่น และเชื้อเพลิงให้ครบ' }, 400);
  for (const [a, z, what] of [[rule.ccMin, rule.ccMax, 'CC'], [rule.wMin, rule.wMax, 'น้ำหนัก']] as const) {
    if (!Number.isFinite(a) || !Number.isFinite(z) || a < 0 || z < a || z > 999999) {
      return json({ error: `ช่วง${what}ไม่ถูกต้อง (ต่ำสุดต้องไม่เกินสูงสุด)` }, 400);
    }
  }
  // กฎที่เหมือนกันทุกช่องมีอยู่แล้ว ไม่ต้องเพิ่มซ้ำ
  const key = tariffKey(rule.brand, rule.model, rule.fuel);
  const dup = (await addedRules()).find((r) => tariffKey(r.brand, r.model, r.fuel) === key && r.code === rule.code
    && r.ccMin === rule.ccMin && r.ccMax === rule.ccMax && r.wMin === rule.wMin && r.wMax === rule.wMax);
  if (dup) return json({ ok: true, id: dup.id, duplicate: true });

  const id = newId('TRF');
  await db.insert(masterRecords).values({
    id, type: TARIFF_TYPE, code: id, name: `${rule.brand} ${rule.model} ${rule.fuel}`,
    description: `${rule.code} · CC ${rule.ccMin}-${rule.ccMax} · ${rule.wMin}-${rule.wMax} KG`,
    value: JSON.stringify(rule),
  });
  await logActivity(user.id, 'ADD_TARIFF_RULE', 'MASTER', id, rule);
  return json({ ok: true, id });
}

/** ปิดกฎที่เพิ่มผิด — ไม่ลบแถว ย้อนดูได้ว่าเคยมีกฎอะไร */
export async function DELETE(request: Request) {
  const user = await cargoUser();
  if (user instanceof Response) return user;
  const id = new URL(request.url).searchParams.get('id') ?? '';
  const done = await db.update(masterRecords)
    .set({ isActive: false, updatedAt: new Date() })
    .where(and(eq(masterRecords.id, id), eq(masterRecords.type, TARIFF_TYPE)))
    .returning({ id: masterRecords.id });
  if (!done.length) return json({ error: 'ไม่พบกฎนี้' }, 404);
  await logActivity(user.id, 'REMOVE_TARIFF_RULE', 'MASTER', id);
  return json({ ok: true });
}
