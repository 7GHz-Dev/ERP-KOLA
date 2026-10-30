import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { db } from '@/db';
import { masterRecords } from '@/db/schema';
import { newId } from '@/lib/actions/common';
import { downloadFile, ensureBucket, safeName, uploadFile } from '@/lib/storage';

/**
 * สถานะ worker กรอกเว็บ — worker ส่งสัญญาณมาเป็นระยะ หน้าแลก DO ใช้บอกว่าออนไลน์อยู่ไหม ทำอะไรอยู่
 *
 * เก็บใน master_records หนึ่งแถวต่อ worker (code = ชื่อ worker) แบบเดียวกับค่าตั้งค่าอื่น
 * ไม่ต้องเพิ่มตาราง · เขียนทับแถวเดิมทุกครั้ง จึงไม่โตขึ้นเรื่อย ๆ
 * สัญญาณพก log ล่าสุดมาด้วย และภาพหน้าจอสดตอนกำลังทำงาน (เก็บใน storage ทับไฟล์เดิม)
 *
 * ค่าตั้งที่ ANN สั่งจากหน้าเว็บ (ทำงานเบื้องหลัง · ปิด worker) อยู่อีกแถว worker อ่านกลับไปจากคำตอบของสัญญาณ
 */

export const WORKER_HEARTBEAT_TYPE = 'workerHeartbeat';
/**
 * mode ของ worker สร้าง Draft ใบขน (imp บน server ที่เปิด NETBAY ได้)
 * แยกจาก worker กรอกเว็บแลก DO — หน้าแลก DO ไม่นับตัวนี้ และปุ่มปิด worker ของ ANN ไม่มีผลกับมัน
 */
export const DRAFT_WORKER_MODE = 'draft';
/** mode ของตัว monitor ใบขน (worker:customs) — ตรงกับ CUSTOMS_MONITOR_MODE ใน lib/customs-monitor */
export const CUSTOMS_WORKER_MODE = 'customs';
/** worker ที่ไม่ใช่ตัวกรอกเว็บแลก DO — หน้าแลก DO ไม่นับ และปุ่มปิด worker ของ ANN ไม่มีผล */
export const NON_WEB_MODES = [DRAFT_WORKER_MODE, CUSTOMS_WORKER_MODE];
export const WORKER_SETTING_TYPE = 'workerSetting';
const SETTING_CODE = 'web';

/** ไม่ได้ยินเกินนี้ถือว่าปิดไปแล้ว — worker ส่งทุก 5–20 วินาที เผื่อเน็ตสะดุดได้สองรอบ */
const ONLINE_WITHIN_MS = 70_000;
const LOG_LINES = 80;

export type WorkerSettings = {
  /** ทำงานเบื้องหลัง — Chrome ไม่มีหน้าต่าง และกดปุ่มส่งให้เอง (ไม่มีใครตรวจหน้าจอ) */
  background: boolean;
  /** เวลาที่สั่งปิดจากหน้าเว็บ — worker ที่เปิดก่อนเวลานี้ปิดตัวเองหลังจบงานที่ทำอยู่ */
  stopAt: string | null;
};

export async function getWorkerSettings(): Promise<WorkerSettings> {
  const [row] = await db.select({ value: masterRecords.value }).from(masterRecords)
    .where(and(eq(masterRecords.type, WORKER_SETTING_TYPE), eq(masterRecords.code, SETTING_CODE))).limit(1);
  let data: Partial<WorkerSettings> = {};
  try { data = JSON.parse(row?.value ?? '{}'); } catch { /* ค่าเสีย ใช้ค่าตั้งต้น */ }
  return { background: Boolean(data.background), stopAt: data.stopAt ?? null };
}

export async function setWorkerSettings(patch: Partial<WorkerSettings>) {
  const value = JSON.stringify({ ...(await getWorkerSettings()), ...patch });
  await db.insert(masterRecords)
    .values({ id: newId('WKS'), type: WORKER_SETTING_TYPE, code: SETTING_CODE, name: 'web worker', value })
    .onConflictDoUpdate({ target: [masterRecords.type, masterRecords.code], set: { value, updatedAt: new Date() } });
}

export type WorkerInfo = {
  busy?: string | null;
  mode?: string;
  platform?: string;
  headless?: boolean;
  log?: unknown;
  /** ภาพหน้าจอสด JPEG base64 — ส่งมาเฉพาะตอนกำลังทำงาน */
  shot?: unknown;
  /** worker กำลังปิดตัว — ให้หน้าเว็บเห็นว่าปิดทันที ไม่ต้องรอสัญญาณหมดอายุ */
  offline?: boolean;
};

const shotKey = (worker: string) => `workers/${safeName(worker)}/live.jpg`;

export async function recordHeartbeat(worker: string, info: WorkerInfo) {
  const name = worker.slice(0, 80) || 'worker';
  const [prev] = await db.select({ value: masterRecords.value }).from(masterRecords)
    .where(and(eq(masterRecords.type, WORKER_HEARTBEAT_TYPE), eq(masterRecords.code, name))).limit(1);
  let shotAt: string | null = null;
  try { shotAt = JSON.parse(prev?.value ?? '{}').shotAt ?? null; } catch { /* ไม่มีภาพเก่า */ }

  if (typeof info.shot === 'string' && info.shot.length < 3_000_000) {
    await ensureBucket();
    await uploadFile(shotKey(name), Buffer.from(info.shot, 'base64'), 'image/jpeg');
    shotAt = new Date().toISOString();
  }

  const log = Array.isArray(info.log)
    ? info.log.slice(-LOG_LINES).map((l) => String(l).slice(0, 400))
    : [];
  const value = JSON.stringify({
    busy: info.busy ? String(info.busy).slice(0, 120) : null,
    mode: String(info.mode ?? '').slice(0, 20),
    platform: String(info.platform ?? '').slice(0, 20),
    headless: Boolean(info.headless),
    log, shotAt,
  });
  await db.insert(masterRecords)
    .values({ id: newId('WKR'), type: WORKER_HEARTBEAT_TYPE, code: name, name, value })
    .onConflictDoUpdate({
      target: [masterRecords.type, masterRecords.code],
      set: { value, updatedAt: info.offline ? new Date(0) : new Date(), isActive: true },
    });
  return getWorkerSettings();
}

export async function workerShot(worker: string) {
  return downloadFile(shotKey(worker));
}

export type OnlineWorker = {
  name: string; busy: string | null; mode: string; platform: string; headless: boolean;
  log: string[]; shotAt: string | null; seenAt: string;
};

export async function onlineWorkers(
  filter: { mode?: string; exceptMode?: string | string[] } = {},
): Promise<OnlineWorker[]> {
  const rows = await db.select({ name: masterRecords.name, value: masterRecords.value, updatedAt: masterRecords.updatedAt })
    .from(masterRecords)
    .where(and(
      eq(masterRecords.type, WORKER_HEARTBEAT_TYPE),
      gt(masterRecords.updatedAt, sql`now() - ${`${Math.round(ONLINE_WITHIN_MS / 1000)} seconds`}::interval`),
    ))
    .orderBy(desc(masterRecords.updatedAt));
  return rows.map((r) => {
    let info: Record<string, unknown> = {};
    try { info = JSON.parse(r.value ?? '{}'); } catch { /* ค่าเสีย ใช้ค่าว่าง */ }
    return {
      name: r.name,
      busy: (info.busy as string | null) ?? null,
      mode: String(info.mode ?? ''),
      platform: String(info.platform ?? ''),
      headless: Boolean(info.headless),
      log: Array.isArray(info.log) ? (info.log as string[]) : [],
      shotAt: (info.shotAt as string | null) ?? null,
      seenAt: r.updatedAt.toISOString(),
    };
  }).filter((w) => (!filter.mode || w.mode === filter.mode)
    && !([] as string[]).concat(filter.exceptMode ?? []).includes(w.mode));
}
