import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { automationTasks, jobs, masterRecords } from '@/db/schema';
import { logActivity, newId, recordStatus } from '@/lib/actions/common';
import { TASK_TYPES } from '@/lib/automation';
import { isStatusCode, netbayStatusLabel, NOT_FOUND, statusGroup } from '@/lib/customs-status';

/**
 * ฝั่ง ERP ของตัว monitor ใบขน (scripts/customs-monitor.ts)
 *
 * FAH กด SEND TO CUSTOMS ใน NETBAY เอง แล้วกด "สร้างใบขนแล้ว" บน ERP → งาน CUSTOMS_ENTRY เข้าคิว
 * และเครื่องที่กดเปิดตัว monitor ขึ้นมา ตัว monitor เช็กสถานะใน NETBAY ทุกรายการที่ค้าง
 * จน ACCEPT ครบแล้วปิดตัวเอง · ได้ ACCEPT = ส่งเลขใบขน + PDF เข้า completeTask ตัวเดิม
 *
 * บัญชี NETBAY ของตัว monitor มีบัญชีเดียว (NETBAY_MONITOR_ACCOUNT) login ได้ทีละที่
 * จึงให้ทำได้ทีละเครื่อง: เครื่องที่กดล่าสุดรับหน้าที่ต่อ (lease) ตัวเก่าเห็นแล้วปิดตัวเอง
 * lease เก็บใน master_records แถวเดียว แบบเดียวกับสัญญาณสถานะ worker ไม่ต้องเพิ่มตาราง
 */

export const CUSTOMS_MONITOR_MODE = 'customs';
const LEASE_TYPE = 'customsMonitor';
const LEASE_CODE = 'lease';

type Lease = { worker: string; lease: string; since: string };

/** บัญชี NETBAY ของตัว monitor — ค่าบน Vercel รูปแบบ "user:pass" แยกจากชุดบัญชีประจำเครื่อง */
export function monitorAccount(env: Record<string, string | undefined> = process.env) {
  const raw = (env.NETBAY_MONITOR_ACCOUNT ?? '').trim();
  const i = raw.indexOf(':');
  if (i <= 0) throw new Error('ยังไม่ได้ตั้ง NETBAY_MONITOR_ACCOUNT (รูปแบบ user:pass) บน Vercel');
  return { username: raw.slice(0, i), password: raw.slice(i + 1) };
}

async function readLease(): Promise<Lease | null> {
  const [row] = await db.select({ value: masterRecords.value }).from(masterRecords)
    .where(and(eq(masterRecords.type, LEASE_TYPE), eq(masterRecords.code, LEASE_CODE))).limit(1);
  try { return JSON.parse(row?.value ?? 'null'); } catch { return null; }
}

/** เครื่องที่เพิ่งเปิดรับหน้าที่ — ตัวที่ทำอยู่ก่อน (ถ้ามี) จะเห็นในรอบถัดไปว่าไม่ใช่ตัวมันแล้ว */
export async function takeMonitorLease(worker: string, lease: string) {
  const account = monitorAccount();
  const value = JSON.stringify({ worker: worker.slice(0, 80), lease: lease.slice(0, 120), since: new Date().toISOString() } satisfies Lease);
  await db.insert(masterRecords)
    .values({ id: newId('CML'), type: LEASE_TYPE, code: LEASE_CODE, name: 'ตัว monitor ใบขน', value })
    .onConflictDoUpdate({ target: [masterRecords.type, masterRecords.code], set: { value, updatedAt: new Date() } });
  return { account };
}

export type MonitorTask = {
  id: string; jobId: string | null; jobNo: string | null; blNo: string | null;
  refNo: string; checkedAt: string | null; externalStatus: string | null;
};

/**
 * รายการที่ตัว monitor ต้องเช็กรอบนี้ — ว่าง = ACCEPT ครบแล้ว ตัว monitor ปิดตัวเอง
 *
 * Ref No. เอาจากงานปัจจุบัน ไม่ใช่ค่าที่จำไว้ตอนกด เผื่อ PAINT สร้าง Draft ใหม่ได้เลขใหม่
 * งานที่ได้เลขใบขนไปแล้วทางอื่น (customs_status = FILED) ปิดทิ้ง ไม่งั้นค้างในคิวตลอดไป
 */
export async function monitorTasks(lease: string): Promise<{ owner: boolean; by?: string; tasks: MonitorTask[] }> {
  const current = await readLease();
  if (current && current.lease !== lease) return { owner: false, by: current.worker, tasks: [] };

  const rows = await db.select({
    id: automationTasks.id, jobId: automationTasks.jobId, payload: automationTasks.payload,
    checkedAt: automationTasks.checkedAt, externalStatus: automationTasks.externalStatus,
    jobNo: jobs.jobNo, blNo: jobs.blNo, draftRefNo: jobs.draftRefNo, customsStatus: jobs.customsStatus,
  })
    .from(automationTasks)
    .leftJoin(jobs, eq(jobs.id, automationTasks.jobId))
    .where(and(
      eq(automationTasks.type, TASK_TYPES.CUSTOMS),
      inArray(automationTasks.status, ['QUEUED', 'PROCESSING']),
    ))
    .orderBy(asc(automationTasks.createdAt));

  const filed = rows.filter((r) => r.customsStatus === 'FILED').map((r) => r.id);
  if (filed.length) {
    const now = new Date();
    await db.update(automationTasks)
      .set({ status: 'DONE', error: 'งานได้เลขใบขนทางอื่นแล้ว', completedAt: now, updatedAt: now })
      .where(inArray(automationTasks.id, filed));
  }

  const tasks = rows.filter((r) => r.customsStatus !== 'FILED').map((r) => {
    let payload: { refNo?: string } = {};
    try { payload = JSON.parse(r.payload ?? '{}') ?? {}; } catch { payload = {}; }
    return {
      id: r.id, jobId: r.jobId, jobNo: r.jobNo, blNo: r.blNo,
      refNo: (r.draftRefNo || payload.refNo || '').trim(),
      checkedAt: r.checkedAt?.toISOString() ?? null, externalStatus: r.externalStatus,
    };
  });
  return { owner: true, tasks };
}

/**
 * ผลการเช็ก 1 รายการ — บันทึกสถานะล่าสุดให้หน้าคิวแสดง
 *
 * สถานะยกเลิก (CANCELED, DRAFT_CANCEL) ไม่มีวัน ACCEPT: ปิดงานในคิวแล้วคืนให้ FAH ตรวจ Draft ใหม่
 * (ล้าง customs_task_id งานจึงกลับไปแท็บตรวจ Draft) FAH ทำใบขนใหม่แล้วกด "สร้างใบขนแล้ว" อีกครั้ง
 * error ไม่ว่าง = เช็กรอบนี้ไม่สำเร็จ (เช่นดาวน์โหลด PDF ไม่ได้) รอบหน้าลองใหม่ ไม่เปลี่ยนสถานะงาน
 */
export async function recordCustomsCheck(input: {
  taskId: string; actorId: string; status?: string | null; error?: string | null;
}) {
  const [task] = await db.select().from(automationTasks).where(eq(automationTasks.id, input.taskId)).limit(1);
  if (!task || task.type !== TASK_TYPES.CUSTOMS) throw new Error('ไม่พบงานสร้างใบขนนี้ในคิว');
  if (task.status === 'DONE' || task.status === 'ERROR') return { closed: true };

  const status = String(input.status ?? '').trim().slice(0, 80) || null;
  const error = String(input.error ?? '').trim().slice(0, 1000) || null;
  const now = new Date();

  if (status && statusGroup(status) === 'canceled') {
    const reason = `ใบขนถูกยกเลิกใน NETBAY (${netbayStatusLabel(status)}) — คืนให้ FAH ตรวจ Draft ใหม่`;
    await db.update(automationTasks).set({
      status: 'ERROR', externalStatus: status, checkedAt: now, error: reason, completedAt: now, updatedAt: now,
    }).where(eq(automationTasks.id, task.id));
    if (task.jobId) {
      await db.update(jobs).set({ customsTaskId: null, updatedAt: now })
        .where(and(eq(jobs.id, task.jobId), eq(jobs.customsTaskId, task.id)));
      await recordStatus(task.jobId, null, 'CUSTOMS_CANCELED', reason, input.actorId);
    }
    await logActivity(input.actorId, 'CUSTOMS_CANCELED', 'TASK', task.id, { status });
    return { closed: true };
  }

  await db.update(automationTasks).set({
    // ไม่รู้สถานะ (เช่นเข้า NETBAY ไม่ได้) คงค่าเดิมไว้ ป้ายไม่กระพริบกลับเป็น "ยังไม่ได้เช็ก"
    externalStatus: status ?? task.externalStatus,
    checkedAt: now, error, updatedAt: now,
  }).where(eq(automationTasks.id, task.id));
  return { closed: false, known: status === NOT_FOUND || isStatusCode(status) };
}
