import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { jobs } from '@/db/schema';
import { jobCreatedConditions } from './job-created-date';

/**
 * ไฟล์ตารางงานตามแบบฟอร์มที่ทีมใช้กันอยู่เดิม
 *
 * หัวคอลัมน์และลำดับยกมาจากไฟล์จริงของผู้ใช้ทั้งแถว ไม่ได้จัดใหม่
 * เพราะปลายทางเป็นไฟล์ที่เอาไปวางต่อในตารางหลักที่ใช้กันอยู่แล้ว
 * ถ้าสลับคอลัมน์หรือเปลี่ยนคำ คนรับไฟล์ต้องมานั่งจับคู่ใหม่ทุกครั้ง
 *
 * ช่องที่ระบบยังไม่ได้เก็บข้อมูลไว้ (AT-MAESOT · OPEN · K · O · REMARK)
 * คงหัวคอลัมน์ไว้แต่ปล่อยว่าง ให้คนกรอกเองใน Excel ภายหลัง
 * ตัดออกไม่ได้เพราะตำแหน่งคอลัมน์ต้องตรงกับไฟล์เดิม
 */

export const TEMPLATE_COLUMNS = [
  'CUSTOMER', 'ETA', 'ประเภท', 'INV.', 'SUR', 'TRANSPORT', 'AT-MAESOT', 'OPEN',
  'SHIPPER', 'CON', 'BILL OF LADING', 'CONTAINER NO.', 'UNIT', 'WEIGHT',
  'SHIPLINE', 'VESSEL', 'PORT', 'REF', 'REMARK', 'CONSIGNEE', 'NOTIFY',
  'K', 'O', 'DEM', 'DEM DATE', 'DET', 'DET DATE',
] as const;

/** วันที่ในไฟล์นี้เขียนแบบ d/m/yy ตามที่ทีมใช้ ไม่ใช่ dd/mm/yyyy แบบในระบบ */
function tplDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const iso = value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  return `${Number(m[3])}/${Number(m[2])}/${m[1].slice(2)}`;
}

/** บวกวันเพื่อหาวันสุดท้ายของ DEM/DET เหมือนที่ตารางในระบบคำนวณ */
function addDays(value: string | null, days: number | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + (Number(days) || 0));
  return d.toISOString().slice(0, 10);
}

/** ตัวเลขมีลูกน้ำคั่นหลักพันตามที่ไฟล์เดิมเขียน เช่น 10,750 */
function tplNumber(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

/**
 * ชื่อย่อที่ไฟล์เดิมใช้ในช่อง CONSIGNEE และ NOTIFY
 *
 * ไฟล์ต้นฉบับเขียน "MSFZ" กับ "KOLA" ไม่ใช่ชื่อบริษัทเต็ม
 * จับจากชื่อใน Master Data ไม่ผูก id ตรง ๆ เผื่อ Master ถูกสร้างใหม่
 */
function shortName(name: string | null): string {
  if (!name) return '';
  const n = name.toUpperCase();
  if (/MAESOT\s*FREEZONE|MSFZ/.test(n)) return 'MSFZ';
  if (/KOLA\s*SHIPPING/.test(n)) return 'KOLA';
  return name;
}

export type TemplateFilter = { jobIds?: string[]; anApprovedOnly?: boolean; createdFrom?: string; createdTo?: string };

/**
 * ดึงงานออกมาเป็นแถวตามแบบฟอร์ม
 *
 * รวมเลขตู้ของงานเดียวกันไว้ช่องเดียวคั่นด้วย "," เพราะไฟล์เดิมเป็นหนึ่งแถวต่อหนึ่งงาน
 * ไม่ใช่หนึ่งแถวต่อหนึ่งตู้
 */
export async function templateRows(filter: TemplateFilter = {}) {
  const rows = await db.execute(sql`
    select j.job_no,
           j.eta::text                as eta,
           j.transport_date::text     as transport_date,
           j.bl_no, j.vessel, j.voyage, j.shipline,
           j.unit_amount::float8      as unit_amount,
           j.gross_weight::float8     as gross_weight,
           j.dem_days, j.det_days,
           j.surrender_status, j.draft_ref_no, j.customer_note,
           person.name                as person_name,
           shipper.name               as shipper_name,
           consignee.name             as consignee_name,
           notify.name                as notify_name,
           terminal.name              as terminal_name,
           job_type.name              as job_type_name,
           (select string_agg(c.container_no, ',' order by c.container_no)
              from containers c where c.job_id = j.id)          as container_nos,
           (select count(*)::int from containers c
             where c.job_id = j.id)                             as container_count,
           /* INV. = มีไฟล์ Invoice สินค้าปัจจุบันแล้วหรือยัง */
           (select count(*)::int from files f
             where f.job_id = j.id and f.category = 'INVOICE_GOODS'
               and f.is_current)                                as has_invoice
      from jobs j
      left join master_records person    on person.id    = j.person_id
      left join master_records shipper   on shipper.id   = j.shipper_id
      left join master_records consignee on consignee.id = j.consignee_id
      left join master_records notify    on notify.id    = j.notify_party_id
      left join master_records terminal  on terminal.id  = j.terminal_id
      left join master_records job_type  on job_type.id  = j.job_type_id
     where j.is_archived = false
       ${sql.join(jobCreatedConditions(sql`j.created_at`, filter.createdFrom, filter.createdTo).map(condition => sql`and ${condition}`), sql` `)}
       ${filter.jobIds?.length ? sql`and j.id in ${filter.jobIds}` : sql``}
       ${filter.anApprovedOnly
         ? sql`and exists (
                 select 1 from approvals a
                  where a.job_id = j.id and a.approval_type = 'AN'
                    and a.status = 'APPROVED')`
         : sql``}
     order by j.eta nulls last, j.job_no
  `) as unknown as Array<Record<string, unknown>>;

  return rows.map((r) => {
    const eta = (r.eta as string | null) ?? null;
    const transport = (r.transport_date as string | null) ?? null;
    const cell: Record<string, string> = {
      CUSTOMER: (r.person_name as string) ?? '',
      ETA: tplDate(eta),
      'ประเภท': r.job_type_name === 'MSFZ - USED CAR' ? 'MSFZ - รถยนต์เก่า' : (r.job_type_name as string) ?? '',
      // Y = แนบ Invoice สินค้าแล้ว · ยังไม่แนบปล่อยว่างตามไฟล์เดิม
      'INV.': Number(r.has_invoice) > 0 ? 'Y' : '',
      // เว้นว่างทุกงานตามแบบฟอร์มส่งออก
      SUR: '',
      TRANSPORT: tplDate(transport),
      'AT-MAESOT': '',
      OPEN: '',
      SHIPPER: (r.shipper_name as string) ?? '',
      CON: String(r.container_count ?? 0) === '0' ? '' : String(r.container_count),
      'BILL OF LADING': (r.bl_no as string) ?? '',
      'CONTAINER NO.': (r.container_nos as string) ?? '',
      UNIT: tplNumber(r.unit_amount),
      WEIGHT: tplNumber(r.gross_weight),
      SHIPLINE: (r.shipline as string) ?? '',
      // ไฟล์เดิมเขียนเรือกับเที่ยวรวมกันเป็น "FENGYUNHE V.1924S"
      VESSEL: [r.vessel, r.voyage].filter(Boolean).join(' V.'),
      PORT: (r.terminal_name as string) ?? '',
      REF: (r.draft_ref_no as string) ?? '',
      REMARK: (r.customer_note as string) ?? '',
      CONSIGNEE: shortName((r.consignee_name as string) ?? null),
      NOTIFY: shortName((r.notify_name as string) ?? null),
      K: '',
      O: '',
      DEM: String(r.dem_days ?? ''),
      'DEM DATE': tplDate(addDays(eta, r.dem_days as number)),
      DET: String(r.det_days ?? ''),
      'DET DATE': tplDate(addDays(transport, r.det_days as number)),
    };
    return cell;
  });
}

/** ใส่เครื่องหมายคำพูดเมื่อค่ามีลูกน้ำ คำพูด หรือขึ้นบรรทัดใหม่ ตามมาตรฐาน CSV */
function csvCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * ไฟล์ CSV พร้อมดาวน์โหลด
 *
 * นำหน้าด้วย BOM เพราะ Excel บน Windows ที่ตั้งภาษาไทยไว้จะเดารหัสเป็น Windows-874
 * แล้วภาษาไทยกลายเป็นตัวยึกยือ BOM บอกให้รู้ว่าเป็น UTF-8
 */
export function templateCsv(rows: Array<Record<string, string>>): string {
  const lines = [TEMPLATE_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push(TEMPLATE_COLUMNS.map((c) => csvCell(r[c] ?? '')).join(','));
  }
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** ชื่อไฟล์ที่ดาวน์โหลดออกไป — มีวันที่กำกับไว้ให้รู้ว่าเป็นข้อมูลรอบไหน */
export function templateFileName(): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `ตารางงาน ${p(now.getDate())}-${p(now.getMonth() + 1)}-${now.getFullYear()}.csv`;
}

/** ชื่อของงานหนึ่งใบ ใช้ตอน export ทีละงาน */
export async function jobNoOf(jobId: string): Promise<string | null> {
  const [row] = await db.select({ jobNo: jobs.jobNo }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
  return row?.jobNo ?? null;
}
