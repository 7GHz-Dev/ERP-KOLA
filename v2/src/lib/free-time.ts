import { addDays } from '@/lib/format';

/**
 * วันฟรี DEM / DET / Storage — ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และเบราว์เซอร์
 *
 * นับ ETA เป็นวันที่ 1 ทุกตัว — Last Date = (ETA + จำนวนวัน) − 1 วัน = วันสุดท้ายที่ยังฟรี
 *   DEM        Last Date of DEM = ETA + DEM FREE − 1
 *   DET        Last Date of DET = ETA + DET FREE − 1 (ทั้งแบบปกติและ Combine)
 *              Combine = DEM กับ DET ใช้จำนวนวันเดียวกัน (ปุ่มที่หัวข้อ DET)
 *   Storage    ตั้งต้น 3 วัน → Last Date = ETA + 3 − 1 เช่น ETA 20/11/2026 → 22/11/2026 (23/11 เริ่มมีค่าใช้จ่าย)
 *   null = N/A (ยังไม่ได้กรอก) · 0 วัน = ไม่มีวันฟรี
 */
export const STORAGE_DEFAULT_DAYS = 3;

/** จำนวนวันสำหรับแสดง — null = N/A */
export const daysText = (n: number | null | undefined) => (n === null || n === undefined ? 'N/A' : String(n));

/** วันสุดท้ายของ free time (YYYY-MM-DD) — ไม่มีวันตั้งต้นหรือยังไม่ได้กรอกจำนวนวันคืน null */
export function freeLastDate(start: string | null | undefined, days: number | null | undefined): string | null {
  if (!start || days === null || days === undefined || days <= 0) return null;
  return addDays(start, days - 1);
}

export const storageLastDate = (eta: string | null | undefined, days: number | null | undefined) =>
  freeLastDate(eta, days ?? STORAGE_DEFAULT_DAYS);

const diff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

export type Urgency = { level: 'ok' | 'urgent' | 'over'; left: number; text: string };

/**
 * สถานะ free time เทียบวันนี้ (lastDate = วันสุดท้ายที่ยังฟรี)
 *   Urgent  วันนี้หรือพรุ่งนี้เป็นวันสุดท้าย · เกินแล้ว = เลยวันสุดท้าย (มีค่าใช้จ่ายแล้ว)
 */
export function freeUrgency(lastDate: string | null, today: string): Urgency | null {
  if (!lastDate) return null;
  const left = diff(lastDate, today);
  if (left < 0) return { level: 'over', left, text: `เกิน free time ${-left} วัน` };
  if (left === 0) return { level: 'urgent', left, text: 'Urgent · วันสุดท้ายของ free time' };
  if (left === 1) return { level: 'urgent', left, text: 'Urgent · free time หมดพรุ่งนี้' };
  return { level: 'ok', left, text: `เหลือ ${left + 1} วัน` };
}

/**
 * จำนวนวันจากฟอร์ม — ช่องไม่ได้ส่งมา = คงค่าเดิม · ว่าง / N/A = null · ติดลบหรือไม่ใช่ตัวเลข = error
 */
export function readDays(formData: FormData, field: string, current: number | null, label: string): number | null {
  if (!formData.has(field)) return current;
  const raw = String(formData.get(field) ?? '').trim();
  if (!raw || /^n\/?a$/i.test(raw) || raw === '-') return null;
  const n = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} ต้องเป็นจำนวนวัน 0 ขึ้นไป (ว่าง = N/A)`);
  return Math.round(n);
}
