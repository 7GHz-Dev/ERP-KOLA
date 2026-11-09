import { timingSafeEqual } from 'node:crypto';
import { parseShipmePayload } from '@/lib/sale/charges';
import { receiveFromShipme } from '@/lib/sale/charge-store';
import { isMissingTable } from '@/lib/sale/price-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * รับค่าใช้จ่ายพิเศษจาก ERP SHIPME — สเปก: docs/SHIPME-SPECIAL-CHARGES-API.md
 *
 * POST /api/shipme/special-charges   Authorization: Bearer <SHIPME_API_KEY>
 * ไม่ใช้ session ของผู้ใช้ — ตรวจคีย์ที่ตั้งไว้ใน Vercel (SHIPME_API_KEY) แบบเวลาคงที่
 */
const err = (status: number, error: string) => Response.json({ ok: false, error }, { status });

function authorized(request: Request) {
  const key = process.env.SHIPME_API_KEY ?? '';
  const got = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!key || !got) return false;
  const a = Buffer.from(got); const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!process.env.SHIPME_API_KEY) return err(503, 'ยังไม่ได้ตั้ง SHIPME_API_KEY บนเซิร์ฟเวอร์');
  if (!authorized(request)) return err(401, 'API key ไม่ถูกต้อง');
  const body = await request.json().catch(() => null);
  const parsed = parseShipmePayload(body);
  if (!parsed.ok) return err(400, parsed.error);
  try {
    const result = await receiveFromShipme(parsed.data);
    if (result.conflict) {
      return Response.json({
        ok: false, error: `batchId นี้ Sale เริ่มเจรจาแล้ว (สถานะ ${result.status}) — ถ้ามีรายการเปลี่ยน ให้ส่งเป็น batchId ใหม่`,
        id: result.id, status: result.status,
      }, { status: 409 });
    }
    return Response.json({
      ok: true, id: result.id, created: result.created,
      jobMatched: Boolean(result.jobId),
      ...(result.jobId ? {} : { warning: result.jobMatches > 1 ? 'BL นี้ตรงกับหลายงาน — Sale จะเลือกงานเอง' : 'ยังไม่พบงานที่ BL นี้ใน ERP KOLA — รับไว้แล้ว' }),
    }, { status: result.created ? 201 : 200 });
  } catch (e) {
    if (isMissingTable(e)) return err(503, 'ERP KOLA ยังไม่พร้อมรับข้อมูล (ยังไม่ได้สร้างตาราง)');
    return err(500, e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
  }
}
