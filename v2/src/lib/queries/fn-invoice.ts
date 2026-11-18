import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { files, masterRecords } from '@/db/schema';
import { jobById } from '@/lib/cargo-invoice/jobs';

/**
 * ข้อมูลของหน้าต่าง Create FN Invoice (Pending jobs > 2. Final Invoice) — งานที่กด + Shipper พร้อมที่อยู่
 */
export async function loadFnInvoice(jobId: string) {
  const [job, shippers, goods] = await Promise.all([
    jobById(jobId),
    db.select({ id: masterRecords.id, code: masterRecords.code, name: masterRecords.name, address: masterRecords.address })
      .from(masterRecords).where(and(eq(masterRecords.type, 'shippers'), eq(masterRecords.isActive, true))).orderBy(asc(masterRecords.name)),
    db.select({ id: files.id, fileName: files.fileName }).from(files)
      .where(and(eq(files.jobId, jobId), eq(files.category, 'INVOICE_GOODS'), eq(files.isCurrent, true))).limit(1),
  ]);
  return job ? { job, shippers, goods: goods[0] ?? null } : null;
}
