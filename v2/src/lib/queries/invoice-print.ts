import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { files, jobs } from '@/db/schema';

/**
 * รายการ BL ที่มีไฟล์ Invoice DO ให้ฝ่ายบัญชีเลือกไปพิมพ์
 *
 * ดูจากไฟล์เป็นหลัก ไม่ได้ดูจากขั้นตอนงาน เพราะบัญชีต้องพิมพ์ย้อนหลังได้ทุกช่วง
 * งานที่เดินจบไปแล้วก็ยังต้องหาเจอ ต่างจากหน้าอื่นที่เป็นคิวงานซึ่งกรองตามขั้น
 */
export async function listInvoiceDoJobs(search?: string) {
  const term = (search ?? '').trim();
  return db
    .select({
      jobId: jobs.id,
      jobNo: jobs.jobNo,
      blNo: jobs.blNo,
      eta: jobs.eta,
      shipline: jobs.shipline,
      consigneeName: sql<string | null>`consignee.name`,
      fileId: files.id,
      fileName: files.fileName,
      uploadedAt: files.uploadedAt,
    })
    .from(files)
    .innerJoin(jobs, eq(files.jobId, jobs.id))
    .leftJoin(sql`master_records as consignee`, sql`consignee.id = ${jobs.consigneeId}`)
    .where(and(
      eq(files.category, 'INVOICE_DO'),
      eq(files.isCurrent, true),
      eq(jobs.isArchived, false),
      term
        ? sql`(${jobs.blNo} ilike ${`%${term}%`} or ${jobs.jobNo} ilike ${`%${term}%`}
               or consignee.name ilike ${`%${term}%`})`
        : undefined,
    ))
    .orderBy(desc(files.uploadedAt))
    .limit(300);
}

/** ไฟล์ที่เลือกไว้ เรียงตามลำดับที่ผู้ใช้ติ๊ก เพื่อให้หน้าในไฟล์รวมเรียงตามที่เห็นบนจอ */
export async function invoiceFilesFor(fileIds: string[]) {
  if (!fileIds.length) return [];
  const rows = await db
    .select({
      id: files.id, storageKey: files.storageKey, fileName: files.fileName,
      mimeType: files.mimeType, blNo: jobs.blNo,
    })
    .from(files)
    .innerJoin(jobs, eq(files.jobId, jobs.id))
    .where(and(
      inArray(files.id, fileIds),
      eq(files.category, 'INVOICE_DO'),
      eq(files.isCurrent, true),
      eq(jobs.isArchived, false),
    ));
  const byId = new Map(rows.map((r) => [r.id, r]));
  // คงลำดับที่ผู้ใช้เลือกไว้ ไม่ใช่ลำดับที่ฐานข้อมูลคืนมา
  return fileIds.map((id) => byId.get(id)).filter(Boolean) as typeof rows;
}
