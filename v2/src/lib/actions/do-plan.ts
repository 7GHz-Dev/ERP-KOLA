'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  activityLog, doHandoffs, doPlans, files, jobs, masterRecords, statusHistory,
} from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import { missingSummary, planNo, type PlanCandidate } from '@/lib/do-plan';
import { day, newId, text } from './common';

export type PlanState = { error: string; message: string };

/**
 * FAH สร้าง Plan แลก DO จากรายการที่เลือกไว้ แล้วส่งทั้งชุดให้ Partner ในทีเดียว
 *
 * สร้าง Plan = ส่ง Partner ด้วยเลย ไม่ได้แยกเป็นสองปุ่ม เพราะการนัดวันแลกคือ
 * การส่งมอบงานให้ Partner อยู่แล้ว ถ้าแยกกันจะมีสถานะ "อยู่ใน Plan แต่ยังไม่ส่ง"
 * ซึ่งฝั่ง ANN กับ MAY มองไม่เห็นความต่าง แล้วกลายเป็นงานค้างที่ไม่มีใครรู้ว่าค้าง
 *
 * ปุ่มส่งทีละใบที่มีอยู่เดิมยังอยู่ครบ ใบที่ส่งเดี่ยวก็ยังเข้าคิว ANN/MAY เหมือนเดิม
 * แค่ไม่มี Plan ผูกอยู่ จึงไม่ต้องย้ายข้อมูลเก่าหรือบังคับให้ทุกใบมี Plan
 */
export async function createDoPlan(_previous: PlanState, data: FormData): Promise<PlanState> {
  try {
    const user = await requireActiveSession(['FAH']);
    if (user.mustChangePassword) throw new Error('กรุณาเปลี่ยนรหัสผ่านก่อนดำเนินการ');

    const planDate = day(data.get('planDate'));
    if (!planDate) throw new Error('กรุณาเลือกวันที่ Plan แลก DO');
    const note = text(data.get('note'), 500);

    const input = data.getAll('jobId');
    if (!input.length || input.length > 100 || new Set(input).size !== input.length
      || input.some((id) => typeof id !== 'string' || !id.trim() || id.length > 80)) {
      throw new Error('กรุณาเลือก 1–100 รายการโดยไม่ซ้ำกัน');
    }
    const ids = input as string[];

    const created = await db.transaction(async (tx) => {
      /*
       * ล็อกแถวงานตามลำดับ id เหมือน action ชุดอื่นของระบบ
       * เรียงก่อนล็อกเพื่อไม่ให้สองคนที่เลือกงานทับกันล็อกสลับลำดับกันจนค้างคู่
       */
      const records = await tx.select().from(jobs)
        .where(inArray(jobs.id, ids)).orderBy(jobs.id).for('update');
      if (records.length !== ids.length) throw new Error('ไม่พบ JOB บางรายการ กรุณารีเฟรชรายการ');

      const handoffRows = await tx.select().from(doHandoffs).where(inArray(doHandoffs.jobId, ids));
      const handoffOf = new Map(handoffRows.map((row) => [row.jobId, row]));

      const invoiceRows = await tx.select({ jobId: files.jobId }).from(files).where(and(
        inArray(files.jobId, ids), eq(files.category, 'INVOICE_DO'), eq(files.isCurrent, true),
      ));
      const hasInvoice = new Set(invoiceRows.map((row) => row.jobId));

      /*
       * ค่าตั้งต้นของ Port กับ Partner — ต้องเป็นชุดเดียวกับที่หน้าจอใช้
       *
       * หน้าจอเติมค่าพวกนี้ให้แถวที่ยังไม่ได้เลือกเอง เพราะเกือบทุกใบเข้าแหลมฉบัง
       * และใช้ SHIPME ถ้าฝั่งนี้ไม่เติมตาม แถวที่หน้าจอบอกว่าพร้อมจะโดนปฏิเสธตอนกดส่ง
       * ว่า "ขาด Partner" ทั้งที่จอโชว์ SHIPME อยู่ ซึ่งไม่มีทางแก้ตามจากหน้าจอได้เลย
       *
       * จับจาก Master Data ด้วยรหัส/ชื่อ ไม่ผูก id ตรง ๆ เหมือนที่หน้าจอทำ
       */
      const masters = await tx.select({
        id: masterRecords.id, type: masterRecords.type,
        code: masterRecords.code, name: masterRecords.name,
      }).from(masterRecords).where(and(
        inArray(masterRecords.type, ['ports', 'partners']),
        eq(masterRecords.isActive, true),
      ));
      const ports = masters.filter((m) => m.type === 'ports');
      const partners = masters.filter((m) => m.type === 'partners');
      const defaultPortId =
        ports.find((p) => p.code === 'THLCH')?.id
        ?? ports.find((p) => /แหลมฉบัง|laem\s*chabang/i.test(p.name))?.id
        ?? null;
      const defaultPartnerName = partners.find((p) => /shipme/i.test(p.name))?.name ?? null;

      /*
       * ตรวจความพร้อมด้วยสูตรเดียวกับที่หน้าจอใช้ปิดปุ่ม
       *
       * ค่าที่เอามาตรวจดึงจาก do_handoffs ก่อน แล้วค่อยตกมาที่ jobs แล้วจึงถึงค่าตั้งต้น
       * เพราะแผงกรอกของ FAH บันทึกลงทั้งสองที่ แต่ handoff คือค่าที่ตั้งใจส่งจริง
       */
      const resolve = (job: typeof records[number]) => {
        const handoff = handoffOf.get(job.id);
        return {
          eta: handoff?.etaOfficial ?? job.eta,
          transportDate: handoff?.transportDate ?? job.transportDate,
          portId: handoff?.portId ?? job.portId ?? defaultPortId,
          terminalId: handoff?.terminalId ?? job.terminalId,
          partnerName: handoff?.partnerName ?? job.releasePartner ?? defaultPartnerName,
          note: handoff?.note ?? null,
          alreadySent: Boolean(handoff?.sentAt),
        };
      };
      const candidates: PlanCandidate[] = records.map((job) => {
        const value = resolve(job);
        return {
          id: job.id,
          label: job.blNo ?? job.jobNo,
          hasInvoiceDo: hasInvoice.has(job.id),
          eta: value.eta,
          portId: value.portId,
          terminalId: value.terminalId,
          partnerName: value.partnerName,
          alreadySent: value.alreadySent,
        };
      });
      for (const job of records) {
        if (job.isArchived) throw new Error(`${job.jobNo} ถูกปิดการใช้งานแล้ว`);
      }
      const problem = missingSummary(candidates);
      if (problem) throw new Error(`ยังส่งไม่ได้ — ${problem}`);

      /*
       * เลขที่ Plan นับต่อจากชุดที่มีอยู่ของวันเดียวกัน
       * นับในทรานแซกชันที่ล็อกแถวงานไว้แล้ว สองคนกดพร้อมกันจึงไม่ได้เลขชนกัน
       * และถ้าชนจริงยังมี unique index ของ plan_no กันไว้อีกชั้น
       */
      const [{ count }] = await tx.select({ count: sql<number>`count(*)::int` })
        .from(doPlans).where(eq(doPlans.planDate, planDate));

      const planId = newId('PLN');
      await tx.insert(doPlans).values({
        id: planId, planNo: planNo(planDate, count), planDate, note: note || null,
        createdBy: user.id,
      });

      const now = new Date();
      for (const job of records) {
        const handoff = handoffOf.get(job.id);
        // ใช้ resolve() ตัวเดียวกับที่ตรวจความพร้อม ค่าที่บันทึกจึงเป็นค่าที่ผ่านการตรวจมาแล้ว
        const resolved = resolve(job);
        const values = {
          jobId: job.id,
          etaOfficial: resolved.eta,
          transportDate: resolved.transportDate,
          portId: resolved.portId,
          terminalId: resolved.terminalId,
          partnerName: resolved.partnerName,
          note: resolved.note,
          doPlanId: planId,
          sentBy: user.id,
          sentAt: now,
          updatedAt: now,
        };
        if (handoff) await tx.update(doHandoffs).set(values).where(eq(doHandoffs.id, handoff.id));
        else await tx.insert(doHandoffs).values({ id: newId('DO'), ...values });

        await tx.update(jobs).set({
          // ETA ที่ส่งไปกับ Plan คือตัวจริงแล้ว หน้าอื่นจะได้ขึ้น (OFC) ตรงกัน
          eta: values.etaOfficial, etaIsOfficial: true,
          portId: values.portId, terminalId: values.terminalId,
          releasePartner: values.partnerName ?? job.releasePartner,
          status: 'DO_SENT', updatedBy: user.id, updatedAt: now,
        }).where(eq(jobs.id, job.id));

        await tx.insert(statusHistory).values({
          id: newId('STH'), jobId: job.id, fromStatus: job.status, toStatus: 'DO_SENT',
          note: `ส่ง DO ให้ ${values.partnerName || 'Partner'} ตาม Plan วันที่ ${planDate}`,
          actorId: user.id,
        });
        await tx.insert(activityLog).values({
          id: newId('LOG'), userId: user.id, action: 'CREATE_DO_PLAN',
          entityType: 'JOB', entityId: job.id, detail: JSON.stringify({ planId, planDate }),
        });
      }
      return { planNo: planNo(planDate, count), count: records.length };
    });

    revalidatePath('/', 'layout');
    return {
      error: '',
      message: `สร้าง ${created.planNo} แล้ว ${created.count} รายการ · ส่ง Partner เรียบร้อย`,
    };
  } catch (error) {
    return { message: '', error: error instanceof Error ? error.message : 'สร้าง Plan ไม่สำเร็จ' };
  }
}
