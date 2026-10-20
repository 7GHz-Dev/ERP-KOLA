import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { automationTasks, customsEntries, files, jobs } from '@/db/schema';
import { buildKey, ensureBucket, uploadFile } from '@/lib/storage';
import { WEB_PROOF_CATEGORY, WEB_TASK, type WebTemplateDefinition } from '@/lib/web-template';
import { logActivity, newId, recordStatus } from './actions/common';

/**
 * ตรรกะกลางของคิว automation
 *
 * แยกออกจากไฟล์ server action เพราะ route handler ของ worker ก็เรียกใช้เหมือนกัน
 * ไฟล์ที่มี 'use server' บังคับให้ทุก export เป็น async function จึงเก็บค่าคงที่ไว้ที่นี่ไม่ได้
 */

export const TASK_TYPES = {
  DRAFT: 'DRAFT_ENTRY',
  CUSTOMS: 'CUSTOMS_ENTRY',
  // ANN ส่งชุดแลก D/O ขอ Delivery Order ผ่านเว็บ My Customer Service ของ CMA CGM
  DO_REQUEST: 'DO_REQUEST_CMA',
} as const;

/**
 * ชนิดงานที่ worker Python ของใบขนรับไปทำ
 *
 * worker ตัวนั้นขอคิวโดยไม่ระบุชนิด ถ้าปล่อยให้ได้งานทุกชนิด มันจะคว้างานขอ D/O
 * ไปทำแบบใบขนแล้วพัง — claimNext ที่ไม่ระบุชนิดจึงจำกัดไว้แค่สองชนิดนี้
 */
export const CUSTOMS_TASK_TYPES: string[] = [TASK_TYPES.DRAFT, TASK_TYPES.CUSTOMS];

/** Final Invoice ที่ worker (imp) เติมเลขเครื่องแล้ว ส่งกลับมาพร้อมเลข Ref No. ของ Draft */
export const DRAFT_RESULT_CATEGORY = 'FINAL_INVOICE_ENGINE';

/**
 * สายเรือที่ขอ D/O ผ่านเว็บ My Customer Service ได้ — CMA CGM, APL, ANL และ CNC
 * ใช้ชื่อดิบจาก SHIPLINE ของงาน เพราะแบบฟอร์มจดหมายมีแค่ CNC แต่สายอื่นในกลุ่มก็ใช้เว็บเดียวกัน
 */
export function isCmaGroupLine(shipline: string | null): boolean {
  const norm = (shipline ?? '').toUpperCase().replace(/\(.*?\)/g, '').replace(/[^A-Z]/g, ' ');
  return /\b(CNC|CMA|CMACGM|APL|ANL)\b/.test(norm);
}

/** เก็บไฟล์ผลลัพธ์ของงานเป็นไฟล์ปัจจุบันของ Job ในหมวดนั้น แทนฉบับเดิม */
async function storeResultFile(
  jobId: string, category: string, actorId: string,
  file: { name: string; mimeType: string; body: Buffer },
) {
  const fileId = newId('FIL');
  const key = buildKey(jobId, category, fileId, file.name);
  await ensureBucket();
  await uploadFile(key, file.body, file.mimeType);

  await db.update(files)
    .set({ isCurrent: false, supersededBy: fileId })
    .where(and(eq(files.jobId, jobId), eq(files.category, category), eq(files.isCurrent, true)));

  await db.insert(files).values({
    id: fileId, jobId, category, version: 1,
    storageKey: key, fileName: file.name, mimeType: file.mimeType,
    sizeBytes: file.body.length, isCurrent: true, uploadedBy: actorId,
  });
  return key;
}

/**
 * ภาพหน้าจอของงานกรอกเว็บที่ไม่ใช่หลักฐานส่งจริง — ภาพตอนพังกับภาพทดลองรัน
 * เก็บผูกกับงานในคิว ไม่เข้าไปเป็นไฟล์ของ Job เพราะไม่ใช่เอกสารของงานนั้น
 * เปิดดูได้ที่ /api/web-template/shot/<taskId>
 */
async function storeTaskShot(taskId: string, jobId: string | null, file: { name: string; mimeType: string; body: Buffer }) {
  const key = buildKey(jobId ?? 'web-template', 'WEB_SHOT', taskId, file.name);
  await ensureBucket();
  await uploadFile(key, file.body, file.mimeType);
  return key;
}

/** ส่งแลก D/O แล้ว — รายการย้ายไปแท็บส่งแลกแล้วเหมือนกดปุ่มเอง ซ้ำได้โดยไม่เขียนทับเวลาเดิม */
async function markDoExchanged(jobId: string, by: string, note: string) {
  const [job] = await db.select({ status: jobs.status, doExchangedAt: jobs.doExchangedAt })
    .from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job || job.doExchangedAt) return;
  const now = new Date();
  await db.update(jobs).set({
    doExchangedAt: now, doExchangedBy: by, updatedBy: by, updatedAt: now,
  }).where(eq(jobs.id, jobId));
  await recordStatus(jobId, job.status, 'DO_EXCHANGED', note, by);
}

function taskPayload(task: { payload: string | null }): Record<string, any> {
  try {
    return JSON.parse(task.payload ?? '{}') ?? {};
  } catch {
    return {};
  }
}

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

    // imp ส่ง Final Invoice ที่เติมเลขเครื่องแล้วกลับมาด้วย — เก็บเป็นหมวดแยก ไม่ทับไฟล์ที่ PAINT อัปโหลด
    if (input.file) {
      patch.resultStorageKey = await storeResultFile(task.jobId, DRAFT_RESULT_CATEGORY, input.actorId, input.file);
      patch.resultFileName = input.file.name;
    }

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
  } else if (task.type === TASK_TYPES.DO_REQUEST) {
    // เลขคำขอจากเว็บสายเรือ — บางครั้งหน้ายืนยันไม่แสดงเลข จึงไม่บังคับ
    const refNo = (input.refNo ?? '').trim();
    if (refNo) patch.resultRefNo = refNo;

    // ภาพหน้าจอหลังกด Submit เก็บเป็นหลักฐานว่ายื่นไปแล้วจริง
    if (input.file) {
      const key = await storeResultFile(task.jobId, 'DO_REQUEST_PROOF', input.actorId, input.file);
      patch.resultStorageKey = key;
      patch.resultFileName = input.file.name;
    }

    const requestedBy = String(taskPayload(task).requestedBy ?? '') || input.actorId;

    // ยื่นผ่านเว็บสำเร็จ = ส่งแลก D/O แล้ว
    await markDoExchanged(task.jobId, requestedBy,
      `ยื่นขอ D/O ผ่านเว็บ CMA CGM แล้ว${refNo ? ` · เลขคำขอ ${refNo}` : ''}`);
  } else if (task.type === WEB_TASK.RUN) {
    const payload = taskPayload(task);
    const refNo = (input.refNo ?? '').trim();
    if (refNo) patch.resultRefNo = refNo;

    if (payload.dryRun) {
      // ทดลองรัน — ไม่ได้ส่งจริง ภาพจึงไม่ใช่หลักฐานของงาน และไม่ขยับสถานะงาน
      if (input.file) {
        patch.resultStorageKey = await storeTaskShot(task.id, task.jobId, input.file);
        patch.resultFileName = input.file.name;
      }
    } else {
      if (input.file) {
        patch.resultStorageKey = await storeResultFile(task.jobId, WEB_PROOF_CATEGORY, input.actorId, input.file);
        patch.resultFileName = input.file.name;
      }
      const def = payload.definition as WebTemplateDefinition | undefined;
      const requestedBy = String(payload.requestedBy ?? '') || input.actorId;
      if (def?.button?.markDoExchanged) {
        await markDoExchanged(task.jobId, requestedBy,
          `ส่งผ่านเว็บด้วย Template ${payload.templateName ?? ''}${refNo ? ` · เลขอ้างอิง ${refNo}` : ''}`.trim());
      }
    }
  } else {
    const entryNo = (input.entryNo ?? '').trim();
    if (!entryNo) throw new Error('งาน CUSTOMS_ENTRY ต้องส่ง entryNo กลับมา');
    patch.resultEntryNo = entryNo;

    // เก็บไฟล์ใบขนเป็นไฟล์ของงานนั้นเลย ไม่ปล่อยค้างไว้ในคิว
    if (input.file) {
      patch.resultStorageKey = await storeResultFile(task.jobId, 'CUSTOMS_ENTRY_DOC', input.actorId, input.file);
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

export async function failTask(
  taskId: string, actorId: string, message: string,
  file?: { name: string; mimeType: string; body: Buffer },
) {
  const patch: Record<string, unknown> = {
    status: 'ERROR', error: message.slice(0, 1000), completedAt: new Date(), updatedAt: new Date(),
  };
  const [task] = await db.select({ type: automationTasks.type, jobId: automationTasks.jobId })
    .from(automationTasks).where(eq(automationTasks.id, taskId)).limit(1);
  // ภาพตอนพังของงานกรอกเว็บ — ช่วยดูว่าค้างที่หน้าไหนโดยไม่ต้องไปเปิดเครื่องที่รัน worker
  if (file && task && (task.type === WEB_TASK.RUN || task.type === WEB_TASK.RECORD)) {
    patch.resultStorageKey = await storeTaskShot(taskId, task.jobId, file);
    patch.resultFileName = file.name;
  }
  await db.update(automationTasks).set(patch).where(eq(automationTasks.id, taskId));

  // สร้าง Draft ไม่สำเร็จ — คืนงานให้ PAINT เห็นเหตุผล แก้ไฟล์แล้วกดสร้างใหม่ได้
  // ไม่งั้นงานค้างที่ "รอ Automation สร้าง Draft" ตลอดไป  (เฉพาะงานล่าสุดของ Job นั้น)
  if (task?.type === TASK_TYPES.DRAFT && task.jobId) {
    await db.update(jobs)
      .set({ draftStatus: 'HUB_ERROR', draftRejectReason: message.slice(0, 1000), updatedAt: new Date() })
      .where(and(eq(jobs.id, task.jobId), eq(jobs.draftTaskId, taskId)));
  }
  await logActivity(actorId, 'FAIL_TASK', 'TASK', taskId, { message });
}
