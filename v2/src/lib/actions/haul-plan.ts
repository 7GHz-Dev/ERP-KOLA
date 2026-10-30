'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { containers, haulPlans, jobs } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { day, logActivity, newId, recordStatus, runAction } from './common';

const idsOf = (formData: FormData) =>
  [...new Set(String(formData.get('containerIds') ?? '').split(',').map((v) => v.trim()).filter(Boolean))];

/**
 * NAMKANG ส่งแพลนลากตู้ให้ MAY — เลือกหลายตู้ ตั้งวันลากเดียวกัน แล้วส่งทีเดียว
 *
 * ใช้ปุ่มเดียวกันทั้งส่งครั้งแรกและเปลี่ยนวันหลังส่งแล้ว
 * เปลี่ยนวัน = ส่งใหม่: ล้างการรับแพลนของ MAY แพลนจึงกลับไปอยู่ในรายการใหม่ให้ MAY เห็นว่าวันเปลี่ยน
 * รับเฉพาะตู้ของงานที่ส่ง Partner แล้ว ตรวจฝั่งเซิร์ฟเวอร์ด้วย เพราะฟอร์มถูกยิงตรงได้
 */
async function sendHaulPlanImpl(formData: FormData) {
  const user = await requireActiveSession(['NAMKANG']);
  const ids = idsOf(formData);
  if (!ids.length) throw new Error('ยังไม่ได้เลือกตู้');
  const haulDate = day(formData.get('haulDate'));
  if (!haulDate) throw new Error('กรุณาเลือกวันลากตู้');

  const rows = await db.select({
    containerId: containers.id, containerNo: containers.containerNo,
    jobId: jobs.id, jobStatus: jobs.status, sentToPartner: jobs.eofficeSentAt,
  }).from(containers).innerJoin(jobs, eq(jobs.id, containers.jobId))
    .where(inArray(containers.id, ids));
  const ready = rows.filter((r) => r.sentToPartner);
  if (!ready.length) throw new Error('ตู้ที่เลือกยังไม่ได้ส่ง Partner');

  const now = new Date();
  for (const r of ready) {
    await db.insert(haulPlans)
      .values({
        id: newId('HAUL'), jobId: r.jobId, containerId: r.containerId, haulDate,
        sentAt: now, sentBy: user.id,
      })
      .onConflictDoUpdate({
        target: haulPlans.containerId,
        set: { haulDate, sentAt: now, sentBy: user.id, ackAt: null, ackBy: null, updatedAt: now },
      });
  }

  // ไทม์ไลน์ของงานบอกครั้งเดียวต่องาน พร้อมเลขตู้ที่อยู่ในแพลน
  const byJob = new Map<string, { status: string; nos: string[] }>();
  for (const r of ready) {
    const entry = byJob.get(r.jobId) ?? { status: r.jobStatus, nos: [] };
    entry.nos.push(r.containerNo || r.containerId);
    byJob.set(r.jobId, entry);
  }
  for (const [jobId, entry] of byJob) {
    await recordStatus(jobId, entry.status, 'HAUL_PLAN_SENT',
      `ส่งแพลนลากตู้ ${entry.nos.join(', ')} วันที่ ${formatDate(haulDate)} ให้ MAY`, user.id);
  }
  await logActivity(user.id, 'HAUL_PLAN_SENT', 'CONTAINER', ready.map((r) => r.containerId).join(','),
    { haulDate, count: ready.length });

  revalidatePath('/nam/haul');
  revalidatePath('/may/haul');
  if (ready.length < ids.length) {
    throw new Error(`ส่งแพลนแล้ว ${ready.length} ตู้ · ไม่สำเร็จ ${ids.length - ready.length} ตู้ (ยังไม่ได้ส่ง Partner หรือไม่พบตู้)`);
  }
}

/** MAY รับแพลนลากตู้ — เลือกหลายตู้แล้วกดทีเดียว ตู้ที่รับไปแล้วข้าม ไม่เขียนเวลาทับ */
async function ackHaulPlanImpl(formData: FormData) {
  const user = await requireActiveSession(['MAY']);
  const ids = idsOf(formData);
  if (!ids.length) throw new Error('ยังไม่ได้เลือกตู้');

  const now = new Date();
  const done = await db.update(haulPlans)
    .set({ ackAt: now, ackBy: user.id, updatedAt: now })
    .where(and(inArray(haulPlans.containerId, ids), isNotNull(haulPlans.sentAt), isNull(haulPlans.ackAt)))
    .returning({ containerId: haulPlans.containerId });
  await logActivity(user.id, 'HAUL_PLAN_ACK', 'CONTAINER', done.map((d) => d.containerId).join(','), { count: done.length });

  revalidatePath('/may/haul');
  revalidatePath('/nam/haul');
  if (!done.length) throw new Error('ตู้ที่เลือกรับแพลนไปแล้ว หรือยังไม่ได้ส่งแพลน');
}

export async function sendHaulPlan(formData: FormData) {
  return runAction(() => sendHaulPlanImpl(formData));
}

export async function ackHaulPlan(formData: FormData) {
  return runAction(() => ackHaulPlanImpl(formData));
}
