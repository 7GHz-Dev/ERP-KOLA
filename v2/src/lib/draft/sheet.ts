/**
 * อ่านไฟล์ Excel ด้วย exceljs ให้ได้ค่าแบบเดียวกับ openpyxl (load_workbook(data_only=True)) ของโปรแกรม imp
 *
 *   เซลล์สูตร        -> ค่าที่ Excel คำนวณเก็บไว้ (ไฟล์ต้องเคย Save ใน Excel)  ไม่มีค่า -> null
 *   ตัวเลขรูปแบบวันที่ -> {date}      (openpyxl คืน datetime)
 *   เซลล์ที่ถูก merge (ไม่ใช่มุมซ้ายบน) -> null   (exceljs คืนค่าของเซลล์หลัก แต่ openpyxl คืน None)
 *   error ของ Excel  -> ข้อความเช่น '#N/A'
 */
import ExcelJS from 'exceljs';
import type { CellValue } from './values';

export type Sheet = {
  name: string;
  maxRow: number;
  value(row: number, col: number): CellValue;
  at(address: string): CellValue;
};

export async function loadWorkbook(data: Buffer | Uint8Array | ArrayBuffer) {
  const wb = new ExcelJS.Workbook();
  // exceljs รับ Buffer — ห่อ ArrayBuffer / Uint8Array ให้ตรงชนิด
  await wb.xlsx.load(Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data) as unknown as ArrayBuffer);
  return wb;
}

/** รูปแบบตัวเลขที่เป็นวันที่ (ตรรกะเดียวกับ openpyxl.styles.numbers.is_date_format) */
export function isDateFormat(fmt: string | undefined): boolean {
  if (!fmt) return false;
  const first = fmt.split(';')[0];
  const stripped = first.replace(/(\[.*?\])|(".*?")|(\\.)|(_.)|(\*.)/g, '');
  return /(?<![_\\])[dmhysDMHYS]/.test(stripped);
}

function serialToDate(serial: number, date1904: boolean) {
  let days = Math.floor(serial);
  if (date1904) days += 1462;
  else if (days < 60) days += 1;            // Excel นับ 29 ก.พ. 1900 ที่ไม่มีจริง
  const d = new Date(Date.UTC(1899, 11, 30) + days * 86_400_000);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
}

const fromDate = (d: Date) => ({ date: { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() } });

function plain(v: unknown, numFmt: string | undefined, date1904: boolean): CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'boolean') return v;
  if (typeof v === 'number') return isDateFormat(numFmt) ? { date: serialToDate(v, date1904) } : v;
  if (v instanceof Date) return fromDate(v);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('error' in o) return String(o.error);
    if ('richText' in o && Array.isArray(o.richText)) return o.richText.map((t: { text?: string }) => t.text ?? '').join('');
    if ('formula' in o || 'sharedFormula' in o) return plain(o.result, numFmt, date1904);
    if ('text' in o) return plain(o.text, numFmt, date1904);           // hyperlink
  }
  return null;
}

export function sheetReader(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet): Sheet {
  const date1904 = Boolean((wb.properties as { date1904?: boolean } | undefined)?.date1904);
  const value = (row: number, col: number): CellValue => {
    const cell = ws.findCell(row, col);
    if (!cell) return null;
    if (cell.isMerged && cell.master && cell.master.address !== cell.address) return null;
    return plain(cell.value, cell.numFmt, date1904);
  };
  const at = (address: string) => {
    const m = /^([A-Z]+)(\d+)$/.exec(address)!;
    return value(Number(m[2]), colIndex(m[1]));
  };
  return { name: ws.name, maxRow: ws.rowCount, value, at };
}

export function colIndex(letters: string) {
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n;
}

export function colLetters(n: number) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
