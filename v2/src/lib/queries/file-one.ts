import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { files, jobs } from '@/db/schema';
import { fileLabel } from '@/lib/queries/job-detail';

/** ข้อมูลไฟล์เดียวสำหรับแผงดูไฟล์ */
export async function loadFileOne(fileId: string) {
  const [row] = await db
    .select({
      id: files.id,
      jobId: files.jobId,
      fileName: files.fileName,
      mimeType: files.mimeType,
      category: files.category,
      jobNo: jobs.jobNo,
    })
    .from(files)
    .innerJoin(jobs, eq(jobs.id, files.jobId))
    .where(eq(files.id, fileId))
    .limit(1);
  if (!row) return null;
  return { ...row, categoryLabel: fileLabel(row.category) };
}
