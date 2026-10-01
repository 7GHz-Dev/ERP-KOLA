import { asc, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { bls, containers, customsEntries, jobs } from '@/db/schema';

/**
 * ข้อมูลทั้งหมดของงานหนึ่งใบสำหรับหน้าแก้ไข JOB ของ ADMIN
 *
 * ดึงค่าดิบ (id ของ master, ตัวเลขตามที่เก็บ) ไม่ใช่ชื่อที่แปลแล้วแบบหน้าสรุปงาน
 * เพราะต้องเอาไปเติมในช่องกรอก แล้วส่งกลับมาบันทึกเป็นค่าเดิมได้ตรงตัว
 */
export async function loadAdminJob(jobId: string) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) return null;

  const [blRows, containerRows, [entry]] = await Promise.all([
    db.select({ id: bls.id, blNo: bls.blNo, shipperId: bls.shipperId, shipperName: bls.shipperName })
      .from(bls).where(eq(bls.jobId, jobId)).orderBy(asc(bls.createdAt)),
    db.select({
      id: containers.id, runningNo: containers.runningNo, containerNo: containers.containerNo,
      containerType: containers.containerType, sealNo: containers.sealNo, weight: containers.weight,
    }).from(containers).where(eq(containers.jobId, jobId)).orderBy(asc(containers.createdAt)),
    // หน้าสรุปงานโชว์เลขใบขนจากรายการล่าสุด แก้ที่ตัวเดียวกันจะได้เห็นตรงกัน
    db.select({ id: customsEntries.id, declarationNo: customsEntries.declarationNo })
      .from(customsEntries).where(eq(customsEntries.jobId, jobId))
      .orderBy(desc(customsEntries.updatedAt)).limit(1),
  ]);

  return { job, bls: blRows, containers: containerRows, entry: entry ?? null };
}

export type AdminJob = NonNullable<Awaited<ReturnType<typeof loadAdminJob>>>;
