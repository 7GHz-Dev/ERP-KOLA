import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { files, jobs, masterRecords } from '@/db/schema';
import { letterDate, matchShippingLine, normalizeDestination } from '@/lib/do-letter';
import { sentToPartner } from '@/lib/queries/jobs';
import type { SlipChoice } from '@/lib/do-slip-match';
import {
  compareDoAttach, DO_DOC_CATEGORIES, DO_SLIP_CATEGORIES, type DoAttachment,
} from '@/lib/do-attachments';

export async function loadDoPayBatch(ids: string[]) {
  if (!ids.length || ids.length > 100) return null;
  const selected = await db.select({
    id: jobs.id, jobNo: jobs.jobNo, blNo: jobs.blNo, eta: jobs.eta,
    shipline: jobs.shipline, doPayAmount: jobs.doPayAmount, doDepositAmount: jobs.doDepositAmount,
    doOtherAmount: jobs.doOtherAmount, doOtherLabel: jobs.doOtherLabel,
    doClaimedAt: jobs.doClaimedAt,
  }).from(jobs).where(and(inArray(jobs.id, ids), eq(jobs.isArchived, false)));
  if (selected.length !== ids.length) return null;
  const invoices = await db.select({
    id: files.id, jobId: files.jobId, fileName: files.fileName, mimeType: files.mimeType,
  }).from(files).where(and(inArray(files.jobId, ids), eq(files.category, 'INVOICE_DO'), eq(files.isCurrent, true)));
  const byId = new Map(selected.map(job => [job.id, job]));
  const byJob = new Map(invoices.map(file => [file.jobId, file]));
  return ids.map(id => ({ job: byId.get(id)!, invoiceDo: byJob.get(id) }));
}

/**
 * Slip กับเอกสารแลก D/O ของหลายงานในรอบเดียว — แยกเป็นสองกองตามชนิด
 *
 * ไม่ใช้ currentFiles ของ listJobs เพราะตัวนั้นเก็บได้ไฟล์เดียวต่อหมวด
 * แต่หมวดพวกนี้มีหลายใบต่องาน ถ้าใช้ตัวเดิมจะเห็นแค่ใบเดียวแล้วใบอื่นหายไปเงียบ ๆ
 */
export async function doAttachmentsFor(jobIds: string[]) {
  const map = new Map<string, { slips: DoAttachment[]; docs: DoAttachment[] }>();
  if (!jobIds.length) return map;
  const rows = await db
    .select({
      id: files.id, jobId: files.jobId, category: files.category,
      fileName: files.fileName, mimeType: files.mimeType, note: files.note,
      uploadedAt: files.uploadedAt,
    })
    .from(files)
    .where(and(
      inArray(files.jobId, jobIds),
      eq(files.isCurrent, true),
      inArray(files.category, [...DO_SLIP_CATEGORIES, ...DO_DOC_CATEGORIES]),
    ));
  rows.sort(compareDoAttach);
  for (const r of rows) {
    const entry = map.get(r.jobId) ?? { slips: [], docs: [] };
    const file = { id: r.id, category: r.category, fileName: r.fileName, mimeType: r.mimeType, note: r.note };
    (DO_SLIP_CATEGORIES.includes(r.category) ? entry.slips : entry.docs).push(file);
    map.set(r.jobId, entry);
  }
  return map;
}

/** ไฟล์ที่ใช้เทียบยอดของงานหนึ่ง — Invoice DO กับ Slip ทุกใบ */
export async function loadSlipCheck(jobId: string) {
  const [job] = await db
    .select({ id: jobs.id, jobNo: jobs.jobNo, blNo: jobs.blNo })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) return null;

  const [invoiceDo] = await db
    .select({ id: files.id, fileName: files.fileName, mimeType: files.mimeType })
    .from(files)
    .where(and(eq(files.jobId, jobId), eq(files.isCurrent, true), eq(files.category, 'INVOICE_DO')))
    .limit(1);

  return { job, invoiceDo, slips: (await doAttachmentsFor([jobId])).get(jobId)?.slips ?? [] };
}

/**
 * ข้อมูลของแผงกรอกยอดชำระของ MAY — Invoice DO กับค่าที่ใช้ประกอบข้อความเบิก
 *
 * ดึงค่าที่ข้อความเบิกต้องใช้มาจากงานโดยตรง (BL · ETA · สายเรือ · ยอดที่เคยกรอก)
 * แผงจึงประกอบข้อความได้เองโดยไม่ต้องรอตารางส่งค่าลงมา และรีเฟรชหน้าก็ยังได้ค่าครบ
 */
export async function loadDoPay(jobId: string) {
  const [job] = await db
    .select({
      id: jobs.id, jobNo: jobs.jobNo, blNo: jobs.blNo,
      eta: jobs.eta, shipline: jobs.shipline, doPayAmount: jobs.doPayAmount,
      doDepositAmount: jobs.doDepositAmount,
      doOtherAmount: jobs.doOtherAmount, doOtherLabel: jobs.doOtherLabel,
      doClaimedAt: jobs.doClaimedAt,
      consigneeName: sql<string | null>`consignee.name`,
    })
    .from(jobs)
    .leftJoin(sql`${masterRecords} as consignee`, sql`consignee.id = ${jobs.consigneeId}`)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) return null;

  const [invoiceDo] = await db
    .select({
      id: files.id, fileName: files.fileName, mimeType: files.mimeType,
    })
    .from(files)
    .where(and(
      eq(files.jobId, jobId),
      eq(files.category, 'INVOICE_DO'),
      eq(files.isCurrent, true),
    ))
    .limit(1);

  /*
   * ใบถัดไปที่ยังรอตั้งเบิก — ปุ่ม "ถัดไป" ในแผงพาไปต่อได้เลย
   *
   * บนมือถือ MAY ไล่ทำทีละใบจนหมด ถ้าต้องปิดแผงกลับไปหาแถวถัดไปในตารางเอง
   * จะเสียจังหวะทุกใบ
   *
   * ต้องเป็นใบที่ "อยู่หลังใบนี้" ตามลำดับที่หน้าแสดง (เข้าคิวก่อนขึ้นก่อน)
   * ไม่ใช่ใบเก่าสุดที่ยังค้าง ไม่งั้นพอเปิดใบที่สองแล้วกดถัดไป มันจะย้อนกลับ
   * มาใบแรกแล้ววนอยู่สองใบนั้นไปเรื่อย ๆ ไม่มีทางไล่จนจบ
   *
   * เทียบด้วยคู่ (เวลาเข้าคิว, id) เพราะงานที่เข้าคิวเวลาเดียวกันเป๊ะมีจริง
   * ถ้าเทียบเวลาอย่างเดียวจะข้ามใบที่เวลาชนกันไป id เป็นตัวตัดสินให้ลำดับนิ่ง
   *
   * เงื่อนไขที่เหลือต้องตรงกับ QUEUE.mayDoPay('wait') ไม่งั้นปุ่มจะพาไปงานนอกแท็บ
   */
  const arrived = sql`least(${jobs.eofficeSentAt}, handoff.sent_at)`;
  const [next] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .leftJoin(
      sql`(select job_id, min(sent_at) as sent_at from do_handoffs
            where sent_at is not null group by job_id) as handoff`,
      sql`handoff.job_id = ${jobs.id}`,
    )
    .where(and(
      eq(jobs.isArchived, false),
      sql`(${jobs.eofficeSentAt} is not null or handoff.sent_at is not null)`,
      isNull(jobs.doClaimedAt),
      sql`(${arrived}, ${jobs.id}) > (
            select least(j2.eoffice_sent_at, h2.sent_at), j2.id
              from jobs j2
              left join (select job_id, min(sent_at) as sent_at from do_handoffs
                          where sent_at is not null group by job_id) as h2
                     on h2.job_id = j2.id
             where j2.id = ${jobId})`,
    ))
    .orderBy(sql`${arrived} asc, ${jobs.id} asc`)
    .limit(1);

  return { job, invoiceDo, nextId: next?.id ?? null };
}

/**
 * ข้อมูลสำหรับหน้าแก้ข้อความจดหมายแลก D/O
 *
 * คืนสองชุดคู่กัน — ค่าที่คำนวณจากงาน (ใช้เป็น placeholder ให้เห็นว่าถ้าไม่แก้จะได้อะไร)
 * กับค่าที่ผู้ใช้เคยแก้ไว้ ช่องที่ยังไม่เคยแก้จึงว่าง แต่ผู้ใช้ยังเห็นค่าจริงที่จะถูกพิมพ์
 */
export async function loadDoLetterText(jobId: string) {
  const [job] = await db
    .select({
      id: jobs.id, jobNo: jobs.jobNo, shipline: jobs.shipline,
      blNo: jobs.blNo, vessel: jobs.vessel, voyage: jobs.voyage,
      eta: jobs.eta, portId: jobs.portId, originPort: jobs.originPort,
      doLetterBlNo: jobs.doLetterBlNo,
      doLetterOrigin: jobs.doLetterOrigin,
      doLetterDestination: jobs.doLetterDestination,
      doLetterVessel: jobs.doLetterVessel,
      doLetterEta: jobs.doLetterEta,
    })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) return null;

  const [port] = job.portId
    ? await db.select({ name: masterRecords.name })
        .from(masterRecords).where(eq(masterRecords.id, job.portId)).limit(1)
    : [undefined];

  const [letter] = await db
    .select({ id: files.id, fileName: files.fileName })
    .from(files)
    .where(and(
      eq(files.jobId, jobId),
      eq(files.category, 'DO_LETTER'),
      eq(files.isCurrent, true),
    ))
    .limit(1);

  return {
    job,
    letter,
    line: matchShippingLine(job.shipline),
    /*
     * ค่าที่จะถูกพิมพ์ถ้าไม่แก้อะไรเลย
     *
     * เมืองต้นทางแสดงเฉพาะที่กรอกไว้เอง ไม่ไปอ่านจากไฟล์ PDF ตรงนี้
     * เพราะการเปิดไฟล์อ่านช้าเกินกว่าจะทำตอนเปิดฟอร์ม ตอนออกจดหมายจริงยังอ่านให้เหมือนเดิม
     */
    fromJob: {
      blNo: job.blNo,
      origin: (job.originPort ?? '').trim().toUpperCase() || null,
      destination: normalizeDestination(port?.name ?? null) || null,
      vessel: [job.vessel, job.voyage].filter(Boolean).join('  V. ') || null,
      eta: letterDate(job.eta ?? null) || null,
    },
    edited: {
      blNo: job.doLetterBlNo,
      origin: job.doLetterOrigin,
      destination: job.doLetterDestination,
      vessel: job.doLetterVessel,
      eta: job.doLetterEta,
    },
  };
}

/**
 * งานที่ MAY แนบ Slip ค่าแลก D/O ได้ — ชุดเดียวกับสองแท็บในหน้ายอดชำระ
 *
 * คือทุกงานที่ส่งเข้าคิวแลก DO แล้ว ทั้งที่ยังรอตั้งเบิกและตั้งเบิกแล้ว ไม่ว่า ANN ส่งแลกหรือยัง
 * สลิปมักตามมาหลังตั้งเบิก (โอนเงินหลังได้อนุมัติ) และหลัง ANN ส่งแลกไปแล้วด้วย
 * ใช้ทั้งตอนจับคู่ฝั่งเซิร์ฟเวอร์และเป็นตัวเลือกให้คนเลือกเอง สองฝั่งจึงเห็นชุดเดียวกัน
 */
export async function loadSlipChoices(): Promise<SlipChoice[]> {
  const rows = await db
    .select({
      jobId: jobs.id, jobNo: jobs.jobNo, blNo: jobs.blNo,
      consigneeName: sql<string | null>`consignee.name`,
      hasSlip: sql<boolean>`exists (select 1 from files f
        where f.job_id = ${jobs.id} and f.category = 'DO_SLIP' and f.is_current)`,
    })
    .from(jobs)
    .leftJoin(sql`${masterRecords} as consignee`, sql`consignee.id = ${jobs.consigneeId}`)
    .where(and(
      eq(jobs.isArchived, false),
      sentToPartner(),
    ))
    .orderBy(desc(jobs.createdAt));
  return rows
    .filter((r) => r.blNo)
    .map((r) => ({ ...r, blNo: r.blNo ?? '', hasSlip: Boolean(r.hasSlip) }));
}
