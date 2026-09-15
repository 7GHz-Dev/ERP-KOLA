import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { approvals, files, jobs, masterRecords } from '@/db/schema';
import { formatDate } from '@/lib/format';

/**
 * ข้อมูลของงานสำหรับแผงตรวจก่อนอนุมัติของ NAMKANG
 *
 * คืนเป็นคู่ป้าย-ค่าที่จัดรูปแบบแล้ว เพราะฝั่งแผงอ่านอย่างเดียว ไม่ต้องแก้
 * ส่ง id ของ master ไปให้แล้วให้ฝั่งนั้นไปหาชื่อเองจะเปลืองรอบโดยไม่จำเป็น
 */
export async function loadBlReview(jobId: string) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) return null;

  const ids = [job.consigneeId, job.notifyPartyId, job.personId, job.jobTypeId,
    job.portId, job.terminalId].filter(Boolean) as string[];
  const masters = ids.length
    ? await db.select({ id: masterRecords.id, name: masterRecords.name })
        .from(masterRecords).where(inArray(masterRecords.id, ids))
    : [];
  const nameOf = (id: string | null) => masters.find((m) => m.id === id)?.name ?? '';

  const fileRows = await db
    .select({ id: files.id, category: files.category, fileName: files.fileName, mimeType: files.mimeType })
    .from(files)
    .where(and(
      eq(files.jobId, jobId),
      eq(files.isCurrent, true),
      inArray(files.category, ['ARRIVAL_NOTICE', 'BL']),
    ));
  const byCategory = new Map(fileRows.map((r) => [r.category, r]));

  const [approval] = await db.select({ id: approvals.id, status: approvals.status })
    .from(approvals)
    .where(and(eq(approvals.jobId, jobId), eq(approvals.approvalType, 'AN')))
    .orderBy(desc(approvals.requestedAt))
    .limit(1);

  const num = (v: string | null) => (v ? String(Number(v)) : '');

  return {
    job,
    approvalId: approval?.status === 'PENDING' ? approval.id : null,
    source: byCategory.get(job.sourceType === 'BL' ? 'BL' : 'ARRIVAL_NOTICE')
      ?? byCategory.get('ARRIVAL_NOTICE') ?? byCategory.get('BL'),
    other: byCategory.get(job.sourceType === 'BL' ? 'ARRIVAL_NOTICE' : 'BL'),
    rows: [
      ['Job No.', job.jobNo],
      ['B/L No.', job.blNo ?? ''],
      ['BL Type', job.blType ?? ''],
      ['Shipline', job.shipline ?? ''],
      ['Job Type', nameOf(job.jobTypeId)],
      ['Vessel / Voyage', [job.vessel, job.voyage].filter(Boolean).join(' / ')],
      ['ETA', formatDate(job.eta)],
      ['DEM / DET', `${job.demDays} / ${job.detDays}`],
      ['เมืองต้นทาง', job.originPort ?? ''],
      ['Port of Discharge', nameOf(job.portId)],
      ['Port Terminal', nameOf(job.terminalId)],
      ['สินค้า', job.product ?? ''],
      ['จำนวน', [num(job.unitAmount), job.packageType].filter(Boolean).join(' ')],
      ['น้ำหนักรวม (KG)', num(job.grossWeight)],
      ['มูลค่าสินค้า', [num(job.goodsValue), job.goodsCurrency].filter(Boolean).join(' ')],
      ['Consignee', nameOf(job.consigneeId)],
      ['Notify Party', nameOf(job.notifyPartyId)],
      ['ผู้รับผิดชอบ', nameOf(job.personId)],
      ['หมายเหตุถึงลูกค้า', job.customerNote ?? ''],
    ] as Array<[string, string]>,
  };
}
