'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { db } from '@/db';
import { bls, containers, customsEntries, eofficeRequests, jobs, masterRecords } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import { nextContainerNos } from '@/lib/container-no';
import { STATUS_LABELS } from '@/lib/status';
import {
  CUSTOMS_STATUSES, DRAFT_STATUSES, RELEASE_STATUSES, SOURCE_TYPES, SURRENDER_STATUSES,
} from '@/lib/admin-job-options';
import { readBlRows, readContainerRows } from '@/lib/admin-job-rows';
import { day, logActivity, newId, number, required, runAction, text } from './common';

/**
 * ADMIN แก้ข้อมูลงานได้ทุกหัวข้อในหน้าเดียว
 *
 * ทุกฝ่ายแก้ได้เฉพาะช่องของขั้นตัวเอง (PAINT แก้ข้อมูล BL · FAH แก้ ETA/Partner ฯลฯ)
 * พอข้อมูลผิดในขั้นที่ผ่านไปแล้ว ไม่มีใครแก้ได้ ต้องรอให้งานย้อนกลับ
 * หน้านี้ให้ ADMIN เข้าไปแก้ตรงจุดได้เลย โดยไม่ขยับขั้นงาน (เว้นแต่จะเปลี่ยนสถานะเอง)
 *
 * ทุกช่องตรวจก่อนเขียน — master ต้องมีอยู่จริงและเป็นชนิดที่ถูก สถานะต้องเป็นค่าที่ระบบรู้จัก
 * แล้วเขียนทั้งหมดใน transaction เดียว ผิดตรงไหนต้องไม่เหลือข้อมูลครึ่ง ๆ กลาง ๆ
 */
async function adminUpdateJobImpl(formData: FormData) {
  const user = await requireActiveSession(['ADMIN']);
  const jobId = required(formData.get('jobId'), 'งาน', 80);
  const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new Error('ไม่พบงาน');

  const str = (field: string, max = 200) => text(formData.get(field), max) || null;
  const num = (field: string) => {
    const raw = text(formData.get(field), 40).replace(/,/g, '');
    if (!raw) return null;
    if (!Number.isFinite(Number(raw))) throw new Error(`ช่อง ${field} ต้องเป็นตัวเลข`);
    return raw;
  };
  /*
   * ค่าสถานะต้องเป็นค่าที่ระบบรู้จัก — หรือค่าเดิมของงาน
   * งานเก่าบางใบมีค่าจากระบบเดิมที่ไม่อยู่ในชุด ถ้าไม่ยอมรับค่าเดิม
   * ADMIN จะบันทึกช่องอื่นไม่ได้เลยทั้งที่ไม่ได้แตะช่องสถานะ
   */
  const oneOf = (field: keyof typeof job, allowed: readonly string[], label: string) => {
    const value = text(formData.get(field), 40);
    if (!allowed.includes(value) && value !== (job[field] ?? '')) throw new Error(`${label} ไม่ถูกต้อง`);
    return value;
  };

  const jobNo = required(formData.get('jobNo'), 'JOB No.', 40).toUpperCase();
  if (jobNo !== job.jobNo) {
    const [taken] = await db.select({ id: jobs.id }).from(jobs)
      .where(and(eq(jobs.jobNo, jobNo), ne(jobs.id, jobId))).limit(1);
    if (taken) throw new Error(`JOB No. ${jobNo} มีอยู่แล้ว`);
  }

  const demDays = number(formData.get('demDays'), job.demDays);
  const detDays = number(formData.get('detDays'), job.detDays);
  if (demDays < 0 || detDays < 0) throw new Error('จำนวนวัน DEM/DET ติดลบไม่ได้');

  /*
   * master ทุกช่องต้องชี้ไปของที่มีอยู่จริงและเป็นชนิดที่ถูก
   * ฟอร์มยิงตรงได้ ถ้าปล่อยผ่าน ตารางจะขึ้นช่องว่างโดยไม่รู้ว่าทำไม (left join ไม่ error)
   */
  const masterFields: Array<[keyof typeof job, string, string]> = [
    ['shipperId', 'shippers', 'Shipper'], ['consigneeId', 'consignees', 'Consignee'],
    ['notifyPartyId', 'notify', 'Notify Party'], ['personId', 'people', 'Client in charge'],
    ['jobTypeId', 'jobTypes', 'Job Type'], ['loadingTypeId', 'loadingTypes', 'Loading Type'],
    ['portId', 'ports', 'Port of Discharge'], ['terminalId', 'terminals', 'Port Terminal'],
  ];
  const picked = Object.fromEntries(masterFields.map(([f]) => [f, str(f, 80)])) as Record<string, string | null>;

  // BL รายใบ — ลำดับในฟอร์มคือลำดับที่เก็บ ใบแรกเป็นตัวแทนของงาน
  const blRows = readBlRows(formData);

  const ids = [...new Set([
    ...Object.values(picked), ...blRows.map((r) => r.shipperId),
  ].filter((v): v is string => Boolean(v)))];
  const found = ids.length
    ? await db.select({ id: masterRecords.id, type: masterRecords.type, name: masterRecords.name })
      .from(masterRecords).where(inArray(masterRecords.id, ids))
    : [];
  const master = new Map(found.map((m) => [m.id, m]));
  // ค่าเดิมที่ไม่ได้เปลี่ยนยอมให้ผ่าน แม้ master ตัวนั้นจะถูกลบไปแล้ว — ADMIN ไม่ได้แตะช่องนั้น
  const checkType = (id: string | null, type: string, label: string, current?: unknown) => {
    if (id && id !== current && master.get(id)?.type !== type) throw new Error(`ไม่พบ ${label} ที่เลือก`);
  };
  for (const [field, type, label] of masterFields) checkType(picked[field], type, label, job[field]);
  for (const r of blRows) checkType(r.shipperId, 'shippers', `Shipper ของ BL ${r.blNo}`);

  // ตู้ — แถวใหม่ที่ไม่ได้กรอกอะไรถือว่าไม่มี
  const ctRows = readContainerRows(formData);

  /*
   * เลข BL กับ Shipper ระดับงาน — ตารางทุกหน้าอ่านจากตรงนี้ ส่วนหน้าสรุปงานอ่านจาก BL รายใบ
   * มี BL รายใบเมื่อไหร่ ใช้ใบแรกเป็นค่าของงาน สองที่จึงไม่มีทางขึ้นคนละค่า
   */
  const blNo = blRows.length ? blRows[0].blNo : str('blNo', 120);
  const shipperId = blRows.length ? blRows[0].shipperId : picked.shipperId;
  const declarationNo = str('declarationNo', 80);

  await db.transaction(async (tx) => {
    await tx.update(jobs).set({
      jobNo, blNo, shipperId,
      consigneeId: picked.consigneeId, notifyPartyId: picked.notifyPartyId,
      personId: picked.personId, jobTypeId: picked.jobTypeId, loadingTypeId: picked.loadingTypeId,
      portId: picked.portId, terminalId: picked.terminalId,

      sourceType: oneOf('sourceType', SOURCE_TYPES.map((t) => t.value), 'ที่มาของงาน') || null,
      blType: str('blType', 40),
      product: str('product', 1000),
      unitAmount: num('unitAmount'),
      packageType: str('packageType', 60),
      grossWeight: num('grossWeight'),
      goodsValue: num('goodsValue'),
      goodsCurrency: str('goodsCurrency', 10),
      customerNote: str('customerNote', 1000),

      shipline: str('shipline', 120),
      vessel: str('vessel', 120),
      voyage: str('voyage', 80),
      etd: day(formData.get('etd')),
      eta: day(formData.get('eta')),
      etaIsOfficial: formData.get('etaIsOfficial') === '1',
      transportDate: day(formData.get('transportDate')),
      originPort: str('originPort', 200)?.toUpperCase() ?? null,
      demDays: Math.round(demDays),
      detDays: Math.round(detDays),
      releasePartner: str('releasePartner', 180),

      status: oneOf('status', Object.keys(STATUS_LABELS), 'สถานะงาน'),
      surrenderStatus: oneOf('surrenderStatus', SURRENDER_STATUSES.map((s) => s.value), 'สถานะ Surrender'),
      customsStatus: oneOf('customsStatus', CUSTOMS_STATUSES.map((s) => s.value), 'สถานะใบขน'),
      releaseStatus: oneOf('releaseStatus', RELEASE_STATUSES.map((s) => s.value), 'สถานะปล่อยของ'),
      draftStatus: oneOf('draftStatus', DRAFT_STATUSES.map((s) => s.value), 'สถานะ Draft') || null,
      draftRefNo: str('draftRefNo', 80),
      draftRejectReason: str('draftRejectReason', 1000),

      doPayAmount: num('doPayAmount'),
      doDepositAmount: num('doDepositAmount'),
      doOtherAmount: num('doOtherAmount'),
      doOtherLabel: str('doOtherLabel', 60),

      updatedBy: user.id,
      updatedAt: new Date(),
    }).where(eq(jobs.id, jobId));

    // ---------- BL รายใบ ----------
    const keepBl = blRows.filter((r) => r.id).map((r) => r.id);
    const oldBl = await tx.select({ id: bls.id }).from(bls).where(eq(bls.jobId, jobId));
    const dropBl = oldBl.map((r) => r.id).filter((id) => !keepBl.includes(id));
    if (dropBl.length) await tx.delete(bls).where(inArray(bls.id, dropBl));
    for (const r of blRows) {
      const values = {
        blNo: r.blNo, shipperId: r.shipperId,
        shipperName: r.shipperId ? master.get(r.shipperId)?.name ?? '' : '',
        updatedAt: new Date(),
      };
      if (r.id) await tx.update(bls).set(values).where(and(eq(bls.id, r.id), eq(bls.jobId, jobId)));
      else await tx.insert(bls).values({ id: newId('BL'), jobId, blType: str('blType', 40), ...values });
    }

    // ---------- ตู้ ----------
    const keepCt = ctRows.filter((r) => r.id).map((r) => r.id);
    const oldCt = await tx.select({ id: containers.id }).from(containers).where(eq(containers.jobId, jobId));
    const dropCt = oldCt.map((r) => r.id).filter((id) => !keepCt.includes(id));
    if (dropCt.length) await tx.delete(containers).where(inArray(containers.id, dropCt));
    for (const r of ctRows.filter((row) => row.id)) {
      await tx.update(containers).set({
        containerNo: r.containerNo, containerType: r.containerType, sealNo: r.sealNo,
        weight: r.weight, jobNo, updatedAt: new Date(),
      }).where(and(eq(containers.id, r.id), eq(containers.jobId, jobId)));
    }
    // ตู้ใหม่ได้เลขประจำตู้จากลำดับเดียวกับตอนรับงาน เลขนี้ห้ามซ้ำเพราะใช้ผูกค่าใช้จ่ายรายตู้
    const added = ctRows.filter((row) => !row.id);
    if (added.length) {
      const typeCode = picked.jobTypeId
        ? (await tx.select({ code: masterRecords.code }).from(masterRecords)
          .where(eq(masterRecords.id, picked.jobTypeId)).limit(1))[0]?.code
        : null;
      const runningNos = await nextContainerNos(tx, (typeCode || 'MU').toUpperCase(), added.length);
      await tx.insert(containers).values(added.map((r, i) => ({
        id: newId('CT'), jobId, jobNo, runningNo: runningNos[i],
        containerNo: r.containerNo, containerType: r.containerType, sealNo: r.sealNo, weight: r.weight,
      })));
    }

    // คำร้อง E-Office เก็บเลขงานซ้ำไว้ในตัว เปลี่ยนเลขงานแล้วต้องตามแก้ ไม่งั้นค้นด้วยเลขใหม่ไม่เจอ
    if (jobNo !== job.jobNo) {
      await tx.update(eofficeRequests).set({ jobNo, updatedAt: new Date() }).where(eq(eofficeRequests.jobId, jobId));
    }

    // ---------- เลขใบขน (Im-Dcrl No.) ----------
    const [entry] = await tx.select({ id: customsEntries.id, declarationNo: customsEntries.declarationNo })
      .from(customsEntries).where(eq(customsEntries.jobId, jobId)).limit(1);
    if (entry && entry.declarationNo !== declarationNo) {
      await tx.update(customsEntries).set({ declarationNo, updatedAt: new Date() })
        .where(eq(customsEntries.id, entry.id));
    } else if (!entry && declarationNo) {
      await tx.insert(customsEntries).values({
        // ไม่เดาสถานะให้ — สถานะใบขนของงานแก้แยกที่ช่อง "สถานะใบขน" อยู่แล้ว
        id: newId('CE'), jobId, declarationNo, createdBy: user.id, note: 'ADMIN แก้ไขเลขใบขน',
      });
    }
  });

  await logActivity(user.id, 'ADMIN_UPDATE_JOB', 'JOB', jobId, {
    jobNo, before: { jobNo: job.jobNo, status: job.status, blNo: job.blNo },
  });
  // ข้อมูลงานโผล่แทบทุกหน้า รีเฟรชทั้งแอปง่ายและแน่นอนกว่าไล่ระบุทีละหน้า
  revalidatePath('/', 'layout');
}

export async function adminUpdateJob(formData: FormData) {
  return runAction(async () => {
    await adminUpdateJobImpl(formData);
    // กลับไปหน้าเดิมพร้อมแถบเขียวบอกว่าบันทึกแล้ว
    redirect(`/master/jobs/${String(formData.get('jobId'))}?ok=${encodeURIComponent('บันทึกการแก้ไขแล้ว')}`);
  });
}
