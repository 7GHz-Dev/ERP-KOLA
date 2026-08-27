'use server';

import { revalidatePath } from 'next/cache';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { automationTasks, customsEntries, files, jobs } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import { buildKey, ensureBucket, uploadFile } from '@/lib/storage';
import { logActivity, newId, required, runAction } from './common';
import { completeTask, failTask, reuseOpenTask, TASK_TYPES } from '@/lib/automation';
import { renderCustomsEntryPdf } from '@/lib/customs-pdf';

/**
 * คิวงาน automation
 *
 * ระบบเดิมแยกเป็นเว็บ Hub อีกตัวเพราะ Sheets แชร์ข้ามโปรเจกต์ลำบาก
 * ตรงนี้อยู่ในฐานเดียวกันแล้ว โปรแกรม Python เรียก REST ของ v2 ได้ตรง ๆ
 * เหลือระบบที่ต้องดูแลตัวเดียว
 */

/** PAINT ส่ง Final Invoice เข้าคิวเพื่อให้ automate สร้าง Draft ใบขน */
async function submitDraftTaskImpl(formData: FormData) {
  const user = await requireActiveSession(['PAINT']);
  const jobId = required(formData.get('jobId'), 'งาน', 80);

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new Error('ไม่พบงาน');

  const [invoice] = await db
    .select()
    .from(files)
    .where(and(eq(files.jobId, jobId), eq(files.category, 'FINAL_INVOICE'), eq(files.isCurrent, true)))
    .limit(1);
  if (!invoice) throw new Error('ต้องมีไฟล์ Final Invoice ก่อนส่งสร้าง Draft');

  const existing = await reuseOpenTask(jobId, TASK_TYPES.DRAFT);
  if (!existing) {
    const id = newId('TASK');
    await db.insert(automationTasks).values({
      id, type: TASK_TYPES.DRAFT, status: 'QUEUED', jobId,
      payload: JSON.stringify({ jobNo: job.jobNo, blNo: job.blNo }),
      inputStorageKey: invoice.storageKey,
      inputFileName: invoice.fileName,
    });
    await db.update(jobs)
      .set({ draftTaskId: id, draftStatus: 'SENT_TO_HUB', updatedBy: user.id, updatedAt: new Date() })
      .where(eq(jobs.id, jobId));
    await logActivity(user.id, 'SUBMIT_DRAFT_TASK', 'JOB', jobId, { taskId: id });
  }

  revalidatePath('/pending');
  revalidatePath('/automation');
}

/** FAH ส่งเลข Ref No. เข้าคิวเพื่อให้ automate ทำใบขนสินค้า */
async function submitCustomsTaskImpl(formData: FormData) {
  const user = await requireActiveSession(['FAH']);
  const jobId = required(formData.get('jobId'), 'งาน', 80);

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new Error('ไม่พบงาน');
  if (!job.draftRefNo) throw new Error('ยังไม่มีเลข Ref No. ของงานนี้');

  const existing = await reuseOpenTask(jobId, TASK_TYPES.CUSTOMS);
  if (!existing) {
    const id = newId('TASK');
    await db.insert(automationTasks).values({
      id, type: TASK_TYPES.CUSTOMS, status: 'QUEUED', jobId,
      payload: JSON.stringify({ jobNo: job.jobNo, refNo: job.draftRefNo, blNo: job.blNo }),
    });
    await db.update(jobs)
      .set({ customsTaskId: id, updatedBy: user.id, updatedAt: new Date() })
      .where(eq(jobs.id, jobId));
    await logActivity(user.id, 'SUBMIT_CUSTOMS_TASK', 'JOB', jobId, { taskId: id, refNo: job.draftRefNo });
  }

  revalidatePath('/fah/draft');
  revalidatePath('/automation');
}

/** ปุ่มจำลองบนหน้าเว็บ ใช้ทดสอบทั้งเส้นก่อนโปรแกรม Python จะพร้อม */
async function runTaskSimulationImpl(formData: FormData) {
  const user = await requireActiveSession(['PAINT', 'FAH']);
  const taskId = required(formData.get('taskId'), 'งาน', 80);

  const [task] = await db.select().from(automationTasks)
    .where(eq(automationTasks.id, taskId)).limit(1);
  if (!task) throw new Error('ไม่พบงานในคิว');

  const [job] = task.jobId
    ? await db.select().from(jobs).where(eq(jobs.id, task.jobId)).limit(1)
    : [];

  await db.update(automationTasks).set({
    status: 'PROCESSING', claimedBy: 'simulator', claimedAt: new Date(),
    attempts: task.attempts + 1, updatedAt: new Date(),
  }).where(eq(automationTasks.id, taskId));

  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const suffix = String(Date.now() % 100000).padStart(5, '0');

  try {
    if (task.type === TASK_TYPES.DRAFT) {
      await completeTask({ taskId, actorId: user.id, refNo: `QELS${stamp}${suffix}` });
    } else {
      const entryNo = `A${stamp}${suffix}`;
      // ต้องเป็น PDF เพราะไฟล์นี้ถูกเอาไปต่อในชุด E-Office ไฟล์ข้อความต่อไม่ได้
      const body = await renderCustomsEntryPdf({
        entryNo,
        refNo: job?.draftRefNo ?? '',
        jobNo: job?.jobNo ?? '',
        blNo: job?.blNo ?? '',
      });
      await completeTask({
        taskId, actorId: user.id, entryNo,
        file: { name: `${entryNo}.pdf`, mimeType: 'application/pdf', body },
      });
    }
  } catch (error) {
    await failTask(taskId, user.id, error instanceof Error ? error.message : String(error));
    throw error;
  }

  revalidatePath('/automation');
  revalidatePath('/pending');
  revalidatePath('/fah/draft');
}

/** ดึงผลกลับเข้า Job — เก็บไว้เผื่อกรณีที่ worker บันทึกผลแต่ Job ยังไม่อัปเดต */
export async function pendingTaskCount() {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(automationTasks)
    .where(inArray(automationTasks.status, ['QUEUED', 'PROCESSING']));
  return row?.count ?? 0;
}

/* ----------------------------------------------------------
   ทุกคำสั่งข้างบนถูกห่อด้วย runAction ก่อนผูกกับปุ่มบนหน้าเว็บ
   ข้อผิดพลาดที่ผู้ใช้แก้เองได้จะกลับไปหน้าเดิมพร้อมข้อความ
   แทนที่จะเด้งหน้า 500 Internal Server Error ที่อ่านไม่ออก
   ---------------------------------------------------------- */

export async function submitDraftTask(formData: FormData) {
  return runAction(() => submitDraftTaskImpl(formData));
}

export async function submitCustomsTask(formData: FormData) {
  return runAction(() => submitCustomsTaskImpl(formData));
}

export async function runTaskSimulation(formData: FormData) {
  return runAction(() => runTaskSimulationImpl(formData));
}
