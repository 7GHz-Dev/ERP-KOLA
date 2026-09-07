import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { files, jobs, masterRecords } from '@/db/schema';
import { letterDate, matchShippingLine, normalizeDestination } from '@/lib/do-letter';

/** ไฟล์ที่ใช้เทียบยอดของงานหนึ่ง — Invoice DO กับ Slip */
export async function loadSlipCheck(jobId: string) {
  const [job] = await db
    .select({ id: jobs.id, jobNo: jobs.jobNo, blNo: jobs.blNo })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) return null;

  const rows = await db
    .select({
      id: files.id, category: files.category,
      fileName: files.fileName, mimeType: files.mimeType,
    })
    .from(files)
    .where(and(
      eq(files.jobId, jobId),
      eq(files.isCurrent, true),
      inArray(files.category, ['INVOICE_DO', 'DO_SLIP']),
    ));

  const byCategory = new Map(rows.map((r) => [r.category, r]));
  return {
    job,
    invoiceDo: byCategory.get('INVOICE_DO'),
    slip: byCategory.get('DO_SLIP'),
  };
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
