import { and, asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { files, jobs } from '@/db/schema';
import { FILE_ORDER } from '@/lib/file-categories';

/**
 * คลังไฟล์ข้อมูล — ไฟล์ปัจจุบันของทุกงาน แถวละงาน ติ๊กหลายงานแล้วดาวน์โหลดเป็น ZIP ทีเดียว
 *
 * ตัวกรองมีชั้นเดียวเป็นแท็บตามขั้นงาน (กับหมวดย่อยในแท็บนั้นถ้าอยากแคบลงอีก)
 * รุ่นแรกเป็นชิปทุกหมวดเรียงห้าแถว เลือกได้หลายหมวด คนใช้บอกว่าเยอะและงง
 *
 * ใช้ไฟล์ปัจจุบัน (is_current) เท่านั้น ฉบับเก่ายังเปิดดูได้จาก Drawer ของงาน
 * ไม่ใช้ currentFiles ที่มากับ listJobs เพราะตัวนั้นเก็บได้หมวดละไฟล์เดียว
 * แต่บางหมวดมีไฟล์ปัจจุบันหลายไฟล์จริง (Slip ค่า DO หลายใบต่องาน)
 */

export type LibraryGroup = { key: string; label: string; categories: string[] };

/** แท็บตามขั้นงาน — หมวดที่ไม่อยู่ในกลุ่มไหนไปอยู่ "อื่น ๆ" */
export const LIBRARY_GROUPS: LibraryGroup[] = [
  { key: 'source', label: 'AN / BL', categories: ['ARRIVAL_NOTICE', 'BL'] },
  {
    key: 'invoice', label: 'Invoice สินค้า',
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

const GROUPED = new Set(LIBRARY_GROUPS.flatMap((g) => g.categories));

/** เรียงหมวดตามขั้นงานจริง หมวดที่ไม่รู้จักไปท้าย */
export function sortCategories(list: string[]) {
  const rank = (c: string) => (FILE_ORDER.indexOf(c) + 1) || 999;
  return [...list].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** หมวดของแท็บนั้นที่มีไฟล์อยู่จริง — "other" = หมวดที่ไม่อยู่ในกลุ่มไหนเลย */
export function groupCategories(group: string, present: string[]): string[] {
  if (group === 'other') return sortCategories(present.filter((c) => !GROUPED.has(c)));
  const def = LIBRARY_GROUPS.find((g) => g.key === group);
  return def ? sortCategories(def.categories.filter((c) => present.includes(c))) : [];
}

/**
 * หมวดที่ใช้กรองจากค่าใน URL
 *   null = ไม่กรอง (ทุกหมวด) · [] = แท็บที่ไม่มีไฟล์เลย
 * หมวดย่อยต้องอยู่ในแท็บที่เลือก กันลิงก์เก่าที่พาหมวดของอีกแท็บติดมา
 */
export function resolveFilter(group: string, cat: string, present: string[]): string[] | null {
  if (!group) return null;
  const inGroup = groupCategories(group, present);
  return cat && inGroup.includes(cat) ? [cat] : inGroup;
}

/** งานที่มีไฟล์ปัจจุบันในหมวดที่กรอง (null = หมวดใดก็ได้) — ใช้เป็น where ของ listJobs */
export function hasFilesIn(categories: string[] | null): SQL {
  if (categories === null) {
    return sql`exists (select 1 from files f where f.job_id = ${jobs.id} and f.is_current = true)`;
  }
  if (!categories.length) return sql`false`;
  return sql`exists (select 1 from files f
                      where f.job_id = ${jobs.id} and f.is_current = true
                        and f.category in (${sql.join(categories.map((c) => sql`${c}`), sql`, `)}))`;
}

/** จำนวนงานต่อหมวด (ไฟล์ปัจจุบัน งานที่ยังไม่ถูกลบ) — ใช้หาหมวดที่มีอยู่จริงและเขียนตัวเลขบนแท็บ */
export async function libraryCategoryCounts() {
  const rows = await db
    .select({ category: files.category, jobId: files.jobId })
    .from(files)
    .innerJoin(jobs, eq(jobs.id, files.jobId))
    .where(and(eq(files.isCurrent, true), eq(jobs.isArchived, false)))
    .groupBy(files.category, files.jobId);
  /*
   * ดึงคู่ (หมวด, งาน) มารวมเอง เพราะตัวเลขบนแท็บต้องนับงานไม่ซ้ำข้ามหลายหมวด
   * งานหนึ่งมีทั้ง Invoice DO และ Slip — แท็บแลก DO ต้องนับเป็นหนึ่งงาน ไม่ใช่สอง
   */
  const jobsByCat = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = jobsByCat.get(r.category) ?? new Set<string>();
    set.add(r.jobId);
    jobsByCat.set(r.category, set);
  }
  const allJobs = new Set(rows.map((r) => r.jobId));
  const jobsIn = (cats: string[]) => {
    const set = new Set<string>();
    cats.forEach((c) => jobsByCat.get(c)?.forEach((id) => set.add(id)));
    return set.size;
  };
  return { present: [...jobsByCat.keys()], perCategory: new Map([...jobsByCat].map(([c, s]) => [c, s.size])), all: allJobs.size, jobsIn };
}

export type LibraryFile = {
  id: string; category: string; fileName: string; version: number; uploadedAt: Date; sizeBytes: number | null;
};

/** ไฟล์ปัจจุบันของงานที่อยู่บนหน้า จัดกลุ่มตามงาน → หมวด */
export async function libraryFiles(jobIds: string[], categories: string[] | null) {
  const map = new Map<string, Map<string, LibraryFile[]>>();
  if (!jobIds.length || (categories && !categories.length)) return map;
  const rows = await db
    .select({
      id: files.id, jobId: files.jobId, category: files.category, fileName: files.fileName,
      version: files.version, uploadedAt: files.uploadedAt, sizeBytes: files.sizeBytes,
    })
    .from(files)
    .where(and(
      inArray(files.jobId, jobIds),
      eq(files.isCurrent, true),
      categories ? inArray(files.category, categories) : undefined,
    ))
    .orderBy(asc(files.uploadedAt));
  for (const { jobId, ...file } of rows) {
    const byCat = map.get(jobId) ?? new Map<string, LibraryFile[]>();
    byCat.set(file.category, [...(byCat.get(file.category) ?? []), file]);
    map.set(jobId, byCat);
  }
  return map;
}
