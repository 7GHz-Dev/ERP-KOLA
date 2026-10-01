import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { jobSequences } from '@/db/schema';
import { newId } from '@/lib/actions/common';

/*
 * ย้ายมาจาก actions/intake.ts เพื่อให้หน้าแก้ไข JOB ของ ADMIN ใช้ตัวเดียวกันได้
 * ไฟล์ใน actions/ เป็น 'use server' ฟังก์ชันที่ export จากตรงนั้นจะถูกเรียกจากเบราว์เซอร์ได้
 * ตัวออกเลขตู้ต้องไม่เปิดให้เรียกตรง จึงอยู่ใน lib แทน
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * เลขประจำตู้ เช่น MU2026080001
 *
 * รหัส Job Type + ปี ค.ศ. + เดือน + เลขรัน 4 หลัก เลขรันแยกกันคนละชุดต่อเดือน
 * ล็อกแถวลำดับไว้เหมือนเลขงาน เพราะเลขนี้ต้องไม่ซ้ำ — จะใช้ผูกค่าใช้จ่ายรายตู้ต่อไป
 */
export async function nextContainerNos(tx: Tx, jobTypeCode: string, count: number): Promise<string[]> {
  if (!count) return [];
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `${jobTypeCode}${year}${month}`;

  const [existing] = await tx
    .select()
    .from(jobSequences)
    .where(and(eq(jobSequences.year, year), eq(jobSequences.prefix, prefix)))
    .for('update')
    .limit(1);

  const start = existing?.lastNumber ?? 0;
  const last = start + count;
  if (existing) {
    await tx.update(jobSequences)
      .set({ lastNumber: last, updatedAt: new Date() })
      .where(eq(jobSequences.id, existing.id));
  } else {
    await tx.insert(jobSequences).values({
      id: newId('SEQ'), year, prefix, lastNumber: last,
    });
  }

  return Array.from({ length: count }, (_, i) => `${prefix}${String(start + i + 1).padStart(4, '0')}`);
}

