import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { jobSequences } from '@/db/schema';
import { newId } from '@/lib/actions/common';
import { invoiceNumber, RUNNING_INVOICE } from './final';

/**
 * เลข Invoice รันของระบบ (AICHI) — ใช้ตาราง job_sequences ช่อง year = 'INVOICE' · prefix = ชื่อรูปแบบ
 *
 * หน้าเว็บเสนอเลขถัดไป (เลขล่าสุดที่บันทึก + 1) คนแก้เลขได้ก่อนสร้าง Final Invoice
 * บันทึกแล้วเก็บเลขที่ใช้เป็นเลขล่าสุด (เฉพาะเมื่อมากกว่าเดิม — แก้ย้อนไปออกใบเก่าซ้ำไม่ทำให้ตัวนับถอยหลัง)
 * ยังไม่เคยบันทึกเลย เสนอเลขในใบของผู้ขาย
 */
const YEAR = 'INVOICE';

export type InvoiceSuggest = { prefix: string; next: number | null; last: number | null };

export async function suggestInvoiceNo(pattern: string, vendorNo: string): Promise<InvoiceSuggest | null> {
  const prefix = RUNNING_INVOICE[pattern];
  if (!prefix) return null;
  const [row] = await db.select({ last: jobSequences.lastNumber }).from(jobSequences)
    .where(and(eq(jobSequences.year, YEAR), eq(jobSequences.prefix, pattern))).limit(1);
  const last = row?.last ?? null;
  return { prefix, last, next: last !== null ? last + 1 : invoiceNumber(vendorNo) };
}

/** เลขที่ส่งมาจากหน้าเว็บ → "AICHI 351" — ไม่ใช่เลขจำนวนเต็มบวกคืน null */
export function runningInvoiceNo(pattern: string, raw: FormDataEntryValue | null): string | null {
  const prefix = RUNNING_INVOICE[pattern];
  const n = Number(String(raw ?? '').trim());
  if (!prefix || !Number.isInteger(n) || n <= 0 || n > 9_999_999) return null;
  return `${prefix} ${n}`;
}

export async function recordInvoiceNo(pattern: string, invoiceNo: string) {
  const n = invoiceNumber(invoiceNo);
  if (!RUNNING_INVOICE[pattern] || !n) return;
  await db.insert(jobSequences).values({ id: newId('SEQ'), year: YEAR, prefix: pattern, lastNumber: n })
    .onConflictDoUpdate({
      target: [jobSequences.year, jobSequences.prefix],
      set: { lastNumber: sql`greatest(${jobSequences.lastNumber}, ${n})`, updatedAt: new Date() },
    });
}
