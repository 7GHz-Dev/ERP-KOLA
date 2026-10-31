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

/** บัญชี NETBAY ของตัว monitor ใบขน — ค่าบน Vercel รูปแบบ "user:pass" แยกจากชุดบัญชีประจำเครื่อง */
export function monitorAccount(env: Record<string, string | undefined> = process.env): NetbayAccount {
  const raw = (env.NETBAY_MONITOR_ACCOUNT ?? '').trim();
  const i = raw.indexOf(':');
  if (i <= 0) throw new Error('ยังไม่ได้ตั้ง NETBAY_MONITOR_ACCOUNT (รูปแบบ user:pass) บน Vercel');
  return { username: raw.slice(0, i), password: raw.slice(i + 1) };
}

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

export type NetbayChoice = { username: string; kind: 'monitor' | 'pool'; machine: string };

/**
 * บัญชีที่ให้เลือกก่อนกด "สร้าง Draft" / "Refresh" — ไม่มีรหัสผ่าน (ส่งให้หน้าเว็บ)
 * บอกเครื่องที่จองบัญชีนั้นไว้ด้วย เลือกบัญชีของเครื่องที่กำลังใช้อยู่ = เครื่องนั้นหลุดจาก NETBAY
 */
export async function netbayChoices(): Promise<NetbayChoice[]> {
  const taken = await netbayAssignments();
  const out: NetbayChoice[] = [];
  try {
    out.push({ username: monitorAccount().username, kind: 'monitor', machine: '' });
  } catch { /* ยังไม่ได้ตั้งบัญชี monitor — เลือกได้แค่ชุดประจำเครื่อง */ }
  for (const a of accountPool()) {
    if (out.some((o) => o.username === a.username)) continue;
    out.push({ username: a.username, kind: 'pool', machine: taken.find((t) => t.username === a.username)?.machine ?? '' });
  }
  return out;
}

/**
 * รหัสผ่านของบัญชีที่ผู้ใช้เลือก — ส่งให้ worker ผ่าน /api/worker เท่านั้น (ไม่ส่งให้หน้าเว็บ)
 * รับเฉพาะบัญชีในชุดที่ตั้งไว้ (monitor + NETBAY_ACCOUNT_POOL) ชื่ออื่นไม่ให้
 */
export function netbayCredentials(username: string | null | undefined): NetbayAccount | null {
  const name = String(username ?? '').trim();
  if (!name) return null;
  try {
    const m = monitorAccount();
    if (m.username === name) return m;
  } catch { /* ไม่มีบัญชี monitor */ }
  return accountPool().find((a) => a.username === name) ?? null;
}
