import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { files, jobs } from '@/db/schema';

/**
 * ข้อมูลของงานสำหรับแผงแก้ข้อมูล BL พร้อมไฟล์ต้นทางไว้เปิดดูคู่กัน
 *
 * PAINT ต้องเทียบค่าที่กรอกกับใบ AN/BL ตัวจริงตลอดเวลา
 * เดิมฟอร์มอยู่ในแผงเล็กที่กางจากปุ่มในตาราง เปิดไฟล์ดูทีก็บังฟอร์ม
 * จึงต้องจำเลขแล้วปิดไฟล์กลับมากรอก ซึ่งพลาดง่ายมากกับเลข BL ยาว ๆ
 */
export async function loadBlEdit(jobId: string) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) return null;

  // ไฟล์ต้นทางของงาน — AN หรือ BL แล้วแต่ว่ารับเข้ามาทางไหน
  const rows = await db
    .select({
      id: files.id, category: files.category,
      fileName: files.fileName, mimeType: files.mimeType,
    })
    .from(files)
    .where(and(
      eq(files.jobId, jobId),
      eq(files.isCurrent, true),
      inArray(files.category, ['ARRIVAL_NOTICE', 'BL']),
    ));

  const byCategory = new Map(rows.map((r) => [r.category, r]));
  return {
    job,
    // ใบที่รับเข้ามาเป็นหลักขึ้นก่อน อีกใบเป็นตัวสำรองให้สลับดูได้
    source: byCategory.get(job.sourceType === 'BL' ? 'BL' : 'ARRIVAL_NOTICE')
      ?? byCategory.get('ARRIVAL_NOTICE') ?? byCategory.get('BL'),
    other: byCategory.get(job.sourceType === 'BL' ? 'ARRIVAL_NOTICE' : 'BL'),
  };
}
