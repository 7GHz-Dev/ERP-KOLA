'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { masterRecords } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import {
  ENV_LINE_ACCOUNT, LINE_ACCOUNT_TYPE, activeLineAccountId, lineAccounts, lineBotInfo, lineGroupInfo,
  setActiveLineAccount, type LineAccount,
} from '@/lib/line-accounts';
import { pushToLine } from '@/lib/line-notify';
import { seal } from '@/lib/secret-box';
import { logActivity, newId, required, runAction, text } from './common';

/**
 * LINE OA สำหรับแจ้งเตือนแลก DO — เพิ่ม · ใส่ Group ID · เลือกตัวที่ใช้ส่ง · ส่งข้อความทดสอบ · ลบ (ADMIN)
 *
 * ทุกคำสั่งถาม LINE จริงก่อนบันทึก (ไม่กินโควต้าข้อความ)
 * token ผิดหรือ bot ไม่อยู่ในกลุ่มต้องรู้ตอนกด ไม่ใช่ตอนที่ข้อความแจ้งเตือนหายเงียบ ๆ
 * ห้ามเขียน token ลง activity_log
 */

const PAGE = '/master/monitor';
const compact = (v: FormDataEntryValue | null, max: number) => text(v, max).replace(/\s+/g, '');

function done(message: string): never {
  revalidatePath(PAGE);
  redirect(`${PAGE}?ok=${encodeURIComponent(message)}`);
}

async function accountOf(id: string): Promise<LineAccount> {
  const account = (await lineAccounts()).find((a) => a.id === id);
  if (!account) throw new Error('ไม่พบ LINE OA นี้ — อาจถูกลบไปแล้ว');
  if (account.unreadable) throw new Error('ถอดรหัส token ของ OA นี้ไม่ได้ — ลบแล้วเพิ่มใหม่');
  return account;
}

async function store(id: string, value: { token: string; groupId: string; secret: string }) {
  await db.update(masterRecords).set({ value: seal(JSON.stringify(value)), updatedAt: new Date() })
    .where(and(eq(masterRecords.type, LINE_ACCOUNT_TYPE), eq(masterRecords.id, id)));
}

export async function addLineAccount(formData: FormData) {
  await runAction(async () => {
    const user = await requireActiveSession(['ADMIN']);
    const token = compact(required(formData.get('token'), 'Channel access token', 1000), 1000);
    const groupId = compact(formData.get('groupId'), 100);
    const secret = compact(formData.get('secret'), 100);

    const bot = await lineBotInfo(token);
    if (!bot.ok) throw new Error(`ใช้ token นี้ไม่ได้ — ${bot.error}`);
    const envToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    if (envToken) {
      const envBot = await lineBotInfo(envToken);
      if (envBot.ok && envBot.userId === bot.userId) throw new Error(`${bot.name} คือ OA ที่ตั้งไว้ใน Vercel อยู่แล้ว`);
    }

    // code = userId ของ bot — unique (type, code) กันเพิ่ม OA เดิมซ้ำ
    const [row] = await db.insert(masterRecords)
      .values({
        id: newId('LINE'), type: LINE_ACCOUNT_TYPE, code: bot.userId, name: bot.name, description: bot.basicId,
        value: seal(JSON.stringify({ token, groupId, secret })),
      })
      .onConflictDoNothing()
      .returning({ id: masterRecords.id });
    if (!row) throw new Error(`${bot.name} (${bot.basicId}) เพิ่มไว้แล้ว`);
    await logActivity(user.id, 'LINE_ACCOUNT_ADD', 'LINE', row.id, { name: bot.name, basicId: bot.basicId });

    const group = await lineGroupInfo(token, groupId);
    done(group.ok
      ? `เพิ่ม ${bot.name} แล้ว — กด "ใช้ OA นี้ส่งแจ้งเตือน" เพื่อสลับมาใช้`
      : `เพิ่ม ${bot.name} แล้ว แต่ยังส่งเข้ากลุ่มไม่ได้: ${group.error}`);
  });
}

export async function setLineGroup(formData: FormData) {
  await runAction(async () => {
    const user = await requireActiveSession(['ADMIN']);
    const account = await accountOf(text(formData.get('id'), 60));
    if (account.fromEnv) throw new Error('Group ID ของ OA ที่ตั้งใน Vercel แก้ได้ที่ LINE_GROUP_ID บน Vercel เท่านั้น');
    const groupId = compact(required(formData.get('groupId'), 'Group ID', 100), 100);

    const group = await lineGroupInfo(account.token, groupId);
    if (!group.ok) throw new Error(group.error);
    await store(account.id, { token: account.token, groupId, secret: account.secret });
    await logActivity(user.id, 'LINE_ACCOUNT_GROUP', 'LINE', account.id, { groupId, groupName: group.name });
    done(`${account.name} ส่งเข้ากลุ่ม ${group.name || groupId} ได้แล้ว`);
  });
}

export async function selectLineAccount(formData: FormData) {
  await runAction(async () => {
    const user = await requireActiveSession(['ADMIN']);
    const account = await accountOf(text(formData.get('id'), 60));
    const bot = await lineBotInfo(account.token);
    if (!bot.ok) throw new Error(`${account.name}: ${bot.error}`);
    const group = await lineGroupInfo(account.token, account.groupId);
    if (!group.ok) throw new Error(`${bot.name}: ${group.error}`);

    await setActiveLineAccount(account.id);
    await logActivity(user.id, 'LINE_ACCOUNT_SELECT', 'LINE', account.id, { name: bot.name });
    done(`แจ้งเตือนแลก DO จะส่งด้วย ${bot.name} ตั้งแต่รายการถัดไป`);
  });
}

export async function removeLineAccount(formData: FormData) {
  await runAction(async () => {
    const user = await requireActiveSession(['ADMIN']);
    const id = text(formData.get('id'), 60);
    if (id === ENV_LINE_ACCOUNT) throw new Error('OA ที่ตั้งใน Vercel ลบจากหน้านี้ไม่ได้');
    const [row] = await db.delete(masterRecords)
      .where(and(eq(masterRecords.type, LINE_ACCOUNT_TYPE), eq(masterRecords.id, id)))
      .returning({ name: masterRecords.name });
    if (!row) throw new Error('ไม่พบ LINE OA นี้ — อาจถูกลบไปแล้ว');
    // ลบตัวที่ใช้อยู่ — กลับไปใช้ตัวใน Vercel ไม่ปล่อยให้ชี้ไปตัวที่ไม่มีแล้ว
    const wasActive = (await activeLineAccountId()) === id;
    if (wasActive) await setActiveLineAccount(ENV_LINE_ACCOUNT);
    await logActivity(user.id, 'LINE_ACCOUNT_REMOVE', 'LINE', id, { name: row.name });
    done(`ลบ ${row.name} แล้ว${wasActive ? ' — กลับไปส่งด้วย OA ที่ตั้งใน Vercel' : ''}`);
  });
}

/**
 * ส่งข้อความทดสอบเข้ากลุ่มด้วย OA นี้ — ทางเดียวที่พิสูจน์ได้ว่าข้อความถึงกลุ่มจริง
 *
 * การตรวจ token / กลุ่มตอนเพิ่มและตอนเลือกไม่กินโควต้า แต่ไม่ได้ส่งจริง
 * โควต้าหมด (429) จะรู้ก็ต่อเมื่อส่ง ปุ่มนี้จึงใช้โควต้าเหมือนข้อความแจ้งเตือนปกติหนึ่งครั้ง
 */
export async function testLineAccount(formData: FormData) {
  await runAction(async () => {
    const user = await requireActiveSession(['ADMIN']);
    const account = await accountOf(text(formData.get('id'), 60));
    if (!account.groupId) throw new Error('ยังไม่ได้ใส่ Group ID ของ OA นี้');
    const bot = await lineBotInfo(account.token);
    if (!bot.ok) throw new Error(`${account.name}: ${bot.error}`);

    const result = await pushToLine([
      '🔔 ทดสอบแจ้งเตือนแลก DO จาก ERP-KOLA',
      `ส่งด้วย ${bot.name} โดย ${user.displayName} · ${formatDateTime(new Date())}`,
      'เห็นข้อความนี้ในกลุ่ม = ตั้งค่าถูกต้อง',
    ].join('\n'), { token: account.token, groupId: account.groupId });
    await logActivity(user.id, 'LINE_ACCOUNT_TEST', 'LINE', account.id, { name: bot.name, ok: result.ok, error: result.error });
    if (!result.ok) throw new Error(`${bot.name} ส่งไม่สำเร็จ — ${result.error}`);
    done(`ส่งข้อความทดสอบด้วย ${bot.name} แล้ว — ดูในกลุ่ม LINE ว่าได้รับหรือไม่`);
  });
}
