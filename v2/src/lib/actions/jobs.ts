'use server';

import { revalidatePath } from 'next/cache';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { approvals, customsEntries, doHandoffs, jobs, masterRecords } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import { day, logActivity, newId, number, recordStatus, required, runAction, text } from './common';

/**
 * การแก้ไขข้อมูลทั้งหมดผ่าน server action
 *
 * ทุกตัวเรียก requireActiveSession() ซึ่งตรวจกับฐานข้อมูลจริงว่า session ยังไม่ถูกเพิกถอน
 * ต่างจากการอ่านหน้าเว็บที่ใช้คุกกี้อย่างเดียวเพื่อความเร็ว
 */

async function latestApprovalRow(jobId: string, type: 'AN' | 'FN') {
  const [row] = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.jobId, jobId), eq(approvals.approvalType, type)))
    .orderBy(desc(approvals.requestedAt))
    .limit(1);
  return row ?? null;
}

/** ส่งงานเข้าคิวอนุมัติ */
async function requestApprovalImpl(formData: FormData) {
  const user = await requireActiveSession(['PAINT']);
  const jobId = required(formData.get('jobId'), 'งาน', 80);
  const type = text(formData.get('type'), 4) === 'FN' ? 'FN' : 'AN';

  const pending = await latestApprovalRow(jobId, type);
  if (pending?.status === 'PENDING') throw new Error('รายการนี้รออนุมัติอยู่แล้ว');
  if (type === 'FN') {
    const an = await latestApprovalRow(jobId, 'AN');
    if (an?.status !== 'APPROVED') throw new Error('ต้องผ่านการอนุมัติ AN ก่อน');
  }

  const id = newId('APR');
  await db.insert(approvals).values({
    id, jobId, approvalType: type, status: 'PENDING', requestedBy: user.id,
  });
  const status = type === 'AN' ? 'WAITING_AN_APPROVAL' : 'WAITING_FN_APPROVAL';
  await db.update(jobs).set({ status, updatedBy: user.id, updatedAt: new Date() }).where(eq(jobs.id, jobId));
  await recordStatus(jobId, null, status, `ส่งอนุมัติ ${type}`, user.id);
  await logActivity(user.id, `REQUEST_${type}`, 'APPROVAL', id, { jobId });

  revalidatePath('/pending');
}

/** อนุมัติหรือตีกลับ — AN เป็นสิทธิ์ NAMKANG ส่วน FN เป็นของ FAH */
async function decideApprovalImpl(formData: FormData) {
  const approvalId = required(formData.get('approvalId'), 'รายการอนุมัติ', 80);
  const decision = text(formData.get('decision'), 10) === 'APPROVED' ? 'APPROVED' : 'REJECTED';
  const reason = text(formData.get('reason'), 1000);
  if (decision === 'REJECTED' && !reason) throw new Error('การไม่อนุมัติต้องระบุเหตุผล');

  const [approval] = await db.select().from(approvals).where(eq(approvals.id, approvalId)).limit(1);
  if (!approval) throw new Error('ไม่พบรายการอนุมัติ');
  if (approval.status !== 'PENDING') throw new Error('รายการนี้ถูกตัดสินไปแล้ว');

  const user = await requireActiveSession(
    approval.approvalType === 'AN' ? ['NAMKANG'] : ['FAH'],
  );

  await db.update(approvals)
    .set({ status: decision, reason, decidedBy: user.id, decidedAt: new Date() })
    .where(eq(approvals.id, approvalId));

  const next =
    decision === 'REJECTED'
      ? approval.approvalType === 'AN' ? 'AN_REJECTED' : 'FN_REJECTED'
      : approval.approvalType === 'AN' ? 'AN_APPROVED' : 'FN_APPROVED';

  await db.update(jobs)
    .set({ status: next, updatedBy: user.id, updatedAt: new Date() })
    .where(eq(jobs.id, approval.jobId));
  await recordStatus(approval.jobId, approval.status, next,
    decision === 'REJECTED' ? `ตีกลับ: ${reason}` : 'อนุมัติแล้ว', user.id);
  await logActivity(user.id, `DECIDE_${approval.approvalType}`, 'APPROVAL', approvalId, { decision });

  revalidatePath('/pending');
  revalidatePath('/nam/approve');
  revalidatePath('/fah/fn');
  revalidatePath('/overview');
}

/** FAH ยืนยัน ETA และวันที่ขนย้าย — ETA จึงกลายเป็นตัวจริง แสดง (OFC) */
async function saveDoHandoffImpl(formData: FormData) {
  const user = await requireActiveSession(['FAH']);
  const jobId = required(formData.get('jobId'), 'งาน', 80);
  const eta = day(formData.get('eta'));
  if (!eta) throw new Error('กรุณาระบุ ETA');

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new Error('ไม่พบงาน');

  const transportDate = day(formData.get('transportDate'));
  // FAH เลือก Partner จาก Master Data เก็บชื่อไว้ด้วยเพื่อให้รายงานเก่ายังอ่านออก
  const partnerId = text(formData.get('partnerId'), 80);
  let partnerName = text(formData.get('partnerName'), 180);
  if (partnerId) {
    const [partner] = await db.select({ name: masterRecords.name })
      .from(masterRecords).where(eq(masterRecords.id, partnerId)).limit(1);
    if (!partner) throw new Error('ไม่พบ Partner ที่เลือก');
    partnerName = partner.name;
  }
  const note = text(formData.get('note'), 1000);

  const terminalId = text(formData.get('terminalId'), 80) || job.terminalId;
  const portId = text(formData.get('portId'), 80) || job.portId;
  // ปุ่ม "บันทึกอย่างเดียว" กับ "บันทึกและส่ง Partner" ยิง action เดียวกัน ต่างที่ค่านี้
  const sendToPartner = text(formData.get('sendToPartner'), 4) === '1';

  const [existing] = await db.select().from(doHandoffs).where(eq(doHandoffs.jobId, jobId)).limit(1);
  const values = {
    jobId, etaOfficial: eta, transportDate, partnerName, note,
    portId, terminalId,
    sentBy: sendToPartner ? user.id : existing?.sentBy ?? null,
    sentAt: sendToPartner ? new Date() : existing?.sentAt ?? null,
    updatedAt: new Date(),
  };
  if (existing) await db.update(doHandoffs).set(values).where(eq(doHandoffs.id, existing.id));
  else await db.insert(doHandoffs).values({ id: newId('DO'), ...values });

  await db.update(jobs).set({
    eta, etaIsOfficial: true, transportDate, portId, terminalId,
    releasePartner: partnerName || job.releasePartner,
    status: sendToPartner ? 'DO_SENT' : job.status,
    updatedBy: user.id, updatedAt: new Date(),
  }).where(eq(jobs.id, jobId));
  if (sendToPartner) {
    await recordStatus(jobId, job.status, 'DO_SENT',
      `ส่ง DO ให้ ${partnerName || 'Partner'}`, user.id);
  }
  await logActivity(user.id, sendToPartner ? 'SEND_DO_PARTNER' : 'SAVE_DO_HANDOFF',
    'JOB', jobId, { eta, transportDate, partnerName });

  revalidatePath('/fah/do');
  revalidatePath('/pending');
}

/** NAMKANG อัปเดตสถานะ Surrender BL */
async function updateSurrenderImpl(formData: FormData) {
  const user = await requireActiveSession(['NAMKANG']);
  const jobId = required(formData.get('jobId'), 'งาน', 80);
  const status = text(formData.get('surrenderStatus'), 20);
  if (!['PENDING', 'CLEARED', 'ISSUE'].includes(status)) throw new Error('สถานะไม่ถูกต้อง');

  await db.update(jobs)
    .set({ surrenderStatus: status, updatedBy: user.id, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
  await recordStatus(jobId, null, `SURRENDER_${status}`, text(formData.get('note'), 500), user.id);
  await logActivity(user.id, 'UPDATE_SURRENDER', 'JOB', jobId, { status });

  revalidatePath('/nam/customer');
  revalidatePath('/nam/release');
}

/** ปล่อยสินค้า — ต้องมี E-Office และ Surrender เคลียร์แล้วเท่านั้น */
async function releaseJobImpl(formData: FormData) {
  const user = await requireActiveSession(['NAMKANG']);
  const jobId = required(formData.get('jobId'), 'งาน', 80);

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new Error('ไม่พบงาน');
  if (job.surrenderStatus !== 'CLEARED') throw new Error('Surrender ยังไม่เคลียร์');

  await db.update(jobs).set({
    releaseStatus: 'RELEASED', status: 'RELEASED',
    updatedBy: user.id, updatedAt: new Date(),
  }).where(eq(jobs.id, jobId));
  await recordStatus(jobId, job.status, 'RELEASED', text(formData.get('note'), 500) || 'แจ้งปล่อยสินค้า', user.id);
  await logActivity(user.id, 'RELEASE_JOB', 'JOB', jobId, {});

  revalidatePath('/nam/release');
  revalidatePath('/overview');
}

/** FAH ตีกลับ Draft ให้ PAINT แก้แล้วส่งใหม่ */
async function rejectDraftImpl(formData: FormData) {
  const user = await requireActiveSession(['FAH']);
  const jobId = required(formData.get('jobId'), 'งาน', 80);
  const reason = required(formData.get('reason'), 'เหตุผล', 1000);

  await db.update(jobs).set({
    draftStatus: 'REJECTED', draftRejectReason: reason,
    updatedBy: user.id, updatedAt: new Date(),
  }).where(eq(jobs.id, jobId));
  await recordStatus(jobId, 'SUBMITTED', 'DRAFT_REJECTED', `FAH ตีกลับ Draft: ${reason}`, user.id);
  await logActivity(user.id, 'REJECT_DRAFT', 'JOB', jobId, { reason });

  revalidatePath('/fah/draft');
  revalidatePath('/pending');
}

/**
 * แก้ข้อมูล BL ที่คีย์ผิดตอนรับงาน
 *
 * ยังไม่ผ่านอนุมัติ AN จึงแก้ได้อิสระ ที่แก้บ่อยคือ DEM/DET เพราะสายเรือแจ้งมาทีหลัง
 * เก็บจำนวนวันไว้ ไม่ได้เก็บวันสุดท้าย เพราะวันสุดท้ายคำนวณจาก ETA ซึ่งเปลี่ยนได้อีก
 */
async function updateBlInfoImpl(formData: FormData) {
  const user = await requireActiveSession(['PAINT']);
  const jobId = required(formData.get('jobId'), 'งาน', 80);

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new Error('ไม่พบงาน');

  const demDays = number(formData.get('demDays'), job.demDays);
  const detDays = number(formData.get('detDays'), job.detDays);
  if (demDays < 0 || detDays < 0) throw new Error('จำนวนวันติดลบไม่ได้');

  await db.update(jobs).set({
    blNo: text(formData.get('blNo'), 120) || job.blNo,
    vessel: text(formData.get('vessel'), 120),
    voyage: text(formData.get('voyage'), 80),
    eta: day(formData.get('eta')) ?? job.eta,
    transportDate: day(formData.get('transportDate')),
    demDays: Math.round(demDays),
    detDays: Math.round(detDays),
    product: text(formData.get('product'), 1000),
    updatedBy: user.id,
    updatedAt: new Date(),
  }).where(eq(jobs.id, jobId));

  await logActivity(user.id, 'UPDATE_BL_INFO', 'JOB', jobId, { demDays, detDays });
  revalidatePath('/pending');
}

/**
 * PAINT ส่ง Draft ที่สร้างเสร็จแล้วให้ FAH ตรวจ
 *
 * ก่อนหน้านี้ไม่มีขั้นนี้ Draft ที่ automate สร้างเสร็จจะค้างที่ CREATED
 * ส่วนคิวของ FAH กรอง SUBMITTED จึงไม่มีงานไหลไปถึงเลย
 * ตีกลับแล้วแก้ไฟล์ใหม่ก็กดส่งซ้ำได้จากตรงนี้
 */
async function submitDraftForReviewImpl(formData: FormData) {
  const user = await requireActiveSession(['PAINT']);
  const jobId = required(formData.get('jobId'), 'งาน', 80);

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new Error('ไม่พบงาน');
  if (!job.draftRefNo) throw new Error('ยังไม่มีเลข Ref No. ต้องสร้าง Draft ให้เสร็จก่อน');
  if (job.draftStatus === 'SUBMITTED') throw new Error('ส่งให้ FAH ตรวจอยู่แล้ว');
  if (job.customsStatus === 'FILED') throw new Error('งานนี้ได้เลขใบขนแล้ว ไม่ต้องส่งตรวจซ้ำ');

  await db.update(jobs).set({
    draftStatus: 'SUBMITTED', draftRejectReason: null,
    updatedBy: user.id, updatedAt: new Date(),
  }).where(eq(jobs.id, jobId));
  await recordStatus(jobId, job.draftStatus, 'ENTRY_DRAFTED',
    job.draftStatus === 'REJECTED' ? 'PAINT แก้แล้วส่ง Draft ให้ FAH ตรวจอีกครั้ง' : 'PAINT ส่ง Draft ให้ FAH ตรวจ',
    user.id);
  await logActivity(user.id, 'SUBMIT_DRAFT_REVIEW', 'JOB', jobId, { refNo: job.draftRefNo });

  revalidatePath('/pending');
  revalidatePath('/fah/draft');
}

/** บันทึกเลขใบขนด้วยมือ (ใช้เมื่อไม่ได้ผ่าน Automation Hub) */
async function fileCustomsEntryImpl(formData: FormData) {
  const user = await requireActiveSession(['FAH']);
  const jobId = required(formData.get('jobId'), 'งาน', 80);
  const declarationNo = required(formData.get('declarationNo'), 'เลขที่ใบขน', 120);

  const [existing] = await db.select().from(customsEntries)
    .where(eq(customsEntries.jobId, jobId)).orderBy(desc(customsEntries.updatedAt)).limit(1);

  if (existing) {
    await db.update(customsEntries).set({
      declarationNo, status: 'FILED', filedBy: user.id, filedAt: new Date(), updatedAt: new Date(),
    }).where(eq(customsEntries.id, existing.id));
  } else {
    await db.insert(customsEntries).values({
      id: newId('CUS'), jobId, declarationNo, status: 'FILED',
      amount: String(number(formData.get('amount'))),
      createdBy: user.id, filedBy: user.id, filedAt: new Date(),
    });
  }

  await db.update(jobs).set({
    customsStatus: 'FILED', status: 'CUSTOMS_FILED',
    updatedBy: user.id, updatedAt: new Date(),
  }).where(eq(jobs.id, jobId));
  await recordStatus(jobId, null, 'CUSTOMS_FILED', `เลขใบขน ${declarationNo}`, user.id);
  await logActivity(user.id, 'FILE_CUSTOMS', 'JOB', jobId, { declarationNo });

  revalidatePath('/fah/draft');
  revalidatePath('/pending');
}

/* ----------------------------------------------------------
   ทุกคำสั่งข้างบนถูกห่อด้วย runAction ก่อนผูกกับปุ่มบนหน้าเว็บ
   ข้อผิดพลาดที่ผู้ใช้แก้เองได้จะกลับไปหน้าเดิมพร้อมข้อความ
   แทนที่จะเด้งหน้า 500 Internal Server Error ที่อ่านไม่ออก
   ---------------------------------------------------------- */

export async function requestApproval(formData: FormData) {
  return runAction(() => requestApprovalImpl(formData));
}

export async function decideApproval(formData: FormData) {
  return runAction(() => decideApprovalImpl(formData));
}

export async function saveDoHandoff(formData: FormData) {
  return runAction(() => saveDoHandoffImpl(formData));
}

export async function updateSurrender(formData: FormData) {
  return runAction(() => updateSurrenderImpl(formData));
}

export async function releaseJob(formData: FormData) {
  return runAction(() => releaseJobImpl(formData));
}

export async function rejectDraft(formData: FormData) {
  return runAction(() => rejectDraftImpl(formData));
}

export async function fileCustomsEntry(formData: FormData) {
  return runAction(() => fileCustomsEntryImpl(formData));
}

export async function submitDraftForReview(formData: FormData) {
  return runAction(() => submitDraftForReviewImpl(formData));
}

export async function updateBlInfo(formData: FormData) {
  return runAction(() => updateBlInfoImpl(formData));
}
