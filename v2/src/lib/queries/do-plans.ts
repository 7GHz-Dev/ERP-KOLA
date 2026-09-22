import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { doHandoffs, doPlans, jobs, masterRecords } from '@/db/schema';
import { planProgress, type PlanProgress } from '@/lib/do-plan';

/**
 * รายการ Plan แลก DO พร้อมความคืบหน้า — ใช้ร่วมกันทั้งหน้าของ ANN และของ MAY
 *
 * สองหน้านับคนละช่อง (ANN นับ do_exchanged_at, MAY นับ do_claimed_at) แต่โครงเหมือนกัน
 * จึงรับ `track` เข้ามาแทนที่จะเขียน query ซ้ำสองชุด ซึ่งจะมีวันที่แก้ข้างหนึ่งแล้วลืมอีกข้าง
 */
export type PlanTrack = 'exchange' | 'claim';

export type PlanJobRow = {
  id: string;
  jobNo: string;
  blNo: string | null;
  consigneeName: string | null;
  vessel: string | null;
  voyage: string | null;
  eta: string | null;
  demDays: number;
  shipline: string | null;
  terminalName: string | null;
  doPayAmount: string | null;
  hasInvoiceDo: boolean;
  hasSlip: boolean;
  hasMerged: boolean;
  doneAt: string | null;
};

export type PlanRow = {
  id: string;
  planNo: string;
  planDate: string;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
  progress: PlanProgress;
  jobs: PlanJobRow[];
};

const doneColumn = (track: PlanTrack) =>
  track === 'exchange' ? jobs.doExchangedAt : jobs.doClaimedAt;

/**
 * Plan ทั้งหมดพร้อมงานข้างใน
 *
 * ดึงสองรอบ (Plan แล้วค่อยงาน) แทนการ join แล้วมารวมในหน่วยความจำ
 * เพราะจำนวน Plan น้อยมากเมื่อเทียบกับงาน และแบบนี้จำกัดจำนวน Plan ได้ตรง ๆ
 * โดยไม่ต้องเดาว่าแต่ละ Plan มีกี่แถว
 *
 * `openOnly` = เอาเฉพาะชุดที่ยังทำไม่ครบ ซึ่งเป็นสิ่งที่คนเปิดหน้านี้มาดูจริง ๆ
 * ชุดที่ครบแล้วยังเปิดดูย้อนหลังได้จากอีกแท็บ
 */
export async function listDoPlans(
  { track, openOnly = false, limit = 60 }: { track: PlanTrack; openOnly?: boolean; limit?: number },
): Promise<PlanRow[]> {
  const done = doneColumn(track);

  const planRows = await db
    .select({
      id: doPlans.id,
      planNo: doPlans.planNo,
      planDate: doPlans.planDate,
      note: doPlans.note,
      createdAt: doPlans.createdAt,
      createdByName: sql<string | null>`creator.display_name`,
      total: sql<number>`count(dh.job_id)::int`,
      done: sql<number>`count(*) filter (where ${done} is not null)::int`,
    })
    .from(doPlans)
    .leftJoin(sql`do_handoffs as dh`, sql`dh.do_plan_id = ${doPlans.id}`)
    .leftJoin(jobs, sql`${jobs.id} = dh.job_id and ${jobs.isArchived} = false`)
    .leftJoin(sql`users as creator`, sql`creator.id = ${doPlans.createdBy}`)
    .groupBy(doPlans.id, sql`creator.display_name`)
    .orderBy(desc(doPlans.planDate), desc(doPlans.createdAt))
    .limit(limit);

  /*
   * กรองชุดที่ทำครบแล้วออกหลังนับ ไม่ใช่ด้วย HAVING
   *
   * เกณฑ์ "ครบ" อยู่ใน planProgress() ซึ่งถือว่าชุดว่างยังไม่ครบ
   * ถ้าเขียนเป็น HAVING ซ้ำอีกชุด จะมีสองที่ที่ต้องแก้ให้ตรงกันตลอดไป
   */
  const visible = planRows.filter((plan) => {
    const progress: PlanProgress = { done: plan.done, total: plan.total, complete: plan.total > 0 && plan.done === plan.total };
    return openOnly ? !progress.complete : progress.complete;
  });
  if (!visible.length) return [];

  const planIds = visible.map((plan) => plan.id);
  const jobRows = await db
    .select({
      planId: doHandoffs.doPlanId,
      id: jobs.id,
      jobNo: jobs.jobNo,
      blNo: jobs.blNo,
      consigneeName: sql<string | null>`consignee.name`,
      vessel: jobs.vessel,
      voyage: jobs.voyage,
      eta: jobs.eta,
      demDays: jobs.demDays,
      shipline: jobs.shipline,
      terminalName: sql<string | null>`terminal.name`,
      doPayAmount: jobs.doPayAmount,
      hasInvoiceDo: sql<boolean>`exists (select 1 from files f where f.job_id = ${jobs.id}
                                          and f.category = 'INVOICE_DO' and f.is_current = true)`,
      hasSlip: sql<boolean>`exists (select 1 from files f where f.job_id = ${jobs.id}
                                      and f.category = 'DO_SLIP' and f.is_current = true)`,
      hasMerged: sql<boolean>`exists (select 1 from files f where f.job_id = ${jobs.id}
                                        and f.category = 'DO_MERGED' and f.is_current = true)`,
      doneAt: sql<string | null>`${done}`,
    })
    .from(doHandoffs)
    .innerJoin(jobs, eq(jobs.id, doHandoffs.jobId))
    .leftJoin(sql`${masterRecords} as consignee`, sql`consignee.id = ${jobs.consigneeId}`)
    .leftJoin(sql`${masterRecords} as terminal`, sql`terminal.id = ${jobs.terminalId}`)
    .where(and(
      inArray(doHandoffs.doPlanId, planIds),
      eq(jobs.isArchived, false),
    ))
    // เรียงตามวันสุดท้ายของ DEM ก่อน — ใบที่ใกล้ครบกำหนดต้องทำก่อนเสมอ
    .orderBy(sql`${jobs.eta} + (${jobs.demDays} || ' days')::interval`, jobs.jobNo);

  const byPlan = new Map<string, PlanJobRow[]>();
  for (const row of jobRows) {
    const { planId, ...job } = row;
    if (!planId) continue;
    const list = byPlan.get(planId) ?? [];
    list.push(job);
    byPlan.set(planId, list);
  }

  return visible.map((plan) => {
    const list = byPlan.get(plan.id) ?? [];
    return {
      id: plan.id,
      planNo: plan.planNo,
      planDate: plan.planDate,
      note: plan.note,
      createdAt: String(plan.createdAt),
      createdByName: plan.createdByName,
      progress: planProgress(list),
      jobs: list,
    };
  });
}
