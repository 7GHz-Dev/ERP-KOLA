import { and, eq, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { doHandoffs, jobs } from '@/db/schema';
import { latestApproval, notPartnerRelease, QUEUE, type JoinContext } from './jobs';

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
  const [main, waitingBl, people] = await Promise.all([navCountsMain(), waitingBlCount(), queueCounts(PERSON_QUEUES)]);
  return { ...main, waitingBl, ...people };
}

/*
 * ตัวเลขข้างเมนูของหน้าใหม่ — Waiting list และ Pending Jobs ของ Senior / Head Officer
 * ใช้เงื่อนไขตัวเดียวกับหน้า (QUEUE) งานที่ค้างหลายคิวของคนเดียวกันนับครั้งเดียว
 */
const anyOf = (...qs: Array<(ctx: JoinContext) => (SQL | undefined)[]>) =>
  (ctx: JoinContext) => [or(...qs.map((q) => and(...q(ctx)) ?? sql`false`))];

export const SENIOR_QUEUES = {
  do: QUEUE.fahDo('wait'),
  fn: QUEUE.fahFn(),
  draft: QUEUE.fahDraftReview(),
  customs: QUEUE.fahDraftWaiting(),
};
export const HEAD_QUEUES = {
  an: QUEUE.namApprove(),
  customer: QUEUE.namCustomer('wait'),
  haul: QUEUE.haul('wait'),
};
const PERSON_QUEUES = {
  waitingList: QUEUE.waitingList(),
  seniorPending: anyOf(...Object.values(SENIOR_QUEUES)),
  headPending: anyOf(...Object.values(HEAD_QUEUES)),
};

/**
 * Waiting BL ที่ยังรอ AN — แยก query และกลืน error ไว้
 * ตาราง waiting_bls ต้องสร้างด้วย npm run migrate:waiting-bl ก่อน ถ้าเผลอ deploy ก่อนรัน
 * ตัวเลขนี้เป็น 0 แทนที่เมนูทุกหน้าจะล้มตามไปด้วย
 */
async function waitingBlCount(): Promise<number> {
  try {
    const [row] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from waiting_bls where resolved_at is null and cancelled_at is null`);
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

async function navCountsMain() {
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
               and ${jobs.eofficeHandoverAt} is null and signed.job_id is null))::int`,
      // ต้องตรงกับ QUEUE.pendingEdoc — ยังไม่ส่งมอบคนเดินเอกสาร และยังไม่มีชุดปล่อยเซ็นแล้ว
      edoc: sql<number>`count(*) filter (
        where ${jobs.customsStatus} = 'FILED'
          and ${jobs.eofficeHandoverAt} is null and signed.job_id is null)::int`,
      // ต้องตรงกับ QUEUE.eofficeSigned('wait') — ส่งมอบแล้ว (หรืองานเก่าที่มีไฟล์แล้ว) แต่ยังไม่ได้กดส่ง Partner
      eofficeSignedWait: sql<number>`count(*) filter (
        where ${jobs.customsStatus} = 'FILED' and ${jobs.eofficeSentAt} is null
          and (${jobs.eofficeHandoverAt} is not null or signed.job_id is not null))::int`,
      // ต้องตรงกับ QUEUE.doExchange('wait') — ส่ง Partner แล้ว (ทางใดทางหนึ่ง) แต่ยังไม่ได้ส่งแลก DO
      doExchangeWait: sql<number>`count(*) filter (
        where ${jobs.doExchangedAt} is null
          and ${notPartnerRelease(jobs.jobTypeId)}
          and (${jobs.eofficeSentAt} is not null
               or exists (select 1 from do_handoffs dh
                           where dh.job_id = ${jobs.id} and dh.sent_at is not null)))::int`,
      // ต้องตรงกับ QUEUE.mayDoPay('wait') — ส่ง Partner แล้ว แต่ MAY ยังไม่ได้ตั้งเบิก
      mayClaimWait: sql<number>`count(*) filter (
        where ${jobs.doClaimedAt} is null
          and ${notPartnerRelease(jobs.jobTypeId)}
          and (${jobs.eofficeSentAt} is not null
               or exists (select 1 from do_handoffs dh
                           where dh.job_id = ${jobs.id} and dh.sent_at is not null)))::int`,
      queue: sql<number>`(select count(*) from automation_tasks
                          where status in ('QUEUED', 'PROCESSING'))::int`,
      // ต้องตรงกับ QUEUE.haul('wait') — งาน (ไม่ใช่ MUO) ที่ส่ง Partner แล้วแต่ยังมีตู้ที่ไม่ได้ส่งแพลน
      haulWait: sql<number>`count(*) filter (
        where ${jobs.eofficeSentAt} is not null
          and ${notPartnerRelease(jobs.jobTypeId)}
          and exists (select 1 from containers c
                       where c.job_id = ${jobs.id}
                         and not exists (select 1 from haul_plans hp
                                          where hp.container_id = c.id and hp.sent_at is not null)))::int`,
      // ต้องตรงกับ QUEUE.haul('new') — งานที่มีแพลนส่งมาแล้ว MAY ยังรับไม่ครบ
      haulPlanNew: sql<number>`count(*) filter (
        where ${jobs.eofficeSentAt} is not null
          and ${notPartnerRelease(jobs.jobTypeId)}
          and exists (select 1 from haul_plans hp
                       where hp.job_id = ${jobs.id} and hp.sent_at is not null and hp.ack_at is null))::int`,
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
             where category = 'EOFFICE_SIGNED' and is_current = true) as signed`,
      sql`signed.job_id = ${jobs.id}`,
    )
    .where(eq(jobs.isArchived, false));
  return row;
}

/**
 * ตัวเลขเตือนบนแท็บของหน้างานคงค้าง
 *
 * แท็บ 1-3 นับ "รายการที่รอให้กดส่งอนุมัติ" ส่วนแท็บ 4 นับงานที่ยังไม่ได้ส่งมอบคนเดินเอกสาร
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
          and ${jobs.eofficeHandoverAt} is null and signed.job_id is null)::int`,
    })
    .from(jobs)
    .leftJoin(an, eq(an.jobId, jobs.id))
    .leftJoin(fn, eq(fn.jobId, jobs.id))
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

/**
 * นับงานของหลายคิวในรอบเดียว — ใช้กับตัวเลขบนแท็บของหน้า Pending Jobs / Waiting list
 * รับเงื่อนไข QUEUE ตัวเดียวกับที่ตารางใช้ ตัวเลขจึงเท่ากับจำนวนแถวที่เห็นเสมอ
 */
export async function queueCounts<K extends string>(
  queues: Record<K, (ctx: JoinContext) => (SQL | undefined)[]>,
): Promise<Record<K, number>> {
  const an = latestApproval('AN');
  const fn = latestApproval('FN');
  const ctx = { an, fn };
  const cols = Object.fromEntries(Object.entries(queues).map(([k, where]) => [
    k, sql<number>`count(*) filter (where ${and(...(where as (c: JoinContext) => (SQL | undefined)[])(ctx)) ?? sql`false`})::int`,
  ])) as Record<K, SQL<number>>;
  const [row] = await db
    .select(cols)
    .from(jobs)
    .leftJoin(an, eq(an.jobId, jobs.id))
    .leftJoin(fn, eq(fn.jobId, jobs.id))
    .where(eq(jobs.isArchived, false));
  return Object.fromEntries(Object.keys(queues).map((k) => [k, Number((row as Record<string, number>)[k] ?? 0)])) as Record<K, number>;
}
