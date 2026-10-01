import { revalidatePath } from 'next/cache';
import { requireActiveSession } from '@/lib/auth';
import { reorderMergedPdf } from '@/lib/do-bundle-reorder';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** เรียงหน้าชุดแลก DO ที่รวมแล้ว — ANN เป็นคนรวมชุดจึงเป็นคนเรียง */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireActiveSession(['ANN']);
    if (user.mustChangePassword) throw new Error('กรุณาเปลี่ยนรหัสผ่านก่อนดำเนินการ');
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { order?: unknown };
    const result = await reorderMergedPdf(id, body.order, user.id);
    revalidatePath('/do-exchange');
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'เรียงหน้าไม่สำเร็จ' },
      { status: 400 },
    );
  }
}
