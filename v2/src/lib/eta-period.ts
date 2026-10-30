/**
 * เลือกแสดงงานตามปี / เดือนของ ETA — ปุ่มเหนือตารางของทะเบียนงานและหน้าลากตู้
 *
 * ใช้ ETA เพราะตารางงานเดิมของทีมไล่ตามวันที่เรือเข้า ไม่ใช่วันที่สร้างงานในระบบ
 * (วันที่สร้างงานมีตัวกรองแยกอยู่แล้วที่ทะเบียนงาน ใช้คู่กับปุ่ม Export)
 * กรองที่ฐานข้อมูลผ่าน URL (?year=2026&month=11) ลิงก์ที่ส่งต่อกันจึงเปิดเจอชุดเดียวกัน
 *
 * ฟังก์ชันล้วน ไม่แตะฐานข้อมูล — เงื่อนไข SQL อยู่ที่ etaInPeriod() ใน queries/jobs.ts
 */

export const MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** ปี ค.ศ. และเดือน 1–12 · เดือนมีได้เมื่อเลือกปีแล้วเท่านั้น (เดือนเดียวกันคนละปีไม่ใช่ชุดเดียวกัน) */
export type Period = { year: number | null; month: number | null };

export function readPeriod(year: string | null | undefined, month: string | null | undefined): Period {
  const y = /^\d{4}$/.test(year ?? '') ? Number(year) : null;
  if (!y || y < 2000 || y > 2100) return { year: null, month: null };
  const m = /^\d{1,2}$/.test(month ?? '') ? Number(month) : null;
  return { year: y, month: m && m >= 1 && m <= 12 ? m : null };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ช่วงวันของปี/เดือนที่เลือก — to เป็นวันแรกของช่วงถัดไป (ไม่รวม) · ไม่ได้เลือกคืน null */
export function periodRange(p: Period): { from: string; to: string } | null {
  if (!p.year) return null;
  if (!p.month) return { from: `${p.year}-01-01`, to: `${p.year + 1}-01-01` };
  const next = p.month === 12 ? { y: p.year + 1, m: 1 } : { y: p.year, m: p.month + 1 };
  return { from: `${p.year}-${pad(p.month)}-01`, to: `${next.y}-${pad(next.m)}-01` };
}

/** ค่าใส่ URL — ไม่ได้เลือกไม่ใส่เลย */
export function periodParams(p: Period): Record<string, string> {
  return {
    ...(p.year ? { year: String(p.year) } : {}),
    ...(p.year && p.month ? { month: String(p.month) } : {}),
  };
}

export type PeriodCount = { year: number; month: number; count: number };

/** จำนวนงานต่อปี (เรียงปีล่าสุดก่อน) และต่อเดือนของปีที่เลือก — ใช้บอกตัวเลขบนปุ่ม */
export function periodCounts(rows: PeriodCount[], year: number | null) {
  const years = new Map<number, number>();
  const months = new Map<number, number>();
  for (const r of rows) {
    years.set(r.year, (years.get(r.year) ?? 0) + r.count);
    if (r.year === year) months.set(r.month, (months.get(r.month) ?? 0) + r.count);
  }
  return {
    years: [...years.entries()].sort((a, b) => b[0] - a[0]).map(([y, count]) => ({ year: y, count })),
    months,
  };
}
