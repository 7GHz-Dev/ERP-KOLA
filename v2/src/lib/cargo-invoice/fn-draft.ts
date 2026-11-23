import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { masterRecords, users } from '@/db/schema';
import { newId } from '@/lib/actions/common';

/**
 * Draft FN Invoice (NORMAL) — ค่าที่กรอกในฟอร์มไว้ก่อน ยังไม่ออกเลขเครื่อง ยังไม่เป็นไฟล์ Final Invoice
 *
 * เก็บงานละหนึ่งชุดใน master_records (type=fnDrafts · code=jobId · value=JSON) แบบเดียวกับ carCodes
 * ไม่ต้องเพิ่มตาราง — เปิด Create FN Invoice ของงานนี้อีกครั้งระบบโหลด Draft มาให้แทนการให้ AI อ่านไฟล์ใหม่
 * บันทึก Final Invoice สำเร็จแล้วลบ Draft ทิ้ง
 */
export const FN_DRAFT_TYPE = 'fnDrafts';

export type FnDraftCar = {
  brand: string; model: string; chassis: string; weight: string; year: string; engine: string;
  cc: string; fuel: string; amount: string; container: string;
  /** เลขเครื่อง 7 หลักจากปุ่มสุ่ม Engine (ยังไม่บันทึกลงตาราง) */
  engineNo: string;
};

export type FnDraft = {
  shipperId: string; currency: string; invoiceDate: string; invoiceNo: string;
  cars: FnDraftCar[];
  /** ช่องที่ระบบเติมยังไม่มีคนแก้ ("แถว:ช่อง") */
  auto: string[];
  /** พิกัดที่เลือกไว้ (ลำดับเดียวกับรถ) */
  tariffs: string[];
  /** ชื่อไฟล์ OG Invoice ตอนบันทึก Draft — บอกผู้ใช้ว่า Draft นี้กรอกจากไฟล์ไหน */
  fileName: string;
};

export type FnDraftInfo = FnDraft & { savedAt: string; savedBy: string };

const s = (v: unknown, max = 200) => String(v ?? '').slice(0, max);
const CAR_KEYS = ['brand', 'model', 'chassis', 'weight', 'year', 'engine', 'cc', 'fuel', 'amount', 'container', 'engineNo'] as const;

/** ทำความสะอาดข้อมูลจากหน้าเว็บ — เก็บเป็นข้อความตามที่พิมพ์ (Draft ยังไม่ต้องครบ/ถูกรูปแบบ) */
export function cleanDraft(raw: unknown): FnDraft {
  const o = (raw ?? {}) as Record<string, unknown>;
  const cars = (Array.isArray(o.cars) ? o.cars.slice(0, 200) : []).map((c) => {
    const x = (c ?? {}) as Record<string, unknown>;
    return Object.fromEntries(CAR_KEYS.map((k) => [k, s(x[k], 120)])) as FnDraftCar;
  });
  return {
    shipperId: s(o.shipperId, 80), currency: s(o.currency, 3).toUpperCase(), invoiceDate: s(o.invoiceDate, 10),
    invoiceNo: s(o.invoiceNo, 60).toUpperCase(), cars,
    auto: (Array.isArray(o.auto) ? o.auto : []).map((k) => s(k, 20)).filter((k) => /^\d+:[a-zA-Z]+$/.test(k)).slice(0, 3000),
    tariffs: (Array.isArray(o.tariffs) ? o.tariffs : []).map((t) => s(t, 12)).slice(0, 200),
    fileName: s(o.fileName, 200),
  };
}

export async function loadFnDraft(jobId: string): Promise<FnDraftInfo | null> {
  const [row] = await db.select({ value: masterRecords.value, updatedAt: masterRecords.updatedAt, by: masterRecords.description })
    .from(masterRecords).where(and(eq(masterRecords.type, FN_DRAFT_TYPE), eq(masterRecords.code, jobId))).limit(1);
  if (!row?.value) return null;
  try {
    return { ...cleanDraft(JSON.parse(row.value)), savedAt: row.updatedAt.toISOString(), savedBy: row.by ?? '' };
  } catch { return null; }
}

export async function saveFnDraft(jobId: string, jobNo: string, userId: string, draft: FnDraft) {
  const [u] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, userId)).limit(1);
  const value = JSON.stringify(draft);
  const by = u?.name ?? '';
  const now = new Date();
  await db.insert(masterRecords)
    .values({ id: newId('FND'), type: FN_DRAFT_TYPE, code: jobId, name: `Draft FN Invoice ${jobNo}`, description: by, value, isActive: false })
    .onConflictDoUpdate({ target: [masterRecords.type, masterRecords.code], set: { value, description: by, updatedAt: now } });
  return now.toISOString();
}

export async function deleteFnDraft(jobId: string) {
  await db.delete(masterRecords).where(and(eq(masterRecords.type, FN_DRAFT_TYPE), eq(masterRecords.code, jobId)));
}
