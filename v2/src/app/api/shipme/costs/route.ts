import { isMissingTable } from '@/lib/sale/price-store';
import { shipmeAuthorized } from '@/lib/shipme-auth';
import { parseCostPayload } from '@/lib/total-cost/cost';
import { receiveCosts } from '@/lib/total-cost/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * รับค่าใช้จ่ายราย BL จาก ERP SHIPME (เมนู Total cost ของ ACCOUNT) — สเปก: docs/SHIPME-COSTS-API.md
 *
 * POST /api/shipme/costs   Authorization: Bearer <SHIPME_API_KEY>   (คีย์เดียวกับ /api/shipme/special-charges)
 * ส่งได้ครั้งละหลาย BL · BL เดิม = แทนรายการเดิมทั้งชุด
 */
const err = (status: number, error: string) => Response.json({ ok: false, error }, { status });

export async function POST(request: Request) {
  if (!process.env.SHIPME_API_KEY) return err(503, 'ยังไม่ได้ตั้ง SHIPME_API_KEY บนเซิร์ฟเวอร์');
  if (!shipmeAuthorized(request)) return err(401, 'API key ไม่ถูกต้อง');
  const body = await request.json().catch(() => null);
  const parsed = parseCostPayload(body);
  if (!parsed.ok) return err(400, parsed.error);
  try {
    const results = await receiveCosts(parsed.data);
    return Response.json({
      ok: true,
      results: results.map((r) => ({
        blNo: r.blNo, id: r.id, created: r.created, lines: r.lines, jobMatched: r.jobMatched,
        ...(r.jobMatched ? {} : { warning: r.jobMatches > 1 ? 'BL นี้ตรงกับหลายงาน' : 'ยังไม่พบงานที่ BL นี้ใน ERP KOLA — รับไว้แล้ว' }),
      })),
    });
  } catch (e) {
    if (isMissingTable(e)) return err(503, 'ERP KOLA ยังไม่พร้อมรับข้อมูล (ยังไม่ได้สร้างตาราง)');
    return err(500, e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
  }
}
