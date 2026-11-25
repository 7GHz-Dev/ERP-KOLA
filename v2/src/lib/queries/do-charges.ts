import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '@/db';
import { doCharges, files, masterRecords } from '@/db/schema';
import { DO_CHARGE_MASTER, type DoCharge, type DoChargeTopic } from '@/lib/do-charges';
import type { DoAttachment } from '@/lib/do-attachments';

/** หัวข้อใน dropdown — ที่เปิดใช้อยู่ เรียงตามที่เพิ่มไว้ใน Master Data (หัวข้อใหม่ต่อท้าย) */
export async function doChargeTopics(): Promise<DoChargeTopic[]> {
  return db.select({ id: masterRecords.id, name: masterRecords.name })
    .from(masterRecords)
    .where(and(eq(masterRecords.type, DO_CHARGE_MASTER), eq(masterRecords.isActive, true)))
    .orderBy(asc(masterRecords.createdAt), asc(masterRecords.name));
}

/**
 * ค่าใช้จ่ายของหลายงานในรอบเดียว พร้อม Invoice / Slip ของแต่ละหัวข้อ
 * สองคำสั่ง ไม่ใช่คำสั่งต่องาน — ตารางหนึ่งหน้ามีได้เป็นร้อยแถว
 */
export async function chargesFor(jobIds: string[]): Promise<Map<string, DoCharge[]>> {
  const map = new Map<string, DoCharge[]>();
  if (!jobIds.length) return map;
  const rows = await db.select().from(doCharges)
    .where(inArray(doCharges.jobId, jobIds))
    .orderBy(asc(doCharges.createdAt));
  if (!rows.length) return map;
  const attached = await db.select({
    id: files.id, chargeId: files.doChargeId, category: files.category,
    fileName: files.fileName, mimeType: files.mimeType, note: files.note,
  }).from(files).where(and(
    inArray(files.doChargeId, rows.map((r) => r.id)),
    isNotNull(files.doChargeId),
    eq(files.isCurrent, true),
  )).orderBy(asc(files.uploadedAt));
  const filesOf = (id: string, category: string): DoAttachment[] => attached
    .filter((f) => f.chargeId === id && f.category === category)
    .map(({ id: fid, category: c, fileName, mimeType, note }) => ({ id: fid, category: c, fileName, mimeType, note }));
  for (const r of rows) {
    const list = map.get(r.jobId) ?? [];
    list.push({
      id: r.id, topicId: r.topicId, topicName: r.topicName, amount: r.amount, note: r.note,
      claimedAt: r.claimedAt ? r.claimedAt.toISOString() : null,
      invoices: filesOf(r.id, 'DO_CHARGE_INV'),
      slips: filesOf(r.id, 'DO_CHARGE_SLIP'),
    });
    map.set(r.jobId, list);
  }
  return map;
}
