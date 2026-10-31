import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { automationTasks, jobs, masterRecords } from '@/db/schema';
import { logActivity, newId, recordStatus } from '@/lib/actions/common';
import { TASK_TYPES } from '@/lib/automation';
import { isStatusCode, netbayStatusLabel, NOT_FOUND, statusGroup } from '@/lib/customs-status';
import { monitorAccount, netbayCredentials, type NetbayAccount } from '@/lib/netbay-accounts';
import { onlineWorkers } from '@/lib/worker-status';

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

export { monitorAccount } from '@/lib/netbay-accounts';

async function readLease(): Promise<Lease | null> {
  const [row] = await db.select({ value: masterRecords.value }).from(masterRecords)
    .where(and(eq(masterRecords.type, LEASE_TYPE), eq(masterRecords.code, LEASE_CODE))).limit(1);
  try { return JSON.parse(row?.value ?? 'null'); } catch { return null; }
}

/** ชื่อเจ้าของ lease ตอนกดปิดเช็คสถานะจากหน้าเว็บ — scripts/customs-monitor.ts ใช้ข้อความเดียวกันบอกใน log */
export const MONITOR_STOPPED_BY = 'ปิดจากหน้าเว็บ';

/**
 * ปิดเช็คสถานะ — ยึด lease ไว้ด้วยชื่อ MONITOR_STOPPED_BY ตัว monitor ที่ทำอยู่เห็นว่าไม่ใช่เจ้าของแล้วปิดตัวเองหลังจบรอบ
 * ใช้กลไกเดียวกับตอนเครื่องอื่นรับหน้าที่ต่อ ตัว monitor รุ่นก่อนหน้าที่ยังไม่ได้อัปเดตโค้ดก็ปิดตาม
 * กด "สร้างใบขนแล้ว" หรือ "เปิดตัว monitor" อีกครั้ง เครื่องนั้นยึด lease กลับมาเช็กต่อได้ตามปกติ
 */
export async function stopMonitorLease() {
  const value = JSON.stringify({
    worker: MONITOR_STOPPED_BY, lease: `stopped:${Date.now()}`, since: new Date().toISOString(),
  } satisfies Lease);
  await db.insert(masterRecords)
    .values({ id: newId('CML'), type: LEASE_TYPE, code: LEASE_CODE, name: 'ตัว monitor ใบขน', value })
    .onConflictDoUpdate({ target: [masterRecords.type, masterRecords.code], set: { value, updatedAt: new Date() } });
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
export async function monitorTasks(lease: string): Promise<{
  owner: boolean; by?: string; tasks: MonitorTask[];
  /** มีคนกด Refresh ที่ยังไม่ได้เช็ก — ตัว monitor เช็กทันทีด้วยบัญชีที่ผู้กดเลือก */
  refresh?: { at: string; account: NetbayAccount } | null;
}> {
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
  return { owner: true, tasks, refresh: await pendingRefresh() };
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

/* ---------------- ปุ่ม Refresh: เช็กใน NETBAY ทันที ---------------- */

const REFRESH_CODE = 'refresh';
/** กด Refresh ได้ครั้งละหนึ่งนาที (รวมทุกคน) — แต่ละครั้งเปิด Chrome login NETBAY ใหม่ กดถี่บัญชีชนกันเอง */
export const REFRESH_COOLDOWN_MS = 60_000;
/** คำขอที่ค้างเกินนี้ไม่มีตัวไหนรับ (เช่นเครื่องปิดไป) — ไม่ให้ตัว monitor ที่เปิดทีหลังมาเช็กตามคำขอเก่า */
const REFRESH_STALE_MS = 10 * 60_000;

export type RefreshResult = { accepted: number; waiting: number; failed: number };
export type RefreshState = {
  at: string; by: string; username: string;
  doneAt: string | null; worker: string | null; result: RefreshResult | null;
};

export async function readRefresh(): Promise<RefreshState | null> {
  const [row] = await db.select({ value: masterRecords.value }).from(masterRecords)
    .where(and(eq(masterRecords.type, LEASE_TYPE), eq(masterRecords.code, REFRESH_CODE))).limit(1);
  try { return JSON.parse(row?.value ?? 'null'); } catch { return null; }
}

async function writeRefresh(state: RefreshState) {
  const value = JSON.stringify(state);
  await db.insert(masterRecords)
    .values({ id: newId('CMR'), type: LEASE_TYPE, code: REFRESH_CODE, name: 'Refresh ใบขน', value })
    .onConflictDoUpdate({ target: [masterRecords.type, masterRecords.code], set: { value, updatedAt: new Date() } });
}

async function pendingRefresh() {
  const r = await readRefresh();
  if (!r || r.doneAt || Date.now() - Date.parse(r.at) > REFRESH_STALE_MS) return null;
  const account = netbayCredentials(r.username);
  return account ? { at: r.at, account } : null;
}

/**
 * กด Refresh — ให้ตัว monitor เช็กทุกรายการที่ค้างใน NETBAY ทันที (ไม่รอครบ 5 นาที) ด้วยบัญชีที่เลือก
 *
 * ตัว monitor ที่ออนไลน์อยู่ (เครื่องไหนก็ได้) เห็นคำขอภายใน 10 วินาที
 * ไม่มีตัวไหนออนไลน์ = online:false หน้าเว็บเปิดตัว monitor บนเครื่องที่กด ตัวนั้นเห็นคำขอแล้วเช็กทันที
 */
export async function requestRefresh(input: { by: string; username?: string | null }): Promise<
  | { ok: true; at: string; online: boolean; pending: number }
  | { ok: false; reason: string; waitSec?: number }
> {
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(automationTasks)
    .where(and(eq(automationTasks.type, TASK_TYPES.CUSTOMS), inArray(automationTasks.status, ['QUEUED', 'PROCESSING'])));
  if (!count) return { ok: false, reason: 'ไม่มีใบขนรอเช็กใน NETBAY' };

  const prev = await readRefresh();
  const since = prev ? Date.now() - Date.parse(prev.at) : Infinity;
  if (since < REFRESH_COOLDOWN_MS) {
    const waitSec = Math.ceil((REFRESH_COOLDOWN_MS - since) / 1000);
    return { ok: false, reason: `เพิ่งกด Refresh ไป${prev?.by ? ` (${prev.by})` : ''} — รออีก ${waitSec} วินาที`, waitSec };
  }

  const wanted = String(input.username ?? '').trim();
  const username = wanted || monitorAccount().username;
  if (!netbayCredentials(username)) throw new Error(`ไม่รู้จักบัญชี NETBAY "${username}"`);

  const at = new Date().toISOString();
  await writeRefresh({ at, by: input.by.slice(0, 80), username, doneAt: null, worker: null, result: null });
  const online = (await onlineWorkers({ mode: CUSTOMS_MONITOR_MODE })).length > 0;
  return { ok: true, at, online, pending: count };
}

/** ตัว monitor เช็กตามคำขอ Refresh เสร็จแล้ว — หน้าเว็บที่กดเห็นแล้วโหลดข้อมูลใหม่ */
export async function finishRefresh(input: { at: string; worker: string; result?: Partial<RefreshResult> | null }) {
  const r = await readRefresh();
  if (!r || r.at !== input.at) return { ok: false };
  const n = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));
  await writeRefresh({
    ...r, doneAt: new Date().toISOString(), worker: input.worker.slice(0, 80),
    result: input.result ? { accepted: n(input.result.accepted), waiting: n(input.result.waiting), failed: n(input.result.failed) } : null,
  });
  return { ok: true };
}
