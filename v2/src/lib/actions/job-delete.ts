'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { approvals, files, jobs } from '@/db/schema';
import { requireJobsActor } from '@/lib/job-actor';
import { removeFile } from '@/lib/storage';
import { logActivity, runAction } from './common';

/**
 * ลบงานถาวร — ใช้กับใบที่คีย์ผิดตั้งแต่ต้น ยังไม่ได้ส่งให้ใครดู
 *
 * ลบจริง ไม่ใช่ซ่อน เพราะใบที่คีย์ผิดหรือซ้ำไม่ควรค้างอยู่ให้เกะกะรายงานย้อนหลัง
 * (การซ่อนมีอยู่แล้วที่ Master Data ของ ADMIN สำหรับงานที่ต้องเก็บประวัติไว้)
 *
 * แถวในตารางลูกหายตามด้วย foreign key cascade — BL ตู้ ไฟล์ ประวัติ คำขออนุมัติ
 * แต่ไฟล์ใน storage ไม่ได้หายตาม ต้องสั่งลบเอง ไม่งั้นจะเหลือไฟล์ลอยที่ไม่มีใครอ้างถึง
 *
 * ลบได้ตราบที่งานยังไม่เข้าตารางหลัก (AN ยังไม่ถูกอนุมัติ) — ทั้งที่ยังไม่ส่ง ถูกตีกลับ หรือส่งไปรอ Head Officer อนุมัติอยู่
 * งานที่ส่งไปรออนุมัติ ลบแล้วคำขออนุมัติหายตามไปด้วย (cascade) คิวของ Head Officer จึงไม่ค้าง
 * งานที่อนุมัติเข้าตารางหลักแล้วมีคนอื่นใช้ข้อมูลต่อ ลบทิ้งจะกระทบงานของฝ่ายอื่น — ใช้ซ่อนที่ Master Data แทน
 *
 * Import Officer ลบได้ · Head Officer ลบได้เฉพาะงาน Other cargo (MO / TO) ที่ดูแลเอง
 */
async function deleteJobsImpl(formData: FormData) {
  const ids = String(formData.get('jobIds') ?? '')
    .split(',').map((v) => v.trim()).filter(Boolean);
  if (!ids.length) throw new Error('ยังไม่ได้เลือกรายการ');
  const user = await requireJobsActor(ids, ['PAINT']);

  const rows = await db
    .select({ id: jobs.id, jobNo: jobs.jobNo, isArchived: jobs.isArchived })
    .from(jobs)
    .where(inArray(jobs.id, ids));
  if (!rows.length) throw new Error('ไม่พบงานที่เลือก');

  /*
   * ตรวจว่าทุกใบยังลบได้จริงก่อนเริ่มลบ — ใบไหนมีคำขออนุมัติที่ APPROVED แล้ว (AN เข้าตารางหลัก) ลบไม่ได้
   * PENDING (รอ Head Officer) กับ REJECTED (ถูกตีกลับ) ยังไม่เข้าตารางหลัก ลบได้
   */
  const appr = await db
    .select({ jobId: approvals.jobId, status: approvals.status })
    .from(approvals)
    .where(inArray(approvals.jobId, ids));

  const blocked = rows.filter((r) =>
    appr.some((a) => a.jobId === r.id && a.status === 'APPROVED'));
  if (blocked.length) {
    throw new Error(
      `ลบไม่ได้ ${blocked.length} รายการเพราะอนุมัติเข้าตารางหลักแล้ว: `
      + blocked.map((b) => b.jobNo).join(', '),
    );
  }

  // เก็บ key ของไฟล์ไว้ก่อน เพราะแถวจะหายไปพร้อมงานตอนลบ
  const keys = await db
    .select({ storageKey: files.storageKey })
    .from(files)
    .where(inArray(files.jobId, ids));

  for (const row of rows) {
    await db.delete(jobs).where(eq(jobs.id, row.id));
    await logActivity(user.id, 'DELETE_JOB', 'JOB', row.id, { jobNo: row.jobNo });
  }

  /*
   * ลบไฟล์หลังลบแถวสำเร็จแล้ว
   * ถ้าลบไฟล์ก่อนแล้วลบแถวพลาด จะเหลือแถวที่ชี้ไปไฟล์ที่ไม่มีอยู่ ซึ่งแย่กว่าไฟล์ลอย
   * ไฟล์ลบไม่ผ่านก็ไม่ทำให้ทั้งงานล้ม เพราะแถวหายไปแล้วและไม่มีใครอ้างถึงไฟล์นั้นอีก
   */
  for (const { storageKey } of keys) {
    try {
      await removeFile(storageKey);
    } catch {
      /* ไฟล์ค้างใน storage ไม่กระทบการใช้งาน เก็บกวาดทีหลังได้ */
    }
  }

  revalidatePath('/pending');
  revalidatePath('/jobs');
  revalidatePath('/nam/pending');
  revalidatePath('/other', 'layout');

  // ลบจากหน้าแก้ BL ของงานนั้น — หน้าเดิมไม่มีแล้ว พากลับไปที่รายการ
  const back = String(formData.get('returnTo') ?? '');
  if (back.startsWith('/') && !back.startsWith('//')) redirect(back);
}

export async function deleteJobs(formData: FormData) {
  return runAction(() => deleteJobsImpl(formData));
}
