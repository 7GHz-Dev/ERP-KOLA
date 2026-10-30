import { and, desc, eq, sql } from 'drizzle-orm';
import nodemailer from 'nodemailer';
import { db } from '@/db';
import { activityLog, masterRecords } from '@/db/schema';
import { activeLineTarget, lineGroupInfo } from '@/lib/line-accounts';
import { pushToLine } from '@/lib/line-notify';
import { open, seal } from '@/lib/secret-box';
import { BUCKET, downloadFile, storage } from '@/lib/storage';
import { LINE_SOURCE_ACTION } from '@/lib/usage-log';
import { isShipmePartner, partnerLineMessage, partnerMail, parseEmails, type PartnerJob } from '@/lib/partner-message';

/**
 * ส่งชุดปล่อย E-Office ที่เซ็นแล้วให้ Port Release Partner ทางช่องทางที่ผูกไว้ (Master Data → Port Release Partner)
 *
 *   Email  แนบไฟล์ PDF ไปเลย — ส่งจาก Gmail ของบริษัท (App Password) ตั้งที่หน้าเดียวกัน หรือ env GMAIL_USER/GMAIL_APP_PASSWORD
 *   LINE   ส่งข้อความพร้อมลิงก์ดาวน์โหลด (ใช้ได้ 7 วัน) เข้ากลุ่มของ Partner ด้วย LINE OA ที่ใช้อยู่
 *          LINE Messaging API ส่งไฟล์ PDF เข้ากลุ่มไม่ได้ จึงส่งเป็นลิงก์แทน · bot ของ OA ต้องอยู่ในกลุ่มนั้น
 *
 * เหมือนการแจ้งเตือน LINE เดิม: ส่งไม่ได้ต้องไม่ทำให้การกดส่ง Partner พัง — ทุกฟังก์ชันคืนผลแทนการ throw
 * ผลแต่ละช่องทางขึ้นแถบแจ้งผลให้คนกดเห็นทันที และบันทึกลงไทม์ไลน์ของงาน
 */

export const MAIL_SETTING = { type: 'mailSetting', code: 'gmail' } as const;
const LINK_DAYS = 7;

export type ChannelResult = { channel: 'Email' | 'LINE'; ok: boolean; skipped?: boolean; detail: string };

export type Partner = {
  id: string; code: string | null; name: string; shortName: string | null;
  email: string | null; lineGroupId: string | null;
};

/* ---------- บัญชี Gmail ที่ใช้ส่ง ---------- */

export type GmailSender = { user: string; pass: string; fromEnv: boolean };

export async function gmailSender(): Promise<GmailSender | null> {
  try {
    const [row] = await db.select({ value: masterRecords.value }).from(masterRecords)
      .where(and(eq(masterRecords.type, MAIL_SETTING.type), eq(masterRecords.code, MAIL_SETTING.code))).limit(1);
    const data = JSON.parse(open(row?.value) ?? 'null') as { user?: string; pass?: string } | null;
    if (data?.user && data.pass) return { user: data.user, pass: data.pass, fromEnv: false };
  } catch { /* ถอดไม่ได้ (SESSION_SECRET เปลี่ยน) ถอยไปใช้ env */ }
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  return user && pass ? { user, pass, fromEnv: true } : null;
}

/** App Password ของ Google แสดงเป็น 4 กลุ่มคั่นวรรค — ตัดวรรคออกก่อนเก็บ */
export async function saveGmailSender(user: string, pass: string) {
  const value = seal(JSON.stringify({ user: user.trim(), pass: pass.replace(/\s+/g, '') }));
  await db.insert(masterRecords)
    .values({ id: 'SET-MAIL-GMAIL', type: MAIL_SETTING.type, code: MAIL_SETTING.code, name: 'Gmail ที่ใช้ส่งชุดปล่อยให้ Partner', value })
    .onConflictDoUpdate({ target: [masterRecords.type, masterRecords.code], set: { value, updatedAt: new Date() } });
}

export async function clearGmailSender() {
  await db.delete(masterRecords)
    .where(and(eq(masterRecords.type, MAIL_SETTING.type), eq(masterRecords.code, MAIL_SETTING.code)));
}

function gmailTransport(sender: GmailSender) {
  return nodemailer.createTransport({
    service: 'gmail', auth: { user: sender.user, pass: sender.pass },
    // ผู้ใช้รอหน้าเว็บอยู่ — ไม่ปล่อยให้ค้างจนหมดเวลาของ serverless function
    connectionTimeout: 15_000, greetingTimeout: 10_000, socketTimeout: 30_000,
  });
}

/* ---------- Partner ---------- */

const partnerColumns = {
  id: masterRecords.id, code: masterRecords.code, name: masterRecords.name, shortName: masterRecords.shortName,
  email: masterRecords.email, lineGroupId: masterRecords.lineGroupId,
};

/** Partner จากชื่อที่เก็บในงาน (jobs.release_partner เก็บเป็นชื่อ) — ไม่สนตัวพิมพ์และช่องว่างหัวท้าย */
export async function partnerByName(name: string | null | undefined): Promise<Partner | null> {
  const key = (name ?? '').trim().toUpperCase();
  if (!key) return null;
  const [row] = await db.select(partnerColumns).from(masterRecords)
    .where(and(eq(masterRecords.type, 'partners'), sql`upper(trim(${masterRecords.name})) = ${key}`)).limit(1);
  return row ?? null;
}

export async function partnerById(id: string): Promise<Partner | null> {
  const [row] = await db.select(partnerColumns).from(masterRecords)
    .where(and(eq(masterRecords.type, 'partners'), eq(masterRecords.id, id))).limit(1);
  return row ?? null;
}

/** ผูก Email/LINE ไว้ไหม — SHIPME ไม่ใช้สองทางนี้ (ช่องทางของ SHIPME คือ ERP SHIPME ซึ่งเชื่อมภายหลัง) */
export function hasChannel(p: Pick<Partner, 'name' | 'email' | 'lineGroupId'> | null): boolean {
  if (!p || isShipmePartner(p.name)) return false;
  return Boolean(parseEmails(p.email).length || (p.lineGroupId ?? '').trim());
}

/* ---------- ส่ง ---------- */

async function sendMail(to: string[], job: PartnerJob, file: { body: Buffer; fileName: string; mimeType: string }): Promise<ChannelResult> {
  if (!to.length) return { channel: 'Email', ok: false, skipped: true, detail: 'ไม่ได้ผูกอีเมล' };
  const sender = await gmailSender();
  if (!sender) return { channel: 'Email', ok: false, detail: 'ยังไม่ได้ตั้งบัญชี Gmail ที่ใช้ส่ง (Master Data → Port Release Partner)' };
  try {
    const mail = partnerMail(job);
    await gmailTransport(sender).sendMail({
      from: { name: 'KOLA SHIPPING', address: sender.user },
      to, subject: mail.subject, text: mail.text,
      attachments: [{ filename: file.fileName, content: file.body, contentType: file.mimeType }],
    });
    return { channel: 'Email', ok: true, detail: to.join(', ') };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // 535 = Gmail ไม่รับรหัส — ส่วนใหญ่ใช้รหัสบัญชีแทน App Password หรือยังไม่เปิด 2-Step Verification
    const hint = /535|Invalid login|Username and Password not accepted/i.test(message)
      ? 'Gmail ไม่รับรหัส — ต้องใช้ App Password (เปิด 2-Step Verification ก่อน)' : message.slice(0, 200);
    return { channel: 'Email', ok: false, detail: hint };
  }
}

async function sendLine(groupId: string, job: PartnerJob, link: string | null): Promise<ChannelResult> {
  if (!groupId) return { channel: 'LINE', ok: false, skipped: true, detail: 'ไม่ได้ผูกกลุ่ม LINE' };
  const target = await activeLineTarget();
  if (!target) return { channel: 'LINE', ok: false, detail: 'ยังไม่ได้ตั้ง LINE OA (หน้าการใช้งานและค่าใช้จ่าย)' };
  const r = await pushToLine(partnerLineMessage(job, link, LINK_DAYS), { token: target.token, groupId });
  return r.ok
    ? { channel: 'LINE', ok: true, detail: 'ส่งเข้ากลุ่มแล้ว' }
    : { channel: 'LINE', ok: false, detail: r.error ?? 'ส่งไม่สำเร็จ' };
}

/** ลิงก์ดาวน์โหลดไฟล์จาก storage ส่วนตัว — หมดอายุเอง ไม่ต้อง login (Partner ไม่มีบัญชีในระบบ) */
async function downloadLink(storageKey: string, fileName: string): Promise<string | null> {
  try {
    const { data } = await storage().storage.from(BUCKET)
      .createSignedUrl(storageKey, LINK_DAYS * 24 * 3600, { download: fileName });
    return data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * ส่งไฟล์ให้ Partner ทุกช่องทางที่ผูกไว้ — ไม่มีช่องทางเลยคืน [] (ผู้เรียกไม่ต้องแจ้งอะไร)
 * file = ไฟล์ชุดปล่อยที่เซ็นแล้ว (หมวด EOFFICE_SIGNED) ของงาน
 */
export async function sendToPartner(
  partner: Partner | null,
  job: PartnerJob,
  file: { storageKey: string; fileName: string; mimeType: string | null },
): Promise<ChannelResult[]> {
  if (!partner || !hasChannel(partner)) return [];
  const emails = parseEmails(partner.email);
  const groupId = (partner.lineGroupId ?? '').trim();
  const mimeType = file.mimeType || 'application/pdf';

  const [mail, line] = await Promise.all([
    emails.length
      ? downloadFile(file.storageKey)
          .then((f) => sendMail(emails, job, { body: f.body, fileName: file.fileName, mimeType }))
          .catch((e): ChannelResult => ({ channel: 'Email', ok: false, detail: `อ่านไฟล์ไม่ได้: ${e instanceof Error ? e.message : e}` }))
      : null,
    groupId
      ? downloadLink(file.storageKey, file.fileName).then((link) => sendLine(groupId, job, link))
      : null,
  ]);
  return [mail, line].filter((r): r is ChannelResult => Boolean(r));
}

/**
 * ทดสอบช่องทางของ Partner จากหน้า Master Data — ส่งข้อความสั้น ๆ ไม่แนบไฟล์งานจริง
 * ตั้งค่าเสร็จแล้วกดลองได้ทันที ไม่ต้องรอจนมีงานจริงแล้วค่อยรู้ว่าส่งไม่ถึง
 */
export async function testPartner(partner: Partner): Promise<ChannelResult[]> {
  if (!hasChannel(partner)) return [];
  const emails = parseEmails(partner.email);
  const groupId = (partner.lineGroupId ?? '').trim();
  const note = `ทดสอบการแจ้งเตือนจาก KOLA ERP ถึง ${partner.name}\nTest message from KOLA ERP — channel is working.`;

  const mail = async (): Promise<ChannelResult> => {
    const sender = await gmailSender();
    if (!sender) return { channel: 'Email', ok: false, detail: 'ยังไม่ได้ตั้งบัญชี Gmail ที่ใช้ส่ง' };
    try {
      await gmailTransport(sender).sendMail({ from: { name: 'KOLA SHIPPING', address: sender.user }, to: emails, subject: '[TEST] KOLA ERP', text: note });
      return { channel: 'Email', ok: true, detail: emails.join(', ') };
    } catch (error) {
      return { channel: 'Email', ok: false, detail: (error instanceof Error ? error.message : String(error)).slice(0, 200) };
    }
  };
  const line = async (): Promise<ChannelResult> => {
    const target = await activeLineTarget();
    if (!target) return { channel: 'LINE', ok: false, detail: 'ยังไม่ได้ตั้ง LINE OA' };
    const r = await pushToLine(note, { token: target.token, groupId });
    return r.ok ? { channel: 'LINE', ok: true, detail: 'ส่งเข้ากลุ่มแล้ว' } : { channel: 'LINE', ok: false, detail: r.error ?? 'ส่งไม่สำเร็จ' };
  };
  const results = await Promise.all([emails.length ? mail() : null, groupId ? line() : null]);
  return results.filter((r): r is ChannelResult => Boolean(r));
}

/** ข้อความสรุปผลบนแถบแจ้งผล / ไทม์ไลน์ เช่น "Email ✓ a@b.com · LINE ✗ bot ยังไม่อยู่ในกลุ่ม" */
export function describeResults(results: ChannelResult[]): string {
  return results.map((r) => `${r.channel} ${r.ok ? '✓' : '✗'} ${r.detail}`).join(' · ');
}

/* ---------- หน้าตั้งค่า ---------- */

export type SeenGroup = { id: string; name: string | null };

/**
 * กลุ่ม LINE ที่ bot เห็นล่าสุด (webhook บันทึกไว้ใน activity_log) พร้อมชื่อกลุ่ม
 * ใช้เป็นตัวเลือกตอนผูกกลุ่มให้ Partner — เชิญ bot เข้ากลุ่มของ Partner แล้วพิมพ์อะไรก็ได้ในกลุ่ม กลุ่มจะโผล่ที่นี่
 */
export async function recentLineGroups(limit = 15): Promise<SeenGroup[]> {
  try {
    const rows = await db.select({ entityId: activityLog.entityId, detail: activityLog.detail })
      .from(activityLog).where(eq(activityLog.action, LINE_SOURCE_ACTION))
      .orderBy(desc(activityLog.createdAt)).limit(200);
    const ids: string[] = [];
    for (const row of rows) {
      let type = '';
      try { type = (JSON.parse(row.detail ?? '{}') as { type?: string }).type ?? ''; } catch { /* แถวเก่า */ }
      if (type === 'group' && row.entityId && !ids.includes(row.entityId)) ids.push(row.entityId);
      if (ids.length >= limit) break;
    }
    const target = await activeLineTarget();
    return Promise.all(ids.map(async (id) => ({
      id,
      name: target ? (await lineGroupInfo(target.token, id)).name ?? null : null,
    })));
  } catch {
    return [];
  }
}
