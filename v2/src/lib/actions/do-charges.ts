'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { doCharges, files, jobs, masterRecords } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import { claimAmountInput } from '@/lib/do-claim-batch';
import { DO_CHARGE_MASTER, DO_CHARGE_NOTE_MAX } from '@/lib/do-charges';
import { isFrameworkError, logActivity, newId, text } from './common';

/**
 * ค่าใช้จ่ายแลก DO หลายหัวข้อต่อ BL — ของ MAY ที่แผงยอดชำระ
 *
 * บันทึกทีละหัวข้อทันทีที่กด ไม่รอกดตั้งเบิก — หัวข้อที่เพิ่มแล้วต้องมีที่ให้แนบ Invoice / Slip ได้เลย
 * หัวข้อที่ตั้งเบิกไปแล้วแก้ยอด/ลบไม่ได้ (เบิกเงินไปตามยอดนั้นแล้ว) แต่ยังแนบไฟล์เพิ่มได้
 * คืนผลเป็นค่า เพราะกดจากในแผง ต้องขึ้นข้อความที่บรรทัดนั้น
 */
type Result = { ok: true } | { ok: false; detail: string };

async function attempt(work: () => Promise<void>): Promise<Result> {
  try {
    await work();
    revalidatePath('/may/do-pay', 'layout');
    return { ok: true };
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    return { ok: false, detail: error instanceof Error && error.message ? error.message : 'บันทึกไม่สำเร็จ' };
  }
}

/** เพิ่มหัวข้อ (ไม่มี chargeId) หรือแก้หัวข้อที่ยังไม่ได้ตั้งเบิก */
export async function saveDoCharge(formData: FormData): Promise<Result> {
  return attempt(async () => {
    const user = await requireActiveSession(['MAY']);
    const chargeId = text(formData.get('chargeId'), 80);
    const topicId = text(formData.get('topicId'), 80);
    const amount = claimAmountInput(text(formData.get('amount'), 30));
    const note = text(formData.get('note'), 200).replace(/\s+/g, ' ').trim();
    if (!topicId) throw new Error('กรุณาเลือกหัวข้อ');
    if (amount === null || Number(amount) <= 0) throw new Error('ยอดต้องเป็นตัวเลขมากกว่า 0 ทศนิยมไม่เกิน 2 ตำแหน่ง');
    if (note.length > DO_CHARGE_NOTE_MAX) throw new Error(`หมายเหตุยาวได้ไม่เกิน ${DO_CHARGE_NOTE_MAX} ตัวอักษร`);

    const [topic] = await db.select({ id: masterRecords.id, name: masterRecords.name, isActive: masterRecords.isActive })
      .from(masterRecords)
      .where(and(eq(masterRecords.id, topicId), eq(masterRecords.type, DO_CHARGE_MASTER))).limit(1);
    if (!topic) throw new Error('ไม่พบหัวข้อนี้ใน Master Data');

    const now = new Date();
    if (chargeId) {
      const [row] = await db.select().from(doCharges).where(eq(doCharges.id, chargeId)).limit(1);
      if (!row) throw new Error('ไม่พบรายการ อาจถูกลบไปแล้ว — รีเฟรชหน้า');
      // หัวข้อเดิมที่ถูกปิดใช้ไปแล้วยังบันทึกยอดต่อได้ แต่เลือกหัวข้อที่ปิดใช้ใหม่ไม่ได้
      if (!topic.isActive && row.topicId !== topic.id) throw new Error('หัวข้อนี้ถูกปิดใช้แล้ว');
      const done = await db.update(doCharges).set({
        topicId: topic.id, topicName: topic.name, amount, note: note || null, updatedAt: now,
      }).where(and(eq(doCharges.id, chargeId), isNull(doCharges.claimedAt))).returning({ id: doCharges.id });
      if (!done.length) throw new Error('รายการนี้ตั้งเบิกไปแล้ว แก้ยอดไม่ได้');
      // Invoice / Slip ที่แนบไว้ใช้ชื่อหัวข้อเป็นหมายเหตุ — เปลี่ยนหัวข้อแล้วตามไปด้วย
      await db.update(files).set({ note: topic.name }).where(eq(files.doChargeId, chargeId));
      await logActivity(user.id, 'UPDATE_DO_CHARGE', 'JOB', row.jobId, { chargeId, topic: topic.name, amount, note });
      return;
    }

    if (!topic.isActive) throw new Error('หัวข้อนี้ถูกปิดใช้แล้ว');
    const jobId = text(formData.get('jobId'), 80);
    const [job] = await db.select({ id: jobs.id, isArchived: jobs.isArchived }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job || job.isArchived) throw new Error('ไม่พบงาน');
    const id = newId('DCH');
    await db.insert(doCharges).values({
      id, jobId, topicId: topic.id, topicName: topic.name, amount, note: note || null, createdBy: user.id,
    });
    await logActivity(user.id, 'ADD_DO_CHARGE', 'JOB', jobId, { chargeId: id, topic: topic.name, amount, note });
  });
}

/** ลบหัวข้อที่ยังไม่ได้ตั้งเบิก — Invoice / Slip ที่แนบไว้ปลดออกจากไฟล์ปัจจุบันด้วย (ไม่ลบไฟล์จริง) */
export async function deleteDoCharge(formData: FormData): Promise<Result> {
  return attempt(async () => {
    const user = await requireActiveSession(['MAY']);
    const chargeId = text(formData.get('chargeId'), 80);
    const gone = await db.delete(doCharges)
      .where(and(eq(doCharges.id, chargeId), isNull(doCharges.claimedAt)))
      .returning({ jobId: doCharges.jobId, topicName: doCharges.topicName, amount: doCharges.amount });
    if (!gone.length) throw new Error('ลบไม่ได้ — รายการนี้ตั้งเบิกไปแล้ว หรือถูกลบไปแล้ว');
    await db.update(files).set({ isCurrent: false }).where(eq(files.doChargeId, chargeId));
    await logActivity(user.id, 'DELETE_DO_CHARGE', 'JOB', gone[0].jobId, { chargeId, ...gone[0] });
  });
}

/**
 * ตั้งเบิกค่าใช้จ่ายเพิ่มเติม — หัวข้อที่เพิ่มหลังงานตั้งเบิกไปแล้ว
 * ทำได้เฉพาะงานที่ตั้งเบิกค่า DO แล้ว (ก่อนหน้านั้นหัวข้อทั้งหมดตั้งเบิกไปพร้อมค่า DO)
 */
export async function claimExtraDoCharges(formData: FormData): Promise<Result> {
  return attempt(async () => {
    const user = await requireActiveSession(['MAY']);
    const jobId = text(formData.get('jobId'), 80);
    const [job] = await db.select({ doClaimedAt: jobs.doClaimedAt }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) throw new Error('ไม่พบงาน');
    if (!job.doClaimedAt) throw new Error('งานนี้ยังไม่ได้ตั้งเบิกค่า DO — กดตั้งเบิกแล้วที่แผงก่อน');
    const now = new Date();
    const done = await db.update(doCharges).set({ claimedAt: now, claimedBy: user.id, updatedAt: now })
      .where(and(eq(doCharges.jobId, jobId), isNull(doCharges.claimedAt)))
      .returning({ id: doCharges.id, topicName: doCharges.topicName, amount: doCharges.amount });
    if (!done.length) throw new Error('ไม่มีค่าใช้จ่ายเพิ่มเติมที่รอตั้งเบิก');
    await logActivity(user.id, 'CLAIM_DO_CHARGES', 'JOB', jobId, { charges: done });
  });
}
