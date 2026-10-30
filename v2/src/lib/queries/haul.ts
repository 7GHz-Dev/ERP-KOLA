import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { containers, haulPlans, jobs } from '@/db/schema';
import { notPartnerRelease } from './jobs';

/**
 * แพลนลากตู้ — หน้าแสดงแถวละงานแบบทะเบียนงาน (QUEUE.haul ใน queries/jobs.ts)
 * แต่แพลนยังเก็บรายตู้ใน haul_plans เพราะฝั่ง SHIPME จะผูกรถ/คนขับรายตู้ภายหลัง
 *
 * NAMKANG  wait = งานที่ส่ง Partner แล้ว (หน้า Upload ชุดปล่อย E-Office) ยังมีตู้ที่ไม่ได้ส่งแพลน
 *          sent = ส่งแพลนครบทุกตู้แล้ว
 * MAY      new  = แพลนที่ส่งมาแล้วยังรับไม่ครบ (รวมแพลนที่ NAMKANG เปลี่ยนวันแล้วส่งใหม่)
 *          ack  = รับแพลนครบแล้ว
 *
 * "ส่ง Partner แล้ว" นับเฉพาะทางของ PAINT (jobs.eoffice_sent_at) — ชุดปล่อยเซ็นแล้ว ตู้ถึงลากออกได้
 * ทางของ FAH (do_handoffs) เป็นแค่การส่ง DO ยังไม่มีชุดปล่อย จึงไม่นับ
 * งาน MUO ไม่เข้า เพราะ Partner ภายนอกลากตู้เอง
 */
export type HaulView = 'wait' | 'sent' | 'new' | 'ack';

export type HaulSummary = {
  /** จำนวนตู้ของงาน · ส่งแพลนแล้ว · MAY รับแล้ว */
  containers: number;
  planned: number;
  acked: number;
  /** วันลากตู้ — งานเดียวกันปกติวันเดียว ตู้คนละวันได้จากแพลนเก่ารายตู้หรือตู้ที่เพิ่มทีหลัง */
  firstDate: string | null;
  lastDate: string | null;
  sentAt: Date | null;
  ackAt: Date | null;
};

/** สรุปแพลนของหลายงานพร้อมกัน ไม่ยิงทีละแถว */
export async function haulSummaries(jobIds: string[]): Promise<Map<string, HaulSummary>> {
  const map = new Map<string, HaulSummary>();
  if (!jobIds.length) return map;
  const rows = await db.select({
    jobId: containers.jobId,
    containers: sql<number>`count(*)::int`,
    planned: sql<number>`count(${haulPlans.sentAt})::int`,
    acked: sql<number>`count(${haulPlans.ackAt})::int`,
    firstDate: sql<string | null>`min(${haulPlans.haulDate})::text`,
    lastDate: sql<string | null>`max(${haulPlans.haulDate})::text`,
    sentAt: sql<Date | null>`max(${haulPlans.sentAt})`,
    ackAt: sql<Date | null>`max(${haulPlans.ackAt})`,
  })
    .from(containers)
    .leftJoin(haulPlans, eq(haulPlans.containerId, containers.id))
    .where(inArray(containers.jobId, jobIds))
    .groupBy(containers.jobId);
  for (const r of rows) {
    map.set(r.jobId, {
      ...r,
      sentAt: r.sentAt ? new Date(r.sentAt) : null,
      ackAt: r.ackAt ? new Date(r.ackAt) : null,
    });
  }
  return map;
}

/**
 * งานที่ส่ง Partner แล้วแต่ไม่มีรายการตู้เลย — ลากตู้ไม่ได้จนกว่าจะเพิ่มตู้ในข้อมูลงาน
 * แสดงแยกไว้ให้เห็น ไม่ปล่อยให้หายไปจากหน้าจอเฉย ๆ
 */
export async function sentJobsWithoutContainers() {
  return db.select({ id: jobs.id, jobNo: jobs.jobNo, blNo: jobs.blNo })
    .from(jobs)
    .where(and(
      isNotNull(jobs.eofficeSentAt),
      eq(jobs.isArchived, false),
      notPartnerRelease(jobs.jobTypeId),
      sql`not exists (select 1 from containers c where c.job_id = ${jobs.id})`,
    ))
    .orderBy(desc(jobs.eofficeSentAt))
    .limit(50);
}
