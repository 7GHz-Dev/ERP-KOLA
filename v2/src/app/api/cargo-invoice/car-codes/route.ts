import { logActivity } from '@/lib/actions/common';
import { listCarCodes, setCarCodeActive } from '@/lib/cargo-invoice/car-codes';
import { cargoReader, cargoUser, json } from '@/lib/cargo-invoice/http';

export const dynamic = 'force-dynamic';

/**
 * ชุด ยี่ห้อ+รุ่น ↔ รหัส Chassis ↔ รหัสเครื่อง ที่ระบบจำจากใบที่บันทึก (ใช้เตือนใบถัดไป)
 *   GET               ทุกชุด (รวมที่ปิดไว้) — กรองที่หน้าเว็บ
 *   POST {id, active} ปิด / เปิดชุดที่จำผิด — ไม่ลบแถว ย้อนดูได้
 */
export async function GET() {
  const user = await cargoReader();
  if (user instanceof Response) return user;
  return json({ codes: await listCarCodes(false) });
}

export async function POST(request: Request) {
  const user = await cargoUser();
  if (user instanceof Response) return user;
  const body = await request.json().catch(() => null) as { id?: unknown; active?: unknown } | null;
  const id = String(body?.id ?? '');
  if (!id.startsWith('CC-')) return json({ error: 'ไม่พบชุดนี้' }, 404);
  const active = body?.active === true;
  await setCarCodeActive(id, active);
  await logActivity(user.id, active ? 'ENABLE_CAR_CODE' : 'DISABLE_CAR_CODE', 'MASTER', id);
  return json({ ok: true });
}
