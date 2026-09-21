'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { bls, containers, jobSequences, jobs, masterRecords } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import { decodeCsv, readSheet, toDrafts, type ShipmentDraft } from '@/lib/shipment-import';
import { logActivity, newId, recordStatus, runAction } from './common';

/**
 * นำเข้า Shipment Detail จากไฟล์ตารางงาน
 *
 * ทางเลือกแทนการอัปไฟล์ AN/BL ทีละใบ สำหรับงานที่คีย์ไว้ในตาราง Excel แล้ว
 * ไฟล์ AN/BL ตามมาทีหลังได้ที่หน้า "แนบไฟล์ AN/BL เข้างาน"
 *
 * ทำสองรอบเสมอ — ตรวจก่อน แล้วค่อยเขียน
 * รอบตรวจบอกได้ว่าแถวไหนจะเข้าเป็นงานอะไร ชื่อไหนไม่มีใน Master และใบไหนซ้ำกับของเดิม
 * ผู้ใช้จึงเห็นผลทั้งแผ่นก่อนตัดสินใจ แทนที่จะเขียนไปครึ่งแผ่นแล้วค่อยรู้ว่าไฟล์ผิด
 */

const MAX_BYTES = 4 * 1024 * 1024;
/** กันไฟล์ที่ใหญ่เกินกว่าจะเขียนจบในคำขอเดียว — แผ่นจริงอยู่หลักร้อยแถว */
const MAX_ROWS = 1000;

/** ช่องที่เก็บ id ของ Master Data → ชนิดที่ต้องไปค้น */
const MASTER_OF: Record<keyof ShipmentDraft['names'], string> = {
  shipper: 'shippers',
  consignee: 'consignees',
  notify: 'notify',
  person: 'people',
  terminal: 'terminals',
  jobType: 'jobTypes',
};

/** ผลตรวจรายแถว ใช้แสดงในตารางก่อนยืนยัน และใช้ซ้ำตอนเขียนจริง */
export type PreviewRow = {
  lineNo: number;
  blNo: string;
  vessel: string;
  eta: string | null;
  containers: number;
  /** ชื่อที่จับกับ Master ได้แล้ว — ช่องที่จับไม่ได้จะอยู่ใน warnings */
  resolved: Record<string, string>;
  warnings: string[];
  /** ซ้ำกับงานที่มีอยู่แล้ว — บอกเลขงานเดิมไว้ให้ตรวจ */
  duplicateOf: string | null;
};

/**
 * ผลตรวจที่ยังพก id ของ Master ไว้ใช้เขียนต่อ
 *
 * ไม่ส่ง id ออกไปหน้าเว็บ เพราะหน้าเว็บไม่ได้ใช้ และตอนเขียนจริงก็ตรวจใหม่อยู่แล้ว
 * ส่งออกไปมีแต่จะชวนให้เอากลับมาใช้เขียนโดยไม่ตรวจซ้ำ
 */
type CheckedRow = PreviewRow & { ids: Record<string, string | null> };

export type PreviewResult = {
  rows: PreviewRow[];
  /** บรรทัดว่างหรือบรรทัดรวมยอดที่ข้ามไป */
  skipped: number;
  hasHeader: boolean;
  fileName: string;
};

/* ---------------- จับชื่อกับ Master Data ---------------- */

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9ก-๙]/g, '');

/**
 * ชื่อย่อในไฟล์ที่ไม่ตรงกับชื่อใน Master
 *
 * ไฟล์เขียน "MSFZ" กับ "KOLA" ไม่ใช่ชื่อบริษัทเต็ม ซึ่งเป็นคู่ตรงข้ามของ shortName()
 * ใน job-template.ts ที่ย่อชื่อตอน export ออกไป
 */
const ALIAS: Record<string, RegExp> = {
  MSFZ: /MAESOT\s*FREEZONE/i,
  KOLA: /KOLA\s*SHIPPING/i,
  'MSFZ - รถยนต์เก่า': /MSFZ\s*-\s*USED\s*CAR/i,
};

type MasterRow = { id: string; type: string; code: string | null; name: string };

/**
 * หา id จากชื่อในไฟล์ — ไม่เจอคืน null ให้ไปขึ้นเป็นคำเตือน
 *
 * ไล่จากชื่อย่อที่รู้จัก ไปรหัส ไปชื่อเต็ม แล้วค่อยแบบขึ้นต้นตรงกัน
 * ชั้นสุดท้ายจำเป็นเพราะชื่อในไฟล์มักถูกตัดท้ายจากคอลัมน์ที่แคบ เช่น "SALIM AND"
 */
function lookup(pool: MasterRow[], type: string, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  const list = pool.filter((m) => m.type === type);

  const alias = ALIAS[v];
  if (alias) {
    const hit = list.find((m) => alias.test(m.name));
    if (hit) return hit.id;
  }

  const t = norm(v);
  return (
    list.find((m) => norm(m.code ?? '') === t)?.id
    ?? list.find((m) => norm(m.name) === t)?.id
    ?? list.find((m) => norm(m.name).startsWith(t) && t.length >= 4)?.id
    ?? null
  );
}

/* ---------------- อ่านไฟล์ + ตรวจ ---------------- */

async function parseUpload(formData: FormData) {
  const blob = formData.get('file');
  if (!(blob instanceof File) || blob.size === 0) throw new Error('กรุณาเลือกไฟล์ CSV');
  if (blob.size > MAX_BYTES) throw new Error('ไฟล์ต้องมีขนาดไม่เกิน 4 MB');
  if (!/\.csv$/i.test(blob.name)) throw new Error('รองรับเฉพาะไฟล์ .csv — ถ้าเป็น Excel ให้บันทึกเป็น CSV ก่อน');

  const content = decodeCsv(new Uint8Array(await blob.arrayBuffer()));
  const { rows, hasHeader } = readSheet(content);
  if (!rows.length) throw new Error('ไฟล์ไม่มีข้อมูล');
  if (rows.length > MAX_ROWS) {
    throw new Error(`ไฟล์มี ${rows.length} แถว เกิน ${MAX_ROWS} แถวที่รับได้ — แบ่งไฟล์แล้วนำเข้าทีละส่วน`);
  }

  const { drafts, skipped } = toDrafts(rows);
  if (!drafts.length) throw new Error('ไม่พบแถวที่มีเลข BL หรือชื่อเรือ — ตรวจว่าเลือกไฟล์ถูกแผ่นหรือยัง');
  return { drafts, skipped, hasHeader, fileName: blob.name };
}

/**
 * ตรวจทุกแถวของไฟล์ — จับชื่อกับ Master และหางานที่ซ้ำ
 *
 * แยกจากการเขียนจริงเพื่อให้เรียกซ้ำได้โดยไม่มีผลข้างเคียง
 * ตอนกดยืนยันจะอ่านไฟล์ใหม่แล้วตรวจอีกรอบ ไม่ได้เชื่อผลที่ส่งกลับมาจากเบราว์เซอร์
 */
async function checkDrafts(drafts: ShipmentDraft[]) {
  const pool = await db
    .select({ id: masterRecords.id, type: masterRecords.type, code: masterRecords.code, name: masterRecords.name })
    .from(masterRecords)
    .where(eq(masterRecords.isActive, true)) as MasterRow[];

  /*
   * เลข BL ที่มีอยู่แล้วทั้งระบบ ดึงรอบเดียวแล้วเทียบในหน่วยความจำ
   * ถามทีละแถวจะยิง query เท่าจำนวนแถว ซึ่งช้ากว่ามากเมื่อไฟล์มีหลายร้อยแถว
   */
  const existing = await db
    .select({ blNo: bls.blNo, jobNo: jobs.jobNo })
    .from(bls)
    .innerJoin(jobs, eq(jobs.id, bls.jobId))
    .where(eq(jobs.isArchived, false));
  const byBl = new Map<string, string>();
  for (const e of existing) {
    const k = norm(e.blNo ?? '');
    if (k && !byBl.has(k)) byBl.set(k, e.jobNo);
  }

  const seen = new Map<string, number>();
  const rows: CheckedRow[] = drafts.map((d) => {
    const warnings: string[] = [];
    const resolved: Record<string, string> = {};
    const ids: Record<string, string | null> = {};

    for (const [field, type] of Object.entries(MASTER_OF)) {
      const raw = d.names[field as keyof ShipmentDraft['names']];
      if (!raw) { ids[field] = null; continue; }
      const found = lookup(pool, type, raw);
      ids[field] = found;
      if (found) resolved[field] = pool.find((m) => m.id === found)!.name;
      else warnings.push(`ไม่พบ "${raw}" ใน Master Data (${type}) — เว้นว่างไว้`);
    }

    if (!d.blNo) warnings.push('ไม่มีเลข BL');
    if (!d.eta && d.names.shipper) warnings.push('ETA อ่านไม่ออก — เว้นว่างไว้');

    const key = norm(d.blNo);
    let duplicateOf = key ? byBl.get(key) ?? null : null;
    // ซ้ำกันเองภายในไฟล์ด้วย ไม่ใช่แค่ซ้ำกับของที่มีอยู่
    if (!duplicateOf && key) {
      const at = seen.get(key);
      if (at !== undefined) duplicateOf = `ซ้ำกับบรรทัด ${at} ในไฟล์เดียวกัน`;
      else seen.set(key, d.lineNo);
    }

    return {
      lineNo: d.lineNo,
      blNo: d.blNo,
      vessel: [d.vessel, d.voyage].filter(Boolean).join(' / '),
      eta: d.eta,
      containers: d.containers.length,
      resolved,
      warnings,
      duplicateOf,
      ids,
    };
  });

  return rows;
}

/** ตรวจไฟล์แล้วคืนผลให้ดูก่อน ยังไม่เขียนอะไรลงฐานข้อมูล */
async function previewShipmentCsvImpl(formData: FormData): Promise<PreviewResult> {
  await requireActiveSession(['PAINT']);
  const { drafts, skipped, hasHeader, fileName } = await parseUpload(formData);
  const rows = await checkDrafts(drafts);
  return { rows: rows.map(({ ids: _ids, ...r }) => r), skipped, hasHeader, fileName };
}

/* ---------------- เขียนจริง ---------------- */

/** เลขงานถัดไปหลายใบรวดเดียว — ล็อกแถวไว้กันสองคนกดพร้อมกันแล้วได้เลขซ้ำ */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function nextJobNos(tx: Tx, count: number): Promise<string[]> {
  const year = String(new Date().getFullYear());
  const prefix = 'KOLA';
  const [existing] = await tx
    .select().from(jobSequences)
    .where(and(eq(jobSequences.year, year), eq(jobSequences.prefix, prefix)))
    .for('update').limit(1);

  const start = existing?.lastNumber ?? 0;
  const last = start + count;
  if (existing) {
    await tx.update(jobSequences)
      .set({ lastNumber: last, updatedAt: new Date() })
      .where(eq(jobSequences.id, existing.id));
  } else {
    await tx.insert(jobSequences).values({ id: newId('SEQ'), year, prefix, lastNumber: last });
  }
  return Array.from({ length: count }, (_, i) =>
    `${prefix}-${year}-${String(start + i + 1).padStart(4, '0')}`);
}

/** เลขประจำตู้ — รหัส Job Type + ปี + เดือน + เลขรัน เหมือนที่หน้ารับงานออกให้ */
async function nextContainerNos(tx: Tx, code: string, count: number): Promise<string[]> {
  if (!count) return [];
  const now = new Date();
  const prefix = `${code}${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const year = String(now.getFullYear());

  const [existing] = await tx
    .select().from(jobSequences)
    .where(and(eq(jobSequences.year, year), eq(jobSequences.prefix, prefix)))
    .for('update').limit(1);

  const start = existing?.lastNumber ?? 0;
  if (existing) {
    await tx.update(jobSequences)
      .set({ lastNumber: start + count, updatedAt: new Date() })
      .where(eq(jobSequences.id, existing.id));
  } else {
    await tx.insert(jobSequences).values({
      id: newId('SEQ'), year, prefix, lastNumber: start + count,
    });
  }
  return Array.from({ length: count }, (_, i) =>
    `${prefix}${String(start + i + 1).padStart(4, '0')}`);
}

/**
 * เขียนงานทั้งไฟล์ลงระบบ
 *
 * อ่านไฟล์ใหม่แล้วตรวจซ้ำฝั่งเซิร์ฟเวอร์ ไม่เชื่อผลตรวจที่เบราว์เซอร์ส่งกลับมา
 * เพราะระหว่างที่ผู้ใช้ดูผลอยู่ อาจมีคนอื่นเพิ่งรับงานเลข BL เดียวกันเข้ามาแล้ว
 *
 * ทั้งไฟล์อยู่ใน transaction เดียว ถ้าพลาดกลางทางจะไม่เหลืองานครึ่ง ๆ กลาง ๆ
 * ที่ต้องมานั่งไล่ลบเอง ซึ่งเสี่ยงกว่าการนำเข้าใหม่ทั้งไฟล์
 */
async function importShipmentCsvImpl(formData: FormData) {
  const user = await requireActiveSession(['PAINT']);
  const { drafts, fileName } = await parseUpload(formData);
  const checked = await checkDrafts(drafts);

  // ข้ามใบที่ซ้ำเสมอ — นำเข้าไฟล์เดิมซ้ำจึงไม่ทำให้งานงอกเป็นสองเท่า
  const take = drafts.filter((_, i) => !checked[i].duplicateOf);
  const rows = checked.filter((r) => !r.duplicateOf);
  const duplicates = checked.length - rows.length;
  if (!take.length) {
    throw new Error(`ทุกแถวในไฟล์มีอยู่ในระบบแล้ว (${duplicates} ใบ) — ไม่มีอะไรต้องนำเข้า`);
  }

  const created = await db.transaction(async (tx) => {
    const jobNos = await nextJobNos(tx, take.length);

    /*
     * รหัส Job Type ของแต่ละแถว ใช้นำหน้าเลขประจำตู้
     * ดึงรอบเดียวทั้งชุดแล้วเทียบในหน่วยความจำ ไม่ถามทีละแถว
     */
    const typeIds = [...new Set(rows.map((r) => r.ids.jobType).filter(Boolean))] as string[];
    const typeCodes = new Map<string, string>();
    if (typeIds.length) {
      const found = await tx.select({ id: masterRecords.id, code: masterRecords.code })
        .from(masterRecords).where(sql`${masterRecords.id} in ${typeIds}`);
      for (const t of found) typeCodes.set(t.id, (t.code ?? 'MU').toUpperCase());
    }

    for (let i = 0; i < take.length; i += 1) {
      const d = take[i];
      const ids = rows[i].ids;
      const jobId = newId('JOB');
      const jobNo = jobNos[i];

      await tx.insert(jobs).values({
        id: jobId,
        jobNo,
        blNo: d.blNo || null,
        vessel: d.vessel || null,
        voyage: d.voyage || null,
        eta: d.eta,
        etaIsOfficial: false,
        transportDate: d.transportDate,
        shipperId: ids.shipper,
        consigneeId: ids.consignee,
        notifyPartyId: ids.notify,
        personId: ids.person,
        terminalId: ids.terminal,
        jobTypeId: ids.jobType,
        /*
         * เข้าคิวเดียวกับงานที่รับจาก Arrival Notice
         *
         * ไฟล์ตารางเป็นงานที่มีข้อมูลครบแล้วแต่ยังไม่มีไฟล์ AN/BL แนบ
         * ซึ่งเป็นสถานะเดียวกับงานที่รับจาก AN แล้วรอคีย์ BL ต่อ
         * ใช้สถานะเดิมจึงไม่ต้องเพิ่มคิวใหม่ให้ทุกหน้าจอต้องรู้จัก
         */
        status: 'WAITING_ENTER_BL',
        sourceType: 'AN',
        product: 'รถยนต์เก่าใช้แล้ว',
        unitAmount: d.unitAmount,
        grossWeight: d.grossWeight,
        shipline: d.shipline || null,
        demDays: d.demDays,
        detDays: d.detDays,
        draftRefNo: d.draftRefNo || null,
        customerNote: d.customerNote || null,
        createdBy: user.id,
        updatedBy: user.id,
      });

      await tx.insert(bls).values({
        id: newId('BL'),
        jobId,
        blNo: d.blNo,
        shipperId: ids.shipper,
        shipperName: rows[i].resolved.shipper ?? d.names.shipper,
      });

      if (d.containers.length) {
        const code = ids.jobType ? typeCodes.get(ids.jobType) ?? 'MU' : 'MU';
        const runningNos = await nextContainerNos(tx, code, d.containers.length);
        await tx.insert(containers).values(d.containers.map((no, n) => ({
          id: newId('CT'),
          jobId,
          jobNo,
          runningNo: runningNos[n],
          containerNo: no,
          containerType: '',
          sealNo: '',
        })));
      }
    }

    return jobNos.map((jobNo, i) => ({ jobNo, blNo: take[i].blNo }));
  });

  /*
   * ประวัติสถานะกับ log เขียนนอก transaction เหมือนหน้ารับงาน
   * ถ้าเขียนไม่สำเร็จก็ไม่ควรย้อนงานที่นำเข้าไปแล้วทั้งไฟล์ เพราะเป็นข้อมูลประกอบ
   */
  for (const c of created) {
    const [row] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.jobNo, c.jobNo)).limit(1);
    if (row) await recordStatus(row.id, null, 'WAITING_ENTER_BL', 'นำเข้าจากไฟล์ Shipment Detail', user.id);
  }
  await logActivity(user.id, 'IMPORT_SHIPMENT_CSV', 'JOB', created[0]?.jobNo ?? '-', {
    fileName, imported: created.length, duplicates,
  });

  revalidatePath('/pending');
  revalidatePath('/overview');
  revalidatePath('/jobs');
  revalidatePath('/intake/attach');

  return { imported: created.length, duplicates, jobNos: created.map((c) => c.jobNo) };
}

export async function previewShipmentCsv(formData: FormData) {
  return runAction(() => previewShipmentCsvImpl(formData));
}

export async function importShipmentCsv(formData: FormData) {
  return runAction(() => importShipmentCsvImpl(formData));
}
