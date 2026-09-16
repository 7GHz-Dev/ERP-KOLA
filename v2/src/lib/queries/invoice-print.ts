import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { files, jobs } from '@/db/schema';

/**
 * รายการ BL ที่มีไฟล์ Invoice DO ให้ฝ่ายบัญชีเลือกไปพิมพ์
 *
 * ดูจากไฟล์เป็นหลัก ไม่ได้ดูจากขั้นตอนงาน เพราะบัญชีต้องพิมพ์ย้อนหลังได้ทุกช่วง
 * งานที่เดินจบไปแล้วก็ยังต้องหาเจอ ต่างจากหน้าอื่นที่เป็นคิวงานซึ่งกรองตามขั้น
 */
/**
 * แยกคำค้นที่วางมาเป็นหลายบรรทัดออกเป็นรายการเลข BL
 *
 * บัญชีคัดเลข BL จากไฟล์หรืออีเมลมาวางทีเดียว ซึ่งมักมีบรรทัดว่างคั่น
 * และมีเลขซ้ำกันเพราะคัดมาจากหลายที่ ตัดทิ้งให้ทั้งคู่
 *
 * รับตัวคั่นได้ทั้งขึ้นบรรทัดใหม่ ลูกน้ำ เซมิโคลอน และช่องว่างซ้อน
 * แต่ไม่ตัดที่ช่องว่างเดี่ยว เพราะบางเลขมีช่องว่างอยู่ในตัว
 *
 * เทียบแบบไม่สนตัวพิมพ์เล็กใหญ่ตอนตัดซ้ำ แต่คงรูปที่พิมพ์มาไว้แสดงผล
 */
export function parseBlTerms(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[\n\r,;]+|\s{2,}/)) {
    const term = raw.trim();
    if (!term) continue;
    const key = term.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

export async function listInvoiceDoJobs(search?: string) {
  const terms = parseBlTerms(search ?? '');

  /*
   * หลายเลขพร้อมกัน — เจอเลขไหนก็เอามาแสดงหมด
   *
   * เทียบแบบ "มีข้อความนี้อยู่ใน bl_no" เพื่อให้วางได้ทั้งเลขเต็มที่มีวงเล็บ
   * (KG1222026-68581(ONEYTYOGG8879300)) เลขหน้าวงเล็บ หรือเลขในวงเล็บอย่างเดียว
   * ทั้งสามแบบชี้ไปงานเดียวกัน เพราะฐานข้อมูลเก็บรวมไว้ในช่องเดียว
   */
  if (terms.length > 1) {
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
        or(...terms.map((t) => sql`${jobs.blNo} ilike ${`%${t}%`}`)),
      ))
      .orderBy(desc(files.uploadedAt))
      .limit(300);
  }

  const term = terms[0] ?? '';
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
