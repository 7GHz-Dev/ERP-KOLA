'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { automationTasks, files, jobs } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import { isCmaGroupLine, reuseOpenTask, TASK_TYPES } from '@/lib/automation';
import { logActivity, newId, required, runAction, text } from './common';

/**
 * ANN ส่งชุดแลก D/O ไปขอ Delivery Order ผ่านเว็บ My Customer Service ของ CMA CGM
 *
 * ปุ่มนี้แค่ใส่งานเข้าคิว — worker บนเครื่องที่ล็อกอินเว็บสายเรือไว้เป็นคนกรอกเว็บจริง
 * (scripts/do-request-worker.ts) เพราะเว็บสายเรือต้องใช้บัญชีของพนักงาน
 * ซึ่งไม่ควรเก็บรหัสผ่านไว้บนเซิร์ฟเวอร์
 *
 * ไฟล์ที่แนบคือชุดแลก D/O ที่รวมแล้ว — มีทั้งจดหมาย สลิป และเอกสารประกอบในไฟล์เดียว
 * ใช้ทั้งช่อง Payment Document และ Supporting Document บนเว็บ
 */
async function queueDoRequestImpl(formData: FormData) {
  const user = await requireActiveSession(['ANN']);
  const jobId = required(formData.get('jobId'), 'งาน', 80);
  const paymentRef = required(formData.get('paymentRef'), 'หมายเลขอ้างอิงในสลิป', 80);
  const note = text(formData.get('note'), 1000);

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new Error('ไม่พบงาน');
  if (job.doExchangedAt) throw new Error('ส่งแลก DO ไปแล้ว');
  if (!job.blNo) throw new Error('งานนี้ยังไม่มีเลข BL');
  if (!isCmaGroupLine(job.shipline)) throw new Error('สายเรือนี้ไม่ได้ขอ D/O ผ่านเว็บ CMA CGM');

  const [merged] = await db.select({ storageKey: files.storageKey, fileName: files.fileName })
    .from(files)
    .where(and(eq(files.jobId, jobId), eq(files.category, 'DO_MERGED'), eq(files.isCurrent, true)))
    .limit(1);
  if (!merged) throw new Error('ยังไม่ได้รวมชุดแลก DO');

  // กดซ้ำระหว่างที่งานเดิมยังไม่จบ ไม่สร้างงานใหม่ กันยื่นสองรอบ
  if (await reuseOpenTask(jobId, TASK_TYPES.DO_REQUEST)) throw new Error('งานนี้อยู่ในคิวส่งแลกแล้ว');

  const id = newId('TASK');
  await db.insert(automationTasks).values({
    id, type: TASK_TYPES.DO_REQUEST, status: 'QUEUED', jobId,
    payload: JSON.stringify({
      jobNo: job.jobNo, blNo: job.blNo.trim(), agencyLocation: 'Thailand',
      paymentRef, note, requestedBy: user.id,
    }),
    inputStorageKey: merged.storageKey,
    inputFileName: merged.fileName,
  });
  await logActivity(user.id, 'QUEUE_DO_REQUEST', 'JOB', jobId, { taskId: id, paymentRef });

  revalidatePath('/do-exchange');
}

/** ยกเลิกงานที่ยังรออยู่ในคิว — worker ยังไม่ได้หยิบไปทำ */
async function cancelDoRequestImpl(formData: FormData) {
  const user = await requireActiveSession(['ANN']);
  const taskId = required(formData.get('taskId'), 'งาน', 80);

  const [task] = await db.select().from(automationTasks).where(eq(automationTasks.id, taskId)).limit(1);
  if (!task || task.type !== TASK_TYPES.DO_REQUEST) throw new Error('ไม่พบงานในคิว');
  // งานที่ worker กำลังกรอกเว็บอยู่ ยกเลิกกลางทางไม่ได้ เพราะอาจกด Submit ไปแล้ว
  if (task.status !== 'QUEUED') throw new Error('worker เริ่มทำงานนี้แล้ว ยกเลิกไม่ได้');

  await db.update(automationTasks).set({
    status: 'ERROR', error: 'ยกเลิกโดยผู้ใช้', completedAt: new Date(), updatedAt: new Date(),
  }).where(eq(automationTasks.id, taskId));
  await logActivity(user.id, 'CANCEL_DO_REQUEST', 'TASK', taskId, {});

  revalidatePath('/do-exchange');
}

export async function queueDoRequest(formData: FormData) {
  return runAction(() => queueDoRequestImpl(formData));
}

export async function cancelDoRequest(formData: FormData) {
  return runAction(() => cancelDoRequestImpl(formData));
}
