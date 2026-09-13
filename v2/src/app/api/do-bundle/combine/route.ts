import { requireActiveSession } from '@/lib/auth';
import { combineDoBundles } from '@/lib/do-bundle-combine';
import { isDoBundleKind } from '@/lib/do-bundle-options';
import { revalidatePath } from 'next/cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    const user = await requireActiveSession(['ANN']);
    if (user.mustChangePassword) throw new Error('กรุณาเปลี่ยนรหัสผ่านก่อนดำเนินการ');
    const body = await request.json();
    if (!isDoBundleKind(body.kind) || !Array.isArray(body.fileIds) || body.fileIds.some((id: unknown) => typeof id !== 'string' || !id || id.length > 80)) throw new Error('รายการรวมชุดไม่ถูกต้อง');
    const result = await combineDoBundles(body.fileIds, user.id, body.kind);
    revalidatePath('/do-exchange');
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'รวมชุดไม่สำเร็จ' }, { status: 400 });
  }
}
