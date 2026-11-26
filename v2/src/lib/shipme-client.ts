/**
 * เรียก ERP SHIPME (POST /api · action แบบเดียวกับระบบเดิมของ SHIPME) — สเปก: docs/SHIPME-TRANSPORT-REQUEST.md
 *
 * ยืนยันตัวด้วย SHIPME_SYNC_TOKEN (= KOLA_SYNC_TOKEN ฝั่ง SHIPME) ไม่ใช้ session ผู้ใช้
 * ตั้งไม่ครบ = ปิดการเชื่อม ไม่ยิงอะไรออกไป (ระบบทดสอบ erp-kola-test ตั้งใจไม่ตั้งค่าไว้)
 */
const TIMEOUT_MS = 20000;

export function shipmeConfigured(): boolean {
  return Boolean(process.env.SHIPME_API_URL?.trim() && process.env.SHIPME_SYNC_TOKEN?.trim());
}

/** ข้อความภาษาไทยของ error code จาก SHIPME */
const ERRORS: Record<string, string> = {
  sync_not_configured: 'SHIPME ยังไม่เปิดรับข้อมูลจาก KOLA (ยังไม่ได้ตั้ง KOLA_SYNC_TOKEN)',
  invalid_token: 'กุญแจเชื่อม SHIPME ไม่ตรงกัน',
  no_rows: 'ไม่มีแถวให้ส่ง',
  file_too_large: 'ไฟล์ใหญ่เกิน 20MB',
  pdf_only: 'รับเฉพาะไฟล์ PDF',
  bad_kind: 'ประเภทเอกสารไม่ถูกต้อง',
  bad_bl: 'ไม่มีเลข BL',
  file_missing: 'ไม่พบไฟล์ที่อัปขึ้น SHIPME — ลองอัปใหม่',
  not_found: 'ไม่พบรายการนี้ใน SHIPME',
  storage_failed: 'SHIPME เก็บไฟล์ไม่สำเร็จ',
};

export async function shipmeCall<T extends object>(action: string, body: Record<string, unknown>):
  Promise<({ ok: true } & T) | { ok: false; error: string }> {
  if (!shipmeConfigured()) return { ok: false, error: 'ยังไม่ได้ตั้งค่าการเชื่อม SHIPME' };
  try {
    const res = await fetch(process.env.SHIPME_API_URL!.trim(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, action, token: process.env.SHIPME_SYNC_TOKEN!.trim() }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    const data = await res.json().catch(() => null) as ({ ok?: boolean; error?: string } & T) | null;
    if (!data) return { ok: false, error: `ติดต่อ SHIPME ไม่ได้ (HTTP ${res.status})` };
    if (!data.ok) return { ok: false, error: ERRORS[data.error ?? ''] ?? `SHIPME ตอบกลับ: ${data.error ?? 'ไม่สำเร็จ'}` };
    return data as { ok: true } & T;
  } catch {
    return { ok: false, error: 'ติดต่อ SHIPME ไม่ได้' };
  }
}
