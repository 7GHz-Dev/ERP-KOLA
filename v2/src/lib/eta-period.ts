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

/* ---------- ทะเบียนงาน (Bookings table): 12 เดือนล่าสุดเป็นค่าตั้งต้น ---------- */

/**
 * มุมที่เลือกของแถบ ETA ในหน้า Bookings table
 *   recent  12 เดือนล่าสุด (ค่าตั้งต้น) — ETA ตั้งแต่ต้นเดือนที่ 11 ก่อนเดือนนี้ ไม่จำกัดปลาย (เรือที่ยังไม่เข้าก็เห็น)
 *   all     ทุกงาน (?eta=all)
 *   period  ปี / เดือนที่กดเลือก (?year=&month=) — แบบเดียวกับแถบเดิมของหน้าลากตู้
 */
export type EtaView = { kind: 'recent' } | { kind: 'all' } | { kind: 'period'; period: Period };

export function readEtaView(eta: string, year: string, month: string): EtaView {
  if (eta === 'all') return { kind: 'all' };
  const period = readPeriod(year, month);
  return period.year ? { kind: 'period', period } : { kind: 'recent' };
}

export function etaViewParams(v: EtaView): Record<string, string> {
  if (v.kind === 'all') return { eta: 'all' };
  if (v.kind === 'period') return periodParams(v.period);
  return {};
}

/** เดือนปัจจุบันตามเวลาไทย */
export function currentMonth(now = new Date()): { year: number; month: number } {
  const [y, m] = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' }).split('-').map(Number);
  return { year: y, month: m };
}

const monthIndex = (p: { year: number; month: number }) => p.year * 12 + (p.month - 1);
const fromIndex = (i: number) => ({ year: Math.floor(i / 12), month: (i % 12) + 1 });

/** เดือนแรกของช่วง 12 เดือนล่าสุด (นับเดือนนี้เป็นเดือนที่ 12) */
export function recentStart(now = new Date()) {
  return fromIndex(monthIndex(currentMonth(now)) - 11);
}

/** วันแรกของช่วง 12 เดือนล่าสุด — ใช้เป็นเงื่อนไข SQL (etaSince) */
export function recentFrom(now = new Date()) {
  const s = recentStart(now);
  return `${s.year}-${pad(s.month)}-01`;
}

/** "พ.ย. 69" — ปี พ.ศ. สองหลักแบบที่ทีมเขียนกัน */
export const monthLabel = (p: { year: number; month: number }) => `${MONTHS_TH[p.month - 1]} ${String(p.year + 543).slice(-2)}`;

/**
 * ปุ่มเดือนของแถบ 12 เดือนล่าสุด — ใหม่สุดก่อน
 * เริ่มที่เดือนนี้ (หรือเดือนที่มี ETA ไกลสุดถ้าเรือยังไม่เข้า) ไล่ย้อนไปถึงเดือนแรกของช่วง
 * พร้อมยอดรวมของช่วง และปีก่อนหน้าที่ยังมีงาน (ปุ่ม "ปีก่อนหน้า")
 */
export function recentBar(rows: PeriodCount[], now = new Date()) {
  const start = monthIndex(recentStart(now));
  const latest = Math.max(monthIndex(currentMonth(now)), ...rows.map((r) => monthIndex(r)));
  const byMonth = new Map(rows.map((r) => [monthIndex(r), r.count]));
  const months = [];
  for (let i = latest; i >= start; i -= 1) months.push({ ...fromIndex(i), count: byMonth.get(i) ?? 0 });
  const recentTotal = rows.filter((r) => monthIndex(r) >= start).reduce((s, r) => s + r.count, 0);
  const allTotal = rows.reduce((s, r) => s + r.count, 0);
  const older = new Map<number, number>();
  for (const r of rows) if (monthIndex(r) < start) older.set(r.year, (older.get(r.year) ?? 0) + r.count);
  return {
    months, recentTotal, allTotal, start: fromIndex(start),
    olderYears: [...older].sort((a, b) => b[0] - a[0]).map(([year, count]) => ({ year, count })),
  };
}
