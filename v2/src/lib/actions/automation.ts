'use server';

import { revalidatePath } from 'next/cache';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { automationTasks, customsEntries, files, jobs } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import { buildKey, ensureBucket, uploadFile } from '@/lib/storage';
import { logActivity, newId, required, runAction } from './common';
import { completeTask, reuseOpenTask, TASK_TYPES } from '@/lib/automation';
import { recordCustomsCheck, requestRefresh } from '@/lib/customs-monitor';
import { netbayCredentials } from '@/lib/netbay-accounts';

/**
 * คิวงาน automation
 *
 * ระบบเดิมแยกเป็นเว็บ Hub อีกตัวเพราะ Sheets แชร์ข้ามโปรเจกต์ลำบาก
 * ตรงนี้อยู่ในฐานเดียวกันแล้ว โปรแกรม Python เรียก REST ของ v2 ได้ตรง ๆ
 * เหลือระบบที่ต้องดูแลตัวเดียว
 */

/** PAINT ส่ง Final Invoice เข้าคิวเพื่อให้ automate สร้าง Draft ใบขน */
async function submitDraftTaskImpl(formData: FormData) {
  const user = await requireActiveSession(['PAINT']);
  const jobId = required(formData.get('jobId'), 'งาน', 80);
  // บัญชี NETBAY ที่เลือกไว้ก่อนกด — ว่าง = บัญชีประจำเครื่องที่กด (.env.local)
  const netbayUser = String(formData.get('netbayUser') ?? '').trim().slice(0, 80);
  if (netbayUser && !netbayCredentials(netbayUser)) throw new Error(`ไม่รู้จักบัญชี NETBAY "${netbayUser}"`);

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new Error('ไม่พบงาน');

  const [invoice] = await db
    .select()
    .from(files)
    .where(and(eq(files.jobId, jobId), eq(files.category, 'FINAL_INVOICE'), eq(files.isCurrent, true)))
    .limit(1);
  if (!invoice) throw new Error('ต้องมีไฟล์ Final Invoice ก่อนส่งสร้าง Draft');

  const existing = await reuseOpenTask(jobId, TASK_TYPES.DRAFT);
  if (!existing) {
    const id = newId('TASK');
    await db.insert(automationTasks).values({
      id, type: TASK_TYPES.DRAFT, status: 'QUEUED', jobId,
      // local: ให้เครื่องที่กดเป็นคนทำ (ปุ่มเปิดลิงก์ kola-worker://draft?task=…) worker กลางไม่หยิบ
      payload: JSON.stringify({
        jobNo: job.jobNo, blNo: job.blNo, local: true, requestedBy: user.id, ...(netbayUser ? { netbayUser } : {}),
      }),
      inputStorageKey: invoice.storageKey,
      inputFileName: invoice.fileName,
    });
    await db.update(jobs)
      .set({ draftTaskId: id, draftStatus: 'SENT_TO_HUB', updatedBy: user.id, updatedAt: new Date() })
      .where(eq(jobs.id, jobId));
    await logActivity(user.id, 'SUBMIT_DRAFT_TASK', 'JOB', jobId, { taskId: id, netbayUser: netbayUser || null });
  }

  revalidatePath('/pending');
  revalidatePath('/automation');
}

/**
 * FAH กด SEND TO CUSTOMS ใน NETBAY เองแล้ว — งานเข้าคิวรอสร้างใบขน
 * ตัว monitor (worker:customs) บนเครื่องที่กดเช็กสถานะใน NETBAY จน ACCEPT แล้วส่งเลขใบขน + PDF กลับ
 */
async function submitCustomsTaskImpl(formData: FormData) {
  const user = await requireActiveSession(['FAH']);
  const jobId = required(formData.get('jobId'), 'งาน', 80);

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new Error('ไม่พบงาน');
  if (!job.draftRefNo) throw new Error('ยังไม่มีเลข Ref No. ของงานนี้');

  const existing = await reuseOpenTask(jobId, TASK_TYPES.CUSTOMS);
  if (!existing) {
    const id = newId('TASK');
    await db.insert(automationTasks).values({
      id, type: TASK_TYPES.CUSTOMS, status: 'QUEUED', jobId,
      payload: JSON.stringify({ jobNo: job.jobNo, refNo: job.draftRefNo, blNo: job.blNo }),
    });
    await db.update(jobs)
      .set({ customsTaskId: id, updatedBy: user.id, updatedAt: new Date() })
      .where(eq(jobs.id, jobId));
    await logActivity(user.id, 'SUBMIT_CUSTOMS_TASK', 'JOB', jobId, { taskId: id, refNo: job.draftRefNo });
  }

  revalidatePath('/fah/draft');
  revalidatePath('/automation');
}

/**
 * ปุ่ม Refresh (ตรวจ Draft · รอไฟล์และเลขใบขน · คิว Automation) — เช็กใบขนที่ค้างใน NETBAY ทันที ด้วยบัญชีที่เลือก
 * คืนผลให้ปุ่มเอง (ไม่ใช่ฟอร์ม) ปุ่มจึงรู้ว่าต้องเปิดตัว monitor บนเครื่องนี้ไหม และต้องรออีกกี่วินาที
 */
export async function refreshCustoms(username: string) {
  try {
    const user = await requireActiveSession(['PAINT', 'FAH']);
    const result = await requestRefresh({ by: user.displayName || user.username, username: String(username ?? '').slice(0, 80) });
    if (result.ok) await logActivity(user.id, 'REFRESH_CUSTOMS', 'WORKER', 'customs', { username, at: result.at });
    return result;
  } catch (error) {
    return { ok: false as const, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * จำลอง ACCEPT (ทดสอบ) — ใช้ทดสอบทั้งเส้นทางด้วยไฟล์ทดสอบ ซึ่งส่ง Customs จริงไม่ได้ ตัว monitor จึงไม่มีวันเห็น ACCEPT
 * ทำแบบเดียวกับที่ตัว monitor ทำตอนเจอ ACCEPT: บันทึกสถานะ แล้ว completeTask ด้วยเลขใบขน + PDF
 * เลขใบขนขึ้นต้น A999 และ PDF เขียนชัดว่าเป็นเอกสารทดสอบ — งานเดินต่อไปเตรียมเอกสารเดิน E ได้ตามปกติ
 * ADMIN เท่านั้น: กดกับงานจริงเท่ากับใส่เลขใบขนปลอมลงงาน
 */
async function simulateCustomsAcceptImpl(formData: FormData) {
  const user = await requireActiveSession(['ADMIN']);
  if (user.role !== 'ADMIN') throw new Error('จำลอง ACCEPT ได้เฉพาะ ADMIN');
  const taskId = required(formData.get('taskId'), 'งานในคิว', 80);

  const [task] = await db.select().from(automationTasks).where(eq(automationTasks.id, taskId)).limit(1);
  if (!task || task.type !== TASK_TYPES.CUSTOMS) throw new Error('ไม่พบงานสร้างใบขนนี้ในคิว');
  if (task.status !== 'QUEUED' && task.status !== 'PROCESSING') throw new Error('งานนี้ไม่ได้รอ ACCEPT แล้ว');
  const [job] = task.jobId ? await db.select().from(jobs).where(eq(jobs.id, task.jobId)).limit(1) : [];
  if (!job) throw new Error('ไม่พบงาน');

  // A + 13 หลักตามรูปแบบเลขใบขน · A999 นำหน้าให้เห็นว่าเป็นเลขทดสอบ
  const entryNo = `A999${String(Date.now()).slice(-10)}`;
  const pdf = await testDeclarationPdf({ entryNo, refNo: job.draftRefNo ?? '', blNo: job.blNo ?? '', jobNo: job.jobNo ?? '' });

  await recordCustomsCheck({ taskId, actorId: user.id, status: 'ACCEPT' });
  await completeTask({
    taskId, actorId: user.id, entryNo,
    file: { name: `${entryNo}.pdf`, mimeType: 'application/pdf', body: pdf },
  });
  await logActivity(user.id, 'SIMULATE_CUSTOMS_ACCEPT', 'JOB', job.id, { taskId, entryNo });

  revalidatePath('/automation');
  revalidatePath('/fah/draft');
  revalidatePath('/pending');
}

/** PDF ใบขนทดสอบ 1 หน้า — อักษรละตินล้วน ไม่ต้องใช้ฟอนต์ไทย */
async function testDeclarationPdf(v: { entryNo: string; refNo: string; blNo: string; jobNo: string }) {
  const { PDFDocument, StandardFonts, rgb } = await import('@cantoo/pdf-lib');
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const red = rgb(0.75, 0.1, 0.1);
  page.drawText('TEST IMPORT DECLARATION', { x: 60, y: 760, size: 24, font: bold });
  page.drawText('SIMULATED - NOT A REAL CUSTOMS DOCUMENT', { x: 60, y: 730, size: 14, font: bold, color: red });
  const rows = [
    ['Declaration No.', v.entryNo], ['Reference No.', v.refNo || '-'], ['BL No.', v.blNo || '-'],
    ['Job No.', v.jobNo || '-'], ['Status', 'Customs Accept (simulated)'], ['Created', new Date().toISOString()],
  ];
  rows.forEach(([k, val], i) => {
    page.drawText(k, { x: 60, y: 680 - i * 26, size: 13, font: bold });
    page.drawText(val, { x: 220, y: 680 - i * 26, size: 13, font });
  });
  return Buffer.from(await doc.save());
}

export async function simulateCustomsAccept(formData: FormData) {
  return runAction(() => simulateCustomsAcceptImpl(formData));
}

/** ดึงผลกลับเข้า Job — เก็บไว้เผื่อกรณีที่ worker บันทึกผลแต่ Job ยังไม่อัปเดต */
export async function pendingTaskCount() {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(automationTasks)
    .where(inArray(automationTasks.status, ['QUEUED', 'PROCESSING']));
  return row?.count ?? 0;
}

/* ----------------------------------------------------------
   ทุกคำสั่งข้างบนถูกห่อด้วย runAction ก่อนผูกกับปุ่มบนหน้าเว็บ
   ข้อผิดพลาดที่ผู้ใช้แก้เองได้จะกลับไปหน้าเดิมพร้อมข้อความ
   แทนที่จะเด้งหน้า 500 Internal Server Error ที่อ่านไม่ออก
   ---------------------------------------------------------- */

export async function submitDraftTask(formData: FormData) {
  return runAction(() => submitDraftTaskImpl(formData));
}

export async function submitCustomsTask(formData: FormData) {
  return runAction(() => submitCustomsTaskImpl(formData));
}

