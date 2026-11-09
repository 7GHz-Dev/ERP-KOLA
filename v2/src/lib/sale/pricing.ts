/**
 * ราคาเก็บลูกค้า — คำนวณและตรวจรายการ (ฟังก์ชันล้วน ใช้ได้ทั้งหน้าจอและเซิร์ฟเวอร์)
 *
 * รายการ = ชื่อรายการ × จำนวน × ราคาต่อหน่วย · หน่วยเป็น "ต่อตู้" หรือ "ต่องาน"
 * ต่อตู้: จำนวนตั้งต้น = จำนวนตู้ของงาน (แก้ได้) · ต่องาน: จำนวนตั้งต้น = 1
 * เงินคิดเป็นสตางค์ (จำนวนเต็ม) ตอนรวม กันทศนิยมลอย ๆ แบบ 0.1 + 0.2
 */

export type PriceUnit = 'CONTAINER' | 'JOB';
export const UNIT_LABEL: Record<PriceUnit, string> = { CONTAINER: 'ต่อตู้', JOB: 'ต่องาน' };

export type PriceLineInput = { description: string; unit: PriceUnit; quantity: number; unitPrice: number };
export type PriceLine = PriceLineInput & { amount: number };

/** รายการที่ใช้บ่อย — ตัวเลือกในช่องชื่อรายการ (พิมพ์ชื่ออื่นได้) */
export const PRICE_PRESETS: Array<{ description: string; unit: PriceUnit }> = [
  { description: 'ค่าพิธีการศุลกากร (Customs clearance)', unit: 'JOB' },
  { description: 'ค่าบริการนำเข้า (Import handling)', unit: 'CONTAINER' },
  { description: 'ค่าขนส่ง (Transport)', unit: 'CONTAINER' },
  { description: 'ค่าเอกสาร (Documentation)', unit: 'JOB' },
  { description: 'ค่าตรวจปล่อย (Inspection)', unit: 'JOB' },
  { description: 'ค่ายกขน (Lift on / Lift off)', unit: 'CONTAINER' },
];

const satang = (n: number) => Math.round(n * 100);

export function lineAmount(l: Pick<PriceLineInput, 'quantity' | 'unitPrice'>): number {
  return Math.round(l.quantity * 100) * satang(l.unitPrice) / 10000;
}

export function priceTotal(lines: Array<Pick<PriceLineInput, 'quantity' | 'unitPrice'>>): number {
  return lines.reduce((s, l) => s + Math.round(lineAmount(l) * 100), 0) / 100;
}

/** ตรวจรายการที่ส่งมา — คืนรายการที่ใช้ได้พร้อมยอด หรือข้อผิดพลาดแรกที่เจอ */
export function validateLines(raw: unknown): { lines: PriceLine[]; total: number; error: string | null } {
  if (!Array.isArray(raw)) return { lines: [], total: 0, error: 'รูปแบบรายการราคาไม่ถูกต้อง' };
  const lines: PriceLine[] = [];
  for (const [i, r] of raw.slice(0, 50).entries()) {
    const o = (r ?? {}) as Record<string, unknown>;
    const description = String(o.description ?? '').trim().slice(0, 200);
    const unit = o.unit === 'CONTAINER' ? 'CONTAINER' : o.unit === 'JOB' ? 'JOB' : null;
    const quantity = Number(String(o.quantity ?? '').replace(/,/g, ''));
    const unitPrice = Number(String(o.unitPrice ?? '').replace(/,/g, ''));
    const blank = !description && !o.unitPrice;
    if (blank) continue; // แถวว่างที่เพิ่มไว้แล้วไม่ได้กรอก ข้ามไป
    const row = `แถว ${i + 1}`;
    if (!description) return { lines, total: 0, error: `${row}: ใส่ชื่อรายการ` };
    if (!unit) return { lines, total: 0, error: `${row}: เลือกหน่วย (ต่อตู้ / ต่องาน)` };
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 10000) return { lines, total: 0, error: `${row}: จำนวนต้องมากกว่า 0` };
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 100_000_000) return { lines, total: 0, error: `${row}: ราคาต่อหน่วยไม่ถูกต้อง` };
    lines.push({ description, unit, quantity, unitPrice, amount: lineAmount({ quantity, unitPrice }) });
  }
  return { lines, total: priceTotal(lines), error: null };
}

export const baht = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
