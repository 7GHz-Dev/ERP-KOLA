'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { jobs, specialChargeFiles, specialChargeItems, specialCharges } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import { logActivity, required, runAction, text } from './common';
import { validateLines, baht } from '@/lib/sale/pricing';
import { savePriceSet } from '@/lib/sale/price-store';
import { CHARGE_STATUS, guessType, itemsTotal, MAX_FILE_BYTES, SALE_EDITABLE, type ChargeStatus } from '@/lib/sale/charges';
import { storeChargeFile } from '@/lib/sale/charge-store';

/** งานของ Sale — SALE SUPERVISOR ทำได้ทุกอย่างของ SALE OFFICER */
const SALE_ROLES = ['SALE', 'SALE_SUPERVISOR'];

/**
 * บันทึกราคาเก็บลูกค้าของงาน
 * mode=confirm = ยืนยันราคา (ปลดด่านยิงใบขน) · mode=draft = บันทึกไว้ก่อน (ยังยิงใบขนไม่ได้)
 */
async function savePriceImpl(formData: FormData) {
  const user = await requireActiveSession(SALE_ROLES);
  const jobId = required(formData.get('jobId'), 'งาน', 80);
  const confirm = text(formData.get('mode'), 10) === 'confirm';
  let raw: unknown;
  try { raw = JSON.parse(text(formData.get('lines'), 50_000) || '[]'); } catch { raw = null; }
  const { lines, total, error } = validateLines(raw);
  if (error) throw new Error(error);
  if (confirm && !lines.length) throw new Error('ยืนยันราคาต้องมีอย่างน้อย 1 รายการ');

  const [job] = await db.select({ jobNo: jobs.jobNo, isArchived: jobs.isArchived }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job || job.isArchived) throw new Error('ไม่พบงาน');

  await savePriceSet({ jobId, lines, total, note: text(formData.get('note'), 1000), confirm, userId: user.id });
  await logActivity(user.id, confirm ? 'CONFIRM_SALE_PRICE' : 'SAVE_SALE_PRICE', 'JOB', jobId, { total, lines: lines.length });
  revalidatePath('/sale/pricing');
  revalidatePath('/pending');
  revalidatePath('/fah/draft');
  redirect(`/sale/pricing?ok=${encodeURIComponent(confirm
    ? `ยืนยันราคางาน ${job.jobNo} แล้ว ${baht(total)} บาท — ยิงใบขนได้`
    : `บันทึกร่างราคางาน ${job.jobNo} แล้ว (ยังไม่ยืนยัน)`)}`);
}

export async function savePrice(formData: FormData) { return runAction(() => savePriceImpl(formData)); }

/* ---------------- ค่าใช้จ่ายพิเศษจาก SHIPME ---------------- */

async function chargeHead(chargeId: string) {
  const [c] = await db.select().from(specialCharges).where(eq(specialCharges.id, chargeId)).limit(1);
  if (!c) throw new Error('ไม่พบรายการค่าใช้จ่ายพิเศษ');
  return c;
}

const back = (chargeId: string, msg: string) => redirect(`/sale/charges/${chargeId}?ok=${encodeURIComponent(msg)}`);

/** Sale บันทึกผลการเจรจา — ยอดที่ตกลงต่อรายการ + หมายเหตุ (ยังแก้ได้จนกว่าจะส่งให้ Supervisor) */
async function saveNegotiationImpl(formData: FormData) {
  const user = await requireActiveSession(SALE_ROLES);
  const chargeId = required(formData.get('chargeId'), 'รายการ', 80);
  const c = await chargeHead(chargeId);
  if (!SALE_EDITABLE.includes(c.status as ChargeStatus)) throw new Error(`แก้ไม่ได้ — สถานะ ${CHARGE_STATUS[c.status as ChargeStatus] ?? c.status}`);

  let raw: unknown;
  try { raw = JSON.parse(text(formData.get('items'), 50_000) || '[]'); } catch { raw = null; }
  if (!Array.isArray(raw)) throw new Error('รูปแบบรายการไม่ถูกต้อง');
  const items = await db.select({ id: specialChargeItems.id }).from(specialChargeItems).where(eq(specialChargeItems.chargeId, chargeId));
  const known = new Set(items.map((i) => i.id));
  const agreed: number[] = [];
  await db.transaction(async (tx) => {
    for (const r of raw as Array<Record<string, unknown>>) {
      const id = String(r.id ?? '');
      if (!known.has(id)) continue;
      const s = String(r.agreedAmount ?? '').replace(/,/g, '').trim();
      const amount = s === '' ? null : Number(s);
      if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw new Error('ยอดที่ตกลงต้องเป็นตัวเลขไม่ติดลบ');
      if (amount !== null) agreed.push(amount);
      await tx.update(specialChargeItems)
        .set({ agreedAmount: amount === null ? null : String(amount), saleNote: String(r.saleNote ?? '').trim().slice(0, 500) || null })
        .where(eq(specialChargeItems.id, id));
    }
    await tx.update(specialCharges).set({
      status: 'NEGOTIATING', saleNote: text(formData.get('saleNote'), 2000) || null,
      agreedTotal: agreed.length ? String(itemsTotal(agreed)) : null,
      saleBy: user.id, saleAt: new Date(), updatedAt: new Date(),
    }).where(eq(specialCharges.id, chargeId));
  });
  await logActivity(user.id, 'SALE_NEGOTIATE', 'SPECIAL_CHARGE', chargeId, { agreedTotal: itemsTotal(agreed) });
  revalidatePath('/sale/charges');
  back(chargeId, 'บันทึกผลการเจรจาแล้ว');
}

/** แนบหลักฐานการเจรจา (รูปแชท · อีเมล · ใบเสนอราคา) — รูปหรือ PDF ไม่เกิน 8 MB */
async function uploadEvidenceImpl(formData: FormData) {
  const user = await requireActiveSession(SALE_ROLES);
  const chargeId = required(formData.get('chargeId'), 'รายการ', 80);
  const c = await chargeHead(chargeId);
  if (!SALE_EDITABLE.includes(c.status as ChargeStatus)) throw new Error('ส่งตรวจแล้ว แนบหลักฐานเพิ่มไม่ได้');
  const blob = formData.get('file');
  if (!(blob instanceof File) || blob.size === 0) throw new Error('กรุณาเลือกไฟล์');
  if (blob.size > MAX_FILE_BYTES) throw new Error('ไฟล์ต้องไม่เกิน 8 MB');
  const type = blob.type || guessType(blob.name);
  if (!/^(image\/|application\/pdf$)/i.test(type)) throw new Error('แนบได้เฉพาะรูปหรือ PDF');
  await storeChargeFile({
    chargeId, source: 'SALE', bytes: Buffer.from(await blob.arrayBuffer()), fileName: blob.name, mimeType: type,
    userId: user.id, note: text(formData.get('note'), 300) || undefined,
  });
  await logActivity(user.id, 'SALE_EVIDENCE', 'SPECIAL_CHARGE', chargeId, { fileName: blob.name });
  back(chargeId, `แนบหลักฐาน ${blob.name} แล้ว`);
}

/** ส่งให้ SALE SUPERVISOR ตรวจ — ต้องมียอดที่ตกลงครบทุกรายการ และหลักฐานอย่างน้อย 1 ไฟล์ */
async function submitChargeImpl(formData: FormData) {
  const user = await requireActiveSession(SALE_ROLES);
  const chargeId = required(formData.get('chargeId'), 'รายการ', 80);
  const c = await chargeHead(chargeId);
  if (!SALE_EDITABLE.includes(c.status as ChargeStatus)) throw new Error('ส่งตรวจไปแล้ว');
  const items = await db.select({ agreed: specialChargeItems.agreedAmount }).from(specialChargeItems).where(eq(specialChargeItems.chargeId, chargeId));
  if (items.some((i) => i.agreed === null)) throw new Error('ใส่ยอดที่ตกลงให้ครบทุกรายการแล้วกดบันทึกก่อนส่งตรวจ');
  const [evidence] = await db.select({ id: specialChargeFiles.id }).from(specialChargeFiles)
    .where(and(eq(specialChargeFiles.chargeId, chargeId), eq(specialChargeFiles.source, 'SALE'))).limit(1);
  if (!evidence) throw new Error('ต้องแนบหลักฐานการเจรจาอย่างน้อย 1 ไฟล์ก่อนส่งตรวจ');
  await db.update(specialCharges).set({ status: 'SUBMITTED', updatedAt: new Date() }).where(eq(specialCharges.id, chargeId));
  await logActivity(user.id, 'SALE_SUBMIT', 'SPECIAL_CHARGE', chargeId, {});
  revalidatePath('/sale/charges');
  back(chargeId, 'ส่งให้ Supervisor ตรวจแล้ว');
}

/** SALE SUPERVISOR ตัดสิน — อนุมัติ หรือส่งกลับให้ Sale แก้ (ต้องบอกเหตุผล) */
async function reviewChargeImpl(formData: FormData) {
  const user = await requireActiveSession(['SALE_SUPERVISOR']);
  const chargeId = required(formData.get('chargeId'), 'รายการ', 80);
  const approve = text(formData.get('decision'), 10) === 'APPROVED';
  const note = text(formData.get('reviewNote'), 2000);
  if (!approve && !note) throw new Error('ส่งกลับต้องระบุเหตุผล');
  const c = await chargeHead(chargeId);
  if (c.status !== 'SUBMITTED') throw new Error('รายการนี้ไม่ได้รอตรวจ');
  await db.update(specialCharges).set({
    status: approve ? 'APPROVED' : 'RETURNED', reviewNote: note || null, reviewBy: user.id, reviewAt: new Date(), updatedAt: new Date(),
  }).where(eq(specialCharges.id, chargeId));
  await logActivity(user.id, approve ? 'SUPERVISOR_APPROVE' : 'SUPERVISOR_RETURN', 'SPECIAL_CHARGE', chargeId, { note });
  revalidatePath('/sale/charges');
  back(chargeId, approve ? 'อนุมัติแล้ว' : 'ส่งกลับให้ Sale แก้แล้ว');
}

export async function saveNegotiation(formData: FormData) { return runAction(() => saveNegotiationImpl(formData)); }
export async function uploadEvidence(formData: FormData) { return runAction(() => uploadEvidenceImpl(formData)); }
export async function submitCharge(formData: FormData) { return runAction(() => submitChargeImpl(formData)); }
export async function reviewCharge(formData: FormData) { return runAction(() => reviewChargeImpl(formData)); }
