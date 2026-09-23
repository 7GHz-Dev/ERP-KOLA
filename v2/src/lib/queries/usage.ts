import { and, gte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { activityLog } from '@/db/schema';
import { AI_READ_ACTION } from '@/lib/usage-log';

/**
 * ยอดใช้งานสำหรับหน้า Monitor ของ ADMIN
 *
 * ค่าใช้จ่าย AI เก็บอยู่ใน activity_log เป็น JSON ต่อการเรียกหนึ่งครั้ง
 * ดึงตัวเลขออกมาด้วย ->> แล้วรวมใน Postgres ไม่ใช่ดึงทุกแถวมารวมในเมมโมรี
 * เพราะจำนวนแถวโตขึ้นเรื่อย ๆ ตามการใช้งาน
 */

export type AiUsage = {
  /** ยอดรวมทั้งหมดตั้งแต่เริ่มบันทึก */
  total: { calls: number; baht: number };
  /** เดือนนี้ (เวลาไทย) */
  month: { calls: number; baht: number };
  /** 7 วันล่าสุด */
  week: { calls: number; baht: number };
  /** วันนี้ */
  today: { calls: number; baht: number };
  /** แยกรายวัน 14 วันล่าสุด ใหม่สุดอยู่บน */
  daily: Array<{ day: string; calls: number; baht: number; failed: number }>;
};

/*
 * ตัดวันด้วยเขตเวลาไทยทุกที่ ให้ตรงกับที่หน้าจออื่นแสดง
 * ถ้าใช้ UTC ยอด "วันนี้" จะเริ่มนับตอน 7 โมงเช้า ซึ่งไม่ตรงกับที่คนเข้าใจ
 */
const BKK = sql`at time zone 'Asia/Bangkok'`;

export async function aiUsage(): Promise<AiUsage> {
  const baht = sql<number>`coalesce(sum((${activityLog.detail}::jsonb ->> 'baht')::numeric), 0)`;
  const calls = sql<number>`count(*)::int`;

  const [totals] = await db
    .select({
      totalCalls: calls,
      totalBaht: baht,
      monthCalls: sql<number>`count(*) filter (
        where date_trunc('month', ${activityLog.createdAt} ${BKK})
            = date_trunc('month', now() ${BKK}))::int`,
      monthBaht: sql<number>`coalesce(sum((${activityLog.detail}::jsonb ->> 'baht')::numeric) filter (
        where date_trunc('month', ${activityLog.createdAt} ${BKK})
            = date_trunc('month', now() ${BKK})), 0)`,
      weekCalls: sql<number>`count(*) filter (
        where ${activityLog.createdAt} >= now() - interval '7 days')::int`,
      weekBaht: sql<number>`coalesce(sum((${activityLog.detail}::jsonb ->> 'baht')::numeric) filter (
        where ${activityLog.createdAt} >= now() - interval '7 days'), 0)`,
      todayCalls: sql<number>`count(*) filter (
        where (${activityLog.createdAt} ${BKK})::date = (now() ${BKK})::date)::int`,
      todayBaht: sql<number>`coalesce(sum((${activityLog.detail}::jsonb ->> 'baht')::numeric) filter (
        where (${activityLog.createdAt} ${BKK})::date = (now() ${BKK})::date), 0)`,
    })
    .from(activityLog)
    .where(sql`${activityLog.action} = ${AI_READ_ACTION}`);

  const daily = await db
    .select({
      day: sql<string>`(${activityLog.createdAt} ${BKK})::date`,
      calls,
      baht,
      // นับครั้งที่อ่านไม่สำเร็จแยกไว้ — เสียเงินแล้วแต่ไม่ได้ค่า ถ้าเยอะผิดปกติต้องรู้
      failed: sql<number>`count(*) filter (
        where (${activityLog.detail}::jsonb ->> 'ok') = 'false')::int`,
    })
    .from(activityLog)
    .where(and(
      sql`${activityLog.action} = ${AI_READ_ACTION}`,
      gte(activityLog.createdAt, sql`now() - interval '14 days'`),
    ))
    .groupBy(sql`(${activityLog.createdAt} ${BKK})::date`)
    .orderBy(sql`(${activityLog.createdAt} ${BKK})::date desc`);

  const n = (v: unknown) => Number(v ?? 0);
  return {
    total: { calls: n(totals?.totalCalls), baht: n(totals?.totalBaht) },
    month: { calls: n(totals?.monthCalls), baht: n(totals?.monthBaht) },
    week: { calls: n(totals?.weekCalls), baht: n(totals?.weekBaht) },
    today: { calls: n(totals?.todayCalls), baht: n(totals?.todayBaht) },
    daily: daily.map((d) => ({
      day: String(d.day).slice(0, 10),
      calls: n(d.calls), baht: n(d.baht), failed: n(d.failed),
    })),
  };
}

export type LineQuota = {
  configured: boolean;
  type: string | null;
  limit: number | null;
  used: number | null;
  left: number | null;
  percent: number | null;
  error?: string;
};

/**
 * โควต้าข้อความของ LINE — ถามจาก LINE ทุกครั้ง ไม่เก็บ cache
 *
 * ค่าเปลี่ยนตลอดตามการใช้งานจริง และหน้านี้เปิดไม่บ่อย จึงไม่คุ้มที่จะ cache
 * แล้วต้องมาคิดเรื่องค่าเก่าค้างอีก
 */
export async function lineQuota(): Promise<LineQuota> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) return { configured: false, type: null, limit: null, used: null, left: null, percent: null };

  const headers = { Authorization: `Bearer ${token}` };
  const get = async (path: string) => {
    const res = await fetch(`https://api.line.me${path}`, { headers, cache: 'no-store' });
    if (!res.ok) throw new Error(`LINE ตอบ ${res.status}`);
    return res.json() as Promise<Record<string, unknown>>;
  };

  try {
    const [quota, used] = await Promise.all([
      get('/v2/bot/message/quota'),
      get('/v2/bot/message/quota/consumption'),
    ]);
    const type = (quota.type as string) ?? null;
    const limit = typeof quota.value === 'number' ? quota.value : null;
    const total = typeof used.totalUsage === 'number' ? used.totalUsage : null;
    return {
      configured: true, type, limit, used: total,
      left: limit !== null && total !== null ? limit - total : null,
      percent: limit && total !== null ? Math.round((total / limit) * 100) : null,
    };
  } catch (error) {
    return {
      configured: true, type: null, limit: null, used: null, left: null, percent: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
