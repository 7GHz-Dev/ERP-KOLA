'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { bls, containers, files, jobSequences, jobs, masterRecords } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import { buildKey, ensureBucket, uploadFile } from '@/lib/storage';
import { day, logActivity, newId, number, recordStatus, required, runAction, text } from './common';

/**
 * รับงานเข้าระบบจาก Arrival Notice หรือ BL
 *
 * สร้าง Job เลขใหม่ พร้อมรายการ BL และตู้ แล้วเก็บไฟล์ต้นทางไว้เป็นหลักฐาน
 * ทั้งหมดอยู่ใน transaction เดียว ถ้าพลาดกลางทางจะไม่เหลือ Job ที่ไม่มีข้อมูลค้างไว้
 */

/**
 * เลขประจำตู้ เช่น MU2026080001
 *
 * รหัส Job Type + ปี ค.ศ. + เดือน + เลขรัน 4 หลัก เลขรันแยกกันคนละชุดต่อเดือน
 * ล็อกแถวลำดับไว้เหมือนเลขงาน เพราะเลขนี้ต้องไม่ซ้ำ — จะใช้ผูกค่าใช้จ่ายรายตู้ต่อไป
 */
async function nextContainerNos(tx: Tx, jobTypeCode: string, count: number): Promise<string[]> {
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

/** เลขงานถัดไปของปีนั้น — ล็อกแถวไว้กันสองคนกดพร้อมกันแล้วได้เลขซ้ำ */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function nextJobNo(tx: Tx): Promise<string> {
  const year = String(new Date().getFullYear());
  const prefix = 'KOLA';

  const [existing] = await tx
    .select()
    .from(jobSequences)
    .where(and(eq(jobSequences.year, year), eq(jobSequences.prefix, prefix)))
    .for('update')
    .limit(1);

  let next: number;
  if (existing) {
    next = existing.lastNumber + 1;
    await tx.update(jobSequences)
      .set({ lastNumber: next, updatedAt: new Date() })
      .where(eq(jobSequences.id, existing.id));
  } else {
    next = 1;
    await tx.insert(jobSequences).values({
      id: newId('SEQ'), year, prefix, lastNumber: next,
    });
  }
  return `${prefix}-${year}-${String(next).padStart(4, '0')}`;
}

/** หา id ของ master จากรหัส ใช้เติมค่าตั้งต้นโดยไม่ผูกกับ id ที่อาจเปลี่ยน */
async function masterIdByCode(type: string, code: string): Promise<string | null> {
  const [row] = await db
    .select({ id: masterRecords.id })
    .from(masterRecords)
    .where(and(eq(masterRecords.type, type), sql`upper(${masterRecords.code}) = ${code.toUpperCase()}`))
    .limit(1);
  return row?.id ?? null;
}

async function createJobFromIntakeImpl(formData: FormData) {
  const user = await requireActiveSession(['PAINT']);

  const sourceType = text(formData.get('sourceType'), 4) === 'BL' ? 'BL' : 'AN';
  const vessel = required(formData.get('vessel'), 'ชื่อเรือ', 120);

  // รายการ BL และตู้ ส่งมาเป็น JSON เพราะจำนวนแถวไม่แน่นอน
  let blRows: Array<{ blNo: string; shipperId: string; shipperName: string }> = [];
  let containerRows: Array<{ containerNo: string; containerType: string; sealNo: string }> = [];
  try {
    blRows = JSON.parse(text(formData.get('blRows'), 20000) || '[]');
    containerRows = JSON.parse(text(formData.get('containerRows'), 20000) || '[]');
  } catch {
    throw new Error('ข้อมูล BL หรือตู้ไม่ถูกต้อง');
  }

  blRows = blRows.filter((r) => r?.blNo?.trim());
  containerRows = containerRows.filter((r) => r?.containerNo?.trim());
  if (!blRows.length) throw new Error('กรุณาระบุ BL No. อย่างน้อย 1 รายการ');
  if (blRows.some((r) => !r.shipperId)) throw new Error('กรุณาเลือก Shipper ให้ครบทุก BL');

  const blob = formData.get('file');
  if (!(blob instanceof File) || blob.size === 0) {
    throw new Error(`กรุณาแนบไฟล์ ${sourceType === 'AN' ? 'Arrival Notice' : 'Bill of Lading'}`);
  }
  if (blob.size > 8 * 1024 * 1024) throw new Error('ไฟล์ต้องมีขนาดไม่เกิน 8 MB');

  const jobTypeId = text(formData.get('jobTypeId'), 80) || null;

  const jobId = newId('JOB');
  const fileId = newId('FIL');
  const category = sourceType === 'AN' ? 'ARRIVAL_NOTICE' : 'BL';
  const key = buildKey(jobId, category, fileId, blob.name);

  // อัปโหลดไฟล์ก่อนเปิด transaction — ถ้าอัปโหลดพลาดจะได้ไม่มีแถวค้างในฐานข้อมูล
  await ensureBucket();
  await uploadFile(key, Buffer.from(await blob.arrayBuffer()), blob.type);

  const jobNo = await db.transaction(async (tx) => {
    const generated = await nextJobNo(tx);

    await tx.insert(jobs).values({
      id: jobId,
      jobNo: generated,
      blNo: blRows[0].blNo.trim(),
      vessel,
      voyage: text(formData.get('voyage'), 80),
      eta: day(formData.get('eta')),
      etaIsOfficial: false,
      shipperId: blRows[0].shipperId,
      consigneeId: text(formData.get('consigneeId'), 80) || null,
      notifyPartyId: text(formData.get('notifyPartyId'), 80) || null,
      portId: text(formData.get('portId'), 80) || null,
      // เมืองต้นทางใช้บนจดหมายแลก D/O ซึ่งเขียนเป็นตัวพิมพ์ใหญ่ทั้งหมด
      originPort: text(formData.get('originPort'), 120).toUpperCase() || null,
      terminalId: text(formData.get('terminalId'), 80) || null,
      personId: text(formData.get('personId'), 80) || null,
      jobTypeId,
      status: sourceType === 'BL' ? 'WAITING_ARRIVAL_NOTICE_BL' : 'WAITING_ENTER_BL',
      sourceType,
      blType: text(formData.get('blType'), 40),
      product: text(formData.get('product'), 1000),
      unitAmount: String(number(formData.get('unitAmount'))),
      packageType: text(formData.get('packageType'), 40),
      grossWeight: String(number(formData.get('grossWeight'))),
      shipline: text(formData.get('shipline'), 180),
      demDays: number(formData.get('demDays')),
      detDays: number(formData.get('detDays')),
      createdBy: user.id,
      updatedBy: user.id,
    });

    await tx.insert(bls).values(blRows.map((r) => ({
      id: newId('BL'),
      jobId,
      blNo: r.blNo.trim(),
      blType: text(formData.get('blType'), 40),
      shipperId: r.shipperId,
      shipperName: r.shipperName ?? '',
    })));

    if (containerRows.length) {
      // รหัส Job Type เป็นตัวนำของเลขประจำตู้ ถ้าไม่ได้เลือกไว้ใช้ MU ตามงานส่วนใหญ่
      const [jobType] = jobTypeId
        ? await tx.select({ code: masterRecords.code }).from(masterRecords)
          .where(eq(masterRecords.id, jobTypeId)).limit(1)
        : [];
      const code = (jobType?.code || 'MU').toUpperCase();
      const runningNos = await nextContainerNos(tx, code, containerRows.length);

      await tx.insert(containers).values(containerRows.map((r, i) => ({
        id: newId('CT'),
        jobId,
        jobNo: generated,
        runningNo: runningNos[i],
        containerNo: r.containerNo.trim(),
        containerType: r.containerType ?? '',
        sealNo: r.sealNo ?? '',
      })));
    }

    await tx.insert(files).values({
      id: fileId,
      jobId,
      category,
      version: 1,
      storageKey: key,
      fileName: blob.name,
      mimeType: blob.type || 'application/pdf',
      sizeBytes: blob.size,
      isCurrent: true,
      uploadedBy: user.id,
    });

    return generated;
  });

  await recordStatus(jobId, null, sourceType === 'BL' ? 'WAITING_ARRIVAL_NOTICE_BL' : 'WAITING_ENTER_BL',
    `รับงานจาก ${sourceType}`, user.id);
  await logActivity(user.id, 'CREATE_JOB', 'JOB', jobId, { jobNo, sourceType, bls: blRows.length });

  revalidatePath('/pending');
  revalidatePath('/overview');

  // ไม่พาไปหน้าอื่น เพราะคนรับงานมักคีย์ติดกันหลายใบ
  // คืนเลขงานให้หน้าเดิมขึ้นข้อความแล้วล้างฟอร์มรอใบถัดไป
  return jobNo;
}

/** เพิ่ม Shipper ใหม่จากหน้ารับงาน โดยไม่ต้องออกไปหน้า Master Data */
async function quickAddShipperImpl(formData: FormData) {
  const user = await requireActiveSession(['PAINT']);
  const name = required(formData.get('name'), 'ชื่อ Shipper', 180);
  let code = text(formData.get('code'), 60).toUpperCase();

  const [dup] = await db
    .select({ id: masterRecords.id })
    .from(masterRecords)
    .where(and(eq(masterRecords.type, 'shippers'), sql`upper(${masterRecords.name}) = ${name.toUpperCase()}`))
    .limit(1);
  if (dup) throw new Error('ชื่อนี้มีอยู่ใน Master Data แล้ว');

  // เว้นรหัสว่างไว้ = ให้ระบบรันต่อจากเลขสูงสุดที่ใช้แล้ว ไม่ใช่นับจำนวนแถว
  if (!code) {
    const [max] = await db
      .select({ value: sql<number>`coalesce(max(nullif(regexp_replace(code, '^SHP', ''), '')::int), 0)` })
      .from(masterRecords)
      .where(and(eq(masterRecords.type, 'shippers'), sql`code ~ '^SHP[0-9]+$'`));
    code = `SHP${String((max?.value ?? 0) + 1).padStart(4, '0')}`;
  }

  const id = newId('MD');
  await db.insert(masterRecords).values({ id, type: 'shippers', code, name });
  await logActivity(user.id, 'CREATE_MASTER', 'shippers', id, { code, name });

  revalidatePath('/intake/an');
  revalidatePath('/intake/bl');
  revalidatePath('/master');
}

export async function intakeDefaults() {
  const [consigneeId, notifyId, portId, jobTypeId] = await Promise.all([
    masterIdByCode('consignees', 'CNE0001'),
    masterIdByCode('notify', 'NTP0001'),
    masterIdByCode('ports', 'THLCH'),
    masterIdByCode('jobTypes', 'MU'),
  ]);
  return { consigneeId, notifyId, portId, jobTypeId };
}

/* ----------------------------------------------------------
   ทุกคำสั่งข้างบนถูกห่อด้วย runAction ก่อนผูกกับปุ่มบนหน้าเว็บ
   ข้อผิดพลาดที่ผู้ใช้แก้เองได้จะกลับไปหน้าเดิมพร้อมข้อความ
   แทนที่จะเด้งหน้า 500 Internal Server Error ที่อ่านไม่ออก
   ---------------------------------------------------------- */

export async function createJobFromIntake(formData: FormData) {
  return runAction(() => createJobFromIntakeImpl(formData));
}

export async function quickAddShipper(formData: FormData) {
  return runAction(() => quickAddShipperImpl(formData));
}
