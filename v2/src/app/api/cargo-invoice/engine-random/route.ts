import { randomEngineNumbers } from '@/lib/engine-numbers';
import { cargoReader, json } from '@/lib/cargo-invoice/http';
import { jobById } from '@/lib/cargo-invoice/jobs';

export const dynamic = 'force-dynamic';

/**
 * ปุ่ม "สุ่ม Engine" (Create FN Invoice · NORMAL) — เลข 7 หลักที่ไม่ซ้ำกับที่เคยออก ตามลำดับรถที่ส่งมา
 * ยังไม่จองในตาราง เลขถูกบันทึกจริงตอนบันทึก Final Invoice (ตรวจซ้ำอีกครั้งในขั้นนั้น)
 */
export async function POST(request: Request) {
  const user = await cargoReader();
  if (user instanceof Response) return user;
  const body = await request.json().catch(() => null) as { jobId?: unknown; chassis?: unknown } | null;
  const chassis = Array.isArray(body?.chassis)
    ? body!.chassis.slice(0, 200).map((c) => String(c ?? '').replace(/\s+/g, '').toUpperCase())
    : [];
  if (!chassis.length) return json({ error: 'ยังไม่มีรายการรถ' }, 400);
  const job = body?.jobId ? await jobById(String(body.jobId)) : null;
  try {
    const numbers = await randomEngineNumbers(chassis, (job?.blNo ?? '').replace(/\s/g, '').toUpperCase());
    return json({ numbers });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
}
