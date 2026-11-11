import { timingSafeEqual } from 'node:crypto';

/**
 * คีย์ของ ERP SHIPME (Vercel env SHIPME_API_KEY) — ใช้ร่วมกันทุก endpoint ใต้ /api/shipme
 * ไม่ใช้ session ของผู้ใช้ · เทียบแบบเวลาคงที่
 */
export function shipmeAuthorized(request: Request) {
  const key = process.env.SHIPME_API_KEY ?? '';
  const got = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!key || !got) return false;
  const a = Buffer.from(got); const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}
