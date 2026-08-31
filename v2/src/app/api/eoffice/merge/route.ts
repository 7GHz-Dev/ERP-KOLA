import { requireActiveSession } from '@/lib/auth';
import { buildBundle, type BundleKind, type BundleStep } from '@/lib/eoffice-bundle';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * รวมชุด E-Office พร้อมรายงานความคืบหน้า
 *
 * ส่งกลับเป็น NDJSON บรรทัดละหนึ่งเหตุการณ์ หน้าเว็บอ่านทีละบรรทัดแล้วขยับแถบ %
 * ใช้เส้นทางนี้แทน server action เพราะ action ตอบกลับได้ครั้งเดียวตอนจบ
 * บอกความคืบหน้าระหว่างทางไม่ได้ และไฟล์สายเรือบางใบใหญ่พอที่จะรอนาน
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { jobId?: string; kind?: string };
  // ชุดแลก DO เป็นงานของ ANN ส่วนชุด E-Office เป็นของ PAINT
  const kind: BundleKind = body.kind === 'do' ? 'do' : 'eoffice';

  let user;
  try {
    user = await requireActiveSession(kind === 'do' ? ['ANN'] : ['PAINT']);
  } catch (error) {
    return new Response(
      JSON.stringify({ status: 'error', detail: error instanceof Error ? error.message : 'ไม่มีสิทธิ์' }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    );
  }

  const { jobId } = body;
  if (!jobId) {
    return new Response(JSON.stringify({ status: 'error', detail: 'ไม่ได้ระบุงาน' }), {
      status: 400, headers: { 'content-type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: BundleStep | { status: 'error'; detail: string }) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };
      try {
        await buildBundle(jobId, user.id, send, kind);
      } catch (error) {
        send({ status: 'error', detail: error instanceof Error ? error.message : 'รวมชุดไม่สำเร็จ' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      // กัน proxy พักข้อมูลไว้จนความคืบหน้ามาถึงทีเดียวตอนจบ
      'x-accel-buffering': 'no',
    },
  });
}
