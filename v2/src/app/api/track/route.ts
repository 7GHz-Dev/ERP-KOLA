import { currentUser } from '@/lib/auth';
import { trackJobs } from '@/lib/track';

export const dynamic = 'force-dynamic';

/** ปุ่มเช็คสถานะ BL — อ่านอย่างเดียว ตรวจแค่คุกกี้ที่เซ็นชื่อเหมือนการเปิดหน้าทั่วไป (ไม่ใช้ AI) */
export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  const q = (new URL(request.url).searchParams.get('q') ?? '').slice(0, 80);
  return Response.json(await trackJobs(q));
}
