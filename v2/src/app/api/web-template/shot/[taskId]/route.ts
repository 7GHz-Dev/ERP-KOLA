import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { automationTasks } from '@/db/schema';
import { currentUser } from '@/lib/auth';
import { downloadFile } from '@/lib/storage';
import { WEB_TASK } from '@/lib/web-template';

/**
 * ภาพหน้าจอของงานกรอกเว็บ — ภาพตอนพัง หรือภาพทดลองรัน
 * ภาพหลักฐานส่งจริงเป็นไฟล์ของงาน (WEB_PROOF) เปิดผ่าน /files/<id> ตามปกติ
 */
export async function GET(_request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  if (!(await currentUser())) return new NextResponse('กรุณาเข้าสู่ระบบ', { status: 401 });
  const { taskId } = await params;
  const [task] = await db.select({
    type: automationTasks.type, key: automationTasks.resultStorageKey, name: automationTasks.resultFileName,
  }).from(automationTasks).where(eq(automationTasks.id, taskId)).limit(1);
  if (!task?.key || (task.type !== WEB_TASK.RUN && task.type !== WEB_TASK.RECORD)) {
    return new NextResponse('ไม่พบภาพ', { status: 404 });
  }
  try {
    const { body, contentType } = await downloadFile(task.key);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        'Content-Type': contentType || 'image/png',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(task.name ?? 'shot.png')}`,
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (error) {
    return new NextResponse(`เปิดภาพไม่สำเร็จ: ${error instanceof Error ? error.message : error}`, { status: 502 });
  }
}
