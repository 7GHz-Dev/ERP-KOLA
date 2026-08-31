import { currentUser } from '@/lib/auth';
import { navCounts } from '@/lib/queries/dashboard';

export const dynamic = 'force-dynamic';

/**
 * ตัวเลขงานค้างข้างเมนู — แยกมาเป็น endpoint เพราะ layout ไม่ถูกเรนเดอร์ใหม่
 *
 * router.refresh() ขอเฉพาะส่วนของหน้า ไม่ได้ขอ layout กลับมาด้วย
 * ตัวเลขข้างเมนูจึงค้างค่าเดิมจนกว่าผู้ใช้จะกดรีเฟรชทั้งหน้าเอง
 * ให้เมนูมาดึงเองหลังทุกครั้งที่ข้อมูลเปลี่ยน
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 });
  return Response.json(await navCounts());
}
