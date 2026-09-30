import { claimText, type ClaimInput } from './do-claim';

export function claimAmountInput(value: string): string | null {
  const raw = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.replace(/,/g, '').split('.');
  const integer = whole.replace(/^0+(?=\d)/, '');
  if (integer.length > 16) return null;
  return `${integer}.${fraction.padEnd(2, '0')}`;
}

/**
 * ค่ามัดจำตู้ไม่บังคับ — ว่างคือไม่มี (null) ส่วนที่พิมพ์ผิดรูปคืน undefined
 * แยกสองค่านี้ออกจากกัน เพราะช่องว่างต้องกดต่อได้ แต่ช่องที่พิมพ์ผิดต้องกันไว้ก่อน
 */
export function depositInput(value: string | null | undefined): string | null | undefined {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  return claimAmountInput(raw) ?? undefined;
}

export function allClaimText(items: ClaimInput[]): string {
  return items.map(item => claimText({
    ...item,
    amount: claimAmountInput(String(item.amount ?? '')),
    deposit: depositInput(item.deposit === null || item.deposit === undefined ? '' : String(item.deposit)) ?? null,
  })).join('\n\n');
}

export function readBatchClaims(data: FormData) {
  const ids = data.getAll('jobId');
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length) throw new Error('กรุณาเลือก 1–100 รายการโดยไม่ซ้ำกัน');
  return ids.map(id => {
    if (typeof id !== 'string' || !id.trim() || id.length > 80) throw new Error('รายการ JOB ไม่ถูกต้อง');
    const raw = data.get(`amount:${id}`);
    const amount = typeof raw === 'string' ? claimAmountInput(raw) : null;
    if (amount === null) throw new Error('กรุณากรอกยอดทุกรายการที่เลือกเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง');
    const rawDeposit = data.get(`deposit:${id}`);
    const deposit = depositInput(typeof rawDeposit === 'string' ? rawDeposit : '');
    if (deposit === undefined) throw new Error('ค่ามัดจำตู้ต้องเป็นตัวเลขไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง หรือเว้นว่างถ้าไม่มี');
    return { id, amount, deposit };
  });
}
