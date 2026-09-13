import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { files, jobs } from '@/db/schema';
import { buildKey, downloadFile, ensureBucket, uploadFile } from '@/lib/storage';
import { logActivity, newId } from '@/lib/actions/common';
import { doBundleFileName, type DoBundleKind } from './do-bundle-options';

export async function concatenateDoPdfs(sources: Uint8Array[]): Promise<Uint8Array> {
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  const combined = await PDFDocument.create();
  for (const bytes of sources) {
    const source = await PDFDocument.load(bytes, { password: '' });
    const pages = await combined.copyPages(source, source.getPageIndices());
    pages.forEach(page => combined.addPage(page));
  }
  if (!combined.getPageCount()) throw new Error('ไม่มีหน้าที่รวมได้');
  return combined.save();
}

export async function combineDoBundles(fileIds: string[], userId: string, kind: DoBundleKind) {
  if (fileIds.length < 2 || fileIds.length > 100 || new Set(fileIds).size !== fileIds.length) throw new Error('เลือกรายการรวมชุด 2–100 รายการโดยไม่ซ้ำกัน');
  const records = await db.select({
    id: files.id, jobId: files.jobId, storageKey: files.storageKey, blNo: jobs.blNo, note: files.note,
  }).from(files).innerJoin(jobs, eq(files.jobId, jobs.id)).where(and(
    inArray(files.id, fileIds), eq(files.category, 'DO_MERGED'), eq(jobs.isArchived, false),
  ));
  if (records.length !== fileIds.length || new Set(records.map(row => row.jobId)).size !== records.length) throw new Error('ชุดเอกสารที่เลือกไม่ถูกต้องหรือ JOB ถูกปิดการใช้งาน');
  const byId = new Map(records.map(record => [record.id, record]));
  const ordered = fileIds.map(id => byId.get(id)!);
  const sources: Uint8Array[] = [];
  for (const record of ordered) sources.push((await downloadFile(record.storageKey)).body);
  const bytes = await concatenateDoPdfs(sources);
  const first = ordered[0];
  const fileName = doBundleFileName(`${first.blNo} +${ordered.length - 1}`, kind);
  const id = newId('FIL');
  const category = 'DO_BATCH_MERGED';
  const key = buildKey(first.jobId, category, id, fileName);
  await ensureBucket();
  await uploadFile(key, bytes, 'application/pdf');
  await db.transaction(async tx => {
    const [previous] = await tx.select({ version: files.version }).from(files).where(and(
      eq(files.jobId, first.jobId), eq(files.category, category), eq(files.isCurrent, true),
    )).limit(1);
    await tx.update(files).set({ isCurrent: false, supersededBy: id }).where(and(
      eq(files.jobId, first.jobId), eq(files.category, category), eq(files.isCurrent, true),
    ));
    await tx.insert(files).values({
      id, jobId: first.jobId, category, version: (previous?.version ?? 0) + 1, storageKey: key,
      fileName, mimeType: 'application/pdf', sizeBytes: bytes.length, uploadedBy: userId,
      note: `รวมตามลำดับ BL: ${ordered.map(row => row.blNo).join(' → ')}\n${ordered.filter(row => row.note?.includes('ยังขาด:')).map(row => `${row.blNo}: ${row.note}`).join('\n')}`,
    });
  });
  await logActivity(userId, 'MERGE_DO_BATCH', 'FILE', id, { fileIds, jobIds: ordered.map(row => row.jobId), kind });
  return { fileId: id, fileName };
}
