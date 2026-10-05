import ExcelJS from 'exceljs';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { jobs } from '@/db/schema';
import { jobCreatedConditions } from '@/lib/job-created-date';

/**
 * รายงานงานที่ MAY ตั้งเบิกแล้ว — ส่งออกเป็น Excel ให้ฝ่ายบัญชีกระทบยอด
 *
 * แยกจาก route เพราะ exceljs ทำงานได้เฉพาะฝั่งเซิร์ฟเวอร์ และให้ทดสอบตัวไฟล์ได้โดยไม่ต้องยิง HTTP
 */

export type ClaimReportRow = {
  /** วันที่ตั้งเบิกตามเวลาไทย YYYY-MM-DD */
  claimedOn: string;
  blNo: string | null;
  doPayAmount: string | null;
  doDepositAmount: string | null;
  doOtherAmount: string | null;
  doOtherLabel: string | null;
};

/** ช่วงวันที่ตั้งเบิก (รวมทั้งสองวัน ตามเวลาไทย) — ว่างคือไม่จำกัด */
export async function claimReportRows(from?: string, to?: string): Promise<ClaimReportRow[]> {
  return db.select({
    // ตัดวันด้วยเขตเวลาไทยให้ตรงกับที่หน้าจอแสดง ตั้งเบิกตอนเย็นจะได้ไม่กลายเป็นวันถัดไป
    claimedOn: sql<string>`to_char(${jobs.doClaimedAt} at time zone 'Asia/Bangkok', 'YYYY-MM-DD')`,
    blNo: jobs.blNo,
    doPayAmount: jobs.doPayAmount,
    doDepositAmount: jobs.doDepositAmount,
    doOtherAmount: jobs.doOtherAmount,
    doOtherLabel: jobs.doOtherLabel,
  }).from(jobs).where(and(
    isNotNull(jobs.doClaimedAt),
    eq(jobs.isArchived, false),
    ...jobCreatedConditions(sql`${jobs.doClaimedAt}`, from, to),
  )).orderBy(asc(jobs.doClaimedAt), asc(jobs.blNo));
}

const money = (v: string | null) => (v === null || v === '' ? null : Number(v));

/**
 * ยอดเงินเก็บเป็นตัวเลขจริง ไม่ใช่ข้อความ เปิดใน Excel แล้วบวกลบต่อได้ทันที
 * วันที่เก็บเป็นวันที่จริงแสดงแบบ วว/ดด/ปปปป ตามที่ทีมใช้ เรียงหรือกรองตามวันได้
 * ท้ายตารางมีแถวรวมเป็นสูตร SUM แก้ตัวเลขในไฟล์แล้วยอดรวมตามให้
 */
export async function claimReportXlsx(rows: ClaimReportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ตั้งเบิกแล้ว', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'วันที่ตั้งเบิก', key: 'claimedOn', width: 14, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'เลข BL', key: 'blNo', width: 22 },
    { header: 'ยอดค่า DO', key: 'doPay', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'ยอดค่ามัดจำ', key: 'deposit', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'ยอดค่าอื่นๆ', key: 'other', width: 14, style: { numFmt: '#,##0.00' } },
    { header: 'ระบุ (ค่าอื่นๆ)', key: 'otherLabel', width: 24 },
  ];
  ws.getRow(1).font = { bold: true };

  for (const r of rows) {
    const [y, m, d] = r.claimedOn.split('-').map(Number);
    ws.addRow({
      claimedOn: new Date(Date.UTC(y, m - 1, d)),
      blNo: r.blNo ?? '',
      doPay: money(r.doPayAmount),
      deposit: money(r.doDepositAmount),
      other: money(r.doOtherAmount),
      otherLabel: r.doOtherLabel ?? '',
    });
  }

  if (rows.length) {
    const last = rows.length + 1;
    const total = ws.addRow({ blNo: 'รวม' });
    for (const [key, letter] of [['doPay', 'C'], ['deposit', 'D'], ['other', 'E']] as const) {
      total.getCell(key).value = { formula: `SUM(${letter}2:${letter}${last})` };
    }
    total.font = { bold: true };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** ชื่อไฟล์บอกช่วงวันที่ เปิดหลายไฟล์พร้อมกันจะได้ไม่สับสน */
export function claimReportFileName(from?: string, to?: string): string {
  const range = from || to ? `_${from || 'เริ่มต้น'}_ถึง_${to || 'ล่าสุด'}` : '';
  return `ตั้งเบิกค่าDO${range}.xlsx`;
}
