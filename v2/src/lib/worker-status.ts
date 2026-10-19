import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { db } from '@/db';
import { masterRecords } from '@/db/schema';
import { newId } from '@/lib/actions/common';

/**
 * สถานะ worker กรอกเว็บ — worker ส่งสัญญาณมาทุก 20 วินาที หน้าแลก DO ใช้บอกว่าออนไลน์อยู่ไหม
 *
 * เก็บใน master_records หนึ่งแถวต่อ worker (code = ชื่อ worker) แบบเดียวกับค่าตั้งค่าอื่น
 * ไม่ต้องเพิ่มตาราง · เขียนทับแถวเดิมทุกครั้ง จึงไม่โตขึ้นเรื่อย ๆ
 */

export const WORKER_HEARTBEAT_TYPE = 'workerHeartbeat';

/** ไม่ได้ยินเกินนี้ถือว่าปิดไปแล้ว — worker ส่งทุก 20 วินาที เผื่อเน็ตสะดุดได้สองรอบ */
const ONLINE_WITHIN_MS = 70_000;

export type WorkerInfo = { busy?: string | null; mode?: string; platform?: string };

export async function recordHeartbeat(worker: string, info: WorkerInfo) {
  const name = worker.slice(0, 80) || 'worker';
  const value = JSON.stringify({
    busy: info.busy ? String(info.busy).slice(0, 120) : null,
    mode: String(info.mode ?? '').slice(0, 20),
    platform: String(info.platform ?? '').slice(0, 20),
  });
  await db.insert(masterRecords)
    .values({ id: newId('WKR'), type: WORKER_HEARTBEAT_TYPE, code: name, name, value })
    .onConflictDoUpdate({
      target: [masterRecords.type, masterRecords.code],
      set: { value, updatedAt: new Date(), isActive: true },
    });
}

export type OnlineWorker = { name: string; busy: string | null; mode: string; platform: string; seenAt: string };

export async function onlineWorkers(): Promise<OnlineWorker[]> {
  const rows = await db.select({ name: masterRecords.name, value: masterRecords.value, updatedAt: masterRecords.updatedAt })
    .from(masterRecords)
    .where(and(
      eq(masterRecords.type, WORKER_HEARTBEAT_TYPE),
      gt(masterRecords.updatedAt, sql`now() - ${`${Math.round(ONLINE_WITHIN_MS / 1000)} seconds`}::interval`),
    ))
    .orderBy(desc(masterRecords.updatedAt));
  return rows.map((r) => {
    let info: WorkerInfo = {};
    try { info = JSON.parse(r.value ?? '{}'); } catch { /* ค่าเสีย ใช้ค่าว่าง */ }
    return {
      name: r.name, busy: info.busy ?? null, mode: info.mode ?? '', platform: info.platform ?? '',
      seenAt: r.updatedAt.toISOString(),
    };
  });
}
