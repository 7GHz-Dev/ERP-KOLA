import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { automationTasks, jobs, masterRecords } from '@/db/schema';
import { logActivity, newId } from '@/lib/actions/common';
import { completeTask, TASK_TYPES } from '@/lib/automation';
import { recordCustomsCheck } from '@/lib/customs-monitor';
import { settingValue } from '@/lib/queries/master';

/**
 * โหมดจำลองสร้างใบขน — ADMIN เปิด/ปิดได้ที่ Master Data → ค่าตั้งต้น
 *
 * ไฟล์ทดสอบส่ง Customs จริงไม่ได้ ตัว monitor จึงไม่มีวันเห็น ACCEPT
 * เปิดโหมดนี้แล้ว กด "สร้างใบขนแล้ว" = ได้เลขใบขนทดสอบ (A999…) + PDF ทดสอบทันที ไม่ผ่าน NETBAY
 * เก็บเป็นแถว settings ปกติ จึงเห็นและแก้ได้จากตารางค่าตั้งต้นด้วย (ค่า ON = เปิด)
 */
export const CUSTOMS_SIMULATION_CODE = 'CUSTOMS_SIMULATION';

export async function isCustomsSimulation() {
  return (await settingValue(CUSTOMS_SIMULATION_CODE, 'OFF')).toUpperCase() === 'ON';
}

export async function setCustomsSimulation(on: boolean) {
  const value = on ? 'ON' : 'OFF';
  await db.insert(masterRecords)
    .values({
      id: newId('MD'), type: 'settings', code: CUSTOMS_SIMULATION_CODE, name: 'โหมดจำลองสร้างใบขน',
      description: 'ON = กด "สร้างใบขนแล้ว" ได้เลขใบขนทดสอบ (A999…) + PDF ทดสอบทันที ไม่ผ่าน NETBAY', value,
    })
    .onConflictDoUpdate({
      target: [masterRecords.type, masterRecords.code],
      set: { value, isActive: true, updatedAt: new Date() },
    });
}

/**
 * จำลอง ACCEPT — ทำแบบเดียวกับที่ตัว monitor ทำตอนเจอ ACCEPT: บันทึกสถานะ แล้ว completeTask ด้วยเลขใบขน + PDF
 * เลขใบขนขึ้นต้น A999 และ PDF เขียนชัดว่าเป็นเอกสารทดสอบ — งานเดินต่อไปเตรียมเอกสารเดิน E ได้ตามปกติ
 */
export async function simulateAccept(taskId: string, actorId: string) {
  const [task] = await db.select().from(automationTasks).where(eq(automationTasks.id, taskId)).limit(1);
  if (!task || task.type !== TASK_TYPES.CUSTOMS) throw new Error('ไม่พบงานสร้างใบขนนี้ในคิว');
  if (task.status !== 'QUEUED' && task.status !== 'PROCESSING') throw new Error('งานนี้ไม่ได้รอ ACCEPT แล้ว');
  const [job] = task.jobId ? await db.select().from(jobs).where(eq(jobs.id, task.jobId)).limit(1) : [];
  if (!job) throw new Error('ไม่พบงาน');

  // A + 13 หลักตามรูปแบบเลขใบขน · A999 นำหน้าให้เห็นว่าเป็นเลขทดสอบ
  const entryNo = `A999${String(Date.now()).slice(-10)}`;
  const pdf = await testDeclarationPdf({ entryNo, refNo: job.draftRefNo ?? '', blNo: job.blNo ?? '', jobNo: job.jobNo ?? '' });

  await recordCustomsCheck({ taskId, actorId, status: 'ACCEPT' });
  await completeTask({
    taskId, actorId, entryNo,
    file: { name: `${entryNo}.pdf`, mimeType: 'application/pdf', body: pdf },
  });
  await logActivity(actorId, 'SIMULATE_CUSTOMS_ACCEPT', 'JOB', job.id, { taskId, entryNo });
  return entryNo;
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
