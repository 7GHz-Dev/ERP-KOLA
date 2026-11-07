import { and, eq, inArray, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { bls, jobs, waitingBls } from '@/db/schema';
import { blKey } from '@/lib/waiting-bl';

/*
 * แยกจาก actions/waiting-bl.ts โดยตั้งใจ — ไฟล์นั้นเป็น 'use server'
 * ทุกฟังก์ชันที่ export จากไฟล์นั้นหน้าเว็บเรียกได้ตรง ๆ ตัวนี้ไม่ได้ตรวจสิทธิ์เอง จึงต้องอยู่นอก
 */

/**
 * AN ของงานนี้ผ่านแล้ว = BL เข้าตารางหลัก → ปิดรายการ Waiting BL ที่เลข BL ตรงกับงาน
 * ดูทั้ง jobs.bl_no และตาราง bls เพราะงานหนึ่งมีได้หลาย BL
 * ไม่ใช่ server action ที่หน้าจอเรียกตรง — decideApproval เรียกหลังบันทึกผลอนุมัติ
 */
export async function resolveWaitingBlsForJob(jobId: string, userId: string) {
  const [job] = await db.select({ blNo: jobs.blNo }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
  const extra = await db.select({ blNo: bls.blNo }).from(bls).where(eq(bls.jobId, jobId));
  const keys = [...new Set([job?.blNo, ...extra.map((b) => b.blNo)].filter(Boolean).map((b) => blKey(String(b))))];
  if (!keys.length) return 0;
  const done = await db.update(waitingBls)
    .set({ resolvedAt: new Date(), resolvedJobId: jobId, updatedBy: userId, updatedAt: new Date() })
    .where(and(isNull(waitingBls.resolvedAt), isNull(waitingBls.cancelledAt), inArray(waitingBls.blKey, keys)))
    .returning({ id: waitingBls.id });
  if (done.length) revalidatePath('/waiting-bl');
  return done.length;
}
