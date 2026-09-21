'use server';

import { revalidatePath } from 'next/cache';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { bls, files, jobs, masterRecords } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import { buildKey, ensureBucket, uploadFile } from '@/lib/storage';
import type { BlChoice } from '@/lib/match-bl';
import { logActivity, newId, required, runAction, text } from './common';

/**
 * แนบไฟล์ AN/BL เข้างานที่มีอยู่แล้ว
 *
 * คู่กับการนำเข้า Shipment Detail จากไฟล์ตาราง — งานเข้าระบบไปแล้วแต่ยังไม่มีไฟล์
 * ตรงนี้เอาไฟล์มาใส่ทีหลังทีละหลายใบ โดยจับคู่จากเลข BL หรือ Waybill ที่อ่านได้ในไฟล์
 *
 * ต่างจากหน้ารับงานตรงที่ไม่สร้างงานใหม่เด็ดขาด เลือกได้เฉพาะ BL ที่มีในระบบ
 * ไฟล์ที่จับคู่ไม่ได้ต้องให้คนเลือกงานเอง ไม่งั้นจะได้งานซ้ำกับที่นำเข้ามาแล้ว
 */

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * BL ทุกใบที่ยังรับไฟล์ได้ ส่งให้เบราว์เซอร์ไว้จับคู่และให้เลือกเอง
 *
 * จับคู่ฝั่งเบราว์เซอร์เพราะการอ่าน PDF ทำที่นั่นอยู่แล้ว ไฟล์จึงยังไม่ถูกส่งขึ้นมา
 * จนกว่าผู้ใช้จะกดบันทึก เหมือนหน้ารับงาน — อัปไฟล์ที่จับคู่ผิดแล้วค่อยลบทีหลัง
 * แย่กว่าให้ดูก่อนกด
 *
 * งานที่เก็บเข้ากรุแล้วไม่เอามาด้วย เพราะไม่ควรมีไฟล์ใหม่เข้าไปอีก
 */
export async function attachableBls(): Promise<BlChoice[]> {
  await requireActiveSession(['PAINT']);

  const rows = await db
    .select({
      id: bls.id,
      jobId: bls.jobId,
      jobNo: jobs.jobNo,
      blNo: bls.blNo,
      vessel: jobs.vessel,
      eta: jobs.eta,
      shipperName: bls.shipperName,
      masterName: masterRecords.name,
    })
    .from(bls)
    .innerJoin(jobs, eq(jobs.id, bls.jobId))
    .leftJoin(masterRecords, eq(masterRecords.id, bls.shipperId))
    .where(eq(jobs.isArchived, false))
    .orderBy(desc(jobs.createdAt));

  /*
   * งานที่มีไฟล์ AN หรือ BL อยู่แล้ว ดึงรอบเดียวแล้วเทียบในหน่วยความจำ
   * ใช้บอกผู้ใช้ว่ากำลังจะทับของเดิม ไม่ได้ห้าม เพราะเปลี่ยนไฟล์เป็นเรื่องปกติ
   */
  const withFile = await db
    .select({ jobId: files.jobId })
    .from(files)
    .where(and(eq(files.isCurrent, true), inArray(files.category, ['ARRIVAL_NOTICE', 'BL'])));
  const has = new Set(withFile.map((f) => f.jobId));

  return rows.map((r) => ({
    id: r.id,
    jobId: r.jobId,
    jobNo: r.jobNo,
    blNo: r.blNo ?? '',
    vessel: r.vessel,
    eta: r.eta,
    shipperName: r.masterName ?? r.shipperName,
    hasFile: has.has(r.jobId),
  }));
}

/**
 * เก็บไฟล์หนึ่งใบเข้างานที่เลือกไว้
 *
 * ทำทีละใบ ไม่รวมทั้งชุดเป็นคำขอเดียว เพราะไฟล์ 20 ใบรวมกันเกินขนาดที่ส่งได้ในรอบเดียว
 * และถ้าใบไหนพลาด ใบที่เหลือยังบันทึกต่อได้ ไม่ล้มทั้งชุด — เหมือนหน้ารับงานหลายใบ
 *
 * เวอร์ชันไฟล์เดินตามของเดิมเหมือน uploadJobFile() ไฟล์เก่าจึงไม่หาย
 * แค่ถูกปิดสถานะ "ปัจจุบัน" ไว้ ย้อนดูได้ที่หน้าไฟล์ของงาน
 */
async function attachArrivalFileImpl(formData: FormData) {
  const user = await requireActiveSession(['PAINT']);
  const blId = required(formData.get('blId'), 'BL ที่จะแนบไฟล์', 80);
  const sourceType = text(formData.get('sourceType'), 4) === 'BL' ? 'BL' : 'AN';
  const category = sourceType === 'AN' ? 'ARRIVAL_NOTICE' : 'BL';

  const blob = formData.get('file');
  if (!(blob instanceof File) || blob.size === 0) throw new Error('กรุณาแนบไฟล์');
  if (blob.size > MAX_BYTES) throw new Error('ไฟล์ต้องมีขนาดไม่เกิน 8 MB');
  if (!/\.pdf$/i.test(blob.name) && blob.type !== 'application/pdf') {
    throw new Error('รองรับเฉพาะไฟล์ PDF');
  }

  const [target] = await db
    .select({ jobId: bls.jobId, jobNo: jobs.jobNo, blNo: bls.blNo, isArchived: jobs.isArchived })
    .from(bls)
    .innerJoin(jobs, eq(jobs.id, bls.jobId))
    .where(eq(bls.id, blId))
    .limit(1);
  if (!target || target.isArchived) throw new Error('ไม่พบ BL ที่จะแนบไฟล์');

  const [current] = await db
    .select({ id: files.id, version: files.version })
    .from(files)
    .where(and(eq(files.jobId, target.jobId), eq(files.category, category), eq(files.isCurrent, true)))
    .limit(1);

  const fileId = newId('FIL');
  const key = buildKey(target.jobId, category, fileId, blob.name);
  // อัปโหลดก่อนเขียนฐานข้อมูล ถ้าอัปพลาดจะได้ไม่มีแถวชี้ไปไฟล์ที่ไม่มีอยู่จริง
  await ensureBucket();
  await uploadFile(key, Buffer.from(await blob.arrayBuffer()), blob.type);

  await db.transaction(async (tx) => {
    await tx.insert(files).values({
      id: fileId,
      jobId: target.jobId,
      category,
      version: (current?.version ?? 0) + 1,
      storageKey: key,
      fileName: blob.name,
      mimeType: blob.type || 'application/pdf',
      sizeBytes: blob.size,
      isCurrent: true,
      uploadedBy: user.id,
    });
    if (current) {
      await tx.update(files)
        .set({ isCurrent: false, supersededBy: fileId })
        .where(eq(files.id, current.id));
    }
  });

  await logActivity(user.id, current ? 'REPLACE_FILE' : 'UPLOAD_FILE', 'FILE', fileId, {
    jobId: target.jobId, category, via: 'attach-arrival',
  });

  revalidatePath('/pending');
  revalidatePath('/intake/attach');

  return { jobNo: target.jobNo, replaced: Boolean(current) };
}

export async function attachArrivalFile(formData: FormData) {
  return runAction(() => attachArrivalFileImpl(formData));
}
