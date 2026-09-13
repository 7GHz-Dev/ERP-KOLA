'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { activityLog, jobs } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import { newId, required, runAction } from './common';

export async function setJobActive(formData: FormData) {
  return runAction(async () => {
    const admin = await requireActiveSession(['ADMIN']);
    if (admin.mustChangePassword) throw new Error('กรุณาเปลี่ยนรหัสผ่านก่อนดำเนินการ');
    const id = required(formData.get('jobId'), 'JOB', 80);
    const active = formData.get('active');
    if (active !== '0' && active !== '1') throw new Error('สถานะการใช้งานไม่ถูกต้อง');
    const archived = active === '0';

    await db.transaction(async (tx) => {
      // Change only the expected previous state, so duplicate submissions do not duplicate the audit.
      const [changed] = await tx.update(jobs)
        .set({ isArchived: archived, updatedBy: admin.id, updatedAt: new Date() })
        .where(and(eq(jobs.id, id), eq(jobs.isArchived, !archived)))
        .returning({ jobNo: jobs.jobNo });
      if (!changed) {
        const [existing] = await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, id)).limit(1);
        if (!existing) throw new Error('ไม่พบ JOB ที่ต้องการ');
        return;
      }
      await tx.insert(activityLog).values({
        id: newId('LOG'), userId: admin.id,
        action: archived ? 'DISABLE_JOB' : 'ENABLE_JOB', entityType: 'JOB', entityId: id,
        detail: JSON.stringify({ jobNo: changed.jobNo, isArchived: archived }),
      });
    });
    revalidatePath('/', 'layout');
  });
}
