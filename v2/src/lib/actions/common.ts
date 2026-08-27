import { randomBytes } from 'node:crypto';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { activityLog, statusHistory } from '@/db/schema';

export const newId = (prefix: string) =>
  `${prefix}-${randomBytes(10).toString('hex').toUpperCase()}`;

export function text(value: FormDataEntryValue | null, maxLength = 1000): string {
  const s = value === null ? '' : String(value).trim();
  return s.length > maxLength ? s.slice(0, maxLength) : s;
}

export function required(value: FormDataEntryValue | null, label: string, maxLength = 1000): string {
  const s = text(value, maxLength);
  if (!s) throw new Error(`กรุณากรอก${label}`);
  return s;
}

export function number(value: FormDataEntryValue | null, fallback = 0): number {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

/** วันที่จากช่อง input[type=date] คืน null ถ้าว่างหรือรูปแบบผิด */
export function day(value: FormDataEntryValue | null): string | null {
  const s = text(value, 40);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export async function logActivity(
  userId: string, action: string, entityType: string, entityId: string, detail?: unknown,
) {
  await db.insert(activityLog).values({
    id: newId('LOG'),
    userId, action, entityType, entityId,
    detail: detail === undefined ? null : JSON.stringify(detail),
  });
}

export async function recordStatus(
  jobId: string, fromStatus: string | null, toStatus: string, note: string, actorId: string,
) {
  await db.insert(statusHistory).values({
    id: newId('STH'),
    jobId, fromStatus, toStatus, note, actorId,
  });
}

/* ---------- แจ้งข้อผิดพลาดให้ผู้ใช้อ่านออก ---------- */

/** ข้อผิดพลาดของ Next เอง เช่น redirect หรือ notFound ต้องปล่อยผ่าน ไม่ใช่ของผู้ใช้ */
function isFrameworkError(error: unknown) {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string'
    && (digest.startsWith('NEXT_REDIRECT')
      || digest === 'NEXT_NOT_FOUND'
      || digest.startsWith('NEXT_HTTP_ERROR_FALLBACK'));
}

/**
 * เส้นทางกลับจากหัว referer
 *
 * รับเฉพาะพาธภายในเว็บนี้ ตัด host ทิ้งเสมอ และกัน "//" ที่เบราว์เซอร์
 * ตีความเป็นลิงก์ข้ามโดเมน ไม่งั้นจะกลายเป็นช่องพาผู้ใช้ออกไปเว็บอื่น
 */
function samePath(referer: string | null): string {
  if (!referer) return '/overview';
  try {
    const url = new URL(referer);
    if (!url.pathname.startsWith('/') || url.pathname.startsWith('//')) return '/overview';
    const params = url.searchParams;
    params.delete('err');
    params.delete('ok');
    params.delete('created');
    const q = params.toString();
    return `${url.pathname}${q ? `?${q}` : ''}`;
  } catch {
    return '/overview';
  }
}

/**
 * ห่อคำสั่งทุกตัวที่ผูกกับปุ่มบนหน้าเว็บ
 *
 * ข้อผิดพลาดที่ผู้ใช้แก้เองได้ เช่น "ต้องมีไฟล์ Final Invoice ก่อน" ถ้าปล่อยให้ throw
 * ผู้ใช้จะเจอหน้า 500 Internal Server Error เปล่า ๆ ซึ่งอ่านไม่ออกว่าต้องทำอะไรต่อ
 * ตรงนี้พากลับหน้าเดิมพร้อมข้อความแทน และยังเป็น POST-redirect-GET ที่กดรีเฟรชซ้ำได้
 */
export async function runAction<T>(work: () => Promise<T>): Promise<T | undefined> {
  try {
    return await work();
  } catch (error) {
    if (isFrameworkError(error)) throw error;
    const message = error instanceof Error && error.message ? error.message : 'ทำรายการไม่สำเร็จ';
    const base = samePath((await headers()).get('referer'));
    redirect(`${base}${base.includes('?') ? '&' : '?'}err=${encodeURIComponent(message.slice(0, 300))}`);
  }
}
