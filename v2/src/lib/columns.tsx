import Link from 'next/link';
import { ApprovalBadge, FileChip, type Column } from '@/components/JobTable';
import { addDays, formatDate } from '@/lib/format';
import type { JobRow } from '@/lib/queries/jobs';

/**
 * คอลัมน์มาตรฐานที่ใช้ซ้ำหลายหน้า
 * นิยามไว้ที่เดียวเพื่อให้ทุกหน้าแสดงข้อมูลชนิดเดียวกันเหมือนกันเป๊ะ
 */

export const col = {
  clientInCharge: (): Column => ({
    label: 'Client in charge', searchKey: 'person',
    render: (r) => r.personName ?? '-',
  }),
  jobType: (): Column => ({
    label: 'Job Type', searchKey: 'jobType',
    render: (r) => r.jobTypeName ?? '-',
  }),
  jobNo: (): Column => ({
    label: 'Job No.', searchKey: 'jobNo', sortKey: 'jobNo',
    // Job No. เป็นตัวระบุงานที่คนจำได้ ทำเป็นทางเข้าสรุปงานอีกทาง
    render: (r) => <Link className="cell-link" href={`/job/${r.id}`}>{r.jobNo}</Link>,
  }),
  source: (): Column => ({
    label: 'ที่มา',
    render: (r) => <span className="badge neutral">{r.sourceType ?? 'AN'}</span>,
  }),
  shipper: (): Column => ({
    label: 'Shipper', searchKey: 'shipper',
    render: (r) => r.shipperName ?? '-',
  }),
  blNo: (): Column => ({
    label: 'BL No.', searchKey: 'blNo', sortKey: 'blNo',
    render: (r) => r.blNo ?? '-',
  }),
  consignee: (): Column => ({
    label: 'Consignee', searchKey: 'consignee',
    render: (r) => r.consigneeName ?? '-',
  }),
  vessel: (): Column => ({
    label: 'Vessel / Voyage', searchKey: 'vessel', sortKey: 'vessel',
    render: (r) => [r.vessel, r.voyage].filter(Boolean).join(' / ') || '-',
  }),
  /** (OFC) = FAH ยืนยัน ETA ที่หน้า Invoice DO แล้ว ก่อนหน้านั้นเป็นค่าเบื้องต้นจาก PAINT */
  eta: (): Column => ({
    label: 'ETA', sortKey: 'eta',
    render: (r) => `${formatDate(r.eta)}${r.etaIsOfficial ? ' (OFC)' : ''}`,
  }),
  /** จำนวนวันฟรี ไม่ใช่วันสุดท้าย — ใช้ตอนที่ยังแก้ตัวเลขได้อยู่ */
  demDet: (): Column => ({
    label: 'DEM / DET', align: 'center',
    render: (r) => `${r.demDays} / ${r.detDays}`,
  }),
  lastDem: (): Column => ({
    label: 'Last Date of DEM', sortKey: 'demDays',
    render: (r) => formatDate(addDays(r.eta, r.demDays)),
  }),
  lastDet: (): Column => ({
    label: 'Last Date of DET', sortKey: 'detDays',
    render: (r) => formatDate(addDays(r.transportDate, r.detDays)),
  }),
  refNo: (): Column => ({
    label: 'Ref No.', searchKey: 'refNo', sortKey: 'draftRefNo',
    render: (r) => r.draftRefNo ?? '-',
  }),
  declarationNo: (): Column => ({
    label: 'เลขใบขน', searchKey: 'entryNo',
    render: (r) => (r.declarationNo ? <b>{r.declarationNo}</b> : '-'),
  }),
  port: (): Column => ({
    label: 'Port', searchKey: 'port',
    render: (r) => r.portName ?? '-',
  }),
  /** ฝั่ง FAH ดูรหัสท่าเรือเร็วกว่าชื่อเต็ม เพราะต้องคีย์ลงใบขนอยู่แล้ว */
  portCode: (): Column => ({
    label: 'Port of Discharge', searchKey: 'port',
    render: (r) => r.portCode ?? r.portName ?? '-',
  }),
  terminal: (): Column => ({
    label: 'Terminal',
    render: (r) => r.terminalName ?? '-',
  }),
  anStatus: (): Column => ({
    label: 'สถานะ AN',
    render: (r) => <ApprovalBadge status={r.anStatus} />,
  }),
  fnStatus: (): Column => ({
    label: 'สถานะ FN',
    render: (r) => <ApprovalBadge status={r.fnStatus} />,
  }),
  surrender: (): Column => ({
    label: 'Surrender',
    render: (r) => surrenderBadge(r.surrenderStatus),
  }),
  file: (label: string, category: string): Column => ({
    label,
    render: (r) => <FileChip file={r.currentFiles?.[category]} />,
  }),
};

export type FilesByJob = Map<string, Record<string, { id: string; fileName: string }>>;

export function surrenderBadge(status: string | null) {
  if (status === 'CLEARED') return <span className="badge approved">เคลียร์แล้ว</span>;
  if (status === 'ISSUE') return <span className="badge rejected">มีปัญหา</span>;
  return <span className="badge pending">รอตรวจ</span>;
}

export function draftBadge(row: JobRow) {
  if (row.draftStatus === 'REJECTED') return <span className="badge rejected">ถูกตีกลับ</span>;
  if (row.draftStatus === 'CREATED') return <span className="badge approved">สร้าง Draft แล้ว</span>;
  if (row.draftStatus === 'SUBMITTED') return <span className="badge pending">รอ FAH ตรวจ</span>;
  if (row.draftStatus === 'SENT_TO_HUB') return <span className="badge pending">รอ Hub สร้าง Draft</span>;
  return <span className="badge pending">รอสร้าง Draft</span>;
}

/** อ่านพารามิเตอร์จาก URL ให้เป็นค่าที่ query ใช้ได้ */
export function readParams(
  params: Record<string, string | string[] | undefined>,
  searchKeys: string[],
) {
  const one = (key: string) => {
    const value = params[key];
    return typeof value === 'string' ? value.trim() : '';
  };
  const search: Record<string, string> = {};
  searchKeys.forEach((key) => {
    const value = one(key);
    if (value) search[key] = value;
  });
  const sortBy = one('sortBy') || undefined;
  const sortDir: 'asc' | 'desc' = one('sortDir') === 'asc' ? 'asc' : 'desc';

  const carry: Record<string, string> = { ...search };
  if (sortBy) {
    carry.sortBy = sortBy;
    carry.sortDir = sortDir;
  }
  return { one, search, sortBy, sortDir, carry };
}
