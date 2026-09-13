'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { activityLog, files, jobs, statusHistory } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import { newId } from './common';

export type ExchangeBatchState = { error: string; message: string };

export async function markDoExchangedBatch(_previous: ExchangeBatchState, data: FormData): Promise<ExchangeBatchState> {
  try {
    const user = await requireActiveSession(['ANN']);
    if (user.mustChangePassword) throw new Error('กรุณาเปลี่ยนรหัสผ่านก่อนดำเนินการ');
    const input = data.getAll('jobId');
    if (!input.length || input.length > 100 || new Set(input).size !== input.length
      || input.some(id => typeof id !== 'string' || !id.trim() || id.length > 80)) {
      throw new Error('กรุณาเลือก 1–100 รายการโดยไม่ซ้ำกัน');
    }
    const ids = input as string[];
    await db.transaction(async tx => {
      const records = await tx.select().from(jobs).where(inArray(jobs.id, ids)).orderBy(jobs.id).for('update');
      if (records.length !== ids.length) throw new Error('ไม่พบ JOB บางรายการ กรุณารีเฟรชรายการ');
      const bundles = await tx.select({ jobId: files.jobId }).from(files).where(and(
        inArray(files.jobId, ids), eq(files.category, 'DO_MERGED'), eq(files.isCurrent, true),
      ));
      const ready = new Set(bundles.map(file => file.jobId));
      for (const job of records) {
        if (job.isArchived) throw new Error(`${job.jobNo} ถูกปิดการใช้งานแล้ว`);
        if (job.doExchangedAt) throw new Error(`${job.jobNo} ส่งแลก DO ไปแล้ว`);
        if (!ready.has(job.id)) throw new Error(`${job.jobNo} ยังไม่ได้รวมชุดแลก DO`);
      }
      const now = new Date();
      for (const job of records) {
        await tx.update(jobs).set({ doExchangedAt: now, doExchangedBy: user.id, updatedBy: user.id, updatedAt: now }).where(eq(jobs.id, job.id));
        await tx.insert(statusHistory).values({
          id: newId('STH'), jobId: job.id, fromStatus: job.status, toStatus: 'DO_EXCHANGED',
          note: 'ส่งชุดแลก D/O ให้สายเรือ (หลายรายการ)', actorId: user.id,
        });
        await tx.insert(activityLog).values({
          id: newId('LOG'), userId: user.id, action: 'MARK_DO_EXCHANGED', entityType: 'JOB', entityId: job.id,
          detail: JSON.stringify({ batch: true }),
        });
      }
    });
    revalidatePath('/', 'layout');
    return { error: '', message: `ส่งแลก DO แล้ว ${ids.length} รายการ` };
  } catch (error) {
    return { message: '', error: error instanceof Error ? error.message : 'ส่งแลก DO ไม่สำเร็จ' };
  }
}
