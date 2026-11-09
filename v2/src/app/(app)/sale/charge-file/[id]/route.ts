import { currentUser, roleAllows } from '@/lib/auth';
import { readChargeFile } from '@/lib/sale/charge-store';

/** เปิดไฟล์แนบค่าใช้จ่ายพิเศษ — เฉพาะ Sale / Sale Supervisor (และ ADMIN) */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response('กรุณาเข้าสู่ระบบ', { status: 401 });
  if (!roleAllows(user.role, ['SALE', 'SALE_SUPERVISOR'])) return new Response('ไม่มีสิทธิ์', { status: 403 });
  const { id } = await params;
  const found = await readChargeFile(id).catch(() => null);
  if (!found) return new Response('ไม่พบไฟล์', { status: 404 });
  return new Response(new Uint8Array(found.bytes), {
    headers: {
      'Content-Type': found.file.mimeType || 'application/octet-stream',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(found.file.fileName)}`,
      'Cache-Control': 'private, max-age=300',
    },
  });
}
