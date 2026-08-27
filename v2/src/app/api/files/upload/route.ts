import { revalidatePath } from 'next/cache';
import { uploadJobFile } from '@/lib/actions/files';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * อัปโหลดไฟล์แนบผ่าน XHR เพื่อให้หน้าเว็บบอก % ความคืบหน้าได้
 *
 * เป็นทางเดียวกับ server action ทุกอย่าง เรียกฟังก์ชันตัวเดียวกันต่อ
 * ทั้งการตรวจสิทธิ์ ขนาดไฟล์ และการเก็บเวอร์ชัน
 * ที่ต้องมีเส้นทางนี้เพิ่มเพราะ server action รู้แค่ตอนจบ บอกระหว่างทางไม่ได้
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    await uploadJobFile(formData);
    revalidatePath('/pending');
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'อัปโหลดไม่สำเร็จ';
    // action ที่ห่อด้วย runAction จะโยน NEXT_REDIRECT ออกมาเมื่อมีข้อผิดพลาดของผู้ใช้
    const digest = (error as { digest?: string })?.digest;
    if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) {
      const target = digest.split(';')[2] ?? '';
      const detail = decodeURIComponent(target.split('err=')[1] ?? '') || 'อัปโหลดไม่สำเร็จ';
      return Response.json({ ok: false, detail }, { status: 400 });
    }
    return Response.json({ ok: false, detail: message }, { status: 400 });
  }
}
