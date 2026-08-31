import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { files, jobs } from '@/db/schema';

/** ไฟล์ที่ใช้เทียบยอดของงานหนึ่ง — Invoice DO กับ Slip */
export async function loadSlipCheck(jobId: string) {
  const [job] = await db
    .select({ id: jobs.id, jobNo: jobs.jobNo, blNo: jobs.blNo })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) return null;

  const rows = await db
    .select({
      id: files.id, category: files.category,
      fileName: files.fileName, mimeType: files.mimeType,
    })
    .from(files)
    .where(and(
      eq(files.jobId, jobId),
      eq(files.isCurrent, true),
      inArray(files.category, ['INVOICE_DO', 'DO_SLIP']),
    ));

  const byCategory = new Map(rows.map((r) => [r.category, r]));
  return {
    job,
    invoiceDo: byCategory.get('INVOICE_DO'),
    slip: byCategory.get('DO_SLIP'),
  };
}
