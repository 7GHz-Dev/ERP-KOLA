import { asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { jobPriceLines, jobPriceSets, jobs } from '@/db/schema';
import { newId } from '@/lib/actions/common';
import type { PriceLine } from './pricing';

/**
 * ราคาเก็บลูกค้าในฐานข้อมูล + ด่าน "ต้องมีราคาก่อนยิงใบขน"
 *
 * ตารางมาจาก npm run migrate:sale — ถ้ายังไม่ได้รัน ทุกฟังก์ชันที่ด่านอื่นเรียกใช้จะ "ปล่อยผ่าน" (fail-open)
 * เพื่อไม่ให้งานยิงใบขนทั้งระบบหยุดเพราะลืมรัน migration · หน้า Sale จะขึ้นบอกให้รันแทน
 */

export const isMissingTable = (e: unknown) =>
  typeof e === 'object' && e !== null && ('code' in e ? (e as { code?: string }).code === '42P01' : /does not exist/.test(String(e)));

export type PriceSet = {
  jobId: string; currency: string; total: number; note: string | null;
  confirmedAt: Date | null; confirmedBy: string | null; updatedAt: Date;
  lines: PriceLine[];
};

export async function getPriceSet(jobId: string): Promise<PriceSet | null> {
  const [set] = await db.select().from(jobPriceSets).where(eq(jobPriceSets.jobId, jobId)).limit(1);
  if (!set) return null;
  const lines = await db.select().from(jobPriceLines).where(eq(jobPriceLines.jobId, jobId)).orderBy(asc(jobPriceLines.lineNo));
  return {
    jobId, currency: set.currency, total: Number(set.total), note: set.note,
    confirmedAt: set.confirmedAt, confirmedBy: set.confirmedBy, updatedAt: set.updatedAt,
    lines: lines.map((l) => ({
      description: l.description, unit: l.unit === 'CONTAINER' ? 'CONTAINER' : 'JOB',
      quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), amount: Number(l.amount),
    })),
  };
}

/** สถานะราคาของหลายงาน — null = ยังไม่ได้รัน migration (ไม่รู้) */
export async function priceStatus(jobIds: string[]): Promise<Map<string, { total: number; confirmed: boolean }> | null> {
  if (!jobIds.length) return new Map();
  try {
    const rows = await db.select({ jobId: jobPriceSets.jobId, total: jobPriceSets.total, confirmedAt: jobPriceSets.confirmedAt })
      .from(jobPriceSets).where(inArray(jobPriceSets.jobId, jobIds));
    return new Map(rows.map((r) => [r.jobId, { total: Number(r.total), confirmed: Boolean(r.confirmedAt) }]));
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
}

/**
 * ด่านก่อนยิงใบขน — ส่ง Draft ให้ตรวจ · สั่งสร้าง Draft · ส่งเข้า NETBAY · บันทึกเลขใบขน
 * ต้องมีราคาที่ Sale ยืนยันแล้ว ไม่งั้นโยน error พร้อมบอกว่าต้องทำอะไร
 */
export async function assertSalePrice(jobId: string) {
  try {
    const [row] = await db.select({ confirmedAt: jobPriceSets.confirmedAt }).from(jobPriceSets)
      .where(eq(jobPriceSets.jobId, jobId)).limit(1);
    if (!row?.confirmedAt) {
      const [job] = await db.select({ jobNo: jobs.jobNo }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
      throw new Error(`งาน ${job?.jobNo ?? jobId} ยังไม่มีราคาเก็บลูกค้าจาก Sale — ต้องให้ Sale กำหนดและยืนยันราคาก่อนยิงใบขน`);
    }
  } catch (e) {
    if (isMissingTable(e)) {
      console.warn('ยังไม่ได้รัน npm run migrate:sale — ข้ามด่านราคา Sale ไปก่อน');
      return;
    }
    throw e;
  }
}

/** บันทึกราคา (แทนชุดเดิมทั้งชุด) · confirm = ยืนยันราคา ปลดด่านยิงใบขน */
export async function savePriceSet(input: {
  jobId: string; lines: PriceLine[]; total: number; note: string; confirm: boolean; userId: string;
}) {
  await db.transaction(async (tx) => {
    await tx.delete(jobPriceLines).where(eq(jobPriceLines.jobId, input.jobId));
    if (input.lines.length) {
      await tx.insert(jobPriceLines).values(input.lines.map((l, i) => ({
        id: newId('JPL'), jobId: input.jobId, lineNo: i + 1, description: l.description, unit: l.unit,
        quantity: String(l.quantity), unitPrice: String(l.unitPrice), amount: String(l.amount),
      })));
    }
    const values = {
      total: String(input.total), note: input.note || null, updatedBy: input.userId, updatedAt: new Date(),
      // ยืนยันแล้วแก้ราคาภายหลัง: คงสถานะยืนยันไว้ถ้ากดยืนยันซ้ำ · บันทึกร่างเฉย ๆ = ถอนการยืนยัน ต้องยืนยันใหม่
      confirmedAt: input.confirm ? new Date() : null, confirmedBy: input.confirm ? input.userId : null,
    };
    await tx.insert(jobPriceSets).values({ jobId: input.jobId, ...values })
      .onConflictDoUpdate({ target: jobPriceSets.jobId, set: values });
  });
}

/** ราคาล่าสุดที่ยืนยันแล้วของ Client in Charge คนเดียวกัน — ปุ่ม "ใช้รายการเดียวกับงานก่อน" */
export async function lastPriceForClient(personId: string | null, exceptJobId: string) {
  if (!personId) return null;
  const [row] = await db.execute<{ job_id: string; job_no: string }>(sql`
    select ps.job_id, j.job_no from job_price_sets ps join jobs j on j.id = ps.job_id
     where j.person_id = ${personId} and ps.job_id <> ${exceptJobId} and ps.confirmed_at is not null
     order by ps.confirmed_at desc limit 1`);
  if (!row) return null;
  const set = await getPriceSet(row.job_id);
  return set ? { jobNo: row.job_no, lines: set.lines } : null;
}
