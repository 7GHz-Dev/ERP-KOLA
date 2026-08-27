'use server';

import { revalidatePath } from 'next/cache';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { approvals, files, jobs } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import { buildKey, ensureBucket, uploadFile } from '@/lib/storage';
import { storeInvoicePdf } from '@/lib/eoffice-bundle';
import { logActivity, newId, recordStatus, required, runAction, text } from './common';

const MAX_BYTES = 8 * 1024 * 1024;

/** นามสกุลที่ไม่รับ เพราะเป็นไฟล์สั่งงานได้ ไม่ใช่เอกสาร */
const BLOCKED = /\.(exe|cmd|bat|com|js|mjs|vbs|ps1|sh|jar|msi)$/i;

/** ใครอัปโหลดหมวดไหนได้ — ยกกติกามาจากระบบเดิม */
const UPLOAD_ROLES: Record<string, string[]> = {
  ARRIVAL_NOTICE: ['PAINT'],
  BL: ['PAINT'],
  FINAL_INVOICE: ['PAINT'],
  FINAL_INVOICE_PDF: ['PAINT'],
  EOFFICE: ['PAINT'],
  EOFFICE_REQUEST: ['PAINT'],
  INVOICE_GOODS: ['NAMKANG'],
  SURRENDER: ['NAMKANG'],
  INVOICE_DO: ['FAH'],
  CUSTOMS_ENTRY_DOC: ['FAH'],
  OTHER: ['PAINT', 'FAH', 'NAMKANG'],
};

async function uploadJobFileImpl(formData: FormData) {
  const jobId = required(formData.get('jobId'), 'งาน', 80);
  const category = required(formData.get('category'), 'หมวดไฟล์', 40).toUpperCase();
  const allowed = UPLOAD_ROLES[category];
  if (!allowed) throw new Error(`หมวดไฟล์ไม่ถูกต้อง: ${category}`);

  const user = await requireActiveSession(allowed);

  const blob = formData.get('file');
  if (!(blob instanceof File) || blob.size === 0) throw new Error('กรุณาเลือกไฟล์');
  if (blob.size > MAX_BYTES) throw new Error('ไฟล์ต้องมีขนาดไม่เกิน 8 MB');
  if (BLOCKED.test(blob.name)) throw new Error('ไม่อนุญาตไฟล์ชนิดนี้');

  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job || job.isArchived) throw new Error('ไม่พบงานที่ต้องการอัปโหลดไฟล์');

  const [current] = await db
    .select()
    .from(files)
    .where(and(eq(files.jobId, jobId), eq(files.category, category), eq(files.isCurrent, true)))
    .limit(1);

  const changeReason = text(formData.get('changeReason'), 500);
  // เปลี่ยนไฟล์ Invoice สินค้าต้องบอกเหตุผลเสมอ เพราะกระทบยอดที่ฝ่ายอื่นใช้ไปแล้ว
  if (category === 'INVOICE_GOODS' && current && !changeReason) {
    throw new Error('การเปลี่ยนไฟล์ Invoice ต้องระบุเหตุผล');
  }

  const id = newId('FIL');
  const version = (current?.version ?? 0) + 1;
  const key = buildKey(jobId, category, id, blob.name);

  const bytes = Buffer.from(await blob.arrayBuffer());
  await ensureBucket();
  await uploadFile(key, bytes, blob.type);

  await db.insert(files).values({
    id, jobId, category, version,
    storageKey: key,
    fileName: blob.name,
    mimeType: blob.type || 'application/octet-stream',
    sizeBytes: blob.size,
    note: text(formData.get('note'), 500),
    changeReason: current ? changeReason : '',
    isCurrent: true,
    // Invoice ที่เปลี่ยนใหม่ต้องมีคนกดรับทราบก่อน แถวจึงจะหายแดง
    isAcknowledged: !(category === 'INVOICE_GOODS' && Boolean(current)),
    uploadedBy: user.id,
  });

  if (current) {
    await db.update(files)
      .set({ isCurrent: false, supersededBy: id })
      .where(eq(files.id, current.id));
  }

  if (category === 'INVOICE_GOODS' && current) {
    await db.update(jobs)
      .set({ hasInvoiceAlert: true, updatedBy: user.id, updatedAt: new Date() })
      .where(eq(jobs.id, jobId));
  }

  // Final Invoice ที่เป็น Excel แปลงเป็น PDF ให้เลย ชุด E-Office จะได้ใช้ต่อได้ทันที
  if (category === 'FINAL_INVOICE' && /\.xlsx?$/i.test(blob.name)) {
    try {
      await storeInvoicePdf(jobId, user.id, bytes);
    } catch {
      // แปลงไม่ได้ก็ไม่ควรทำให้การอัปโหลดล้มเหลว ตอนรวมชุดจะลองใหม่และแจ้งเหตุผล
    }
  }

  await logActivity(user.id, current ? 'REPLACE_FILE' : 'UPLOAD_FILE', 'FILE', id,
    { jobId, category, version });

  revalidatePath('/pending');
  revalidatePath('/fah/do');
  revalidatePath('/fah/fn');
  revalidatePath('/nam/customer');
  revalidatePath('/nam/release');
}

/** รับทราบว่า Invoice สินค้าถูกเปลี่ยนใหม่ — แถวจะหายแดง */
async function acknowledgeInvoiceImpl(formData: FormData) {
  const user = await requireActiveSession(['PAINT', 'FAH']);
  const jobId = required(formData.get('jobId'), 'งาน', 80);

  const [file] = await db
    .select()
    .from(files)
    .where(and(eq(files.jobId, jobId), eq(files.category, 'INVOICE_GOODS'), eq(files.isCurrent, true)))
    .limit(1);
  if (!file) throw new Error('ไม่พบไฟล์ Invoice');

  await db.update(files)
    .set({ isAcknowledged: true, acknowledgedBy: user.id, acknowledgedAt: new Date() })
    .where(eq(files.id, file.id));
  await db.update(jobs)
    .set({ hasInvoiceAlert: false, updatedBy: user.id, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
  await logActivity(user.id, 'ACK_INVOICE', 'FILE', file.id, { jobId });

  revalidatePath('/pending');
  revalidatePath('/nam/customer');
}

/* ----------------------------------------------------------
   ทุกคำสั่งข้างบนถูกห่อด้วย runAction ก่อนผูกกับปุ่มบนหน้าเว็บ
   ข้อผิดพลาดที่ผู้ใช้แก้เองได้จะกลับไปหน้าเดิมพร้อมข้อความ
   แทนที่จะเด้งหน้า 500 Internal Server Error ที่อ่านไม่ออก
   ---------------------------------------------------------- */

export async function uploadJobFile(formData: FormData) {
  return runAction(() => uploadJobFileImpl(formData));
}

export async function acknowledgeInvoice(formData: FormData) {
  return runAction(() => acknowledgeInvoiceImpl(formData));
}
