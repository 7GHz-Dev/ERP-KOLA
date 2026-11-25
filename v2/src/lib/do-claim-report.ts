import ExcelJS from 'exceljs';
import { and, asc, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { doCharges, jobs } from '@/db/schema';
import { jobCreatedConditions } from '@/lib/job-created-date';

/**
 * รายงานงานที่ MAY ตั้งเบิกแล้ว — ส่งออกเป็น Excel ให้ฝ่ายบัญชีกระทบยอด
 *
 * แยกจาก route เพราะ exceljs ทำงานได้เฉพาะฝั่งเซิร์ฟเวอร์ และให้ทดสอบตัวไฟล์ได้โดยไม่ต้องยิง HTTP
 */

export type ClaimReportCharge = { topic: string; amount: string; note: string | null };

export type ClaimReportRow = {
  /** วันที่ตั้งเบิกตามเวลาไทย YYYY-MM-DD */
  claimedOn: string;
  /** วันเวลาที่รายการส่งเข้าคิวแลก DO ตามเวลาไทย YYYY-MM-DD HH:MI — ไม่มีคือ null */
  arrivedAt: string | null;
  blNo: string | null;
  /** ค่า DO — ว่างในแถวของค่าใช้จ่ายที่ตั้งเบิกเพิ่มเติมภายหลัง */
  doPayAmount: string | null;
  /** หัวข้อค่าใช้จ่ายที่ตั้งเบิกในวันนั้น (มัดจำ · ล่าช้า · DEM · DET …) */
  charges: ClaimReportCharge[];
};

/*
 * เวลาที่รายการส่งเข้ามา — นิยามเดียวกับคอลัมน์ "วันที่ส่งรายการมา" บนหน้าจอ
 * PAINT ส่งทาง E-Office หรือ FAH ส่งทาง do_handoffs เอาครั้งแรกที่ถึง (least ข้าม null ให้)
 * เขียนชื่อตารางเต็ม — ในคำสั่ง select ตารางเดียว drizzle พิมพ์ ${jobs.id} เป็น "id" เฉย ๆ
 * ซึ่งในซับคิวรีจะกลายเป็น do_handoffs.id แล้วจับคู่ไม่เจอสักแถว
 */
const arrivedAt = sql<string | null>`to_char(least("jobs"."eoffice_sent_at",
  (select min(dh.sent_at) from do_handoffs dh where dh.job_id = "jobs"."id"))
  at time zone 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI')`;
// ตัดวันด้วยเขตเวลาไทยให้ตรงกับที่หน้าจอแสดง ตั้งเบิกตอนเย็นจะได้ไม่กลายเป็นวันถัดไป
const bangkokDay = (column: SQL) => sql<string>`to_char(${column} at time zone 'Asia/Bangkok', 'YYYY-MM-DD')`;

/**
 * หนึ่งแถวต่อหนึ่งงานต่อหนึ่งวันที่ตั้งเบิก — ช่วงวันที่ตั้งเบิก (รวมทั้งสองวัน ตามเวลาไทย) ว่างคือไม่จำกัด
 *
 * ค่า DO กับหัวข้อที่ตั้งเบิกไปพร้อมกันอยู่แถวเดียวกัน
 * หัวข้อที่เพิ่มแล้วตั้งเบิกเพิ่มเติมวันหลังเป็นอีกแถว (ค่า DO ว่าง) บัญชีกระทบยอดตามวันที่เบิกเงินได้ตรง
 */
export async function claimReportRows(from?: string, to?: string): Promise<ClaimReportRow[]> {
  const [mains, extras] = await Promise.all([
    db.select({
      jobId: jobs.id, claimedOn: bangkokDay(sql`${jobs.doClaimedAt}`), arrivedAt, blNo: jobs.blNo, doPayAmount: jobs.doPayAmount,
    }).from(jobs).where(and(
      isNotNull(jobs.doClaimedAt),
      eq(jobs.isArchived, false),
      ...jobCreatedConditions(sql`${jobs.doClaimedAt}`, from, to),
    )),
    db.select({
      jobId: jobs.id, claimedOn: bangkokDay(sql`${doCharges.claimedAt}`), arrivedAt, blNo: jobs.blNo,
      topic: doCharges.topicName, amount: doCharges.amount, note: doCharges.note,
    }).from(doCharges).innerJoin(jobs, eq(jobs.id, doCharges.jobId)).where(and(
      isNotNull(doCharges.claimedAt),
      eq(jobs.isArchived, false),
      ...jobCreatedConditions(sql`${doCharges.claimedAt}`, from, to),
    )).orderBy(asc(doCharges.createdAt)),
  ]);
  const rows = new Map<string, ClaimReportRow>();
  for (const m of mains) {
    rows.set(`${m.jobId}|${m.claimedOn}`, { claimedOn: m.claimedOn, arrivedAt: m.arrivedAt, blNo: m.blNo, doPayAmount: m.doPayAmount, charges: [] });
  }
  for (const e of extras) {
    const key = `${e.jobId}|${e.claimedOn}`;
    const row = rows.get(key) ?? { claimedOn: e.claimedOn, arrivedAt: e.arrivedAt, blNo: e.blNo, doPayAmount: null, charges: [] };
    row.charges.push({ topic: e.topic, amount: e.amount, note: e.note });
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => a.claimedOn.localeCompare(b.claimedOn) || (a.blNo ?? '').localeCompare(b.blNo ?? ''));
}

/**
 * ข้อความวันเวลาไทยจากฐาน → Date ที่ exceljs เขียนลงไฟล์ตรงตามตัวเลข
 * exceljs ถือ Date เป็น UTC จึงสร้างด้วย Date.UTC ไม่ให้เขตเวลาของเครื่องเลื่อนชั่วโมง
 */
function excelDate(value: string): Date {
  const [y, m, d, hh = 0, mi = 0] = value.split(/[-\s:]/).map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mi));
}

const money = (v: string | null) => (v === null || v === '' ? null : Number(v));

const COLUMN_LETTERS = (n: number) => {
  let out = '';
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) out = String.fromCharCode(65 + ((i - 1) % 26)) + out;
  return out;
};

/**
 * ยอดเงินเก็บเป็นตัวเลขจริง ไม่ใช่ข้อความ เปิดใน Excel แล้วบวกลบต่อได้ทันที
 * วันที่เก็บเป็นวันที่จริงแสดงแบบ วว/ดด/ปปปป ตามที่ทีมใช้ เรียงหรือกรองตามวันได้
 * หัวข้อค่าใช้จ่ายแยกคอลัมน์ละหัวข้อ (ตามที่มีในช่วงนั้น) · ท้ายแถวมียอดรวมของแถว · ท้ายตารางมีแถวรวมเป็นสูตร SUM
 */
export async function claimReportXlsx(rows: ClaimReportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ตั้งเบิกแล้ว', { views: [{ state: 'frozen', ySplit: 1 }] });
  const topics = [...new Set(rows.flatMap((r) => r.charges.map((c) => c.topic)))];
  const moneyStyle = { numFmt: '#,##0.00' };
  ws.columns = [
    { header: 'วันที่ตั้งเบิก', key: 'claimedOn', width: 14, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'วันที่ส่งรายการมา', key: 'arrivedAt', width: 18, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
    { header: 'เลข BL', key: 'blNo', width: 22 },
    { header: 'ยอดค่า DO', key: 'doPay', width: 14, style: moneyStyle },
    ...topics.map((t, i) => ({ header: t, key: `t${i}`, width: Math.max(14, t.length + 4), style: moneyStyle })),
    { header: 'หมายเหตุ', key: 'note', width: 28 },
    { header: 'รวม', key: 'total', width: 14, style: moneyStyle },
  ];
  ws.getRow(1).font = { bold: true };

  const firstMoney = 4;
  const lastMoney = firstMoney + topics.length;
  const totalCol = lastMoney + 2;
  for (const [i, r] of rows.entries()) {
    const values: Record<string, unknown> = {
      claimedOn: excelDate(r.claimedOn),
      arrivedAt: r.arrivedAt ? excelDate(r.arrivedAt) : null,
      blNo: r.blNo ?? '',
      doPay: money(r.doPayAmount),
      note: [r.doPayAmount === null ? 'ตั้งเบิกเพิ่มเติม' : '',
        ...r.charges.filter((c) => c.note).map((c) => `${c.topic}: ${c.note}`)].filter(Boolean).join(' · '),
    };
    // หัวข้อเดียวกันสองบรรทัดในวันเดียวกัน (เช่น DEM สองรอบ) บวกรวมในช่องเดียว
    topics.forEach((t, k) => {
      const lines = r.charges.filter((c) => c.topic === t);
      values[`t${k}`] = lines.length ? lines.reduce((sum, c) => sum + Number(c.amount), 0) : null;
    });
    const row = ws.addRow(values);
    const n = i + 2;
    row.getCell(totalCol).value = { formula: `SUM(${COLUMN_LETTERS(firstMoney)}${n}:${COLUMN_LETTERS(lastMoney)}${n})` };
  }

  if (rows.length) {
    const last = rows.length + 1;
    const total = ws.addRow({ blNo: 'รวม' });
    for (let c = firstMoney; c <= lastMoney; c += 1) {
      total.getCell(c).value = { formula: `SUM(${COLUMN_LETTERS(c)}2:${COLUMN_LETTERS(c)}${last})` };
    }
    total.getCell(totalCol).value = { formula: `SUM(${COLUMN_LETTERS(totalCol)}2:${COLUMN_LETTERS(totalCol)}${last})` };
    total.font = { bold: true };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** ชื่อไฟล์บอกช่วงวันที่ เปิดหลายไฟล์พร้อมกันจะได้ไม่สับสน */
export function claimReportFileName(from?: string, to?: string): string {
  const range = from || to ? `_${from || 'เริ่มต้น'}_ถึง_${to || 'ล่าสุด'}` : '';
  return `ตั้งเบิกค่าDO${range}.xlsx`;
}
