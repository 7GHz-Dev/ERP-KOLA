import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { files } from '@/db/schema';
import { draftCsv } from '@/lib/cargo-invoice/draft-csv';
import { cargoReader, json } from '@/lib/cargo-invoice/http';
import { downloadFile } from '@/lib/storage';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * CSV สำหรับ Draft ใบขน จาก Final Invoice ที่บันทึกแล้วของงาน (?jobId=) — เลขเครื่องเป็นเลขจริงที่ออกตอนบันทึก
 * ก่อนบันทึกใช้ /api/cargo-invoice/preview (output=csv) หรือ /api/cargo-invoice/normal (mode=csv) แทน
 */
export async function GET(request: Request) {
  const user = await cargoReader();
  if (user instanceof Response) return user;
  const jobId = new URL(request.url).searchParams.get('jobId') ?? '';
  const [file] = await db.select({ key: files.storageKey }).from(files)
    .where(and(eq(files.jobId, jobId), eq(files.category, 'FINAL_INVOICE'), eq(files.isCurrent, true))).limit(1);
  if (!file) return json({ error: 'งานนี้ยังไม่มี Final Invoice' }, 404);
  try {
    const { body } = await downloadFile(file.key);
    return json(await draftCsv(body));
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
}
