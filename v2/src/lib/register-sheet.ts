import { addDays, formatDate, num } from '@/lib/format';
import { isByTruck, isPartnerRelease } from '@/lib/job-types';
import { statusLabel } from '@/lib/status';
import type { JobRow } from '@/lib/queries/jobs';

/**
 * ทะเบียนงานแบบตารางงานเดิมของทีม — หนึ่งแถวต่อหนึ่งงาน หัวคอลัมน์และลำดับตามไฟล์ Excel ที่ใช้กันอยู่
 *
 * ใช้ทั้งหน้าทะเบียนงานและหน้าจัดการลากตู้ คนเปิดสองหน้านี้จึงอ่านคอลัมน์ชุดเดียวกัน
 * แยกค่าที่แสดงไว้เป็นฟังก์ชันล้วน (ไม่มี JSX) เพื่อทดสอบได้โดยไม่ต้องมีหน้าเว็บ
 *
 * ต่างจากไฟล์ export (job-template.ts) ตรงที่วันที่เป็น dd/mm/yyyy แบบทั้งระบบ
 * เพราะตัวกรองหัวคอลัมน์จับคอลัมน์วันที่จากรูปแบบนี้ ส่วนไฟล์ export ต้องเป็น d/m/yy ตามไฟล์เดิม
 *
 * AT-MAESOT · OPEN ระบบยังไม่ได้เก็บ — คงหัวคอลัมน์ไว้ตามตารางเดิม แสดง "-"
 * ต่างจากไฟล์เดิมสองช่อง: SUR แสดงสถานะ Surrender (ที่ NAMKANG อัปเดต) · REMARK เป็น DECLARATION NO. (เลขใบขน)
 */
export const SHEET_COLUMNS = [
  'CUSTOMER', 'ETA', 'ประเภท', 'INV.', 'SUR', 'TRANSPORT', 'AT-MAESOT', 'OPEN',
  'SHIPPER', 'CON', 'BILL OF LADING', 'CONTAINER NO.', 'UNIT', 'WEIGHT',
  'SHIPLINE', 'VESSEL', 'PORT', 'REF NO', 'DECLARATION NO.', 'CONSIGNEE', 'NOTIFY',
  'DEM', 'DEM DATE', 'DET', 'DET DATE', 'STATUS',
] as const;

export type SheetColumn = (typeof SHEET_COLUMNS)[number];

export type SheetSource = Pick<JobRow,
  | 'personName' | 'eta' | 'jobTypeName' | 'jobTypeShort' | 'jobTypeCode' | 'currentFiles' | 'surrenderStatus'
  | 'transportDate' | 'shipperName' | 'containerCount' | 'blNo' | 'containerNos' | 'unitAmount'
  | 'grossWeight' | 'shipline' | 'vessel' | 'voyage' | 'terminalName' | 'draftRefNo' | 'declarationNo'
  | 'consigneeName' | 'consigneeShort' | 'notifyName' | 'notifyShort'
  | 'demDays' | 'detDays' | 'status'>;

/** สถานะ Surrender แบบสั้น — คำเดียวกับป้ายในหน้า NAMKANG (surrenderBadge) */
export const SURRENDER_SHORT: Record<string, string> = {
  PENDING: 'รอตรวจ', CLEARED: 'เคลียร์แล้ว', ISSUE: 'มีปัญหา',
};

const or = (...values: Array<string | null | undefined>) =>
  values.map((v) => (v ?? '').trim()).find(Boolean) || '-';

/** จำนวนวันฟรี 0 = ไม่มี DEM/DET ให้นับ — ตารางเดิมเขียน "-" ทั้งจำนวนวันและวันสุดท้าย */
function freeDays(start: string | null, days: number | null): { days: string; last: string } {
  if (!days || days <= 0) return { days: '-', last: '-' };
  return { days: String(days), last: start ? formatDate(addDays(start, days)) : '-' };
}

export function sheetCells(r: SheetSource): Record<SheetColumn, string> {
  const dem = freeDays(r.eta, r.demDays);
  const det = freeDays(r.transportDate, r.detDays);
  return {
    CUSTOMER: or(r.personName),
    ETA: formatDate(r.eta),
    'ประเภท': or(r.jobTypeShort, r.jobTypeName),
    // Y = แนบ Invoice สินค้าแล้ว (กติกาเดียวกับไฟล์ export)
    'INV.': r.currentFiles?.INVOICE_GOODS ? 'Y' : '-',
    // สถานะ Surrender ที่ NAMKANG อัปเดต (หน้าใส่ Client in Charge / ติดตาม Invoice & Surrender)
    SUR: SURRENDER_SHORT[r.surrenderStatus ?? 'PENDING'] ?? SURRENDER_SHORT.PENDING,
    TRANSPORT: formatDate(r.transportDate),
    'AT-MAESOT': '-',
    OPEN: '-',
    SHIPPER: or(r.shipperName),
    CON: r.containerCount ? String(r.containerCount) : '-',
    'BILL OF LADING': or(r.blNo),
    // เว้นวรรคหลังลูกน้ำ ช่องจะได้ตัดบรรทัดได้เมื่อมีหลายตู้
    'CONTAINER NO.': or((r.containerNos ?? '').split(',').filter(Boolean).join(', ')),
    UNIT: num(r.unitAmount),
    WEIGHT: num(r.grossWeight),
    SHIPLINE: or(r.shipline),
    // ตารางเดิมเขียนเรือกับเที่ยวรวมกันเป็น "AS CARLOTTA V.522S"
    VESSEL: or([r.vessel, r.voyage].filter(Boolean).join(' V.')),
    PORT: or(r.terminalName),
    'REF NO': or(r.draftRefNo),
    // เลขใบขน — ได้มาตอนตัว monitor เจอ ACCEPT ใน NETBAY (หรือ FAH ใส่เอง)
    'DECLARATION NO.': or(r.declarationNo),
    CONSIGNEE: or(r.consigneeShort, r.consigneeName),
    NOTIFY: or(r.notifyShort, r.notifyName),
    DEM: dem.days,
    'DEM DATE': dem.last,
    DET: det.days,
    'DET DATE': det.last,
    STATUS: statusLabel(r.status),
  };
}

/**
 * สีแถวตามตารางเดิม — ส้ม = MUO (Partner ภายนอกปล่อยเอง) · ม่วง = ขนทางรถ · เขียว = งานอื่น
 * MUO มาก่อน เพราะเป็นตัวบอกว่าใครรับผิดชอบงานนี้ ส่วนขนทางรถเป็นแค่วิธีขนส่ง
 */
export function sheetRowClass(r: Pick<JobRow, 'jobTypeCode' | 'shipline' | 'vessel'>): string {
  if (isPartnerRelease(r.jobTypeCode)) return 'row-muo';
  if (isByTruck(r.shipline, r.vessel)) return 'row-truck';
  return 'row-kola';
}
