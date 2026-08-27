import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { automationTasks, customsEntries, files, jobs } from '@/db/schema';
import { buildKey, ensureBucket, uploadFile } from '@/lib/storage';
import { logActivity, newId, recordStatus } from './actions/common';

/**
 * ตรรกะกลางของคิว automation
 *
 * แยกออกจากไฟล์ server action เพราะ route handler ของ worker ก็เรียกใช้เหมือนกัน
 * ไฟล์ที่มี 'use server' บังคับให้ทุก export เป็น async function จึงเก็บค่าคงที่ไว้ที่นี่ไม่ได้
 */

export const TASK_TYPES = { DRAFT: 'DRAFT_ENTRY', CUSTOMS: 'CUSTOMS_ENTRY' } as const;

/** งานเดิมที่ยังไม่จบของ job เดียวกัน ให้ใช้ตัวเดิม กันกดรัวแล้วคิวบาน */
export async function reuseOpenTask(jobId: string, type: string) {
  const [row] = await db
    .select()
    .from(automationTasks)
    .where(and(
      eq(automationTasks.jobId, jobId),
      eq(automationTasks.type, type),
      inArray(automationTasks.status, ['QUEUED', 'PROCESSING']),
    ))
    .limit(1);
  return row ?? null;
}

/**
 * บันทึกผลลัพธ์ของงาน automation แล้วอัปเดต Job ตามชนิดงาน
 * ใช้ร่วมกันทั้งจาก REST ของ worker และจากปุ่มจำลองบนหน้าเว็บ
 */
export async function completeTask(input: {
  taskId: string;
  actorId: string;
  refNo?: string;
  entryNo?: string;
  file?: { name: string; mimeType: string; body: Buffer };
}) {
  const [task] = await db.select().from(automationTasks)
    .where(eq(automationTasks.id, input.taskId)).limit(1);
  if (!task) throw new Error('ไม่พบงานในคิว');
  if (task.status === 'DONE') throw new Error('งานนี้เสร็จไปแล้ว');
  if (!task.jobId) throw new Error('งานนี้ไม่ได้ผูกกับ Job');

  const now = new Date();
  const patch: Record<string, unknown> = {
    status: 'DONE', error: null, completedAt: now, updatedAt: now,
  };

  if (task.type === TASK_TYPES.DRAFT) {
    const refNo = (input.refNo ?? '').trim();
    if (!refNo) throw new Error('งาน DRAFT_ENTRY ต้องส่ง refNo กลับมา');
    patch.resultRefNo = refNo;

    await db.update(jobs).set({
      draftRefNo: refNo, draftStatus: 'CREATED', customsStatus: 'DRAFT', updatedAt: now,
    }).where(eq(jobs.id, task.jobId));

    const [entry] = await db.select().from(customsEntries)
      .where(eq(customsEntries.jobId, task.jobId)).orderBy(desc(customsEntries.updatedAt)).limit(1);
    if (entry) {
      await db.update(customsEntries).set({ entryNo: refNo, status: 'DRAFT', updatedAt: now })
        .where(eq(customsEntries.id, entry.id));
    } else {
      await db.insert(customsEntries).values({
        id: newId('CUS'), jobId: task.jobId, entryNo: refNo, status: 'DRAFT',
        note: 'สร้างโดยระบบ automate', createdBy: input.actorId,
      });
    }
    await recordStatus(task.jobId, null, 'DRAFT_CREATED', `ได้เลข Ref No. ${refNo}`, input.actorId);
  } else {
    const entryNo = (input.entryNo ?? '').trim();
    if (!entryNo) throw new Error('งาน CUSTOMS_ENTRY ต้องส่ง entryNo กลับมา');
    patch.resultEntryNo = entryNo;

    // เก็บไฟล์ใบขนเป็นไฟล์ของงานนั้นเลย ไม่ปล่อยค้างไว้ในคิว
    if (input.file) {
      const fileId = newId('FIL');
      const key = buildKey(task.jobId, 'CUSTOMS_ENTRY_DOC', fileId, input.file.name);
      await ensureBucket();
      await uploadFile(key, input.file.body, input.file.mimeType);

      await db.update(files)
        .set({ isCurrent: false, supersededBy: fileId })
        .where(and(eq(files.jobId, task.jobId), eq(files.category, 'CUSTOMS_ENTRY_DOC'), eq(files.isCurrent, true)));

      await db.insert(files).values({
        id: fileId, jobId: task.jobId, category: 'CUSTOMS_ENTRY_DOC', version: 1,
        storageKey: key, fileName: input.file.name, mimeType: input.file.mimeType,
        sizeBytes: input.file.body.length, isCurrent: true, uploadedBy: input.actorId,
      });
      patch.resultStorageKey = key;
      patch.resultFileName = input.file.name;
    }

    const [entry] = await db.select().from(customsEntries)
      .where(eq(customsEntries.jobId, task.jobId)).orderBy(desc(customsEntries.updatedAt)).limit(1);
    if (entry) {
      await db.update(customsEntries).set({
        declarationNo: entryNo, status: 'FILED', filedBy: input.actorId, filedAt: now, updatedAt: now,
      }).where(eq(customsEntries.id, entry.id));
    } else {
      await db.insert(customsEntries).values({
        id: newId('CUS'), jobId: task.jobId, declarationNo: entryNo, status: 'FILED',
        createdBy: input.actorId, filedBy: input.actorId, filedAt: now,
      });
    }

    await db.update(jobs)
      .set({ customsStatus: 'FILED', status: 'CUSTOMS_FILED', updatedAt: now })
      .where(eq(jobs.id, task.jobId));
    await recordStatus(task.jobId, null, 'CUSTOMS_FILED', `ได้เลขใบขน ${entryNo}`, input.actorId);
  }

  await db.update(automationTasks).set(patch).where(eq(automationTasks.id, input.taskId));
  await logActivity(input.actorId, 'COMPLETE_TASK', 'TASK', input.taskId,
    { type: task.type, refNo: input.refNo, entryNo: input.entryNo });
}

export async function failTask(taskId: string, actorId: string, message: string) {
  await db.update(automationTasks).set({
    status: 'ERROR', error: message.slice(0, 1000), completedAt: new Date(), updatedAt: new Date(),
  }).where(eq(automationTasks.id, taskId));
  await logActivity(actorId, 'FAIL_TASK', 'TASK', taskId, { message });
}
