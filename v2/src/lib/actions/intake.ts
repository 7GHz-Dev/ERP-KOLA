'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { bls, containers, files, jobSequences, jobs, masterRecords } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import { buildKey, ensureBucket, uploadFile } from '@/lib/storage';
import { nextContainerNos } from '@/lib/container-no';
import { day, logActivity, newId, number, recordStatus, required, runAction, text } from './common';
import {
  duplicateBlMessage, duplicateContainers, isBlDuplicateExempt, normalizeBlNo,
  type DuplicateBl,
} from '@/lib/intake-checks';

/**
 * รับงานเข้าระบบจาก Arrival Notice หรือ BL
 *
 * สร้าง Job เลขใหม่ พร้อมรายการ BL และตู้ แล้วเก็บไฟล์ต้นทางไว้เป็นหลักฐาน
 * ทั้งหมดอยู่ใน transaction เดียว ถ้าพลาดกลางทางจะไม่เหลือ Job ที่ไม่มีข้อมูลค้างไว้
 */

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

/*
 * รถยนต์เก่าที่ notify ไม่ใช่ KOLA ต้องเป็นงานประเภท MUO
 *
 * ฟอร์มทีละใบสลับให้ตั้งแต่บนหน้าจอแล้ว แต่ตรงนี้ตรวจซ้ำฝั่งเซิร์ฟเวอร์
 * เพราะโหมดรับหลายใบพร้อมกันส่งค่าตั้งต้นมาตรง ๆ ไม่ได้ผ่านหน้าจอนั้น
 * และฟอร์มถูกยิงตรงได้ กติกาที่มีผลกับตัวเลขค่าใช้จ่ายจึงไม่ควรอยู่แค่ฝั่งเบราว์เซอร์
 */
async function applyUsedCarRule(
  jobTypeId: string | null, notifyPartyId: string | null, product: string,
): Promise<string | null> {
  if (!jobTypeId || !notifyPartyId) return jobTypeId;
  if (!/รถยนต์|USED\s*CAR|USED\s*VEHICLE/i.test(product)) return jobTypeId;

  const [current] = await db.select({ code: masterRecords.code })
    .from(masterRecords).where(eq(masterRecords.id, jobTypeId)).limit(1);
  const code = (current?.code ?? '').toUpperCase();
  // ผู้ใช้เลือกประเภทอื่นไว้เอง (เช่น TRANSIT) แปลว่าตั้งใจ ไม่ไปทับ
  if (code !== 'MU' && code !== 'MUO') return jobTypeId;

  const [notify] = await db.select({ name: masterRecords.name })
    .from(masterRecords).where(eq(masterRecords.id, notifyPartyId)).limit(1);
  const want = /KOLA\s*SHIPPING/i.test(notify?.name ?? '') ? 'MU' : 'MUO';
  if (want === code) return jobTypeId;

  return (await masterIdByCode('jobTypes', want)) ?? jobTypeId;
}

/**
 * เลข BL ที่มีอยู่แล้วในงานที่ยังไม่ถูกเก็บเข้าคลัง
 * ดูทั้งตาราง bls และ jobs.bl_no เพราะ FAH แก้เลข BL ที่หน้า Invoice DO ได้ทั้งสองที่
 */
async function existingBls(blNos: string[]): Promise<DuplicateBl[]> {
  const wanted = [...new Set(blNos.map(normalizeBlNo).filter(Boolean))];
  if (!wanted.length) return [];
  const norm = (column: typeof bls.blNo | typeof jobs.blNo) =>
    sql`upper(regexp_replace(coalesce(${column}, ''), '[[:space:]]', '', 'g'))`;

  const [fromBls, fromJobs] = await Promise.all([
    db.select({ blNo: bls.blNo, jobNo: jobs.jobNo })
      .from(bls).innerJoin(jobs, eq(jobs.id, bls.jobId))
      .where(and(eq(jobs.isArchived, false), inArray(norm(bls.blNo), wanted))),
    db.select({ blNo: jobs.blNo, jobNo: jobs.jobNo })
      .from(jobs)
      .where(and(eq(jobs.isArchived, false), inArray(norm(jobs.blNo), wanted))),
  ]);

  const seen = new Set<string>();
  const out: DuplicateBl[] = [];
  for (const r of [...fromBls, ...fromJobs]) {
    const k = `${normalizeBlNo(r.blNo ?? '')}|${r.jobNo}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ blNo: r.blNo ?? '', jobNo: r.jobNo });
  }
  return out;
}

/**
 * หน้ารับงานถามก่อนบันทึกว่าเลข BL ที่กรอกซ้ำกับงานไหนบ้าง จะได้ขึ้นเตือนให้ยืนยัน
 * สายเรือที่ BL ซ้ำได้ตามปกติ (SEALS) ไม่ต้องเตือน
 */
export async function findDuplicateBls(blNos: string[], shipline: string): Promise<DuplicateBl[]> {
  await requireActiveSession(['PAINT']);
  if (isBlDuplicateExempt(shipline)) return [];
  return existingBls(Array.isArray(blNos) ? blNos.map(String).slice(0, 50) : []);
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

  // ตู้เดียวกันอยู่สองแถวในงานเดียวไม่ได้ — ตรวจฝั่งเซิร์ฟเวอร์ด้วยเพราะฟอร์มถูกยิงตรงได้
  const dupContainers = duplicateContainers(containerRows.map((r) => r.containerNo));
  if (dupContainers.length) throw new Error(`เลขตู้ซ้ำกัน: ${dupContainers.join(', ')}`);

  const shipline = text(formData.get('shipline'), 180);
  const dupInForm = new Set(blRows.map((r) => normalizeBlNo(r.blNo))).size !== blRows.length;
  if (dupInForm && !isBlDuplicateExempt(shipline)) throw new Error('กรอกเลข BL ซ้ำกันในงานเดียวกัน');

  /*
   * เลข BL ซ้ำกับงานที่มีอยู่ — หน้าจอเตือนและให้ยืนยันก่อนแล้ว จึงส่ง allowDuplicateBl มา
   * ไม่ได้ยืนยัน (เช่นฟอร์มเก่าที่เปิดค้างไว้) ให้หยุดพร้อมบอกว่าซ้ำกับงานไหน
   */
  if (!isBlDuplicateExempt(shipline) && text(formData.get('allowDuplicateBl'), 4) !== '1') {
    const found = await existingBls(blRows.map((r) => r.blNo));
    if (found.length) {
      throw new Error(`เลข BL ซ้ำกับงานที่มีอยู่: ${duplicateBlMessage(found)} — กดบันทึกอีกครั้งแล้วยืนยันถ้าตั้งใจรับซ้ำ`);
    }
  }

  const blob = formData.get('file');
  if (!(blob instanceof File) || blob.size === 0) {
    throw new Error(`กรุณาแนบไฟล์ ${sourceType === 'AN' ? 'Arrival Notice' : 'Bill of Lading'}`);
  }
  if (blob.size > 8 * 1024 * 1024) throw new Error('ไฟล์ต้องมีขนาดไม่เกิน 8 MB');

  const notifyPartyId = text(formData.get('notifyPartyId'), 80) || null;
  const product = text(formData.get('product'), 1000);
  const jobTypeId = await applyUsedCarRule(
    text(formData.get('jobTypeId'), 80) || null, notifyPartyId, product,
  );

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
      notifyPartyId,
      portId: text(formData.get('portId'), 80) || null,
      // เมืองต้นทางใช้บนจดหมายแลก D/O ซึ่งเขียนเป็นตัวพิมพ์ใหญ่ทั้งหมด
      originPort: text(formData.get('originPort'), 120).toUpperCase() || null,
      terminalId: text(formData.get('terminalId'), 80) || null,
      personId: text(formData.get('personId'), 80) || null,
      jobTypeId,
      status: sourceType === 'BL' ? 'WAITING_ARRIVAL_NOTICE_BL' : 'WAITING_ENTER_BL',
      sourceType,
      blType: text(formData.get('blType'), 40),
      product,
      unitAmount: String(number(formData.get('unitAmount'))),
      packageType: text(formData.get('packageType'), 40),
      grossWeight: String(number(formData.get('grossWeight'))),
      shipline,
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

/**
 * หัวข้อที่ PAINT เพิ่มเองได้จากหน้ารับงานและแผงแก้ BL โดยไม่ต้องเป็น ADMIN
 * สองหัวข้อนี้เจอรายชื่อใหม่บ่อยตอนคีย์ใบแรกของลูกค้าใหม่
 */
const QUICK_ADD: Record<string, { label: string; prefix: string }> = {
  shippers: { label: 'Shipper', prefix: 'SHP' },
  consignees: { label: 'Consignee', prefix: 'CNE' },
};

async function quickAddMasterImpl(formData: FormData) {
  const user = await requireActiveSession(['PAINT']);
  const type = text(formData.get('type'), 40);
  const spec = QUICK_ADD[type];
  if (!spec) throw new Error('หัวข้อนี้เพิ่มจากหน้านี้ไม่ได้');
  const name = required(formData.get('name'), `ชื่อ ${spec.label}`, 180);
  let code = text(formData.get('code'), 60).toUpperCase();

  const [dup] = await db
    .select({ id: masterRecords.id })
    .from(masterRecords)
    .where(and(eq(masterRecords.type, type), sql`upper(${masterRecords.name}) = ${name.toUpperCase()}`))
    .limit(1);
  if (dup) throw new Error('ชื่อนี้มีอยู่ใน Master Data แล้ว');

  // เว้นรหัสว่างไว้ = ให้ระบบรันต่อจากเลขสูงสุดที่ใช้แล้ว ไม่ใช่นับจำนวนแถว
  if (!code) {
    const [max] = await db
      .select({
        value: sql<number>`coalesce(max(nullif(regexp_replace(code, ${`^${spec.prefix}`}, ''), '')::int), 0)`,
      })
      .from(masterRecords)
      .where(and(eq(masterRecords.type, type), sql`code ~ ${`^${spec.prefix}[0-9]+$`}`));
    code = `${spec.prefix}${String(Number(max?.value ?? 0) + 1).padStart(4, '0')}`;
  } else {
    const [taken] = await db
      .select({ id: masterRecords.id })
      .from(masterRecords)
      .where(and(eq(masterRecords.type, type), eq(masterRecords.code, code)))
      .limit(1);
    if (taken) throw new Error(`รหัส ${code} มีอยู่แล้ว เว้นว่างให้ระบบตั้งให้ได้`);
  }

  const id = newId('MD');
  await db.insert(masterRecords).values({ id, type, code, name });
  await logActivity(user.id, 'CREATE_MASTER', type, id, { code, name });

  revalidatePath('/intake/an');
  revalidatePath('/intake/bl');
  revalidatePath('/master');

  // คืนค่าให้หน้ารับงานเลือกรายการที่เพิ่งเพิ่มในแถวที่กำลังกรอกได้ทันที
  return { id, code, name };
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

export async function quickAddMaster(formData: FormData) {
  return runAction(() => quickAddMasterImpl(formData));
}
