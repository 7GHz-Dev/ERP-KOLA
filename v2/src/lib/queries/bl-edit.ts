import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { approvals, files, jobs, masterRecords } from '@/db/schema';
import { OTHER_KINDS } from '@/lib/other-cargo';
import { roleAllows } from '@/lib/auth';

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

  // ลบงานได้ตราบที่ AN ยังไม่ถูกอนุมัติ (ยังไม่เข้าตารางหลัก) — ดู actions/job-delete.ts
  const appr = await db.select({ status: approvals.status }).from(approvals).where(eq(approvals.jobId, jobId));
  // ลบแล้วกลับไปรายการที่งานนี้อยู่ — Other cargo อยู่หน้า Other job ของ Head Officer
  const [type] = job.jobTypeId
    ? await db.select({ code: masterRecords.code }).from(masterRecords).where(eq(masterRecords.id, job.jobTypeId)).limit(1)
    : [];
  const code = (type?.code ?? '').trim().toUpperCase();
  const kind = Object.entries(OTHER_KINDS).find(([, k]) => k.code === code)?.[0];
  const byCategory = new Map(rows.map((r) => [r.category, r]));
  return {
    job,
    deletable: !appr.some((a) => a.status === 'APPROVED'),
    waitingApproval: appr.some((a) => a.status === 'PENDING'),
    returnTo: kind ? `/other/${kind}?tab=bl` : '/pending?tab=bl',
    // ใบที่รับเข้ามาเป็นหลักขึ้นก่อน อีกใบเป็นตัวสำรองให้สลับดูได้
    source: byCategory.get(job.sourceType === 'BL' ? 'BL' : 'ARRIVAL_NOTICE')
      ?? byCategory.get('ARRIVAL_NOTICE') ?? byCategory.get('BL'),
    other: byCategory.get(job.sourceType === 'BL' ? 'ARRIVAL_NOTICE' : 'BL'),
  };
}

/** ลบงานแล้วกลับไปไหน — Senior / Head Officer ทำงานจากหน้า Waiting list ส่วน Import Officer จากงานคงค้าง */
export function backTo(data: { job: { sourceType: string | null }; returnTo: string }, role: string) {
  if (data.job.sourceType === 'BL' && !roleAllows(role, ['PAINT']) && !data.returnTo.startsWith('/other/')) return '/waiting-list';
  return data.returnTo;
}
