'use server';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { users, waitingBls } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import { logActivity, newId, required, runAction, text } from './common';
import {
  WAITING_CHANNELS, blKey, parseLooseDate, parsePaste, splitContainers,
} from '@/lib/waiting-bl';

/**
 * Waiting BL — NAMKANG / FAH บันทึก BL ที่ลูกค้าแจ้งมาก่อน AN จากสายเรือ
 * PAINT ถามได้ว่า BL ที่กำลังรับอยู่มีใน Waiting BL หรือไม่ (findWaitingBls)
 * อนุมัติ AN เมื่อไรก็ปิดรายการที่ BL ตรงกัน (resolveWaitingBlsForJob — เรียกจาก decideApproval)
 */

const EDITORS = ['NAMKANG', 'FAH'];
const PATH = '/waiting-bl';

const openOnly = and(isNull(waitingBls.resolvedAt), isNull(waitingBls.cancelledAt));
/** งานในตารางหลักที่ BL ตรงกัน — AN อนุมัติแล้วหรือยัง */
async function jobsWithBl(keys: string[]) {
  if (!keys.length) return [];
  return db.execute<{ key: string; job_id: string; job_no: string; an_status: string | null }>(sql`
    select k.key, j.id as job_id, j.job_no,
           (select a.status from approvals a where a.job_id = j.id and a.approval_type = 'AN'
             order by a.requested_at desc limit 1) as an_status
      from unnest(${sql`array[${sql.join(keys.map((k) => sql`${k}`), sql`, `)}]::text[]`}) as k(key)
      join jobs j on j.is_archived = false
       and (upper(regexp_replace(coalesce(j.bl_no, ''), '[[:space:]]', '', 'g')) = k.key
            or exists (select 1 from bls b where b.job_id = j.id
                         and upper(regexp_replace(coalesce(b.bl_no, ''), '[[:space:]]', '', 'g')) = k.key))`);
}

function fields(formData: FormData) {
  const blNo = required(formData.get('blNo'), 'เลข BL', 120);
  const etaRaw = text(formData.get('eta'), 20);
  const eta = parseLooseDate(etaRaw);
  if (etaRaw && !eta) throw new Error(`อ่านวันที่ ETA "${etaRaw}" ไม่ได้ — ใช้รูปแบบ วว/ดด/ปปปป`);
  const channel = text(formData.get('channel'), 40);
  return {
    blNo,
    blKey: blKey(blNo),
    customer: text(formData.get('customer'), 200) || null,
    shipper: text(formData.get('shipper'), 200) || null,
    vessel: text(formData.get('vessel'), 120) || null,
    voyage: text(formData.get('voyage'), 60) || null,
    eta,
    containerNos: splitContainers(text(formData.get('containerNos'), 2000)).join(' ') || null,
    product: text(formData.get('product'), 300) || null,
    channel: WAITING_CHANNELS.includes(channel) ? channel : channel || null,
    note: text(formData.get('note'), 1000) || null,
  };
}

/** ตรวจก่อนบันทึก: BL ที่เข้าตารางหลักแล้วไม่ต้องรอ · BL ที่รออยู่แล้วไม่ต้องซ้ำ */
async function guard(keys: string[], exceptId?: string) {
  const approved = [...await jobsWithBl(keys)].filter((j) => j.an_status === 'APPROVED');
  if (approved.length) {
    throw new Error(`BL นี้เข้าตารางหลักแล้ว: ${approved.map((j) => `งาน ${j.job_no}`).join(', ')} — ไม่ต้องเพิ่มใน Waiting BL`);
  }
  const open = await db.select({ id: waitingBls.id, blNo: waitingBls.blNo }).from(waitingBls)
    .where(and(openOnly, inArray(waitingBls.blKey, keys)));
  const dup = open.filter((o) => o.id !== exceptId);
  if (dup.length) throw new Error(`มี BL นี้ใน Waiting BL อยู่แล้ว: ${dup.map((d) => d.blNo).join(', ')}`);
}

async function saveWaitingBlImpl(formData: FormData) {
  const user = await requireActiveSession(EDITORS);
  const id = text(formData.get('id'), 80);
  const data = fields(formData);
  await guard([data.blKey], id || undefined);

  if (id) {
    const done = await db.update(waitingBls)
      .set({ ...data, updatedBy: user.id, updatedAt: new Date() })
      .where(and(eq(waitingBls.id, id), openOnly))
      .returning({ id: waitingBls.id });
    if (!done.length) throw new Error('ไม่พบรายการ หรือรายการนี้ปิดไปแล้ว');
    await logActivity(user.id, 'UPDATE_WAITING_BL', 'WAITING_BL', id, { blNo: data.blNo });
  } else {
    const newIdValue = newId('WBL');
    await db.insert(waitingBls).values({ id: newIdValue, ...data, createdBy: user.id, updatedBy: user.id });
    await logActivity(user.id, 'CREATE_WAITING_BL', 'WAITING_BL', newIdValue, { blNo: data.blNo });
  }
  revalidatePath(PATH);
  redirect(`${PATH}?ok=${encodeURIComponent(`บันทึก BL ${data.blNo} แล้ว`)}`);
}

/** วางจาก Excel ทีละหลายรายการ — ข้าม BL ที่รออยู่แล้วหรือเข้าตารางหลักแล้ว แล้วบอกว่าข้ามอะไร */
async function importWaitingBlsImpl(formData: FormData) {
  const user = await requireActiveSession(EDITORS);
  const channel = text(formData.get('channel'), 40) || null;
  const { rows, errors } = parsePaste(text(formData.get('paste'), 100_000));
  if (!rows.length) throw new Error(errors[0] ?? 'ไม่มีรายการให้นำเข้า');
  if (rows.length > 300) throw new Error('นำเข้าได้ครั้งละไม่เกิน 300 รายการ');

  const keys = [...new Set(rows.map((r) => blKey(r.blNo)))];
  const approved = new Set([...await jobsWithBl(keys)].filter((j) => j.an_status === 'APPROVED').map((j) => j.key));
  const open = new Set((await db.select({ key: waitingBls.blKey }).from(waitingBls)
    .where(and(openOnly, inArray(waitingBls.blKey, keys)))).map((o) => o.key));

  const skipped: string[] = [];
  const seen = new Set<string>();
  const values = [];
  for (const r of rows) {
    const key = blKey(r.blNo);
    if (approved.has(key)) { skipped.push(`${r.blNo} (เข้าตารางหลักแล้ว)`); continue; }
    if (open.has(key) || seen.has(key)) { skipped.push(`${r.blNo} (มีอยู่แล้ว)`); continue; }
    seen.add(key);
    values.push({
      id: newId('WBL'), blNo: r.blNo.slice(0, 120), blKey: key,
      customer: r.customer || null, shipper: r.shipper || null, vessel: r.vessel || null, voyage: r.voyage || null,
      eta: r.eta, containerNos: r.containerNos || null, product: r.product || null, note: r.note || null,
      channel, createdBy: user.id, updatedBy: user.id,
    });
  }
  if (values.length) await db.insert(waitingBls).values(values);
  await logActivity(user.id, 'IMPORT_WAITING_BL', 'WAITING_BL', user.id, { added: values.length, skipped: skipped.length });
  revalidatePath(PATH);
  const msg = [`นำเข้า ${values.length} รายการ`, skipped.length ? `ข้าม ${skipped.length}: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? ' …' : ''}` : '',
    errors.length ? `เตือน: ${errors.slice(0, 3).join(' · ')}` : ''].filter(Boolean).join(' · ');
  redirect(`${PATH}?ok=${encodeURIComponent(msg.slice(0, 280))}`);
}

/** ลบออกจากรายการรอโดยไม่ได้เข้าตารางหลัก (ลูกค้ายกเลิก / กรอกผิด) — เก็บแถวไว้ดูย้อนหลัง */
async function cancelWaitingBlImpl(formData: FormData) {
  const user = await requireActiveSession(EDITORS);
  const id = required(formData.get('id'), 'รายการ', 80);
  const done = await db.update(waitingBls)
    .set({ cancelledAt: new Date(), cancelledBy: user.id, updatedBy: user.id, updatedAt: new Date() })
    .where(and(eq(waitingBls.id, id), openOnly))
    .returning({ blNo: waitingBls.blNo });
  if (!done.length) throw new Error('ไม่พบรายการ หรือรายการนี้ปิดไปแล้ว');
  await logActivity(user.id, 'CANCEL_WAITING_BL', 'WAITING_BL', id, { blNo: done[0].blNo });
  revalidatePath(PATH);
}

export async function saveWaitingBl(formData: FormData) { return runAction(() => saveWaitingBlImpl(formData)); }
export async function importWaitingBls(formData: FormData) { return runAction(() => importWaitingBlsImpl(formData)); }
export async function cancelWaitingBl(formData: FormData) { return runAction(() => cancelWaitingBlImpl(formData)); }

export type WaitingMatch = {
  blNo: string; customer: string | null; shipper: string | null; vessel: string | null;
  eta: string | null; containerNos: string | null; channel: string | null; note: string | null;
  createdByName: string | null; createdAt: string;
};

/**
 * หน้ารับ AN ถาม: เลข BL ที่กำลังกรอกอยู่ใน Waiting BL หรือไม่
 * คืนข้อมูลที่ NAMKANG / FAH กรอกไว้ ให้ PAINT เทียบกับ AN ได้ทันที
 */
export async function findWaitingBls(blNos: string[]): Promise<WaitingMatch[]> {
  await requireActiveSession(['PAINT', 'NAMKANG', 'FAH']);
  const keys = [...new Set((Array.isArray(blNos) ? blNos : []).slice(0, 50).map((b) => blKey(String(b))).filter(Boolean))];
  if (!keys.length) return [];
  const rows = await db
    .select({
      blNo: waitingBls.blNo, customer: waitingBls.customer, shipper: waitingBls.shipper,
      vessel: sql<string | null>`nullif(concat_ws(' / ', ${waitingBls.vessel}, ${waitingBls.voyage}), '')`,
      eta: sql<string | null>`${waitingBls.eta}::text`, containerNos: waitingBls.containerNos,
      channel: waitingBls.channel, note: waitingBls.note,
      createdByName: users.displayName, createdAt: sql<string>`${waitingBls.createdAt}::text`,
    })
    .from(waitingBls)
    .leftJoin(users, eq(users.id, waitingBls.createdBy))
    .where(and(openOnly, inArray(waitingBls.blKey, keys)));
  return rows;
}
