'use server';

import { revalidatePath } from 'next/cache';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { jobs, activityLog } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import { readBatchClaims } from '@/lib/do-claim-batch';
import { newId } from './common';

export type BatchClaimState = { error: string; completed: string[]; message: string };

export async function markDoClaimedBatch(previous: BatchClaimState, data: FormData): Promise<BatchClaimState> {
  try {
    const user = await requireActiveSession(['MAY']);
    if (user.mustChangePassword) throw new Error('กรุณาเปลี่ยนรหัสผ่านก่อนดำเนินการ');
    const claims = readBatchClaims(data);
    await db.transaction(async tx => {
      // Lock in a consistent order and validate every job before changing any of them.
      const records = await tx.select().from(jobs).where(inArray(jobs.id, claims.map(item => item.id)))
        .orderBy(jobs.id).for('update');
      const byId = new Map(records.map(job => [job.id, job]));
      for (const item of claims) {
        const job = byId.get(item.id);
        if (!job || job.isArchived) throw new Error('มี JOB ที่ไม่พบหรือถูกปิดการใช้งาน กรุณารีเฟรชรายการ');
        if (job.doClaimedAt) throw new Error(`${job.jobNo} ตั้งเบิกไปแล้ว กรุณายกเลิกการเลือกรายการนี้`);
        if (job.doExchangedAt) throw new Error(`${job.jobNo} ส่งแลก DO แล้ว กรุณารีเฟรชรายการ`);
      }
      const now = new Date();
      for (const { id, amount } of claims) {
        const job = byId.get(id)!;
        await tx.update(jobs).set({
          doPayAmount: amount, doPayAmountBy: job.doPayAmountBy ?? user.id,
          doPayAmountAt: job.doPayAmountAt ?? now, doClaimedAt: now, doClaimedBy: user.id,
          updatedBy: user.id, updatedAt: now,
        }).where(eq(jobs.id, id));
        await tx.insert(activityLog).values({
          id: newId('LOG'), userId: user.id, action: 'MARK_DO_CLAIMED', entityType: 'JOB', entityId: id,
          detail: JSON.stringify({ amount, batch: true }),
        });
      }
    });
    revalidatePath('/may/do-pay', 'layout');
    return { error: '', completed: [...new Set([...previous.completed, ...claims.map(item => item.id)])], message: `ตั้งเบิกแล้ว ${claims.length} รายการ` };
  } catch (error) {
    return { ...previous, message: '', error: error instanceof Error ? error.message : 'ตั้งเบิกไม่สำเร็จ กรุณาลองอีกครั้ง' };
  }
}
