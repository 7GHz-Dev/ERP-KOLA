import { currentUser } from '@/lib/auth';
import { storeDoLetterPdf } from '@/lib/do-letter-store';

export const dynamic = 'force-dynamic';

/**
 * ออกจดหมายแลก D/O แล้วส่ง PDF กลับให้เปิดดูทันที
 *
 * เก็บไฟล์ไว้กับงานด้วย เพราะต้องใช้ตอนรวมชุดแลก DO ในขั้นถัดไป
 *
 * ?json=1 คืนแค่ id กับชื่อไฟล์แทนตัว PDF
 * ใช้ตอนกดปุ่มบนตาราง เพื่อเอา id ไปเปิดแผงดูไฟล์ต่อ ไม่ต้องเด้งแท็บใหม่
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const user = await currentUser();
  if (!user) return new Response('unauthorized', { status: 401 });
  if (!['ANN', 'ADMIN'].includes(user.role)) {
    return new Response('forbidden', { status: 403 });
  }

  const { jobId } = await params;
  const wantsJson = new URL(_request.url).searchParams.get('json') === '1';
  try {
    const { id, fileName, bytes } = await storeDoLetterPdf(jobId, user.id);
    if (wantsJson) {
      return Response.json({ id, fileName });
    }
    return new Response(new Uint8Array(bytes), {
      headers: {
        'content-type': 'application/pdf',
        // inline = เปิดดูในแท็บใหม่ได้เลย ไม่ต้องโหลดลงเครื่องก่อน
        'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ออกจดหมายไม่สำเร็จ';
    if (wantsJson) return Response.json({ error: message }, { status: 400 });
    return new Response(message, { status: 400 });
  }
}
