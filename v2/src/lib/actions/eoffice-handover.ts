'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { files, jobs } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import { logActivity, recordStatus, required, runAction } from './common';

/**
 * ส่งมอบชุดเอกสารเดิน E ให้คนเดินเอกสาร — PAINT เลือกหลายรายการที่แท็บ 4 แล้วกดทีเดียว
 *
 * หน้างานพิมพ์ชุดที่รวมไว้ไปเซ็น แล้วสแกนกลับมาอัปโหลดที่หน้า "Upload ชุดปล่อย E-Office"
 * รายการรอไว้ที่หน้านั้นตั้งแต่กดส่งมอบ อัปไฟล์ให้ตรงงานแล้วกดส่ง Partner ต่อได้เลย
 *
 * ต้องรวมชุด E-Office แล้วเท่านั้น — ยังไม่มีชุดก็ไม่มีอะไรให้คนเดินเอกสารถือไป
 * รายการไหนไม่ผ่านไม่ขวางรายการอื่น ส่งมอบที่ผ่านไปก่อนแล้วบอกว่าใบไหนติดอะไร
 */
async function handoverEofficeImpl(formData: FormData) {
  const user = await requireActiveSession(['PAINT']);
  const ids = [...new Set(String(formData.get('jobIds') ?? '').split(',').map((v) => v.trim()).filter(Boolean))];
  if (!ids.length) throw new Error('ยังไม่ได้เลือกรายการ');

  const rows = await db.select({
    id: jobs.id, jobNo: jobs.jobNo, blNo: jobs.blNo, status: jobs.status,
    customsStatus: jobs.customsStatus, handoverAt: jobs.eofficeHandoverAt,
  }).from(jobs).where(inArray(jobs.id, ids));
  const merged = new Set((await db.select({ jobId: files.jobId }).from(files)
    .where(and(inArray(files.jobId, ids), eq(files.category, 'EOFFICE_MERGED'), eq(files.isCurrent, true))))
    .map((f) => f.jobId));

  const failed: string[] = [];
  const ready = rows.filter((r) => {
    const name = r.blNo || r.jobNo;
    if (r.customsStatus !== 'FILED') failed.push(`${name} ยังไม่ได้เลขใบขน`);
    else if (r.handoverAt) failed.push(`${name} ส่งมอบไปแล้ว`);
    else if (!merged.has(r.id)) failed.push(`${name} ยังไม่ได้รวมชุด E-Office`);
    else return true;
    return false;
  });
  if (rows.length < ids.length) failed.push(`ไม่พบงาน ${ids.length - rows.length} รายการ`);

  if (ready.length) {
    const now = new Date();
    // ตั้งเฉพาะที่ยังว่าง — กดซ้ำจากสองหน้าจอพร้อมกันแล้วเวลาส่งมอบไม่ถูกเขียนทับ
    await db.update(jobs)
      .set({ eofficeHandoverAt: now, eofficeHandoverBy: user.id, updatedBy: user.id, updatedAt: now })
      .where(and(inArray(jobs.id, ready.map((r) => r.id)), isNull(jobs.eofficeHandoverAt)));
    for (const r of ready) {
      await recordStatus(r.id, r.status, 'EOFFICE_HANDOVER', 'ส่งมอบชุดเอกสารเดิน E ให้คนเดินเอกสาร', user.id);
    }
    await logActivity(user.id, 'EOFFICE_HANDOVER', 'JOB', ready.map((r) => r.id).join(','), { count: ready.length });
  }

  revalidatePath('/pending');
  revalidatePath('/paint/eoffice-signed');
  if (!ready.length) throw new Error(failed[0] ?? 'ส่งมอบไม่สำเร็จ');
  if (failed.length) {
    throw new Error(`ส่งมอบแล้ว ${ready.length} รายการ · ไม่สำเร็จ ${failed.length} รายการ: ${failed.join(' · ')}`);
  }
}

/**
 * คืนงานไปแท็บ 4 — ส่งมอบผิดใบ หรือต้องออกคำร้อง/รวมชุดใหม่ก่อนเดินเอกสาร
 * ทำได้เฉพาะที่ยังไม่ได้อัปชุดที่เซ็นแล้ว ไม่งั้นงานจะค้างอยู่หน้า Upload เพราะมีไฟล์แล้ว
 */
async function undoEofficeHandoverImpl(formData: FormData) {
  const user = await requireActiveSession(['PAINT']);
  const jobId = required(formData.get('jobId'), 'งาน', 80);

  const [job] = await db.select({ status: jobs.status, handoverAt: jobs.eofficeHandoverAt, sentAt: jobs.eofficeSentAt })
    .from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new Error('ไม่พบงาน');
  if (!job.handoverAt) throw new Error('งานนี้ยังไม่ได้ส่งมอบ');
  if (job.sentAt) throw new Error('ส่ง Partner ไปแล้ว คืนไปเตรียมเอกสารไม่ได้');
  const [signed] = await db.select({ id: files.id }).from(files)
    .where(and(eq(files.jobId, jobId), eq(files.category, 'EOFFICE_SIGNED'), eq(files.isCurrent, true))).limit(1);
  if (signed) throw new Error('อัปชุดปล่อยที่เซ็นแล้ว คืนไปเตรียมเอกสารไม่ได้');

  await db.update(jobs)
    .set({ eofficeHandoverAt: null, eofficeHandoverBy: null, updatedBy: user.id, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
  await recordStatus(jobId, job.status, 'EOFFICE_HANDOVER_UNDO', 'คืนไปเตรียมเอกสารเดิน E', user.id);
  await logActivity(user.id, 'EOFFICE_HANDOVER_UNDO', 'JOB', jobId, {});

  revalidatePath('/pending');
  revalidatePath('/paint/eoffice-signed');
}

export async function handoverEoffice(formData: FormData) {
  return runAction(() => handoverEofficeImpl(formData));
}

export async function undoEofficeHandover(formData: FormData) {
  return runAction(() => undoEofficeHandoverImpl(formData));
}
