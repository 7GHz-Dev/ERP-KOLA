import { and, asc, desc, eq, ilike, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { containers, haulPlans, jobs, masterRecords } from '@/db/schema';

/**
 * รายการตู้สำหรับแพลนลากตู้ — แถวละตู้ ไม่ใช่แถวละงาน เพราะแพลนรถลากเป็นรายตู้
 *
 * NAMKANG  wait = งานที่ส่ง Partner แล้ว (หน้า Upload ชุดปล่อย E-Office) แต่ตู้ยังไม่ได้ส่งแพลน
 *          sent = ส่งแพลนให้ MAY แล้ว
 * MAY      new  = แพลนที่ส่งมาแล้วยังไม่ได้กดรับ (รวมแพลนที่ NAMKANG เปลี่ยนวันแล้วส่งใหม่)
 *          ack  = รับแพลนแล้ว
 *
 * "ส่ง Partner แล้ว" นับเฉพาะทางของ PAINT (jobs.eoffice_sent_at) — ชุดปล่อยเซ็นแล้ว ตู้ถึงลากออกได้
 * ทางของ FAH (do_handoffs) เป็นแค่การส่ง DO ยังไม่มีชุดปล่อย จึงไม่นับ
 */
export type HaulView = 'wait' | 'sent' | 'new' | 'ack';

export async function listHaulRows(view: HaulView, q = '') {
  const conditions: (SQL | undefined)[] = [
    isNotNull(jobs.eofficeSentAt),
    eq(jobs.isArchived, false),
    view === 'wait' ? isNull(haulPlans.sentAt) : isNotNull(haulPlans.sentAt),
    view === 'new' ? isNull(haulPlans.ackAt) : view === 'ack' ? isNotNull(haulPlans.ackAt) : undefined,
  ];
  const term = q.trim();
  if (term) {
    conditions.push(or(
      ilike(jobs.blNo, `%${term}%`), ilike(jobs.jobNo, `%${term}%`),
      ilike(containers.containerNo, `%${term}%`), ilike(containers.runningNo, `%${term}%`),
      sql`consignee.name ilike ${`%${term}%`}`,
    ));
  }

  /*
   * รอวางแพลน: ส่ง Partner ก่อนขึ้นก่อน (ค้างนานสุดอยู่บน)
   * ส่งแล้ว/ของ MAY: เรียงตามวันลากตู้ วันใกล้สุดอยู่บน ตู้ในงานเดียวกันอยู่ติดกัน
   */
  const order = view === 'wait'
    ? [asc(jobs.eofficeSentAt), asc(jobs.jobNo), asc(containers.containerNo)]
    : view === 'ack'
      ? [desc(haulPlans.haulDate), asc(jobs.jobNo), asc(containers.containerNo)]
      : [asc(haulPlans.haulDate), asc(jobs.jobNo), asc(containers.containerNo)];

  return db.select({
    containerId: containers.id,
    containerNo: containers.containerNo,
    containerType: containers.containerType,
    runningNo: containers.runningNo,
    jobId: jobs.id,
    jobNo: jobs.jobNo,
    blNo: jobs.blNo,
    eta: jobs.eta,
    demDays: jobs.demDays,
    eofficeSentAt: jobs.eofficeSentAt,
    consigneeName: sql<string | null>`consignee.name`,
    terminalName: sql<string | null>`terminal.name`,
    haulDate: haulPlans.haulDate,
    sentAt: haulPlans.sentAt,
    ackAt: haulPlans.ackAt,
  })
    .from(containers)
    .innerJoin(jobs, eq(jobs.id, containers.jobId))
    .leftJoin(haulPlans, eq(haulPlans.containerId, containers.id))
    .leftJoin(sql`${masterRecords} as consignee`, sql`consignee.id = ${jobs.consigneeId}`)
    .leftJoin(sql`${masterRecords} as terminal`, sql`terminal.id = ${jobs.terminalId}`)
    .where(and(...conditions))
    .orderBy(...order)
    .limit(500);
}

export type HaulRow = Awaited<ReturnType<typeof listHaulRows>>[number];

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
      sql`not exists (select 1 from containers c where c.job_id = ${jobs.id})`,
    ))
    .orderBy(desc(jobs.eofficeSentAt))
    .limit(50);
}
