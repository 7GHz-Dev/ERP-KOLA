/**
 * ค่าใช้จ่ายพิเศษจาก ERP SHIPME — ตรวจข้อมูลที่ส่งเข้ามา + ชื่อสถานะ (ฟังก์ชันล้วน)
 *
 * SHIPME ส่งมาเมื่อแผนกบัญชีกดจัดชุดใบแจ้งหนี้ของ BL นั้น (สเปกเต็ม: docs/SHIPME-SPECIAL-CHARGES-API.md)
 * Sale เจรจาแล้วบันทึกยอดที่ตกลงพร้อมหลักฐาน → SALE SUPERVISOR ตรวจ อนุมัติ / ส่งกลับ
 */

export const CHARGE_STATUS = {
  NEW: 'ใหม่จาก SHIPME',
  NEGOTIATING: 'กำลังเจรจา',
  SUBMITTED: 'รอ Supervisor ตรวจ',
  APPROVED: 'อนุมัติแล้ว',
  RETURNED: 'ส่งกลับแก้',
} as const;
export type ChargeStatus = keyof typeof CHARGE_STATUS;

/** Sale แก้ได้เมื่อยังไม่ส่งตรวจ หรือถูกส่งกลับ */
export const SALE_EDITABLE: ChargeStatus[] = ['NEW', 'NEGOTIATING', 'RETURNED'];

export const MAX_ITEMS = 100;
export const MAX_ATTACHMENTS = 10;
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = /^(image\/(jpeg|png|webp|gif|heic)|application\/pdf)$/i;

export type ShipmeItem = { code: string | null; description: string; quantity: number; amount: number; note: string | null };
export type ShipmeAttachment = { fileName: string; contentType: string; url: string | null; dataBase64: string | null };
export type ShipmePayload = {
  batchId: string; blNo: string; invoiceNo: string | null; issuedAt: string | null; currency: string;
  note: string | null; items: ShipmeItem[]; attachments: ShipmeAttachment[];
};

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : '');
const money = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};

/** ตรวจ JSON ที่ SHIPME ส่งมา — ผิดตรงไหนบอกชื่อช่องให้ฝั่ง SHIPME แก้ได้ทันที */
export function parseShipmePayload(body: unknown): { ok: true; data: ShipmePayload } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body ต้องเป็น JSON object' };
  const b = body as Record<string, unknown>;
  const batchId = str(b.batchId, 120);
  const blNo = str(b.blNo, 120).replace(/\s/g, '').toUpperCase();
  if (!batchId) return { ok: false, error: 'batchId: ต้องมี (เลขชุดใบแจ้งหนี้ ใช้ซ้ำเพื่ออัปเดตชุดเดิม)' };
  if (!blNo) return { ok: false, error: 'blNo: ต้องมี' };
  const issuedAt = str(b.issuedAt, 40) || null;
  if (issuedAt && Number.isNaN(new Date(issuedAt).getTime())) return { ok: false, error: 'issuedAt: ต้องเป็นวันเวลา ISO 8601' };
  const currency = (str(b.currency, 3) || 'THB').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: 'currency: ต้องเป็นรหัส 3 ตัว เช่น THB' };

  if (!Array.isArray(b.items) || !b.items.length) return { ok: false, error: 'items: ต้องมีอย่างน้อย 1 รายการ' };
  if (b.items.length > MAX_ITEMS) return { ok: false, error: `items: ไม่เกิน ${MAX_ITEMS} รายการ` };
  const items: ShipmeItem[] = [];
  for (const [i, raw] of b.items.entries()) {
    const it = (raw ?? {}) as Record<string, unknown>;
    const description = str(it.description, 300);
    const amount = money(it.amount);
    const quantity = it.quantity === undefined ? 1 : money(it.quantity);
    if (!description) return { ok: false, error: `items[${i}].description: ต้องมี` };
    if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: `items[${i}].amount: ต้องเป็นตัวเลขไม่ติดลบ` };
    if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, error: `items[${i}].quantity: ต้องมากกว่า 0` };
    items.push({ code: str(it.code, 40) || null, description, quantity, amount, note: str(it.note, 500) || null });
  }

  const rawFiles = b.attachments === undefined ? [] : b.attachments;
  if (!Array.isArray(rawFiles)) return { ok: false, error: 'attachments: ต้องเป็น array' };
  if (rawFiles.length > MAX_ATTACHMENTS) return { ok: false, error: `attachments: ไม่เกิน ${MAX_ATTACHMENTS} ไฟล์` };
  const attachments: ShipmeAttachment[] = [];
  for (const [i, raw] of rawFiles.entries()) {
    const a = (raw ?? {}) as Record<string, unknown>;
    const fileName = str(a.fileName, 200);
    const contentType = str(a.contentType, 80) || guessType(fileName);
    const url = str(a.url, 2000) || null;
    const dataBase64 = typeof a.dataBase64 === 'string' ? a.dataBase64.replace(/^data:[^;]+;base64,/, '') : null;
    if (!fileName) return { ok: false, error: `attachments[${i}].fileName: ต้องมี` };
    if (!ALLOWED_TYPES.test(contentType)) return { ok: false, error: `attachments[${i}].contentType: รับเฉพาะรูป (jpeg/png/webp/gif/heic) หรือ PDF` };
    if (!url && !dataBase64) return { ok: false, error: `attachments[${i}]: ต้องมี url หรือ dataBase64 อย่างใดอย่างหนึ่ง` };
    if (url && !/^https:\/\//i.test(url)) return { ok: false, error: `attachments[${i}].url: ต้องเป็น https://` };
    if (dataBase64 && dataBase64.length * 0.75 > MAX_FILE_BYTES) return { ok: false, error: `attachments[${i}]: ไฟล์ใหญ่เกิน 8 MB` };
    attachments.push({ fileName, contentType, url, dataBase64 });
  }

  return {
    ok: true,
    data: { batchId, blNo, invoiceNo: str(b.invoiceNo, 120) || null, issuedAt, currency, note: str(b.note, 2000) || null, items, attachments },
  };
}

export function guessType(name: string) {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', pdf: 'application/pdf' } as Record<string, string>)[ext] ?? '';
}

/** ยอดรวม — amount ของแต่ละรายการคือยอดของรายการนั้นแล้ว (quantity มีไว้แสดงเท่านั้น) */
export const itemsTotal = (amounts: number[]) =>
  amounts.reduce((s, a) => s + Math.round(a * 100), 0) / 100;
