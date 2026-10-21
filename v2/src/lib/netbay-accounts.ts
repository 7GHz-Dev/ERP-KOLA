import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { masterRecords } from '@/db/schema';
import { newId } from '@/lib/actions/common';

/**
 * บัญชี NETBAY แยกเครื่องละบัญชี — NETBAY ให้ login ด้วยบัญชีเดียวได้ทีละที่
 * ถ้าสองเครื่องใช้บัญชีเดียวกันพร้อมกัน เครื่องที่ login ก่อนจะหลุดกลางงาน (สร้าง Draft ค้างครึ่งทาง)
 *
 * ตัวติดตั้งของแต่ละเครื่องขอบัญชีผ่าน /api/worker (netbayAccount) ด้วยชื่อเครื่อง
 * เครื่องเดิมขอซ้ำได้บัญชีเดิมเสมอ · เครื่องใหม่ได้บัญชีแรกที่ยังว่าง
 * การจองเก็บใน master_records (type netbayAccount, code = ชื่อบัญชี) — unique (type, code) กันสองเครื่องได้บัญชีเดียวกัน
 *
 * ชุดทดลอง: erpkola1 ถึง erpkola10 รหัสผ่านเหมือนชื่อบัญชี (ผู้ใช้สร้างไว้ใน NETBAY)
 * เปลี่ยนชุดได้ด้วย NETBAY_ACCOUNT_POOL บน Vercel รูปแบบ "user1:pass1,user2:pass2"
 */

export const NETBAY_ACCOUNT_TYPE = 'netbayAccount';

export type NetbayAccount = { username: string; password: string };

export function accountPool(env: Record<string, string | undefined> = process.env): NetbayAccount[] {
  const raw = (env.NETBAY_ACCOUNT_POOL ?? '').trim();
  if (raw) {
    return raw.split(',').map((pair) => pair.trim()).filter(Boolean).map((pair) => {
      const i = pair.indexOf(':');
      return i > 0 ? { username: pair.slice(0, i), password: pair.slice(i + 1) } : { username: pair, password: pair };
    });
  }
  return Array.from({ length: 10 }, (_, i) => ({ username: `erpkola${i + 1}`, password: `erpkola${i + 1}` }));
}

type Assignment = { machine: string; assignedAt: string };

const parse = (raw: string | null): Assignment | null => {
  try { return JSON.parse(raw ?? 'null'); } catch { return null; }
};

/** บัญชีที่จองไว้ทั้งหมด — แสดงให้ผู้ดูแลดูว่าเครื่องไหนใช้บัญชีไหน */
export async function netbayAssignments() {
  const rows = await db.select({ code: masterRecords.code, value: masterRecords.value, updatedAt: masterRecords.updatedAt })
    .from(masterRecords).where(eq(masterRecords.type, NETBAY_ACCOUNT_TYPE)).orderBy(asc(masterRecords.code));
  return rows.map((r) => ({ username: r.code ?? '', machine: parse(r.value)?.machine ?? '', updatedAt: r.updatedAt }));
}

/**
 * บัญชีของเครื่องนี้ — เครื่องเดิมได้บัญชีเดิม เครื่องใหม่ได้บัญชีที่ว่างตัวแรก
 * ชื่อเครื่องเทียบแบบไม่สนตัวพิมพ์ (Windows คืน COMPUTERNAME เป็นตัวใหญ่ hostname เป็นตัวเล็ก)
 */
export async function assignNetbayAccount(machineName: string): Promise<NetbayAccount & { reused: boolean }> {
  const machine = machineName.trim().toLowerCase().slice(0, 120);
  if (!machine) throw new Error('ไม่ได้ระบุชื่อเครื่อง');
  const pool = accountPool();
  const taken = await netbayAssignments();

  const mine = taken.find((t) => t.machine === machine && pool.some((p) => p.username === t.username));
  if (mine) {
    await db.update(masterRecords).set({ updatedAt: new Date() })
      .where(and(eq(masterRecords.type, NETBAY_ACCOUNT_TYPE), eq(masterRecords.code, mine.username)));
    return { ...pool.find((p) => p.username === mine.username)!, reused: true };
  }

  for (const account of pool) {
    if (taken.some((t) => t.username === account.username)) continue;
    const value = JSON.stringify({ machine, assignedAt: new Date().toISOString() } satisfies Assignment);
    // อีกเครื่องอาจจองบัญชีนี้ไปพร้อมกันพอดี — unique (type, code) ทำให้ได้เครื่องเดียว ที่แพ้ไปลองบัญชีถัดไป
    const [row] = await db.insert(masterRecords)
      .values({ id: newId('NBA'), type: NETBAY_ACCOUNT_TYPE, code: account.username, name: `NETBAY ${account.username}`, value })
      .onConflictDoNothing()
      .returning({ id: masterRecords.id });
    if (row) return { ...account, reused: false };
  }
  throw new Error(`บัญชี NETBAY ถูกใช้ครบ ${pool.length} เครื่องแล้ว — เพิ่มบัญชีใน NETBAY_ACCOUNT_POOL หรือคืนบัญชีของเครื่องที่เลิกใช้`);
}
