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

export type ReviewQueue = { approvalIds: string[]; jobIds: string[]; labels: string[]; index: number };

/**
 * ชุดที่ติ๊กตรวจต่อกัน (Approve B/L > ติ๊กหลายรายการ > ตรวจ) — มาจาก ?aq=<approval id คั่นลูกน้ำ>
 * หน้าอนุมัติติ๊กด้วย id ของรายการอนุมัติ จึงแปลงเป็นงานตรงนี้ · id ใน URL เป็นได้ทั้ง id งานหรือ id รายการอนุมัติ (ใบแรก)
 * ป้ายบอกเลข BL + ผลตัดสินแล้ว (อนุมัติ / ตีกลับ) ให้รู้ว่าเหลือกี่ใบ
 */
export async function reviewQueue(id: string, raw: string | string[] | undefined): Promise<{ jobId: string; queue: ReviewQueue | null }> {
  const ids = [...new Set(String(Array.isArray(raw) ? raw[0] : raw ?? '').split(',').map((v) => v.trim()).filter(Boolean))].slice(0, 100);
  const asApproval = async () => (await db.select({ jobId: approvals.jobId }).from(approvals).where(eq(approvals.id, id)).limit(1))[0]?.jobId;
  if (ids.length < 2) return { jobId: (await asApproval()) ?? id, queue: null };
  const rows = await db.select({ id: approvals.id, jobId: approvals.jobId, status: approvals.status, blNo: jobs.blNo, jobNo: jobs.jobNo })
    .from(approvals).innerJoin(jobs, eq(jobs.id, approvals.jobId)).where(inArray(approvals.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const kept = ids.filter((a) => byId.has(a));
  const jobId = byId.get(id)?.jobId ?? id;
  const jobIds = kept.map((a) => byId.get(a)!.jobId);
  const index = jobIds.indexOf(jobId);
  if (kept.length < 2 || index < 0) return { jobId, queue: null };
  const mark = (s: string) => (s === 'APPROVED' ? ' ✓ อนุมัติแล้ว' : s === 'REJECTED' ? ' ✗ ตีกลับแล้ว' : '');
  return {
    jobId,
    queue: { approvalIds: kept, jobIds, index, labels: kept.map((a) => { const r = byId.get(a)!; return `${r.blNo?.trim() || r.jobNo}${mark(r.status)}`; }) },
  };
}
