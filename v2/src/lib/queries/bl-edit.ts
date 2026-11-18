import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { approvals, containers, files, jobs, masterRecords } from '@/db/schema';
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
  // ตู้ของงาน — แก้ในแผงเดียวกัน (เลขตู้ · ขนาด · ซีล · น้ำหนัก)
  const boxes = await db.select({
    id: containers.id, containerNo: containers.containerNo, containerType: containers.containerType,
    sealNo: containers.sealNo, weight: containers.weight,
  }).from(containers).where(eq(containers.jobId, jobId)).orderBy(containers.createdAt, containers.containerNo);
  return {
    job,
    containers: boxes.map((b) => ({
      id: b.id, containerNo: b.containerNo ?? '', containerType: b.containerType ?? '', sealNo: b.sealNo ?? '',
      weight: b.weight === null ? '' : String(Number(b.weight)),
    })),
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

export type EditQueue = { ids: string[]; labels: string[]; index: number };

/**
 * ชุดงานที่เลือกแก้ต่อกัน (Pending jobs > 1. ใส่ข้อมูล BL > ติ๊กหลายรายการ > แก้ไข)
 * มาจาก ?queue=id1,id2,… — เรียงตามลำดับที่เลือกในตาราง · ป้ายเป็นเลข BL (ไม่มีใช้เลขงาน)
 * งานที่ไม่อยู่แล้ว (ถูกลบ) ตัดออก · งานปัจจุบันไม่อยู่ในชุดคืน null (เปิดแบบใบเดียวตามเดิม)
 */
export async function editQueue(current: string, raw: string | string[] | undefined): Promise<EditQueue | null> {
  const ids = [...new Set(String(Array.isArray(raw) ? raw[0] : raw ?? '').split(',').map((v) => v.trim()).filter(Boolean))].slice(0, 100);
  if (ids.length < 2 || !ids.includes(current)) return null;
  const rows = await db.select({ id: jobs.id, jobNo: jobs.jobNo, blNo: jobs.blNo }).from(jobs).where(inArray(jobs.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r.blNo?.trim() || r.jobNo]));
  const kept = ids.filter((id) => byId.has(id));
  return kept.length < 2 ? null : { ids: kept, labels: kept.map((id) => byId.get(id)!), index: kept.indexOf(current) };
}
