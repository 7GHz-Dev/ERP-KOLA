import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { files } from '@/db/schema';
import { currentUser } from '@/lib/auth';
import { downloadFile } from '@/lib/storage';
import { driveOcrConfigured, driveOcrText } from '@/lib/drive-ocr';
import { parseText } from '@/lib/slip-parse';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * อ่าน Slip ที่อัปโหลดไว้แล้วด้วย Google Drive OCR
 *
 * อ่านจากไฟล์ที่เก็บไว้ ไม่ให้ส่งรูปมาใหม่ทางนี้ จะได้อ่านตรงกับไฟล์ที่จะถูกรวมในชุดจริง
 * ไม่บันทึกผลลง — เป็นตัวช่วยอ่านให้คนเทียบยอดเอง ตัวเลขที่ใช้ตัดสินใจยังเป็นของคน
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ ok: false, detail: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  if (!['ANN', 'ADMIN'].includes(user.role)) {
    return Response.json({ ok: false, detail: 'ไม่มีสิทธิ์' }, { status: 403 });
  }
  if (!driveOcrConfigured()) {
    return Response.json(
      { ok: false, detail: 'ยังไม่ได้ตั้งค่า Google OAuth สำหรับอ่าน Slip' },
      { status: 400 },
    );
  }

  const { jobId } = (await request.json().catch(() => ({}))) as { jobId?: string };
  if (!jobId) return Response.json({ ok: false, detail: 'ไม่ได้ระบุงาน' }, { status: 400 });

  const [slip] = await db
    .select({ storageKey: files.storageKey, mimeType: files.mimeType, fileName: files.fileName })
    .from(files)
    .where(and(eq(files.jobId, jobId), eq(files.category, 'DO_SLIP'), eq(files.isCurrent, true)))
    .limit(1);
  if (!slip) return Response.json({ ok: false, detail: 'ยังไม่มีไฟล์ Slip' }, { status: 400 });

  // Drive OCR รับเฉพาะรูป — สลิปที่เป็น PDF ต้องให้คนอ่านเอง
  const mime = slip.mimeType ?? '';
  if (!mime.startsWith('image/')) {
    return Response.json(
      { ok: false, detail: 'อ่านอัตโนมัติได้เฉพาะไฟล์รูป (สลิปที่เป็น PDF ให้ดูเทียบเอง)' },
      { status: 400 },
    );
  }

  try {
    const { body } = await downloadFile(slip.storageKey);
    const text = await driveOcrText(`data:${mime};base64,${body.toString('base64')}`);
    const parsed = parseText(text);
    return Response.json({ ok: true, ...parsed, sample: text.replace(/\s+/g, ' ').trim().slice(0, 300) });
  } catch (error) {
    return Response.json(
      { ok: false, detail: error instanceof Error ? error.message : 'อ่าน Slip ไม่สำเร็จ' },
      { status: 400 },
    );
  }
}
