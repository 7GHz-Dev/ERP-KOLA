import { randomInt } from 'node:crypto';
import { inArray, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { engineNumbers } from '@/db/schema';
import { newId } from '@/lib/actions/common';

/**
 * เลขเครื่อง 7 หลัก (1000000-9999999) ที่ไม่ซ้ำกับเลขที่ออกไปแล้วทั้งตาราง — แทน engine.db ของโปรแกรม imp
 *
 * worker สร้าง Draft ใบขนเรียกผ่าน /api/worker (engineLookup · engineIssue) ไม่ได้ต่อฐานข้อมูลเอง
 * การออกเลขล็อกทั้งตารางใน transaction เดียว (pg_advisory_xact_lock) — หลายเครื่องออกพร้อมกันก็ไม่ได้เลขซ้ำ
 * ถ้าบันทึกไม่ครบทุกคัน ทั้งชุดถูกยกเลิก ไม่มีเลขค้าง
 */

export type EngineRow = { number: string; full: string; chassis: string; date: string; bl: string };

const LOCK_KEY = 7_242_031;    // ตัวเลขประจำการล็อกออกเลขเครื่อง (pg_advisory_xact_lock)

/** เวลาไทยแบบที่ตารางเดิมเก็บ: YYYY-MM-DD HH:MM:SS */
const bangkokNow = () => new Date(Date.now() + 7 * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);

const toRow = (r: typeof engineNumbers.$inferSelect): EngineRow => ({
  number: r.number, full: r.fullEngine ?? '', chassis: r.chassis, date: r.dateRan ?? '', bl: r.blNo ?? '',
});

/** แถวที่ใช้เลขเหล่านี้ หรือเป็นของ chassis เหล่านี้ — ให้ worker ตรวจเลขซ้ำ/ใช้เลขเดิม */
export async function engineLookup(numbers: string[], chassis: string[]): Promise<EngineRow[]> {
  const conds = [];
  if (numbers.length) conds.push(inArray(engineNumbers.number, numbers));
  if (chassis.length) conds.push(inArray(engineNumbers.chassis, chassis));
  if (!conds.length) return [];
  const rows = await db.select().from(engineNumbers).where(or(...conds));
  return rows.map(toRow);
}

export type IssueInput = {
  taskId: string; jobId: string | null; blNo: string; invoiceNo: string; sourceFile: string;
  /** คันที่ต้องสุ่มเลขใหม่ ตามลำดับรถใน invoice */
  issue: { head: string; chassis: string }[];
  /** คันที่ในไฟล์มีเลขครบแล้วแต่ยังไม่อยู่ในตาราง — บันทึกเพิ่ม */
  add: { number: string; full: string; chassis: string }[];
};

/** สุ่มและบันทึกเลขใหม่ (+ บันทึกเลขที่มีในไฟล์แล้ว) ใน transaction เดียว  คืนเลขใหม่ตามลำดับของ issue */
export async function issueEngineNumbers(input: IssueInput): Promise<{ number: string; full: string }[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${LOCK_KEY})`);
    const when = bangkokNow();
    const base = { dateRan: when, blNo: input.blNo, invoiceNo: input.invoiceNo, sourceFile: input.sourceFile,
      jobId: input.jobId, taskId: input.taskId };

    // เลขที่มีในไฟล์แล้ว — ต้องไม่เป็นของ chassis อื่น
    const keep = input.add.length
      ? await tx.select().from(engineNumbers).where(inArray(engineNumbers.number, input.add.map((a) => a.number)))
      : [];
    const values: (typeof engineNumbers.$inferInsert)[] = [];
    for (const a of input.add) {
      const used = keep.filter((r) => r.number === a.number);
      if (used.some((r) => r.chassis === a.chassis)) continue;
      if (used.length) throw new Error(`เลข ${a.full} ถูกใช้กับ chassis ${used[0].chassis} แล้ว`);
      values.push({ id: newId('ENG'), number: a.number, fullEngine: a.full, chassis: a.chassis, ...base });
    }

    // สุ่มทีละชุด ตัดเลขที่มีในตารางหรือซ้ำกันเองออก แล้วสุ่มแทนจนครบ
    const taken = new Set(input.add.map((a) => a.number));
    const picked: string[] = [];
    for (let round = 0; picked.length < input.issue.length; round++) {
      if (round > 50) throw new Error('สุ่มเลขเครื่องไม่ซ้ำไม่ได้ — ลองใหม่อีกครั้ง');
      const want = input.issue.length - picked.length;
      const candidates = Array.from({ length: want * 2 }, () => String(randomInt(1_000_000, 10_000_000)))
        .filter((n, i, all) => !taken.has(n) && all.indexOf(n) === i);
      const used = new Set((await tx.select({ n: engineNumbers.number }).from(engineNumbers)
        .where(inArray(engineNumbers.number, candidates))).map((r) => r.n));
      for (const n of candidates) {
        if (picked.length >= input.issue.length) break;
        if (used.has(n)) continue;
        picked.push(n);
        taken.add(n);
      }
    }
    const issued = input.issue.map((c, i) => ({ number: picked[i], full: `${c.head}-${picked[i]}` }));
    input.issue.forEach((c, i) => values.push({
      id: newId('ENG'), number: issued[i].number, fullEngine: issued[i].full, chassis: c.chassis, ...base,
    }));
    if (values.length) await tx.insert(engineNumbers).values(values);
    return issued;
  });
}
