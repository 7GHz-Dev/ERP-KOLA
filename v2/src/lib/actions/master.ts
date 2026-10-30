'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { masterRecords } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import { MASTER_TYPES } from '@/lib/queries/master';
import { isShipmePartner, parseEmails } from '@/lib/partner-message';
import { clearGmailSender, describeResults, partnerById, saveGmailSender, testPartner } from '@/lib/partner-notify';
import { backWithOk, logActivity, newId, required, runAction, text } from './common';

/**
 * เพิ่มและแก้ Master Data ทุกหัวข้อ
 *
 * รหัสเว้นว่างได้ ระบบจะรันต่อจากเลขสูงสุดที่ใช้อยู่ในหัวข้อนั้น
 * (ไม่ใช่นับจำนวนแถว เพราะถ้าเคยลบแถวไปเลขจะชนกับของเดิม)
 */
const CODE_PREFIX: Record<string, string> = {
  shippers: 'SHP',
  consignees: 'CNE',
  notify: 'NTP',
  people: 'PSN',
  ports: 'PORT',
  // ท่าต้นทาง แยกรหัสจาก ports (ท่าปลายทาง) เพราะเป็นคนละชุดข้อมูล
  originPorts: 'POL',
  terminals: 'TML',
  jobTypes: 'JT',
  partners: 'PTN',
  loadingTypes: 'LT',
  containerTypes: 'CT',
  packageTypes: 'PKG',
  settings: 'SET',
};

async function nextCode(type: string): Promise<string> {
  const prefix = CODE_PREFIX[type] ?? 'MD';
  const [row] = await db
    .select({
      max: sql<number>`coalesce(max(nullif(regexp_replace(code, ${`^${prefix}`}, ''), '')::int), 0)`,
    })
    .from(masterRecords)
    .where(and(eq(masterRecords.type, type), sql`code ~ ${`^${prefix}[0-9]+$`}`));
  return `${prefix}${String(Number(row?.max ?? 0) + 1).padStart(4, '0')}`;
}

async function saveMasterRecordImpl(formData: FormData) {
  const user = await requireActiveSession(['ADMIN']);
  const type = required(formData.get('type'), 'หัวข้อ', 40);
  if (!MASTER_TYPES.some((t) => t.key === type)) throw new Error('หัวข้อไม่ถูกต้อง');

  const id = text(formData.get('id'), 80);
  const name = required(formData.get('name'), 'ชื่อ', 200);
  const description = text(formData.get('description'), 500);
  const value = text(formData.get('value'), 500);
  const isActive = text(formData.get('isActive'), 4) !== '0';
  let code = text(formData.get('code'), 60).toUpperCase();
  /*
   * ช่องที่มีเฉพาะบางฟอร์ม — ฟอร์มไหนไม่ได้ส่งมาต้องคงค่าเดิมไว้ ไม่ใช่ล้างทิ้ง
   * ชื่อย่อ: ทะเบียนงานแสดงแทนชื่อเต็ม · อีเมล/กลุ่ม LINE: ช่องทางแจ้งของ Port Release Partner
   */
  const extra: { shortName?: string | null; email?: string | null; lineGroupId?: string | null } = {};
  if (formData.has('shortName')) extra.shortName = text(formData.get('shortName'), 60) || null;
  // SHIPME ส่งผ่าน ERP SHIPME (เชื่อมภายหลัง) ไม่มีช่อง Email/LINE ให้กรอก
  const channels = type === 'partners' && !isShipmePartner(name);
  if (channels && formData.has('email')) {
    const raw = text(formData.get('email'), 500);
    const emails = parseEmails(raw);
    if (raw && emails.length < raw.split(/[\s,;]+/).filter(Boolean).length) {
      throw new Error('อีเมลบางรายการไม่ถูกต้อง — คั่นหลายอีเมลด้วย , เช่น a@x.com, b@y.com');
    }
    extra.email = emails.join(', ') || null;
  }
  if (channels && formData.has('lineGroupId')) {
    const group = text(formData.get('lineGroupId'), 80);
    // Group ID ของ LINE = C + 32 ตัว (ห้องแชท R… / ผู้ใช้ U… ก็ส่งได้)
    if (group && !/^[CRU][0-9a-f]{32}$/.test(group)) {
      throw new Error('Group ID ของ LINE ไม่ถูกต้อง — ขึ้นต้นด้วย C ตามด้วย 32 ตัวอักษร (เลือกจากรายการกลุ่มที่ bot เห็น)');
    }
    extra.lineGroupId = group || null;
  }

  // ชื่อซ้ำในหัวข้อเดียวกันไม่ได้ เพราะทุกหน้าจอเลือกจากชื่อ
  const [dup] = await db
    .select({ id: masterRecords.id })
    .from(masterRecords)
    .where(and(
      eq(masterRecords.type, type),
      sql`upper(${masterRecords.name}) = ${name.toUpperCase()}`,
      id ? sql`${masterRecords.id} <> ${id}` : sql`true`,
    ))
    .limit(1);
  if (dup) throw new Error(`มี "${name}" อยู่ในหัวข้อนี้แล้ว`);

  if (id) {
    const [existing] = await db.select().from(masterRecords)
      .where(eq(masterRecords.id, id)).limit(1);
    if (!existing) throw new Error('ไม่พบรายการที่จะแก้');
    await db.update(masterRecords)
      .set({ code: code || existing.code, name, description, value, isActive, ...extra, updatedAt: new Date() })
      .where(eq(masterRecords.id, id));
    await logActivity(user.id, 'UPDATE_MASTER', type, id, { name });
  } else {
    if (!code) code = await nextCode(type);
    const created = newId('MD');
    await db.insert(masterRecords).values({
      id: created, type, code, name, description, value, isActive, ...extra,
    });
    await logActivity(user.id, 'CREATE_MASTER', type, created, { code, name });
  }

  revalidatePath('/master');
  revalidatePath('/intake/an');
  revalidatePath('/intake/bl');
  revalidatePath('/fah/do');
}

export async function saveMasterRecord(formData: FormData) {
  return runAction(() => saveMasterRecordImpl(formData));
}

/* ---------- Port Release Partner: บัญชี Gmail ที่ใช้ส่ง · ทดสอบช่องทาง ---------- */

async function saveGmailImpl(formData: FormData) {
  const user = await requireActiveSession(['ADMIN']);
  if (text(formData.get('clear'), 4) === '1') {
    await clearGmailSender();
    await logActivity(user.id, 'CLEAR_GMAIL_SENDER', 'SETTING', 'gmail', {});
    revalidatePath('/master');
    return backWithOk('ลบบัญชี Gmail ที่ใช้ส่งแล้ว');
  }
  const address = required(formData.get('gmailUser'), 'อีเมล Gmail', 200);
  const pass = required(formData.get('gmailPass'), 'App Password', 100).replace(/\s+/g, '');
  if (!parseEmails(address).length) throw new Error('อีเมล Gmail ไม่ถูกต้อง');
  // App Password ของ Google ยาว 16 ตัวอักษรเสมอ — รหัสผ่านบัญชีใช้ส่งผ่าน SMTP ไม่ได้
  if (!/^[a-z]{16}$/i.test(pass)) throw new Error('App Password ต้องเป็นตัวอักษร 16 ตัว (สร้างที่ myaccount.google.com/apppasswords)');
  await saveGmailSender(address, pass);
  await logActivity(user.id, 'SET_GMAIL_SENDER', 'SETTING', 'gmail', { address });
  revalidatePath('/master');
  return backWithOk(`บันทึกบัญชี Gmail ${address} แล้ว — กด "ทดสอบส่ง" ที่ Partner เพื่อลองส่งจริง`);
}

async function testPartnerImpl(formData: FormData) {
  const user = await requireActiveSession(['ADMIN']);
  const partner = await partnerById(required(formData.get('id'), 'Partner', 80));
  if (!partner) throw new Error('ไม่พบ Partner');
  const results = await testPartner(partner);
  if (!results.length) throw new Error('Partner นี้ยังไม่ได้ผูก Email หรือกลุ่ม LINE');
  await logActivity(user.id, 'TEST_PARTNER_CHANNELS', 'partners', partner.id, { results: describeResults(results) });
  return backWithOk(`ทดสอบส่งให้ ${partner.name} · ${describeResults(results)}`);
}

export async function saveGmail(formData: FormData) { return runAction(() => saveGmailImpl(formData)); }
export async function testPartnerChannels(formData: FormData) { return runAction(() => testPartnerImpl(formData)); }
