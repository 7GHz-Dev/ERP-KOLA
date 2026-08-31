import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { files, jobs, masterRecords } from '@/db/schema';
import { buildKey, ensureBucket, uploadFile } from '@/lib/storage';
import { logActivity, newId } from '@/lib/actions/common';
import { renderDoLetterPdf } from '@/lib/do-letter-pdf';
import { matchShippingLine } from '@/lib/do-letter';

/** ออกจดหมายแลก D/O แล้วเก็บเป็นไฟล์ของงาน พร้อมบันทึกว่าทำจดหมายแล้ว */
export async function storeDoLetterPdf(jobId: string, userId: string) {
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new Error('ไม่พบงาน');

  // สายเรือมาจาก SHIPLINE ของงานที่กรอกไว้ตั้งแต่รับงาน ไม่ต้องให้เลือกซ้ำ
  const line = matchShippingLine(job.shipline);
  if (!line) {
    throw new Error(
      job.shipline
        ? `ยังไม่มีแบบฟอร์มจดหมายของสายเรือ "${job.shipline}"`
        : 'งานนี้ยังไม่ได้ระบุ SHIPLINE',
    );
  }

  const [port] = job.portId
    ? await db.select({ name: masterRecords.name })
        .from(masterRecords).where(eq(masterRecords.id, job.portId)).limit(1)
    : [undefined];

  const bytes = await renderDoLetterPdf({
    shippingLine: line,
    blNo: job.blNo,
    vessel: job.vessel,
    voyage: job.voyage,
    eta: job.eta,
    portName: port?.name ?? null,
    // เมืองต้นทางยังไม่มีเก็บในฐานข้อมูล เว้นว่างไว้ให้เขียนเติมบนกระดาษ
    originName: null,
  });

  const fileName = `${job.jobNo} [จดหมายแลก DO ${line}].pdf`;
  const id = newId('FIL');
  const key = buildKey(jobId, 'DO_LETTER', id, fileName);

  await ensureBucket();
  await uploadFile(key, bytes, 'application/pdf');

  const [previous] = await db.select().from(files)
    .where(and(eq(files.jobId, jobId), eq(files.category, 'DO_LETTER'), eq(files.isCurrent, true)))
    .limit(1);
  await db.update(files).set({ isCurrent: false, supersededBy: id })
    .where(and(eq(files.jobId, jobId), eq(files.category, 'DO_LETTER'), eq(files.isCurrent, true)));

  await db.insert(files).values({
    id, jobId, category: 'DO_LETTER', version: (previous?.version ?? 0) + 1,
    storageKey: key, fileName, mimeType: 'application/pdf',
    sizeBytes: bytes.length, uploadedBy: userId,
    note: `ระบบออกให้อัตโนมัติ สายเรือ ${line}`,
  });

  // ทำจดหมายแล้วถือว่าผ่านขั้นแรก งานจะไปอยู่แท็บ Upload Slip / รวมเอกสาร
  await db.update(jobs)
    .set({ doLetterAt: new Date(), doLetterBy: userId, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
  await logActivity(userId, 'RENDER_DO_LETTER', 'JOB', jobId, { line });

  return { id, fileName, bytes };
}
