import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { eofficeRequests, files, jobs } from '@/db/schema';
import { buildKey, downloadFile, ensureBucket, uploadFile } from '@/lib/storage';
import { logActivity, newId } from '@/lib/actions/common';
import { renderEofficeRequestPdf } from '@/lib/eoffice-pdf';
import { xlsxToPdf } from '@/lib/xlsx-pdf';

/**
 * ชุดเอกสาร E-Office
 *
 * ลำดับเดียวกับชุดที่ยื่นจริง ยกมาจาก BUNDLE_PARTS ของระบบเดิม:
 *   1. คำร้อง  2. ใบขนสินค้า  3. Final Invoice  4. Arrival Notice หรือ BL
 *
 * ระบบเดิมต้องส่งไฟล์ทั้งหมดไปต่อกันที่เบราว์เซอร์ เพราะ Apps Script รวม PDF ไม่ได้
 * ตรงนี้รวมที่เซิร์ฟเวอร์ ไฟล์ไม่ต้องวิ่งผ่านเครื่องผู้ใช้
 */

export const BUNDLE_PARTS: Array<{ label: string; categories: string[] }> = [
  { label: 'คำร้อง', categories: ['EOFFICE_REQUEST'] },
  { label: 'ใบขนสินค้า', categories: ['CUSTOMS_ENTRY_DOC'] },
  { label: 'Final Invoice', categories: ['FINAL_INVOICE_PDF', 'FINAL_INVOICE'] },
  { label: 'Arrival Notice / BL', categories: ['ARRIVAL_NOTICE', 'BL'] },
];

export const MERGED_CATEGORY = 'EOFFICE_MERGED';

const A4 = { width: 595.28, height: 841.89 };

function isPdf(body: Buffer) {
  return body.subarray(0, 5).toString('latin1') === '%PDF-';
}
function isJpeg(body: Buffer) {
  return body[0] === 0xff && body[1] === 0xd8;
}
function isPng(body: Buffer) {
  return body.subarray(1, 4).toString('latin1') === 'PNG';
}

export type BundleStep = {
  index: number;
  total: number;
  label: string;
  status: 'reading' | 'added' | 'skipped' | 'saving' | 'done';
  detail?: string;
};

/**
 * ต่อเอกสารหนึ่งชิ้นเข้าไปในชุด
 *
 * ไฟล์จากสายเรือมักถูกล็อกไม่ให้แก้ไข (เข้ารหัสไว้โดยที่รหัสผ่านผู้อ่านเป็นค่าว่าง)
 * ต้องถอดรหัสจริงด้วย password: '' — ถ้าใช้ ignoreEncryption จะเปิดได้แต่เนื้อในหายหมด
 * กลายเป็นหน้าขาวทั้งหน้า ซึ่งดูเผิน ๆ เหมือนรวมสำเร็จแล้ว
 */
async function appendPart(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  merged: any, body: Buffer, fileName: string,
): Promise<number> {
  const { PDFDocument } = await import('@cantoo/pdf-lib');

  if (isPdf(body)) {
    const source = await PDFDocument.load(body, { password: '' });
    const pages = await merged.copyPages(source, source.getPageIndices());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pages.forEach((page: any) => merged.addPage(page));
    return pages.length;
  }

  // คำร้องที่สแกนหรือถ่ายรูปมาเป็นไฟล์ภาพ ระบบเดิมก็แปลงให้เป็นหน้าหนึ่งหน้าเหมือนกัน
  if (isJpeg(body) || isPng(body)) {
    const image = isJpeg(body) ? await merged.embedJpg(body) : await merged.embedPng(body);
    const page = merged.addPage([A4.width, A4.height]);
    const margin = 24;
    const scale = Math.min(
      (A4.width - margin * 2) / image.width,
      (A4.height - margin * 2) / image.height,
    );
    const w = image.width * scale;
    const h = image.height * scale;
    page.drawImage(image, {
      x: (A4.width - w) / 2,
      y: (A4.height - h) / 2,
      width: w,
      height: h,
    });
    return 1;
  }

  throw new Error(`${fileName} ไม่ใช่ PDF หรือรูปภาพ`);
}

/** รวมชุดแล้วเก็บกลับเข้าระบบ ส่งความคืบหน้าออกมาทีละชิ้น */
export async function buildBundle(
  jobId: string,
  userId: string,
  onStep?: (step: BundleStep) => void | Promise<void>,
) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new Error('ไม่พบงาน');

  const current = await db
    .select()
    .from(files)
    .where(and(eq(files.jobId, jobId), eq(files.isCurrent, true)));
  const byCategory = new Map(current.map((f) => [f.category, f]));

  const { PDFDocument } = await import('@cantoo/pdf-lib');
  const merged = await PDFDocument.create();
  const used: string[] = [];
  const skipped: string[] = [];
  const total = BUNDLE_PARTS.length + 1;

  // ออกคำร้องไว้แล้วแต่ยังไม่มีไฟล์ ให้ระบบสร้างก่อนเริ่มรวม
  if (!byCategory.has('EOFFICE_REQUEST')) {
    const [req] = await db.select({ id: eofficeRequests.id }).from(eofficeRequests)
      .where(eq(eofficeRequests.jobId, jobId)).limit(1);
    if (req) {
      try {
        await storeRequestPdf(jobId, userId);
        const [made] = await db.select().from(files).where(and(
          eq(files.jobId, jobId), eq(files.category, 'EOFFICE_REQUEST'), eq(files.isCurrent, true),
        )).limit(1);
        if (made) byCategory.set('EOFFICE_REQUEST', made);
      } catch (error) {
        skipped.push(`คำร้อง (${error instanceof Error ? error.message : 'สร้างไม่สำเร็จ'})`);
      }
    }
  }

  // Final Invoice เป็น Excel แต่ยังไม่มีตัว PDF ให้แปลงก่อนเริ่มรวม
  if (!byCategory.has('FINAL_INVOICE_PDF') && byCategory.has('FINAL_INVOICE')) {
    const source = byCategory.get('FINAL_INVOICE')!;
    if (!source.storageKey.startsWith('drive:') && /\.xlsx?$/i.test(source.fileName)) {
      try {
        const { body } = await downloadFile(source.storageKey);
        const madeId = await storeInvoicePdf(jobId, userId, body);
        if (madeId) {
          const [made] = await db.select().from(files).where(eq(files.id, madeId)).limit(1);
          if (made) byCategory.set('FINAL_INVOICE_PDF', made);
        }
      } catch (error) {
        skipped.push(`Final Invoice (แปลงไม่สำเร็จ: ${
          error instanceof Error ? error.message : 'ไม่ทราบสาเหตุ'})`);
      }
    }
  }

  for (let i = 0; i < BUNDLE_PARTS.length; i += 1) {
    const part = BUNDLE_PARTS[i];
    const record = part.categories.map((c) => byCategory.get(c)).find(Boolean);
    await onStep?.({ index: i, total, label: part.label, status: 'reading' });

    if (!record) {
      skipped.push(`${part.label} (ยังไม่มีไฟล์)`);
      await onStep?.({ index: i, total, label: part.label, status: 'skipped', detail: 'ยังไม่มีไฟล์' });
      continue;
    }
    if (record.storageKey.startsWith('drive:')) {
      skipped.push(`${part.label} (ยังอยู่ที่ Drive เดิม)`);
      await onStep?.({ index: i, total, label: part.label, status: 'skipped', detail: 'ยังอยู่ที่ Drive เดิม' });
      continue;
    }

    try {
      const { body } = await downloadFile(record.storageKey);
      const pages = await appendPart(merged, body, record.fileName);
      used.push(`${part.label} (${pages} หน้า)`);
      await onStep?.({
        index: i, total, label: part.label, status: 'added', detail: `${pages} หน้า`,
      });
    } catch (error) {
      const why = error instanceof Error ? error.message : 'อ่านไฟล์ไม่ได้';
      const hint = /password|encrypt/i.test(why)
        ? 'ไฟล์ถูกล็อกด้วยรหัสผ่าน ต้องบันทึกใหม่เป็น PDF ที่เปิดได้ก่อน'
        : /ไม่ใช่ PDF/.test(why)
          ? `${why} — พิมพ์เป็น PDF แล้วอัปโหลดใหม่`
          : why;
      skipped.push(`${part.label} (${hint})`);
      await onStep?.({ index: i, total, label: part.label, status: 'skipped', detail: hint });
    }
  }

  if (!used.length) {
    throw new Error(`ไม่มีไฟล์ที่รวมได้เลย — ${skipped.join(' · ')}`);
  }

  await onStep?.({ index: BUNDLE_PARTS.length, total, label: 'บันทึกชุดที่รวมแล้ว', status: 'saving' });

  const bytes = Buffer.from(await merged.save());
  const fileName = `${job.jobNo} [รวมชุด E-Office].pdf`;
  const id = newId('FIL');
  const key = buildKey(jobId, MERGED_CATEGORY, id, fileName);

  await ensureBucket();
  await uploadFile(key, bytes, 'application/pdf');

  const previous = byCategory.get(MERGED_CATEGORY);
  const version = (previous?.version ?? 0) + 1;
  await db.update(files).set({ isCurrent: false, supersededBy: id })
    .where(and(eq(files.jobId, jobId), eq(files.category, MERGED_CATEGORY), eq(files.isCurrent, true)));

  await db.insert(files).values({
    id, jobId, category: MERGED_CATEGORY, version,
    storageKey: key, fileName, mimeType: 'application/pdf',
    sizeBytes: bytes.length, uploadedBy: userId,
    note: `รวม ${used.length} ชิ้น: ${used.join(' → ')}`,
  });
  await logActivity(userId, 'MERGE_EOFFICE', 'JOB', jobId, { used, skipped });

  const summary = `รวมชุด E-Office แล้ว ${used.length} ชิ้น (${used.join(' → ')})`;
  const message = skipped.length ? `${summary} · ยังขาด: ${skipped.join(' · ')}` : summary;

  await onStep?.({ index: total, total, label: 'เสร็จแล้ว', status: 'done', detail: message });

  return { fileId: id, pageCount: merged.getPageCount(), used, skipped, message };
}

/**
 * ออกไฟล์ PDF ของคำร้องแล้วเก็บเข้าระบบเป็นไฟล์แนบหมวด EOFFICE_REQUEST
 *
 * เรียกตอนกดออกคำร้อง และเรียกซ้ำตอนรวมชุดถ้ายังไม่มีไฟล์
 * (งานเก่าที่ออกคำร้องไว้ก่อนระบบจะสร้าง PDF เองได้ จะได้ไม่ต้องไปกดออกใหม่ทีละใบ)
 */
export async function storeRequestPdf(jobId: string, userId: string) {
  const [req] = await db.select().from(eofficeRequests)
    .where(eq(eofficeRequests.jobId, jobId)).limit(1);
  if (!req) throw new Error('ยังไม่ได้ออกคำร้องของงานนี้');

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new Error('ไม่พบงาน');

  const bytes = await renderEofficeRequestPdf(req);
  const fileName = `${job.jobNo} [คำร้อง ${(req.requestNo ?? '').replace('/', '-')}].pdf`;
  const id = newId('FIL');
  const key = buildKey(jobId, 'EOFFICE_REQUEST', id, fileName);

  await ensureBucket();
  await uploadFile(key, bytes, 'application/pdf');

  const [previous] = await db
    .select()
    .from(files)
    .where(and(
      eq(files.jobId, jobId), eq(files.category, 'EOFFICE_REQUEST'), eq(files.isCurrent, true),
    ))
    .limit(1);

  await db.update(files).set({ isCurrent: false, supersededBy: id })
    .where(and(
      eq(files.jobId, jobId), eq(files.category, 'EOFFICE_REQUEST'), eq(files.isCurrent, true),
    ));

  await db.insert(files).values({
    id, jobId, category: 'EOFFICE_REQUEST', version: (previous?.version ?? 0) + 1,
    storageKey: key, fileName, mimeType: 'application/pdf',
    sizeBytes: bytes.length, uploadedBy: userId,
    note: `ระบบออกให้อัตโนมัติ คำร้องเลขที่ ${req.requestNo}`,
  });
  await logActivity(userId, 'RENDER_EOFFICE_REQUEST', 'JOB', jobId, { requestNo: req.requestNo });

  return { id, fileName, bytes: bytes.length };
}

/**
 * แปลง Final Invoice ที่เป็น Excel ให้เป็น PDF แล้วเก็บเป็นไฟล์คู่กัน
 *
 * เก็บเป็นหมวดแยก (FINAL_INVOICE_PDF) ไม่ทับไฟล์ต้นฉบับ เพราะฝ่ายอื่นยังต้องเปิด
 * ไฟล์ Excel ตัวจริงอยู่ ส่วนชุด E-Office ใช้ตัว PDF
 * เอาเฉพาะขอบเขตการพิมพ์ที่ตั้งไว้ในไฟล์ ไม่ใช่ทั้งชีต
 */
export async function storeInvoicePdf(jobId: string, userId: string, source: Buffer) {
  const pdf = await xlsxToPdf(source);
  if (!pdf) return null;

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) return null;

  const fileName = `${job.jobNo} [Final Invoice].pdf`;
  const id = newId('FIL');
  const key = buildKey(jobId, 'FINAL_INVOICE_PDF', id, fileName);

  await ensureBucket();
  await uploadFile(key, pdf, 'application/pdf');

  const [previous] = await db.select().from(files).where(and(
    eq(files.jobId, jobId), eq(files.category, 'FINAL_INVOICE_PDF'), eq(files.isCurrent, true),
  )).limit(1);

  await db.update(files).set({ isCurrent: false, supersededBy: id }).where(and(
    eq(files.jobId, jobId), eq(files.category, 'FINAL_INVOICE_PDF'), eq(files.isCurrent, true),
  ));

  await db.insert(files).values({
    id, jobId, category: 'FINAL_INVOICE_PDF', version: (previous?.version ?? 0) + 1,
    storageKey: key, fileName, mimeType: 'application/pdf',
    sizeBytes: pdf.length, uploadedBy: userId,
    note: 'ระบบแปลงจาก Excel ให้อัตโนมัติ เฉพาะขอบเขตการพิมพ์',
  });
  await logActivity(userId, 'CONVERT_INVOICE_PDF', 'JOB', jobId, { fileName });
  return id;
}
