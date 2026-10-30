import Link from 'next/link';
import { ApprovalBadge, FileChip, type Column } from '@/components/JobTable';
import { addDays, formatDate, formatDateTime } from '@/lib/format';
import type { JobRow } from '@/lib/queries/jobs';
import { SHEET_COLUMNS, sheetCells, type SheetColumn } from '@/lib/register-sheet';

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
  /**
   * เรือ/เที่ยว — ค้นได้ทั้งชื่อเรืออย่างเดียว และชื่อเรือต่อเที่ยวเรือ
   *
   * ตัวคั่นพิมพ์แบบไหนก็ได้ ฝั่ง query ตัดอักขระที่ไม่ใช่ตัวอักษรหรือตัวเลขทิ้งก่อนเทียบ
   * จะพิมพ์ตามที่เห็นบนจอ ("BANGKOK BRIDGE / 0518W") หรือตามไฟล์ตาราง
   * ("BANGKOK BRIDGE V.0518W") หรือเว้นวรรคเฉย ๆ ก็เจอเหมือนกัน
   */
  vessel: (): Column => ({
    label: 'Vessel / Voyage', searchKey: 'vessel', sortKey: 'vessel',
    searchHint: 'เช่น BANGKOK BRIDGE 0518W',
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
    /*
     * กดแล้วเปิดใบขนนี้ใน NETBAY — ลิงก์ kola-netbay:// เรียก npm run netbay:open ในเครื่องคนกด
     * ให้เปิด Chrome -> login -> Import -> ค้นหา Ref No. -> เปิดใบขน
     * ลิงก์ตรงไปหน้าใบขนใช้ไม่ได้ เพราะ NETBAY ผูก session ไว้กับเบราว์เซอร์ที่ login (UCODE ใน localStorage)
     * ต้องติดตั้งตัวเปิดก่อน (scripts/install/ ตัวเดียวกับปุ่มเปิด worker) และใส่ NETBAY_USER/PASSWORD ใน .env.local
     * และเครื่องต้องอยู่ในเครือข่ายออฟฟิศที่เข้า NETBAY ได้
     */
    render: (r) => (r.draftRefNo ? (
      <a className="badge neutral file-link" href={`kola-netbay://open?ref=${encodeURIComponent(r.draftRefNo)}`}
        title="เปิดใบขนนี้ใน NETBAY (ต้องติดตั้งตัวเปิดของ ERP-KOLA ในเครื่อง)">
        {r.draftRefNo} ↗
      </a>
    ) : '-'),
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
    label: 'Port Terminal',
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
  /**
   * วันเวลาที่รับงานเข้าระบบ
   *
   * ใช้แยกงานที่เพิ่งนำเข้ามาทั้งชุดออกจากงานเก่าที่ค้างอยู่ ซึ่งดูจาก ETA ไม่ได้
   * เพราะงานที่นำเข้าพร้อมกันมี ETA เดียวกันทั้งชุด แต่คนละรอบที่นำเข้า
   *
   * แสดงเวลาด้วย ไม่ใช่แค่วันที่ เพราะการนำเข้าหลายรอบในวันเดียวกันเป็นเรื่องปกติ
   * ถ้าเห็นแต่วันที่จะแยกไม่ออกว่าชุดไหนเข้ามาก่อนหลัง
   */
  createdAt: (): Column => ({
    label: 'วันที่สร้างงาน', sortKey: 'createdAt', className: 'col-created',
    render: (r) => formatDateTime(r.createdAt),
  }),
};

/** ช่องค้นหา/เรียงของคอลัมน์ตารางเดิม — ชื่อต้องตรงกับ SEARCHABLE / SORTABLE ใน queries/jobs.ts */
const SHEET_SEARCH: Partial<Record<SheetColumn, Pick<Column, 'searchKey' | 'sortKey' | 'searchHint'>>> = {
  CUSTOMER: { searchKey: 'person' },
  ETA: { sortKey: 'eta' },
  'ประเภท': { searchKey: 'jobType' },
  SHIPPER: { searchKey: 'shipper' },
  'BILL OF LADING': { searchKey: 'blNo', sortKey: 'blNo' },
  'CONTAINER NO.': { searchKey: 'container' },
  VESSEL: { searchKey: 'vessel', sortKey: 'vessel', searchHint: 'เช่น AS CARLOTTA' },
  VOYAGE: { searchKey: 'voyage', sortKey: 'voyage' },
  'REF NO': { searchKey: 'refNo', sortKey: 'draftRefNo' },
  'DECLARATION NO.': { searchKey: 'entryNo' },
  CONSIGNEE: { searchKey: 'consignee' },
  NOTIFY: { searchKey: 'notify' },
};

/**
 * คอลัมน์ทะเบียนงานแบบตารางเดิม (ลำดับตาม SHEET_COLUMNS) — ใช้ที่ทะเบียนงานและหน้าลากตู้
 *
 * ค่าของทุกช่องคำนวณครั้งเดียวต่อแถว (sheetCells) แล้วจำไว้ ไม่คำนวณซ้ำ 26 รอบต่อแถว
 * REF NO ยังเป็นลิงก์เปิดใบขนใน NETBAY เหมือนคอลัมน์ Ref No. ของหน้าอื่น
 */
export function sheetColumns(): Column[] {
  const memo = new WeakMap<JobRow, Record<SheetColumn, string>>();
  const cells = (r: JobRow) => {
    let hit = memo.get(r);
    if (!hit) { hit = sheetCells(r); memo.set(r, hit); }
    return hit;
  };
  return SHEET_COLUMNS.map((label): Column => ({
    label,
    ...SHEET_SEARCH[label],
    kind: label === 'SHIPPER' ? 'wrap' : undefined,
    className: `sheet-${label === 'CONTAINER NO.' ? 'containers' : label === 'SHIPPER' ? 'shipper' : 'cell'}`,
    align: ['CON', 'UNIT', 'WEIGHT', 'DEM', 'DET', 'INV.', 'SUR'].includes(label) ? 'center' : undefined,
    render: label === 'REF NO'
      ? (r) => (r.draftRefNo ? col.refNo().render(r) : '-')
      : label === 'SUR'
        // ป้ายสีเดียวกับหน้า NAMKANG · ข้อความในป้ายตรงกับ sheetCells ตัวกรองหัวคอลัมน์จึงติ๊กค่าได้ตรง
        ? (r) => surrenderBadge(r.surrenderStatus)
        : label === 'BILL OF LADING' || label === 'DECLARATION NO.'
          ? (r) => <b>{cells(r)[label]}</b>
          : (r) => cells(r)[label],
  }));
}

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
  if (row.draftStatus === 'HUB_ERROR') return <span className="badge rejected">สร้าง Draft ไม่สำเร็จ</span>;
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
