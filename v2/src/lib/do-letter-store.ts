import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { files, jobs, masterRecords } from '@/db/schema';
import { buildKey, downloadFile, ensureBucket, uploadFile } from '@/lib/storage';
import { logActivity, newId } from '@/lib/actions/common';
import { renderDoLetterPdf } from '@/lib/do-letter-pdf';
import { matchShippingLine, normalizeDestination } from '@/lib/do-letter';
import { extractPdfTextServer, parsePortOfLoading } from '@/lib/port-of-loading';

/**
 * เมืองต้นทางของงาน — ที่กรอกไว้ก่อน แล้วค่อยอ่านจากไฟล์ BL / Arrival Notice
 *
 * ค่าที่ผู้ใช้กรอกเองมาก่อนเสมอ ตัวอ่านไม่มีสิทธิ์ทับของที่คนตั้งใจใส่
 * ไม่มีค่ากรอกไว้จึงไปเปิดไฟล์ที่แนบกับงานนั้นแล้วหา Port of Loading
 * อ่านไม่ออกก็คืนค่าว่าง ปล่อยช่องนั้นบนจดหมายให้เขียนด้วยมือเหมือนเดิม
 *
 * อ่าน BL ก่อน Arrival Notice เพราะ BL เป็นต้นฉบับของข้อมูลขนส่ง
 */
async function resolveOriginPort(jobId: string, saved: string | null): Promise<string | null> {
  const typed = (saved ?? '').trim();
  if (typed) return typed.toUpperCase();

  const attached = await db
    .select({ category: files.category, key: files.storageKey, name: files.fileName })
    .from(files)
    .where(and(
      eq(files.jobId, jobId),
      eq(files.isCurrent, true),
      inArray(files.category, ['BL', 'ARRIVAL_NOTICE']),
    ));

  const ordered = [
    ...attached.filter((f) => f.category === 'BL'),
    ...attached.filter((f) => f.category !== 'BL'),
  ].filter((f) => /\.pdf$/i.test(f.name));

  for (const file of ordered) {
    try {
      const { body } = await downloadFile(file.key);
      const found = parsePortOfLoading(await extractPdfTextServer(body));
      if (found) return found;
    } catch {
      // ไฟล์เดียวมีปัญหาไม่ควรทำให้ออกจดหมายไม่ได้ ลองใบถัดไป
    }
  }
  return null;
}

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

  const originName = await resolveOriginPort(jobId, job.originPort);

  const bytes = await renderDoLetterPdf({
    shippingLine: line,
    blNo: job.blNo,
    vessel: job.vessel,
    voyage: job.voyage,
    eta: job.eta,
    // ทุกงานลงแหลมฉบัง เขียนได้หลายแบบจึงรวบให้เป็นข้อความเดียวก่อนวาด
    portName: normalizeDestination(port?.name ?? null) || null,
    originName,
  });

  // ไฟล์เดียวมีสองหน้า — ใบของ KOLA และใบของ MAESOT FREEZONE
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
