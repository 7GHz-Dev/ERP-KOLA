import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { files, jobs } from '@/db/schema';
import { FILE_ORDER } from '@/lib/file-categories';

/**
 * คลังไฟล์ข้อมูล — ไฟล์ปัจจุบันของทุกงาน แถวละงาน กรองเฉพาะหมวดที่ต้องการได้
 *
 * ใช้ไฟล์ปัจจุบัน (is_current) เท่านั้น ฉบับเก่ายังเปิดดูได้จาก Drawer ของงาน
 * ไม่ใช้ currentFiles ที่มากับ listJobs เพราะตัวนั้นเก็บได้หมวดละไฟล์เดียว
 * แต่บางหมวดมีไฟล์ปัจจุบันหลายไฟล์จริง (Slip ค่า DO หลายใบต่องาน)
 */

/** กลุ่มหมวดตามขั้นงาน — กดชื่อกลุ่มเพื่อเลือกทั้งกลุ่มทีเดียว */
export const LIBRARY_GROUPS: Array<{ key: string; label: string; categories: string[] }> = [
  { key: 'source', label: 'เอกสารต้นเรื่อง', categories: ['ARRIVAL_NOTICE', 'BL'] },
  {
    key: 'invoice', label: 'Invoice สินค้า / Surrender',
    categories: ['INVOICE_GOODS', 'FINAL_INVOICE', 'FINAL_INVOICE_PDF', 'FINAL_INVOICE_ENGINE', 'SURRENDER'],
  },
  { key: 'customs', label: 'ใบขน', categories: ['DRAFT_CSV', 'DRAFT_ENTRY', 'CUSTOMS_ENTRY_DOC'] },
  { key: 'eoffice', label: 'E-Office', categories: ['EOFFICE', 'EOFFICE_REQUEST', 'EOFFICE_MERGED', 'EOFFICE_SIGNED'] },
  {
    key: 'do', label: 'Invoice DO / แลก DO',
    categories: [
      'INVOICE_DO', 'DO_LETTER', 'DO_LETTER_SIGNED', 'DO_LETTER_UPLOADED',
      'DO_SLIP', 'DO_SLIP_DEPOSIT', 'DO_SLIP_DEM', 'DO_SLIP_DET', 'DO_SLIP_LATE',
      'DO_INV_DEPOSIT', 'DO_INV_DEM', 'DO_INV_DET', 'DO_INV_LATE', 'DO_OTHER',
      'DO_MERGED', 'DO_BATCH_MERGED', 'DO_REQUEST_PROOF', 'WEB_PROOF',
    ],
  },
];

/** หมวดที่ไม่อยู่ในกลุ่มไหน (OTHER และหมวดใหม่ที่ยังไม่ได้จัดกลุ่ม) ไปอยู่ "อื่น ๆ" */
export function groupOf(category: string) {
  return LIBRARY_GROUPS.find((g) => g.categories.includes(category))?.key ?? 'other';
}

/** อ่าน ?cat=A,B จาก URL — ตัดค่าที่ไม่ใช่ชื่อหมวดทิ้ง กันคนพิมพ์มั่ว */
export function parseCategories(raw: string): string[] {
  return [...new Set(raw.split(',').map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z_]{2,40}$/.test(c)))];
}

/** เรียงหมวดตามขั้นงานจริง หมวดที่ไม่รู้จักไปท้าย */
export function sortCategories(list: string[]) {
  const rank = (c: string) => (FILE_ORDER.indexOf(c) + 1) || 999;
  return [...list].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** งานที่มีไฟล์ปัจจุบันในหมวดที่เลือก (ไม่เลือก = มีไฟล์หมวดใดก็ได้) — ใช้เป็น where ของ listJobs */
export function hasFilesIn(categories: string[]): SQL {
  return categories.length
    ? sql`exists (select 1 from files f
                   where f.job_id = ${jobs.id} and f.is_current = true
                     and f.category in (${sql.join(categories.map((c) => sql`${c}`), sql`, `)}))`
    : sql`exists (select 1 from files f where f.job_id = ${jobs.id} and f.is_current = true)`;
}

/** จำนวนงานที่มีไฟล์ในแต่ละหมวด — ใช้เขียนตัวเลขบนชิปตัวกรอง */
export async function libraryCategoryCounts() {
  const rows = await db
    .select({
      category: files.category,
      jobs: sql<number>`count(distinct ${files.jobId})::int`,
    })
    .from(files)
    .innerJoin(jobs, eq(jobs.id, files.jobId))
    .where(and(eq(files.isCurrent, true), eq(jobs.isArchived, false)))
    .groupBy(files.category);
  return new Map(rows.map((r) => [r.category, Number(r.jobs)]));
}

export type LibraryFile = {
  id: string; category: string; fileName: string; version: number; uploadedAt: Date; sizeBytes: number | null;
};

/** ไฟล์ปัจจุบันของงานที่อยู่บนหน้า จัดกลุ่มตามงาน → หมวด */
export async function libraryFiles(jobIds: string[], categories: string[]) {
  const map = new Map<string, Map<string, LibraryFile[]>>();
  if (!jobIds.length) return map;
  const rows = await db
    .select({
      id: files.id, jobId: files.jobId, category: files.category, fileName: files.fileName,
      version: files.version, uploadedAt: files.uploadedAt, sizeBytes: files.sizeBytes,
    })
    .from(files)
    .where(and(
      inArray(files.jobId, jobIds),
      eq(files.isCurrent, true),
      categories.length ? inArray(files.category, categories) : undefined,
    ))
    .orderBy(asc(files.uploadedAt));
  for (const { jobId, ...file } of rows) {
    const byCat = map.get(jobId) ?? new Map<string, LibraryFile[]>();
    byCat.set(file.category, [...(byCat.get(file.category) ?? []), file]);
    map.set(jobId, byCat);
  }
  return map;
}
