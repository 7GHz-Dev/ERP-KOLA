import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { masterRecords } from '@/db/schema';
import { jobById } from '@/lib/cargo-invoice/jobs';

/**
 * ข้อมูลของหน้าต่าง Create FN Invoice (Pending jobs > 2. Final Invoice) — งานที่กด + Shipper พร้อมที่อยู่
 */
export async function loadFnInvoice(jobId: string) {
  const [job, shippers] = await Promise.all([
    jobById(jobId),
    db.select({ id: masterRecords.id, code: masterRecords.code, name: masterRecords.name, address: masterRecords.address })
      .from(masterRecords).where(and(eq(masterRecords.type, 'shippers'), eq(masterRecords.isActive, true))).orderBy(asc(masterRecords.name)),
  ]);
  return job ? { job, shippers } : null;
}
