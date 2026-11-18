import { addDays } from '@/lib/format';

/**
 * วันฟรี DEM / DET / Storage — ใช้ได้ทั้งฝั่งเซิร์ฟเวอร์และเบราว์เซอร์
 *
 *   DEM / DET  null = N/A (ยังไม่ได้กรอก) · วันสุดท้าย = วันตั้งต้น + จำนวนวัน (แบบคอลัมน์ DEM DATE เดิม)
 *   Storage    ค่าตั้งต้น 3 วัน นับ ETA เป็นวันที่ 1 → Last Date Free Time = ETA + จำนวนวัน
 *              เช่น ETA 20/11/2026 ฟรี 3 วัน (20 · 21 · 22) หมด free time / เริ่มมีค่าใช้จ่าย 23/11/2026
 */
export const STORAGE_DEFAULT_DAYS = 3;

/** จำนวนวันสำหรับแสดง — null = N/A */
export const daysText = (n: number | null | undefined) => (n === null || n === undefined ? 'N/A' : String(n));

/** วันสุดท้ายของ free time (YYYY-MM-DD) — ไม่มีวันตั้งต้นหรือยังไม่ได้กรอกจำนวนวันคืน null */
export function freeLastDate(start: string | null | undefined, days: number | null | undefined): string | null {
  if (!start || days === null || days === undefined) return null;
  return addDays(start, days);
}

export const storageLastDate = (eta: string | null | undefined, days: number | null | undefined) =>
  freeLastDate(eta, days ?? STORAGE_DEFAULT_DAYS);

const diff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

export type Urgency = { level: 'ok' | 'urgent' | 'over'; left: number; text: string };

/**
 * สถานะ free time เทียบวันนี้ — Urgent ตั้งแต่เหลือ 1 วันก่อนหมด (วันสุดท้ายก่อนมีค่าใช้จ่าย) ถึงวันที่เริ่มมีค่าใช้จ่าย
 * เกินแล้ว = เลยวันที่เริ่มมีค่าใช้จ่ายไปแล้ว
 */
export function freeUrgency(lastDate: string | null, today: string): Urgency | null {
  if (!lastDate) return null;
  const left = diff(lastDate, today);
  if (left < 0) return { level: 'over', left, text: `เกิน free time ${-left} วัน` };
  if (left === 0) return { level: 'urgent', left, text: 'Urgent · เริ่มมีค่าใช้จ่ายวันนี้' };
  if (left === 1) return { level: 'urgent', left, text: 'Urgent · หมด free time พรุ่งนี้' };
  return { level: 'ok', left, text: `เหลือ ${left} วัน` };
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
