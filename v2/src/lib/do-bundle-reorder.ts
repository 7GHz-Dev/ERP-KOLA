import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { files, jobs } from '@/db/schema';
import { buildKey, downloadFile, ensureBucket, uploadFile } from '@/lib/storage';
import { logActivity, newId } from '@/lib/actions/common';
import { checkPageOrder, keepPages } from '@/lib/pdf-pages';
import { REORDERABLE_CATEGORIES } from '@/lib/do-bundle-options';

/**
 * เรียงหน้าชุดแลก DO ที่รวมแล้วใหม่ แล้วเก็บเป็นเวอร์ชันใหม่ของไฟล์เดิม
 *
 * ลำดับตอนรวมชุดเป็นลำดับตั้งต้นตามหัวข้อ แต่สายเรือบางเจ้าขอเรียงต่างออกไป
 * เช่นอยากได้ Invoice คู่กับสลิปของค่าเดียวกัน ให้คนเรียงเองจากชุดจริงตรงนี้
 *
 * เก็บเป็นเวอร์ชันใหม่ ไม่เขียนทับ ย้อนดูชุดก่อนเรียงได้ และปุ่มส่งแลกอ่านไฟล์ปัจจุบันตัวใหม่ทันที
 * รวมชุดใหม่อีกรอบจะได้ลำดับตั้งต้นกลับมา ต้องเรียงใหม่อีกที
 */
export async function reorderMergedPdf(fileId: string, order: unknown, userId: string) {
  const [record] = await db
    .select({
      id: files.id, jobId: files.jobId, category: files.category, version: files.version,
      storageKey: files.storageKey, fileName: files.fileName, note: files.note,
      isCurrent: files.isCurrent, doExchangedAt: jobs.doExchangedAt,
    })
    .from(files)
    .innerJoin(jobs, eq(jobs.id, files.jobId))
    .where(eq(files.id, fileId))
    .limit(1);
  if (!record) throw new Error('ไม่พบไฟล์');
  if (!REORDERABLE_CATEGORIES.includes(record.category)) throw new Error('เรียงหน้าได้เฉพาะชุดแลก DO ที่รวมแล้ว');
  if (!record.isCurrent) throw new Error('มีชุดที่ใหม่กว่านี้แล้ว กรุณาเปิดชุดล่าสุดแล้วเรียงใหม่');
  if (record.doExchangedAt) throw new Error('งานนี้ส่งแลก DO แล้ว เรียงหน้าใหม่ไม่ได้');

  const { body } = await downloadFile(record.storageKey);
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  const total = (await PDFDocument.load(body, { password: '' })).getPageCount();
  const pages = checkPageOrder(order, total);
  const bytes = Buffer.from(await keepPages(body, pages));

  const id = newId('FIL');
  const key = buildKey(record.jobId, record.category, id, record.fileName);
  await ensureBucket();
  await uploadFile(key, bytes, 'application/pdf');

  await db.transaction(async (tx) => {
    // ปลดเฉพาะเมื่อยังเป็นไฟล์ปัจจุบันอยู่ ถ้ามีคนรวมชุดใหม่หรือเรียงไปก่อนหน้า ต้องไม่ทับของเขา
    const released = await tx.update(files)
      .set({ isCurrent: false, supersededBy: id })
      .where(and(eq(files.id, record.id), eq(files.isCurrent, true)))
      .returning({ id: files.id });
    if (!released.length) throw new Error('มีชุดที่ใหม่กว่านี้แล้ว กรุณาเปิดชุดล่าสุดแล้วเรียงใหม่');
    await tx.insert(files).values({
      id, jobId: record.jobId, category: record.category, version: record.version + 1,
      storageKey: key, fileName: record.fileName, mimeType: 'application/pdf',
      sizeBytes: bytes.length, uploadedBy: userId,
      // คงหมายเหตุเดิมไว้ — มีรายการเอกสารที่ยังขาดอยู่ ต้องยังเห็นหลังเรียงหน้า
      note: [record.note, 'เรียงหน้าใหม่แล้ว'].filter(Boolean).join('\n'),
    });
  });
  await logActivity(userId, 'REORDER_PAGES', 'FILE', id, { from: record.id, order: pages });

  return { fileId: id };
}
