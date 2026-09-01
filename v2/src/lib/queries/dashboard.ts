import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { doHandoffs, jobs } from '@/db/schema';
import { latestApproval } from './jobs';

/** ตัวเลขสรุปทั้งหมดใน query เดียว แทนการนับทีละอย่างแบบระบบเดิม */
export async function dashboardSummary() {
  const an = latestApproval('AN');
  const fn = latestApproval('FN');
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      invoiceAlerts: sql<number>`count(*) filter (where ${jobs.hasInvoiceAlert})::int`,
      waitingAn: sql<number>`count(*) filter (where ${an.status} = 'PENDING')::int`,
      waitingFn: sql<number>`count(*) filter (where ${fn.status} = 'PENDING')::int`,
      customsDraft: sql<number>`count(*) filter (where ${jobs.customsStatus} = 'DRAFT')::int`,
      customsFiled: sql<number>`count(*) filter (where ${jobs.customsStatus} = 'FILED')::int`,
      released: sql<number>`count(*) filter (where ${jobs.releaseStatus} = 'RELEASED')::int`,
      surrenderIssue: sql<number>`count(*) filter (where ${jobs.surrenderStatus} = 'ISSUE')::int`,
    })
    .from(jobs)
    .leftJoin(an, eq(an.jobId, jobs.id))
    .leftJoin(fn, eq(fn.jobId, jobs.id))
    .where(eq(jobs.isArchived, false));
  return row;
}

/**
 * ตัวเลขที่ขึ้นข้างเมนูซ้าย — ยกเกณฑ์มาจาก navCount() ของระบบเดิมทั้งหมด
 *
 * รวมเป็น query เดียวและให้ layout เรียก ซึ่งเรนเดอร์พร้อมกับตัวหน้าอยู่แล้ว
 * เวลาที่เพิ่มจึงทับซ้อนกับ query ของหน้า ไม่ได้บวกเข้าไปตรง ๆ
 */
export async function navCounts() {
  const an = latestApproval('AN');
  const fn = latestApproval('FN');
  const [row] = await db
    .select({
      pendingAn: sql<number>`count(*) filter (where ${an.status} = 'PENDING')::int`,
      pendingFn: sql<number>`count(*) filter (where ${fn.status} = 'PENDING')::int`,
      // ต้องตรงกับ QUEUE.fahDraftReview ไม่งั้นเลขข้างเมนูจะนับงานที่ทำใบขนเสร็จแล้วด้วย
      draftReview: sql<number>`count(*) filter (
        where ${jobs.draftStatus} = 'SUBMITTED'
          and ${jobs.customsTaskId} is null
          and ${jobs.customsStatus} <> 'FILED')::int`,
      /*
       * ต้องเท่ากับผลรวมของแท็บ 1-4 ในหน้างานคงค้าง
       *
       * เดิมนับ "งานที่ยังไม่ปล่อย" ทั้งหมด ซึ่งรวมงานที่ไม่ได้รออะไรจาก PAINT แล้ว
       * เช่นงานที่รวมชุด E-Office ครบและรอฝั่งอื่นทำต่อ ตัวเลขจึงสูงกว่าที่เห็นในแท็บมาก
       * เงื่อนไขแต่ละก้อนตรงกับ pendingTabCounts ตัวต่อตัว
       */
      openJobs: sql<number>`count(*) filter (
        where (${an.status} is null or ${an.status} = 'REJECTED')
           or (${an.status} = 'APPROVED'
               and (${fn.status} is null or ${fn.status} = 'REJECTED'))
           or (${fn.status} = 'APPROVED'
               and (${jobs.draftStatus} is null
                    or ${jobs.draftStatus} not in ('SUBMITTED', 'FILED')))
           or (${jobs.customsStatus} = 'FILED'
               and merged.job_id is null and signed.job_id is null))::int`,
      // ต้องตรงกับ QUEUE.pendingEdoc — ตัดงานที่ได้ชุดปล่อยเซ็นแล้วออก
      edoc: sql<number>`count(*) filter (
        where ${jobs.customsStatus} = 'FILED' and signed.job_id is null)::int`,
      // ต้องตรงกับ QUEUE.eofficeSigned('wait') — ยังไม่ได้กดส่ง Partner
      eofficeSignedWait: sql<number>`count(*) filter (
        where ${jobs.customsStatus} = 'FILED' and ${jobs.eofficeSentAt} is null)::int`,
      // ต้องตรงกับ QUEUE.doExchange — ส่ง Partner แล้ว (ทางใดทางหนึ่ง) แต่ยังไม่ได้ทำจดหมาย
      doExchangeWait: sql<number>`count(*) filter (
        where ${jobs.doLetterAt} is null
          and (${jobs.eofficeSentAt} is not null
               or exists (select 1 from do_handoffs dh
                           where dh.job_id = ${jobs.id} and dh.sent_at is not null)))::int`,
      queue: sql<number>`(select count(*) from automation_tasks
                          where status in ('QUEUED', 'PROCESSING'))::int`,
      // ต้องตรงกับ QUEUE.fahDo('wait') — งานที่ผ่าน AN แล้วแต่ยังไม่ได้กดส่ง Partner
      fahDoWait: sql<number>`count(*) filter (
        where ${an.status} = 'APPROVED'
          and not exists (select 1 from do_handoffs dh
                           where dh.job_id = ${jobs.id} and dh.sent_at is not null))::int`,
      // ต้องตรงกับ QUEUE.namCustomer('wait') — ยังไม่ได้กดยืนยันข้อมูลลูกค้า
      namCustomerWait: sql<number>`count(*) filter (
        where ${an.status} = 'APPROVED' and ${jobs.customerConfirmedAt} is null)::int`,
    })
    .from(jobs)
    .leftJoin(an, eq(an.jobId, jobs.id))
    .leftJoin(fn, eq(fn.jobId, jobs.id))
    .leftJoin(
      sql`(select distinct job_id from files
             where category = 'EOFFICE_MERGED' and is_current = true) as merged`,
      sql`merged.job_id = ${jobs.id}`,
    )
    .leftJoin(
      sql`(select distinct job_id from files
             where category = 'EOFFICE_SIGNED' and is_current = true) as signed`,
      sql`signed.job_id = ${jobs.id}`,
    )
    .where(eq(jobs.isArchived, false));
  return row;
}

/**
 * ตัวเลขเตือนบนแท็บของหน้างานคงค้าง
 *
 * แท็บ 1-3 นับ "รายการที่รอให้กดส่งอนุมัติ" ส่วนแท็บ 4 นับงานที่ยังไม่ได้รวมชุด E-Office
 * เงื่อนไขต้องตรงกับ QUEUE ในไฟล์ jobs.ts ไม่งั้นตัวเลขจะไม่ตรงกับจำนวนแถวที่เห็น
 */
export async function pendingTabCounts() {
  const an = latestApproval('AN');
  const fn = latestApproval('FN');
  const [row] = await db
    .select({
      bl: sql<number>`count(*) filter (
        where ${an.status} is null or ${an.status} = 'REJECTED')::int`,
      fn: sql<number>`count(*) filter (
        where ${an.status} = 'APPROVED'
          and (${fn.status} is null or ${fn.status} = 'REJECTED'))::int`,
      draft: sql<number>`count(*) filter (
        where ${fn.status} = 'APPROVED'
          and (${jobs.draftStatus} is null
               or ${jobs.draftStatus} not in ('SUBMITTED', 'FILED')))::int`,
      edoc: sql<number>`count(*) filter (
        where ${jobs.customsStatus} = 'FILED'
          and merged.job_id is null and signed.job_id is null)::int`,
    })
    .from(jobs)
    .leftJoin(an, eq(an.jobId, jobs.id))
    .leftJoin(fn, eq(fn.jobId, jobs.id))
    .leftJoin(
      sql`(select distinct job_id from files
             where category = 'EOFFICE_MERGED' and is_current = true) as merged`,
      sql`merged.job_id = ${jobs.id}`,
    )
    .leftJoin(
      sql`(select distinct job_id from files
             where category = 'EOFFICE_SIGNED' and is_current = true) as signed`,
      sql`signed.job_id = ${jobs.id}`,
    )
    .where(eq(jobs.isArchived, false));
  return row;
}

/** เวลาที่ส่ง DO ให้ Partner ของแต่ละงาน — ใช้บอกว่าแถวไหนส่งไปแล้ว */
export async function doHandoffSentAt(jobIds: string[]) {
  const map = new Map<string, string>();
  if (!jobIds.length) return map;
  const rows = await db
    .select({ jobId: doHandoffs.jobId, sentAt: doHandoffs.sentAt })
    .from(doHandoffs)
    .where(and(inArray(doHandoffs.jobId, jobIds), isNotNull(doHandoffs.sentAt)));
  rows.forEach((r) => { if (r.sentAt) map.set(r.jobId, r.sentAt.toISOString()); });
  return map;
}
