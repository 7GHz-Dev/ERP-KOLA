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

/** หัวข้อค่าอื่นๆ ยาวสุดเท่านี้ — พอสำหรับชื่อค่าใช้จ่าย และไม่ล้นข้อความเบิก */
export const OTHER_LABEL_MAX = 60;

/**
 * ค่าอื่น ๆ ไม่บังคับ แต่ยอดกับหัวข้อต้องมาคู่กัน
 * ว่างทั้งคู่ = ไม่มี (null ทั้งคู่) · ขาดข้างใดข้างหนึ่งหรือยอดผิดรูป = undefined
 */
export function otherInput(
  amount: string | null | undefined,
  label: string | null | undefined,
): { amount: string | null; label: string | null } | undefined {
  const raw = String(amount ?? '').trim();
  const name = String(label ?? '').trim().replace(/\s+/g, ' ');
  if (!raw && !name) return { amount: null, label: null };
  if (!raw || !name || name.length > OTHER_LABEL_MAX) return undefined;
  const value = claimAmountInput(raw);
  return value === null ? undefined : { amount: value, label: name };
}

/** ยอดเพิ่มเติมที่จ่ายไปพร้อมค่า DO — ค่าตามที่พิมพ์ในช่อง ยังไม่ตรวจรูป */
export type DoExtras = { deposit: string; other: string; otherLabel: string };

/** ค่าที่บันทึกไว้ (null ได้) → ค่าในช่องกรอก */
export function extrasOf(job: { doDepositAmount?: string | null; doOtherAmount?: string | null; doOtherLabel?: string | null }): DoExtras {
  return { deposit: job.doDepositAmount ?? '', other: job.doOtherAmount ?? '', otherLabel: job.doOtherLabel ?? '' };
}

/** ตรวจรูปยอดเพิ่มเติม — undefined แปลว่ามีช่องที่ยังกรอกไม่ถูก ห้ามคัดลอกหรือตั้งเบิก */
export function checkExtras(extras: DoExtras) {
  const deposit = depositInput(extras.deposit);
  const other = otherInput(extras.other, extras.otherLabel);
  return deposit === undefined || other === undefined ? undefined : { deposit, other };
}

export function allClaimText(items: ClaimInput[]): string {
  return items.map(item => claimText({
    ...item,
    amount: claimAmountInput(String(item.amount ?? '')),
    deposit: depositInput(item.deposit === null || item.deposit === undefined ? '' : String(item.deposit)) ?? null,
    other: otherInput(item.other === null || item.other === undefined ? '' : String(item.other), item.otherLabel)?.amount ?? null,
  })).join('\n\n');
}

export const OTHER_ERROR = `ค่าอื่นๆ ต้องระบุทั้งหัวข้อ (ไม่เกิน ${OTHER_LABEL_MAX} ตัวอักษร) และยอดเป็นตัวเลขไม่ติดลบ หรือเว้นว่างทั้งคู่ถ้าไม่มี`;

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
    const rawOther = data.get(`other:${id}`);
    const rawLabel = data.get(`otherLabel:${id}`);
    const other = otherInput(typeof rawOther === 'string' ? rawOther : '', typeof rawLabel === 'string' ? rawLabel : '');
    if (other === undefined) throw new Error(OTHER_ERROR);
    return { id, amount, deposit, other: other.amount, otherLabel: other.label };
  });
}
