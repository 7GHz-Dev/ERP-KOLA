import { shipmeAuthorized } from '@/lib/shipme-auth';
import { jobsByBlKeys } from '@/lib/transport-request/jobs';
import { docStatusBody, keyOf } from '@/lib/transport-request/parse';

export const dynamic = 'force-dynamic';

/**
 * สถานะ DO ของ BL ให้แพลนงาน ERP SHIPME — สเปก: docs/SHIPME-TRANSPORT-REQUEST.md
 *
 * GET /api/shipme/doc-status?bl=A&bl=B   Authorization: Bearer <SHIPME_API_KEY>   (สูงสุด 300 BL)
 * → { ok, items: { <bl ตามที่ถาม (A-Z0-9)>: { found, jobNo?, doExchangedAt? } } }
 * doExchangedAt = เวลาที่ ANN ส่งชุดแลก DO ให้สายเรือแล้ว (jobs.do_exchanged_at) · null = ยัง
 */
const MAX_BLS = 300;
const err = (status: number, error: string) => Response.json({ ok: false, error }, { status });

export async function GET(request: Request) {
  if (!process.env.SHIPME_API_KEY) return err(503, 'ยังไม่ได้ตั้ง SHIPME_API_KEY บนเซิร์ฟเวอร์');
  if (!shipmeAuthorized(request)) return err(401, 'API key ไม่ถูกต้อง');
  const keys = [...new Set(new URL(request.url).searchParams.getAll('bl').map(keyOf).filter(Boolean))];
  if (!keys.length) return err(400, 'ไม่มี bl');
  if (keys.length > MAX_BLS) return err(400, `ถามได้ครั้งละไม่เกิน ${MAX_BLS} BL`);
  try {
    return Response.json(docStatusBody(keys, await jobsByBlKeys(keys)));
  } catch (e) {
    return err(500, e instanceof Error ? e.message : 'อ่านข้อมูลไม่สำเร็จ');
  }
}
