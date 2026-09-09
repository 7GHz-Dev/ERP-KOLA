/**
 * ข้อความเบิกค่าแลก D/O ที่ MAY คัดลอกไปวางในแชท
 *
 * รูปแบบมาจากที่ทีมพิมพ์มือกันอยู่เดิม สองบรรทัด เช่น
 *   CULVYOK2600762=18,400
 *   ETA 7/9/2026 ของ CU LINES
 *
 * อยู่ในไฟล์กลางเพราะทั้งฝั่งเซิร์ฟเวอร์ (ตอนเรนเดอร์ค่าเริ่มต้น)
 * และฝั่งเบราว์เซอร์ (ตอนพิมพ์ยอดแล้วข้อความอัปเดตตาม) ต้องได้ผลตรงกันเป๊ะ
 */

/**
 * ยอดเงินแบบมีลูกน้ำคั่นหลักพัน และตัดทศนิยม .00 ทิ้ง
 *
 * ยอดค่าแลก D/O เกือบทั้งหมดเป็นจำนวนเต็ม ข้อความที่ทีมพิมพ์กันมาจึงไม่มีสตางค์
 * แต่ถ้าเจอยอดที่มีเศษจริง ๆ ต้องไม่ปัดทิ้ง เพราะเป็นตัวเลขที่ใช้เบิกเงิน
 */
export function claimAmount(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  // จำนวนเต็มไม่เอา .00 ส่วนยอดที่มีเศษต้องครบสองตำแหน่งแบบเงิน ไม่ใช่ 1,234.5
  const digits = Number.isInteger(n) ? 0 : 2;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/**
 * ETA ในข้อความเบิกเขียนแบบไม่มีศูนย์นำ (7/9/2026) ต่างจากตารางที่ใช้ 07/09/2026
 *
 * เป็นข้อความที่ส่งให้คนอ่านในแชท ไม่ใช่ช่องข้อมูล จึงคงรูปแบบที่ทีมใช้กันมา
 * อ่านส่วนวันเดือนปีจากสตริงตรง ๆ ไม่ผ่าน Date เพื่อไม่ให้เขตเวลาเลื่อนวัน
 */
export function claimEta(value: string | Date | null | undefined): string {
  if (!value) return '';
  const iso = value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return '';
  const [, year, month, day] = match;
  return `${Number(day)}/${Number(month)}/${year}`;
}

export type ClaimInput = {
  blNo: string | null;
  eta: string | Date | null;
  shipline: string | null;
  amount: string | number | null;
};

/** ข้อความเบิกเต็มสองบรรทัด — ช่องไหนไม่มีค่าก็ปล่อยว่างไว้ให้เห็นว่ายังขาด */
export function claimText({ blNo, eta, shipline, amount }: ClaimInput): string {
  const first = `${blNo ?? ''}=${claimAmount(amount)}`;
  const second = `ETA ${claimEta(eta)} ของ ${shipline ?? ''}`;
  return `${first}\n${second}`;
}
