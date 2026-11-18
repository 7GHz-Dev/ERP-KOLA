import { formatDate } from '@/lib/format';
import { freeLastDate, storageLastDate } from '@/lib/free-time';

/**
 * ข้อมูลประกอบการสั่งลากตู้ (หน้า Transport Request) — ใช้ทั้งฝั่งเซิร์ฟเวอร์และเบราว์เซอร์ จึงไม่มีการอ่านฐานข้อมูล
 *
 * สิ่งที่ทีมลากตู้ใช้ตัดสินใจ:
 *   D/O        สายเรือปล่อย D/O แล้วหรือยัง — ยังไม่ได้ไปรับตู้ไม่ได้
 *   DEM        free time ตู้อยู่ท่า นับจาก ETA (เหมือนคอลัมน์ DEM DATE ของทะเบียนงาน) — ลากหลังวันสุดท้ายมีค่า DEM
 *   DET        free time หลังตู้ออกจากท่า นับจากวันลาก — สั้น (≤ 3 วัน เช่น CNC) ต้องรีบคืน
 *              ไม่ลากวันศุกร์ / วันคืนตู้ไม่ควรตกเสาร์-อาทิตย์ (คืนตู้ช้า)
 *   ETA        ยังไม่ยืนยันจากระบบกรม = เรืออาจเลื่อน ตู้อาจยังไม่ลง
 *   ท่า         ดูจำนวนตู้ที่รอลากต่อท่า (แถบบนหน้า) — ท่าไหนลงช้า/ตู้เยอะยังต้องเช็กหน้างาน
 */
export const SHORT_DET_DAYS = 3;

export type DoStage = 'NONE' | 'SENT' | 'DONE';

export type HaulRisk = {
  bl: string;
  shipline: string | null;
  terminal: string | null;
  eta: string | null;
  etaOfficial: boolean;
  demDays: number;
  detDays: number;
  doStage: DoStage;
  /** Combine — DET นับจาก ETA (ปกตินับจากวันลาก) */
  combined?: boolean;
  /** Last Date Free Time ของ Storage (ETA + วันฟรี · ETA = วันที่ 1) — ลากตั้งแต่วันนี้มีค่าฝากตู้ */
  storageLast?: string | null;
};

export const DO_TEXT: Record<DoStage, string> = {
  NONE: 'ยังไม่แลก',
  SENT: 'ส่งแลกแล้ว · รอ D/O',
  DONE: 'ได้ D/O แล้ว',
};

/**
 * ขั้น D/O จากข้อมูลงาน: ส่งชุดแลกให้สายเรือ (doExchangedAt) → MAY กรอกยอดจาก Invoice D/O / ตั้งเบิกแล้ว
 * ได้ Invoice D/O มาแล้วถือว่าสายเรือออก D/O ให้แล้ว
 */
export function doStage(r: { doExchangedAt?: Date | string | null; doPayAmount?: string | number | null; doClaimedAt?: Date | string | null }): DoStage {
  if (r.doClaimedAt || (r.doPayAmount !== null && r.doPayAmount !== undefined && r.doPayAmount !== '')) return 'DONE';
  if (r.doExchangedAt) return 'SENT';
  return 'NONE';
}

/** Last Date of DEM = ETA + DEM − 1 (ETA = วันที่ 1) — 0 วัน = ไม่มีให้นับ */
export function demUntil(r: Pick<HaulRisk, 'eta' | 'demDays'>): string | null {
  return freeLastDate(r.eta, r.demDays);
}

/**
 * Last DET date = วันสุดท้ายที่คืนตู้ได้ฟรี — ปกติ: Transport Date (วันลาก) + DET − 1 · Combine: ETA + DET − 1
 * หน้า Transport Request ใช้วันลากที่กำลังเลือกเป็น Transport Date
 */
export function detUntil(r: Pick<HaulRisk, 'eta' | 'detDays' | 'combined'>, transportDate: string | null): string | null {
  return freeLastDate(r.combined ? r.eta : transportDate, r.detDays);
}

const weekday = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const diff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
const WEEKDAY = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];

export function weekdayName(ymd: string) {
  return WEEKDAY[weekday(ymd)] ?? '';
}

/** วันที่เหลือของ DEM เทียบกับวันอ้างอิง (ติดลบ = เกินแล้ว) */
export function demLeft(r: Pick<HaulRisk, 'eta' | 'demDays'>, on: string): number | null {
  const last = demUntil(r);
  return last ? diff(last, on) : null;
}

/**
 * คำเตือนของวันลากที่เลือก รวมทุกงานที่ติ๊ก — ข้อความเดียวกันรวมเป็นบรรทัดเดียว พร้อม BL ที่โดน
 * ไม่ห้ามส่ง เป็นข้อมูลให้ตัดสินใจก่อนกดยืนยัน
 */
export function haulWarnings(rows: HaulRisk[], haulDate: string): string[] {
  if (!haulDate) return [];
  const out = new Map<string, string[]>();
  const add = (text: string, bl: string) => out.set(text, [...(out.get(text) ?? []), bl]);
  const wd = weekday(haulDate);

  if (wd === 5) add('ลากวันศุกร์ — เสี่ยงคืนตู้ช้า', '');
  if (wd === 0 || wd === 6) add(`ลากวัน${WEEKDAY[wd]}`, '');
  for (const r of rows) {
    if (r.doStage === 'NONE') add('ยังไม่ได้ส่งแลก D/O', r.bl);
    else if (r.doStage === 'SENT') add('ส่งแลก D/O แล้วแต่ยังไม่ได้ D/O', r.bl);
    if (r.eta && haulDate < r.eta) add('วันลากก่อน ETA', r.bl);
    else if (!r.etaOfficial) add('ETA ยังไม่ยืนยันจากระบบกรม (เรืออาจเลื่อน ตู้อาจยังไม่ลง)', r.bl);
    const left = demLeft(r, haulDate);
    if (left !== null && left < 0) add(`เกิน free time DEM (Last DEM date ${formatDate(demUntil(r))})`, r.bl);
    if (r.storageLast && haulDate > r.storageLast) add(`เกิน Storage free time (Last STORAGE date ${formatDate(r.storageLast)})`, r.bl);
    // DET นับจาก ETA: ลากวันนี้แล้วเหลือวันคืนตู้ฟรีกี่วัน (รวมวันลาก)
    const det = detUntil(r, haulDate);
    if (det) {
      const days = diff(det, haulDate) + 1;
      if (days <= 0) add(`เกิน free time DET (Last DET date ${formatDate(det)})`, r.bl);
      else if (days <= SHORT_DET_DAYS) add(`ลากแล้วเหลือ DET ${days} วัน ต้องรีบคืนตู้ (Last DET date ${formatDate(det)})`, r.bl);
      if (days > 0 && [0, 6].includes(weekday(det))) add(`วันสุดท้ายคืนตู้ (${formatDate(det)}) ตรงวัน${WEEKDAY[weekday(det)]}`, r.bl);
    }
  }
  return [...out.entries()].map(([text, bls]) => {
    const list = [...new Set(bls.filter(Boolean))];
    return list.length ? `${text}: ${list.slice(0, 4).join(', ')}${list.length > 4 ? ` +${list.length - 4}` : ''}` : text;
  });
}

/** ข้อมูลประกอบของงานหนึ่งแถวในตาราง (JobRow) */
export function haulRiskOf(r: {
  blNo: string | null; jobNo: string; shipline: string | null; terminalName: string | null; eta: string | null;
  etaIsOfficial: boolean | null; demDays: number | null; detDays: number | null; storageFreeDays?: number | null; demDetCombined?: boolean | null;
  doExchangedAt: Date | string | null; doPayAmount: string | null; doClaimedAt: Date | string | null;
}): HaulRisk {
  return {
    bl: r.blNo?.trim() || r.jobNo,
    shipline: r.shipline,
    terminal: r.terminalName,
    eta: r.eta,
    etaOfficial: Boolean(r.etaIsOfficial),
    demDays: Number(r.demDays) || 0,
    detDays: Number(r.detDays) || 0,
    doStage: doStage(r),
    storageLast: storageLastDate(r.eta, r.storageFreeDays),
    combined: Boolean(r.demDetCombined),
  };
}

/** วันนี้ตามเวลาไทย (YYYY-MM-DD) */
export function todayBangkok(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(now);
}
