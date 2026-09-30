import { currentUser, roleAllows } from '@/lib/auth';
import { driveOcrConfigured, driveOcrText } from '@/lib/drive-ocr';
import { matchSlip } from '@/lib/do-slip-match';
import { loadSlipChoices } from '@/lib/queries/do-files';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** รูปจากมือถือหลังย่อฝั่งเบราว์เซอร์แล้วไม่ควรเกินนี้ — กันคำขอค้างนานหรือหลุดเพดานของโฮสต์ */
const MAX_BYTES = 4 * 1024 * 1024;

/**
 * อ่าน Slip ค่าแลก D/O ที่ MAY เลือกไว้ แล้วบอกว่าเป็นของงานไหน
 *
 * รับรูปมาอ่านอย่างเดียว ยังไม่เก็บไฟล์ — เก็บตอนผู้ใช้กดแนบหลังตรวจผลแล้ว
 * จับคู่ผิดแล้วเก็บไปเลย แย่กว่าให้เห็นก่อนกด เหมือนหน้าแนบ AN/BL หลายไฟล์
 *
 * อ่านด้วย Google Drive OCR ตัวเดียวกับปุ่มอ่านยอดของ ANN — ฟรี ไม่มีค่าใช้จ่ายต่อใบ
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return Response.json({ ok: false, detail: 'กรุณาเข้าสู่ระบบ' }, { status: 401 });
  if (!roleAllows(user.role, ['MAY'])) {
    return Response.json({ ok: false, detail: 'ไม่มีสิทธิ์' }, { status: 403 });
  }
  if (!driveOcrConfigured()) {
    return Response.json({ ok: false, detail: 'ยังไม่ได้ตั้งค่า Google OAuth สำหรับอ่าน Slip' }, { status: 400 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File) || !file.size) {
    return Response.json({ ok: false, detail: 'ไม่ได้แนบรูป' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ ok: false, detail: 'รูปใหญ่เกิน 4 MB' }, { status: 400 });
  }
  // Drive OCR รับเฉพาะรูป — สลิปที่เป็น PDF ให้เลือกงานเอง
  const mime = file.type || 'image/jpeg';
  if (!mime.startsWith('image/')) {
    return Response.json({ ok: false, detail: 'อ่านอัตโนมัติได้เฉพาะไฟล์รูป — เลือกงานเอง' }, { status: 400 });
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const [text, choices] = await Promise.all([
      driveOcrText(`data:${mime};base64,${bytes.toString('base64')}`),
      loadSlipChoices(),
    ]);
    return Response.json({ ok: true, ...matchSlip(text, choices) });
  } catch (error) {
    return Response.json(
      { ok: false, detail: error instanceof Error ? error.message : 'อ่าน Slip ไม่สำเร็จ' },
      { status: 400 },
    );
  }
}
