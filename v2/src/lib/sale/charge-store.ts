import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { activityLog, jobs, specialChargeFiles, specialChargeItems, specialCharges, users } from '@/db/schema';
import { newId } from '@/lib/actions/common';
import { jobsForBl } from '@/lib/cargo-invoice/jobs';
import { downloadFile, ensureBucket, safeName, uploadFile } from '@/lib/storage';
import { itemsTotal, MAX_FILE_BYTES, type ShipmeAttachment, type ShipmePayload } from './charges';

/**
 * ค่าใช้จ่ายพิเศษจาก SHIPME ในฐานข้อมูล
 * ไฟล์แนบเก็บใน Supabase Storage (bucket เดียวกับไฟล์งาน) ใต้ special-charges/<id>/ — เปิดผ่าน /sale/charge-file/[id] ที่ตรวจสิทธิ์ก่อน
 */

export const chargeFileKey = (chargeId: string, fileId: string, name: string) =>
  `special-charges/${chargeId}/${fileId}-${safeName(name)}`;

/** ดึงไฟล์แนบจาก SHIPME (url หรือ base64) — จำกัดขนาดและเวลา */
async function fetchAttachment(a: ShipmeAttachment): Promise<Buffer> {
  if (a.dataBase64) return Buffer.from(a.dataBase64, 'base64');
  const res = await fetch(a.url!, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`ดาวน์โหลด ${a.fileName} ไม่ได้ (HTTP ${res.status})`);
  const size = Number(res.headers.get('content-length') ?? 0);
  if (size > MAX_FILE_BYTES) throw new Error(`${a.fileName} ใหญ่เกิน 8 MB`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_FILE_BYTES) throw new Error(`${a.fileName} ใหญ่เกิน 8 MB`);
  return buf;
}

export async function storeChargeFile(input: {
  chargeId: string; source: 'SHIPME' | 'SALE'; bytes: Buffer; fileName: string; mimeType: string; userId: string | null; note?: string;
}) {
  const id = newId('SCF');
  const key = chargeFileKey(input.chargeId, id, input.fileName);
  await ensureBucket();
  await uploadFile(key, input.bytes, input.mimeType);
  await db.insert(specialChargeFiles).values({
    id, chargeId: input.chargeId, source: input.source, storageKey: key, fileName: input.fileName,
    mimeType: input.mimeType, sizeBytes: input.bytes.length, note: input.note ?? null, uploadedBy: input.userId,
  });
  return id;
}

/**
 * รับชุดจาก SHIPME — batchId เดิมที่ Sale ยังไม่ได้เริ่มเจรจา (NEW) = แทนชุดเดิม
 * ถ้าเริ่มเจรจาแล้ว ไม่ทับ คืน conflict ให้ SHIPME รู้ (ต้องคุยกันก่อนส่งชุดใหม่ด้วยเลขใหม่)
 */
export async function receiveFromShipme(p: ShipmePayload) {
  const [existing] = await db.select({ id: specialCharges.id, status: specialCharges.status })
    .from(specialCharges).where(eq(specialCharges.shipmeBatchId, p.batchId)).limit(1);
  if (existing && existing.status !== 'NEW') {
    return { conflict: true as const, id: existing.id, status: existing.status };
  }

  // ดาวน์โหลดไฟล์ให้ครบก่อนเขียนฐานข้อมูล — ไฟล์ไหนเสีย ทั้งชุดไม่ถูกบันทึก SHIPME ส่งใหม่ได้ทันที
  const files = await Promise.all(p.attachments.map(async (a) => ({ a, bytes: await fetchAttachment(a) })));

  const matches = await jobsForBl(p.blNo);
  const jobId = matches.length === 1 ? matches[0].id : null;
  const id = existing?.id ?? newId('SPC');
  const values = {
    blNo: p.blNo, jobId, invoiceNo: p.invoiceNo, issuedAt: p.issuedAt ? new Date(p.issuedAt) : null,
    currency: p.currency, requestedTotal: String(itemsTotal(p.items.map((i) => i.amount))), shipmeNote: p.note,
    updatedAt: new Date(),
  };
  await db.transaction(async (tx) => {
    if (existing) {
      await tx.update(specialCharges).set(values).where(eq(specialCharges.id, id));
      await tx.delete(specialChargeItems).where(eq(specialChargeItems.chargeId, id));
      await tx.delete(specialChargeFiles).where(and(eq(specialChargeFiles.chargeId, id), eq(specialChargeFiles.source, 'SHIPME')));
    } else {
      await tx.insert(specialCharges).values({ id, shipmeBatchId: p.batchId, status: 'NEW', ...values });
    }
    await tx.insert(specialChargeItems).values(p.items.map((it, i) => ({
      id: newId('SCI'), chargeId: id, lineNo: i + 1, code: it.code, description: it.description,
      quantity: String(it.quantity), requestedAmount: String(it.amount), shipmeNote: it.note,
    })));
  });
  for (const f of files) {
    await storeChargeFile({ chargeId: id, source: 'SHIPME', bytes: f.bytes, fileName: f.a.fileName, mimeType: f.a.contentType, userId: null });
  }
  await db.insert(activityLog).values({
    id: newId('LOG'), userId: 'SHIPME', action: existing ? 'SHIPME_CHARGE_UPDATED' : 'SHIPME_CHARGE_RECEIVED',
    entityType: 'SPECIAL_CHARGE', entityId: id,
    detail: JSON.stringify({ batchId: p.batchId, blNo: p.blNo, items: p.items.length, files: files.length }),
  });
  return { conflict: false as const, id, created: !existing, jobId, jobMatches: matches.length };
}

export type ChargeRow = {
  id: string; batchId: string; blNo: string; jobId: string | null; jobNo: string | null; invoiceNo: string | null;
  currency: string; requestedTotal: number; agreedTotal: number | null; status: string;
  receivedAt: Date; saleAt: Date | null; saleName: string | null; items: number; files: number;
};

export async function listCharges(statuses: string[] | null): Promise<ChargeRow[]> {
  const rows = await db.select({
    id: specialCharges.id, batchId: specialCharges.shipmeBatchId, blNo: specialCharges.blNo, jobId: specialCharges.jobId,
    jobNo: jobs.jobNo, invoiceNo: specialCharges.invoiceNo, currency: specialCharges.currency,
    requestedTotal: specialCharges.requestedTotal, agreedTotal: specialCharges.agreedTotal, status: specialCharges.status,
    receivedAt: specialCharges.receivedAt, saleAt: specialCharges.saleAt, saleName: users.displayName,
    items: sql<number>`(select count(*) from special_charge_items i where i.charge_id = ${specialCharges.id})::int`,
    files: sql<number>`(select count(*) from special_charge_files f where f.charge_id = ${specialCharges.id})::int`,
  })
    .from(specialCharges)
    .leftJoin(jobs, eq(jobs.id, specialCharges.jobId))
    .leftJoin(users, eq(users.id, specialCharges.saleBy))
    .where(statuses ? inArray(specialCharges.status, statuses) : undefined)
    .orderBy(desc(specialCharges.receivedAt))
    .limit(500);
  return rows.map((r) => ({ ...r, requestedTotal: Number(r.requestedTotal), agreedTotal: r.agreedTotal === null ? null : Number(r.agreedTotal) }));
}

export async function chargeCounts() {
  const rows = await db.select({ status: specialCharges.status, n: sql<number>`count(*)::int` })
    .from(specialCharges).groupBy(specialCharges.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])) as Record<string, number>;
}

export async function getCharge(id: string) {
  const [head] = await db.select().from(specialCharges).where(eq(specialCharges.id, id)).limit(1);
  if (!head) return null;
  const [items, files, job, events] = await Promise.all([
    db.select().from(specialChargeItems).where(eq(specialChargeItems.chargeId, id)).orderBy(asc(specialChargeItems.lineNo)),
    db.select({ f: specialChargeFiles, by: users.displayName }).from(specialChargeFiles)
      .leftJoin(users, eq(users.id, specialChargeFiles.uploadedBy))
      .where(eq(specialChargeFiles.chargeId, id)).orderBy(asc(specialChargeFiles.uploadedAt)),
    head.jobId ? db.select({ id: jobs.id, jobNo: jobs.jobNo }).from(jobs).where(eq(jobs.id, head.jobId)).limit(1) : Promise.resolve([]),
    db.select({ at: activityLog.createdAt, action: activityLog.action, detail: activityLog.detail, by: users.displayName, userId: activityLog.userId })
      .from(activityLog).leftJoin(users, eq(users.id, activityLog.userId))
      .where(and(eq(activityLog.entityType, 'SPECIAL_CHARGE'), eq(activityLog.entityId, id)))
      .orderBy(desc(activityLog.createdAt)).limit(50),
  ]);
  const [review, sale] = await Promise.all([
    head.reviewBy ? db.select({ name: users.displayName }).from(users).where(eq(users.id, head.reviewBy)).limit(1) : Promise.resolve([]),
    head.saleBy ? db.select({ name: users.displayName }).from(users).where(eq(users.id, head.saleBy)).limit(1) : Promise.resolve([]),
  ]);
  return {
    head, job: job[0] ?? null, saleName: sale[0]?.name ?? null, reviewName: review[0]?.name ?? null,
    items: items.map((i) => ({
      ...i, quantity: Number(i.quantity), requestedAmount: Number(i.requestedAmount),
      agreedAmount: i.agreedAmount === null ? null : Number(i.agreedAmount),
    })),
    files: files.map(({ f, by }) => ({ ...f, by })),
    events,
  };
}

/** อ่านไฟล์แนบ — หน้าเปิดไฟล์ตรวจสิทธิ์แล้วค่อยเรียก */
export async function readChargeFile(fileId: string) {
  const [f] = await db.select().from(specialChargeFiles).where(eq(specialChargeFiles.id, fileId)).limit(1);
  if (!f) return null;
  const { body } = await downloadFile(f.storageKey);
  return { file: f, bytes: body };
}
