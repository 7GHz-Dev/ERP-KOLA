import { claimText, type ClaimTextInput } from './do-charges';

export function claimAmountInput(value: string): string | null {
  const raw = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.replace(/,/g, '').split('.');
  const integer = whole.replace(/^0+(?=\d)/, '');
  if (integer.length > 16) return null;
  return `${integer}.${fraction.padEnd(2, '0')}`;
}

/** ข้อความเบิกหลายรายการต่อกัน — ยอดค่า DO ที่พิมพ์อยู่ (ยังไม่ตรวจรูป) + หัวข้อค่าใช้จ่ายที่บันทึกไว้ */
export function allClaimText(items: ClaimTextInput[]): string {
  return items.map(item => claimText({
    ...item,
    amount: claimAmountInput(String(item.amount ?? '')),
  })).join('\n\n');
}

/**
 * ยอดค่า DO ของแต่ละรายการที่เลือก — หัวข้อค่าใช้จ่าย (มัดจำ · DEM · DET …) บันทึกแยกทีละหัวข้อแล้ว
 * จึงไม่ต้องส่งมากับฟอร์มนี้
 */
export function readBatchClaims(data: FormData) {
  const ids = data.getAll('jobId');
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw new Error('กรุณาเลือก 1–100 รายการโดยไม่ซ้ำกัน');
  return ids.map(id => {
    if (typeof id !== 'string' || !id.trim() || id.length > 80) throw new Error('รายการ JOB ไม่ถูกต้อง');
    const raw = data.get(`amount:${id}`);
    const amount = typeof raw === 'string' ? claimAmountInput(raw) : null;
    if (amount === null) throw new Error('กรุณากรอกยอดทุกรายการที่เลือกเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง');
    return { id, amount };
  });
}
