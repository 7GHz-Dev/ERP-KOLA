/**
 * Waiting BL — ฟังก์ชันล้วน ใช้ได้ทั้งหน้าจอและฝั่งเซิร์ฟเวอร์ (ไม่แตะฐานข้อมูล)
 */
import { normalizeBlNo } from '@/lib/intake-checks';

export const WAITING_CHANNELS = ['LINE', 'WhatsApp', 'โทรศัพท์', 'อีเมลลูกค้า', 'เอกสารจากลูกค้า', 'อื่น ๆ'];

/** คีย์จับคู่เลข BL — ตัวใหญ่ ไม่มีช่องว่าง (ตัวเดียวกับที่หน้ารับงานใช้ตรวจ BL ซ้ำ) */
export const blKey = (value: string) => normalizeBlNo(value);

/**
 * วันที่ที่คนพิมพ์มา → YYYY-MM-DD
 *
 * รับ 2026-10-30 · 30/10/2026 · 30/10/2569 (พ.ศ.) · 30/10/69 · 30-10-26 · 30.10.69
 * ปีสองหลัก 50 ขึ้นไปถือเป็น พ.ศ. (69 = 2569 = 2026) ต่ำกว่านั้นถือเป็น ค.ศ. (26 = 2026)
 * อ่านไม่ได้คืน null — ผู้เรียกตัดสินเองว่าจะปล่อยว่างหรือแจ้งผิด
 */
export function parseLooseDate(raw: string): string | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  let y: number; let m: number; let d: number;
  const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (isoMatch) {
    [y, m, d] = [Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3])];
  } else if (dmy) {
    [d, m, y] = [Number(dmy[1]), Number(dmy[2]), Number(dmy[3])];
    if (dmy[3].length === 2) y = y >= 50 ? 2500 + y : 2000 + y;
  } else {
    return null;
  }
  if (y > 2400) y -= 543;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * เลขตู้หลายตู้ในช่องเดียว → รายการ (ตัวใหญ่ ไม่ซ้ำ)
 *
 * จับรูปแบบมาตรฐาน (อักษร 4 ตัว + ตัวเลข 7 หลัก) ก่อน เพราะคนชอบเว้นวรรคกลางเลข เช่น "TCNU 3365522"
 * ถ้าแยกด้วยช่องว่างตรง ๆ ตู้เดียวจะกลายเป็นสองชิ้น ที่เหลือที่ไม่เข้ารูปแบบค่อยแยกด้วยตัวคั่น
 */
export function splitContainers(raw: string): string[] {
  const text = String(raw ?? '').toUpperCase();
  const found: string[] = [];
  const rest = text.replace(/([A-Z]{4})[\s-]*(\d{6})[\s-]*(\d)/g, (_m, a, b, c) => { found.push(`${a}${b}${c}`); return ' '; });
  rest.split(/[\s,;/]+/).map((c) => c.replace(/[^A-Z0-9]/g, '')).filter(Boolean).forEach((c) => found.push(c));
  return [...new Set(found)];
}

export type WaitingDraft = {
  blNo: string; customer: string; shipper: string; vessel: string; voyage: string;
  eta: string | null; etaRaw: string; containerNos: string; product: string; note: string;
};

/** คอลัมน์ของการวางจาก Excel — ลำดับนี้ตายตัว บอกไว้บนหน้าจอด้วย */
export const PASTE_COLUMNS = ['BL No.', 'ลูกค้า', 'Shipper', 'เรือ', 'Voyage', 'ETA', 'เลขตู้', 'สินค้า', 'หมายเหตุ'];

/**
 * แปลงข้อความที่วางจาก Excel (คั่นด้วย Tab) เป็นรายการ — บรรทัดละ BL
 * ไม่มี Tab ในบรรทัดเลยก็ยอมรับ "|" เป็นตัวคั่นแทน
 * บรรทัดหัวตาราง (ช่องแรกเขียนว่า BL ...) ข้ามให้เอง
 */
export function parsePaste(text: string): { rows: WaitingDraft[]; errors: string[] } {
  const rows: WaitingDraft[] = [];
  const errors: string[] = [];
  String(text ?? '').split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    const cells = (line.includes('\t') ? line.split('\t') : line.split('|')).map((c) => c.trim());
    const [bl = '', customer = '', shipper = '', vessel = '', voyage = '', eta = '', containers = '', product = '', ...rest] = cells;
    if (/^b\/?l\b/i.test(bl) && !/\d/.test(bl)) return; // หัวตาราง
    if (!bl) { errors.push(`บรรทัด ${index + 1}: ไม่มีเลข BL`); return; }
    const etaIso = parseLooseDate(eta);
    if (eta && !etaIso) errors.push(`บรรทัด ${index + 1}: อ่านวันที่ ETA "${eta}" ไม่ได้ (เว้นว่างไว้)`);
    rows.push({
      blNo: bl, customer, shipper, vessel, voyage, eta: etaIso, etaRaw: eta,
      containerNos: splitContainers(containers).join(' '), product, note: rest.join(' ').trim(),
    });
  });
  return { rows, errors };
}
