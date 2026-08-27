import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '@/db';
import { approvals, files, jobs, masterRecords } from '@/db/schema';

/**
 * ตัวดึงรายการงานกลางที่ทุกหน้าใช้ร่วมกัน
 *
 * ระบบเดิมแต่ละหน้าดึงข้อมูลทั้งระบบมาแล้วกรองในเบราว์เซอร์
 * ตรงนี้ให้ Postgres กรอง เรียง และนับให้ในรอบเดียว หน้าไหนต้องการอะไรก็ส่งเงื่อนไขเข้ามา
 */

export type JobFilter = {
  where?: (ctx: JoinContext) => (SQL | undefined)[];
  search?: Record<string, string>;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
};

export type JoinContext = {
  an: ReturnType<typeof latestApproval>;
  fn: ReturnType<typeof latestApproval>;
};

/** สถานะอนุมัติล่าสุดของแต่ละงาน ให้ Postgres หาด้วย DISTINCT ON ซึ่งใช้ index ได้ */
export function latestApproval(type: 'AN' | 'FN') {
  return db
    .selectDistinctOn([approvals.jobId], {
      jobId: approvals.jobId,
      status: approvals.status,
      id: approvals.id,
      reason: approvals.reason,
    })
    .from(approvals)
    .where(eq(approvals.approvalType, type))
    .orderBy(approvals.jobId, desc(approvals.requestedAt))
    .as(`latest_${type.toLowerCase()}`);
}

const SORTABLE: Record<string, AnyPgColumn> = {
  jobNo: jobs.jobNo,
  blNo: jobs.blNo,
  eta: jobs.eta,
  demDays: jobs.demDays,
  detDays: jobs.detDays,
  draftRefNo: jobs.draftRefNo,
  vessel: jobs.vessel,
  createdAt: jobs.createdAt,
};

const SEARCHABLE: Record<string, (value: string) => SQL> = {
  jobNo: (v) => ilike(jobs.jobNo, `%${v}%`),
  blNo: (v) => ilike(jobs.blNo, `%${v}%`),
  vessel: (v) => ilike(jobs.vessel, `%${v}%`),
  refNo: (v) => ilike(jobs.draftRefNo, `%${v}%`),
  entryNo: (v) => sql`entry.declaration_no ilike ${`%${v}%`}`,
  shipper: (v) => sql`shipper.name ilike ${`%${v}%`}`,
  consignee: (v) => sql`consignee.name ilike ${`%${v}%`}`,
  person: (v) => sql`person.name ilike ${`%${v}%`}`,
  jobType: (v) => sql`job_type.name ilike ${`%${v}%`}`,
  port: (v) => sql`port.name ilike ${`%${v}%`}`,
};

export async function listJobs(filter: JobFilter = {}) {
  const an = latestApproval('AN');
  const fn = latestApproval('FN');

  const conditions: (SQL | undefined)[] = [eq(jobs.isArchived, false)];
  if (filter.where) conditions.push(...filter.where({ an, fn }));

  Object.entries(filter.search ?? {}).forEach(([key, value]) => {
    const build = SEARCHABLE[key];
    if (build && value.trim()) conditions.push(build(value.trim()));
  });

  const sortColumn = SORTABLE[filter.sortBy ?? 'createdAt'] ?? jobs.createdAt;
  const order = filter.sortDir === 'asc' ? asc(sortColumn) : desc(sortColumn);
  const pageSize = Math.min(Math.max(filter.pageSize ?? 100, 1), 300);
  const page = Math.max(filter.page ?? 1, 1);
  const where = and(...(conditions.filter(Boolean) as SQL[]));

  const rows = await db
    .select({
      id: jobs.id,
      jobNo: jobs.jobNo,
      blNo: jobs.blNo,
      vessel: jobs.vessel,
      voyage: jobs.voyage,
      eta: jobs.eta,
      etaIsOfficial: jobs.etaIsOfficial,
      transportDate: jobs.transportDate,
      demDays: jobs.demDays,
      detDays: jobs.detDays,
      sourceType: jobs.sourceType,
      product: jobs.product,
      unitAmount: jobs.unitAmount,
      packageType: jobs.packageType,
      grossWeight: jobs.grossWeight,
      draftRefNo: jobs.draftRefNo,
      draftStatus: jobs.draftStatus,
      draftRejectReason: jobs.draftRejectReason,
      customsStatus: jobs.customsStatus,
      surrenderStatus: jobs.surrenderStatus,
      releaseStatus: jobs.releaseStatus,
      releasePartner: jobs.releasePartner,
      hasInvoiceAlert: jobs.hasInvoiceAlert,
      shipperName: sql<string | null>`shipper.name`,
      consigneeName: sql<string | null>`consignee.name`,
      personName: sql<string | null>`person.name`,
      jobTypeName: sql<string | null>`job_type.name`,
      portName: sql<string | null>`port.name`,
      portCode: sql<string | null>`port.code`,
      terminalId: jobs.terminalId,
      portId: jobs.portId,
      terminalName: sql<string | null>`terminal.name`,
      declarationNo: sql<string | null>`entry.declaration_no`,
      eofficeRequestNo: sql<string | null>`eof.request_no`,
      anStatus: an.status,
      anId: an.id,
      anReason: an.reason,
      fnStatus: fn.status,
      fnId: fn.id,
      fnReason: fn.reason,
      // ไฟล์ปัจจุบันของแต่ละหมวด รวมมาในรอบเดียวกัน หน้าที่ต้องใช้ไฟล์จึงไม่ต้องยิง query ซ้ำ
      currentFiles: sql<Record<string, { id: string; fileName: string }> | null>`cf.files`,
      // นับทั้งหมดมาพร้อมกันในรอบเดียว ประหยัดการไป-กลับฐานข้อมูล
      total: sql<number>`count(*) over()::int`,
    })
    .from(jobs)
    .leftJoin(an, eq(an.jobId, jobs.id))
    .leftJoin(fn, eq(fn.jobId, jobs.id))
    .leftJoin(sql`${masterRecords} as shipper`, sql`shipper.id = ${jobs.shipperId}`)
    .leftJoin(sql`${masterRecords} as consignee`, sql`consignee.id = ${jobs.consigneeId}`)
    .leftJoin(sql`${masterRecords} as person`, sql`person.id = ${jobs.personId}`)
    .leftJoin(sql`${masterRecords} as job_type`, sql`job_type.id = ${jobs.jobTypeId}`)
    .leftJoin(sql`${masterRecords} as port`, sql`port.id = ${jobs.portId}`)
    .leftJoin(sql`${masterRecords} as terminal`, sql`terminal.id = ${jobs.terminalId}`)
    .leftJoin(
      sql`(select distinct on (job_id) job_id, declaration_no from customs_entries order by job_id, updated_at desc) as entry`,
      sql`entry.job_id = ${jobs.id}`,
    )
    .leftJoin(sql`eoffice_requests as eof`, sql`eof.job_id = ${jobs.id}`)
    .leftJoin(
      sql`(select job_id,
                  jsonb_object_agg(category, jsonb_build_object('id', id, 'fileName', file_name)) as files
             from files where is_current = true group by job_id) as cf`,
      sql`cf.job_id = ${jobs.id}`,
    )
    .where(where)
    .orderBy(order)
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return { rows, total: rows.length ? rows[0].total : 0, page, pageSize };
}

export type JobRow = Awaited<ReturnType<typeof listJobs>>['rows'][number];

/** ไฟล์ปัจจุบันของหลายงานพร้อมกัน ไม่ยิงทีละแถว */
export async function currentFilesFor(jobIds: string[]) {
  const map = new Map<string, Record<string, { id: string; fileName: string }>>();
  if (!jobIds.length) return map;

  const rows = await db
    .select({ jobId: files.jobId, category: files.category, id: files.id, fileName: files.fileName })
    .from(files)
    .where(and(inArray(files.jobId, jobIds), eq(files.isCurrent, true)));

  for (const row of rows) {
    const entry = map.get(row.jobId) ?? {};
    entry[row.category] = { id: row.id, fileName: row.fileName };
    map.set(row.jobId, entry);
  }
  return map;
}

/* ---------- เงื่อนไขของแต่ละคิวงาน แปลตรงจากระบบเดิม ---------- */

export const QUEUE = {
  /** งานคงค้าง แท็บ 1 — รอส่งอนุมัติ AN / รออนุมัติ */
  pendingBl: (sub: 'wait' | 'approve') => ({ an }: JoinContext) => [
    sub === 'wait'
      ? or(isNull(an.status), eq(an.status, 'REJECTED'))
      : eq(an.status, 'PENDING'),
  ],
  pendingFn: (sub: 'wait' | 'approve') => ({ an, fn }: JoinContext) => [
    eq(an.status, 'APPROVED'),
    sub === 'wait'
      ? or(isNull(fn.status), eq(fn.status, 'REJECTED'))
      : eq(fn.status, 'PENDING'),
  ],
  /*
   * แท็บ 3 Draft ใบขน — ฝั่ง "รออนุมัติรายการ" ต้องตัดงานที่ FAH ทำใบขนเสร็จแล้วออก
   *
   * ตอนออกเลขใบขน ระบบตั้งแค่ customs_status = 'FILED' ส่วน draft_status ยังค้าง
   * เป็น SUBMITTED อยู่ ถ้าดูแค่ค่านั้น งานที่เสร็จแล้วจะค้างในคิวนี้ตลอดไป
   * งานที่ได้เลขใบขนแล้วจะไปโผล่ที่แท็บ 4 เตรียมเอกสารเดิน E แทน
   */
  pendingDraft: (sub: 'wait' | 'approve') => ({ fn }: JoinContext) => [
    eq(fn.status, 'APPROVED'),
    sub === 'wait'
      ? or(isNull(jobs.draftStatus), sql`${jobs.draftStatus} not in ('SUBMITTED','FILED')`)
      : and(eq(jobs.draftStatus, 'SUBMITTED'), ne(jobs.customsStatus, 'FILED')),
  ],
  pendingEdoc: () => () => [eq(jobs.customsStatus, 'FILED')],

  /** FAH */
  fahDo: () => ({ an }: JoinContext) => [eq(an.status, 'APPROVED')],
  fahFn: () => ({ fn }: JoinContext) => [eq(fn.status, 'PENDING')],
  fahDraftReview: () => () => [
    eq(jobs.draftStatus, 'SUBMITTED'),
    isNull(jobs.customsTaskId),
    sql`${jobs.customsStatus} <> 'FILED'`,
  ],
  fahDraftWaiting: () => () => [
    sql`${jobs.customsTaskId} is not null`,
    sql`${jobs.customsStatus} <> 'FILED'`,
  ],
  fahDraftDone: () => () => [eq(jobs.customsStatus, 'FILED')],

  /** NAMKANG */
  namApprove: () => ({ an }: JoinContext) => [eq(an.status, 'PENDING')],
  namCustomer: () => ({ an }: JoinContext) => [eq(an.status, 'APPROVED')],
  namRelease: () => ({ an }: JoinContext) => [eq(an.status, 'APPROVED')],
} as const;
