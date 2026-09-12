/**
 * นำงานเข้าระบบจากไฟล์ Excel / CSV
 *
 *   npx tsx scripts/import-jobs.ts <ไฟล์.xlsx|csv> --dry   ดูผลก่อน ไม่เขียนอะไร
 *   npx tsx scripts/import-jobs.ts <ไฟล์.xlsx|csv>         เขียนจริง
 *
 * ทำสามอย่างที่พิมพ์มือแล้วพลาดง่าย
 *   1. แปลงชื่อใน Master Data เป็น id ให้เอง — พิมพ์ "SALIM AND SONS INTL" ได้เลย
 *      ไม่ต้องไปหา MD-xxxx มาเอง ซึ่งถ้าใส่ผิดระบบจะแสดงช่องว่างเงียบ ๆ ไม่มี error
 *   2. แปลงวันที่ทุกรูปแบบที่ Excel ชอบเปลี่ยนให้ เป็น YYYY-MM-DD
 *   3. ตรวจค่าที่ระบบรู้จัก (status, source_type) ก่อนเขียน แทนที่จะปล่อยให้เข้าไปแล้ว
 *      ไปโผล่ผิดคิวทีหลัง
 *
 * ทุกงานเขียนใน transaction เดียว ถ้าแถวไหนผิดจะไม่เขียนอะไรเลยสักแถว
 */
import { loadEnv } from '../src/lib/env';
loadEnv();

import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { db } from '../src/db';
import { approvals, bls, jobSequences, jobs, masterRecords } from '../src/db/schema';

const FILE = process.argv[2];
const DRY = process.argv.includes('--dry');

if (!FILE) {
  console.error('ใช้: npx tsx scripts/import-jobs.ts <ไฟล์.xlsx|csv> [--dry]');
  process.exit(1);
}

const newId = (p: string) => `${p}-${randomBytes(10).toString('hex').toUpperCase()}`;

/** สถานะที่ระบบรู้จัก — ต้องตรงกับที่หน้าจอและคิวงานใช้ */
const STATUSES = [
  'WAITING_ENTER_BL', 'WAITING_ARRIVAL_NOTICE_BL',
  'AN_APPROVED', 'FN_APPROVED', 'DO_SENT', 'RELEASED',
];

/*
 * คำที่คนมักพิมพ์แทนสถานะจริง
 * "AN" เป็นชื่อ "ที่มาของงาน" ไม่ใช่สถานะ แต่พิมพ์กันติดปาก จึงรับไว้แล้วแปลงให้
 */
const STATUS_ALIAS: Record<string, string> = {
  AN: 'WAITING_ENTER_BL',
  BL: 'WAITING_ARRIVAL_NOTICE_BL',
};

/** ช่องที่เก็บ id ของ Master Data → ชนิดที่ต้องไปค้น */
const MASTER_FIELDS: Record<string, string> = {
  shipper_id: 'shippers',
  consignee_id: 'consignees',
  notify_party_id: 'notify',
  person_id: 'people',
  port_id: 'ports',
  terminal_id: 'terminals',
  job_type_id: 'jobTypes',
  loading_type_id: 'loadingTypes',
};

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/**
 * วันที่จาก Excel มาได้หลายแบบปนกัน — เลขซีเรียล, d/m/yy, yyyy-mm-dd
 *
 * ปีสองหลักตีเป็น 20xx เสมอ เพราะงานนำเข้าไม่มีย้อนไปศตวรรษก่อน
 * เดือน/วันสลับกันได้ จึงยึด d/m/y ตามที่คนไทยเขียน ไม่ใช่ m/d/y แบบอเมริกัน
 */
function toDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;

  // เลขซีเรียลของ Excel (นับจาก 1899-12-30)
  if (/^\d+(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s);
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]);
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    // ปี พ.ศ. ที่หลุดมา แปลงกลับเป็น ค.ศ.
    if (year > 2400) year -= 543;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

const int = (v: unknown): number => {
  const n = Number(str(v).replace(/,/g, ''));
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
/** ค่าจริง/เท็จจาก Excel ซึ่งพิมพ์กันหลายแบบ */
const bool = (v: unknown): boolean =>
  ['TRUE', 'YES', 'Y', '1', 'X', 'ใช่'].includes(str(v).toUpperCase());

const numOrNull = (v: unknown): string | null => {
  const s = str(v);
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? String(n) : null;
};

type Issue = { row: number; msg: string };

/**
 * อ่านแถวจาก .xlsx หรือ .csv ให้เป็นรูปเดียวกัน
 *
 * ใช้ exceljs ที่โปรเจกต์มีอยู่แล้ว ไม่ต้องลงแพ็กเกจเพิ่ม
 * ค่าที่เป็นสูตรเอาผลลัพธ์ ไม่ใช่ตัวสูตร และวันที่ที่ Excel แปลงเป็น Date object แล้ว
 * ส่งต่อเป็น ISO เพื่อให้ toDate() อ่านได้เหมือนกรณีอื่น
 */
async function readRows(file: string) {
  const wb = new ExcelJS.Workbook();
  if (/\.csv$/i.test(file)) {
    // อ่านเป็นข้อความเองแทน exceljs.csv.readFile ซึ่งเดาชนิดค่าแล้วทำให้วันที่เพี้ยน
    const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim());
    const split = (line: string) => {
      const out: string[] = [];
      let cur = '';
      let quoted = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
          else quoted = !quoted;
        } else if (c === ',' && !quoted) { out.push(cur); cur = ''; }
        else cur += c;
      }
      out.push(cur);
      return out;
    };
    const head = split(lines[0]).map((h) => h.trim());
    const rows = lines.slice(1).map((l) => {
      const cells = split(l);
      const o: Record<string, unknown> = {};
      head.forEach((h, i) => { o[h] = (cells[i] ?? '').trim(); });
      return o;
    });
    return { headers: head, raw: rows };
  }

  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('ไม่พบชีตในไฟล์');

  const head: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    head[col - 1] = String(cell.value ?? '').trim();
  });

  const cellText = (v: ExcelJS.CellValue): string => {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'object') {
      const o = v as unknown as Record<string, unknown>;
      if ('result' in o) return String(o.result ?? '');
      if ('text' in o) return String(o.text ?? '');
      if ('richText' in o) {
        return (o.richText as Array<{ text: string }>).map((t) => t.text).join('');
      }
    }
    return String(v);
  };

  const rows: Record<string, unknown>[] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n === 1) return;
    const o: Record<string, unknown> = {};
    let any = false;
    head.forEach((h, i) => {
      if (!h) return;
      const t = cellText(row.getCell(i + 1).value).trim();
      o[h] = t;
      if (t) any = true;
    });
    if (any) rows.push(o);
  });
  return { headers: head.filter(Boolean), raw: rows };
}

async function main() {
  /* ---------- อ่านไฟล์ ---------- */
  const { headers, raw } = await readRows(FILE);
  if (!raw.length) throw new Error('ไฟล์ไม่มีข้อมูล');
  const fix = (h: string) => {
    const k = h.trim().toLowerCase().replace(/\s+/g, '_');
    if (k === 'shipper_i' || k === 'shipper') return 'shipper_id';
    if (k === 'consignee') return 'consignee_id';
    if (k === 'notify_party' || k === 'notify') return 'notify_party_id';
    if (k === 'terminal_' || k === 'terminal') return 'terminal_id';
    if (k === 'job_type' || k === 'jobtype') return 'job_type_id';
    return k;
  };
  console.log(`อ่านไฟล์: ${FILE}`);
  console.log(`หัวคอลัมน์ ${headers.length} ช่อง · ข้อมูล ${raw.length} แถว\n`);

  /* ---------- ตารางแปลงชื่อ → id ---------- */
  const master = await db
    .select({ id: masterRecords.id, type: masterRecords.type, code: masterRecords.code, name: masterRecords.name })
    .from(masterRecords);
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9ก-๙]/g, '');
  const lookup = (type: string, value: string): string | null => {
    if (/^MD-[0-9A-F]{20}$/.test(value)) return value;       // ใส่ id มาเองอยู่แล้ว
    const pool = master.filter((m) => m.type === type);
    const t = norm(value);
    return (
      pool.find((m) => norm(m.code ?? '') === t)?.id
      ?? pool.find((m) => norm(m.name) === t)?.id
      // ชื่อในไฟล์มักถูกตัดท้าย เช่น "SALIM AND" จากคอลัมน์แคบ
      ?? pool.find((m) => norm(m.name).startsWith(t) && t.length >= 4)?.id
      ?? null
    );
  };

  /* ---------- แปลงทีละแถว ---------- */
  const issues: Issue[] = [];
  const planned: Array<{
    job: typeof jobs.$inferInsert;
    blNo: string;
    shipperName: string;
    /** ให้ผ่านอนุมัติ AN ของ NAMKANG มาแล้ว — สร้างแถวใน approvals ให้ด้วย */
    anApproved: boolean;
  }> = [];
  const seenJobNo = new Set<string>();

  raw.forEach((rawRow, i) => {
    const n = i + 2;                                    // แถวใน Excel (นับหัวคอลัมน์)
    const r: Record<string, unknown> = {};
    for (const h of headers) r[fix(h)] = rawRow[h];

    const id = str(r.id) || newId('JOB');
    const jobNo = str(r.job_no);
    if (!jobNo) issues.push({ row: n, msg: 'ไม่มี job_no' });
    if (seenJobNo.has(jobNo)) issues.push({ row: n, msg: `job_no ซ้ำในไฟล์: ${jobNo}` });
    seenJobNo.add(jobNo);

    // สถานะ — รับคำย่อที่คนพิมพ์ติดปากแล้วแปลงให้
    const rawStatus = str(r.status).toUpperCase();
    const status = STATUS_ALIAS[rawStatus] ?? rawStatus;
    if (!status) issues.push({ row: n, msg: 'ไม่มี status' });
    else if (!STATUSES.includes(status)) {
      issues.push({ row: n, msg: `status ไม่ถูกต้อง: ${rawStatus}` });
    } else if (STATUS_ALIAS[rawStatus]) {
      console.log(`  แถว ${n}: แปลง status "${rawStatus}" → "${status}"`);
    }

    /*
     * ผ่านอนุมัติ AN ของ NAMKANG มาแล้ว
     *
     * ตั้ง status เป็น AN_APPROVED อย่างเดียวไม่พอ คิวงานอ่านจากตาราง approvals
     * ไม่ได้อ่านจาก status จึงต้องสร้างแถวอนุมัติให้ด้วย ตรงนี้ทำให้อัตโนมัติ
     * จะได้ไม่ต้องทำชีตที่สองเอง แล้วเผลอใส่ไม่ครบจนงานหายไปจากทุกคิว
     */
    const anApproved = bool(r.an_approved);

    const sourceType = str(r.source_type).toUpperCase() || null;
    if (sourceType && !['AN', 'BL'].includes(sourceType)) {
      issues.push({ row: n, msg: `source_type ต้องเป็น AN หรือ BL: ${sourceType}` });
    }

    if (anApproved && status && status !== 'AN_APPROVED'
        && !['FN_APPROVED', 'DO_SENT', 'RELEASED'].includes(status)) {
      issues.push({
        row: n,
        msg: `an_approved = ใช่ แต่ status เป็น ${status}`
          + ' — ต้องเป็น AN_APPROVED หรือขั้นที่เลยไปแล้ว',
      });
    }

    const eta = str(r.eta) ? toDate(r.eta) : null;
    if (str(r.eta) && !eta) issues.push({ row: n, msg: `eta อ่านไม่ออก: ${str(r.eta)}` });

    // ช่อง Master — แปลงชื่อเป็น id
    const ids: Record<string, string | null> = {};
    for (const [field, type] of Object.entries(MASTER_FIELDS)) {
      const v = str(r[field]);
      if (!v) { ids[field] = null; continue; }
      const found = lookup(type, v);
      if (!found) issues.push({ row: n, msg: `${field}: ไม่พบ "${v}" ใน Master Data (${type})` });
      else if (found !== v) console.log(`  แถว ${n}: ${field} "${v}" → ${found}`);
      ids[field] = found;
    }

    planned.push({
      anApproved,
      blNo: str(r.bl_no),
      shipperName: str(r.shipper_id),
      job: {
        id,
        jobNo,
        status,
        sourceType,
        blNo: str(r.bl_no) || null,
        blType: str(r.bl_type) || null,
        vessel: str(r.vessel) || null,
        voyage: str(r.voyage) || null,
        eta,
        etaIsOfficial: false,
        shipline: str(r.shipline) || null,
        originPort: str(r.origin_port).toUpperCase() || null,
        demDays: int(r.dem_days),
        detDays: int(r.det_days),
        product: str(r.product) || null,
        unitAmount: numOrNull(r.unit_amount),
        packageType: str(r.package_type) || null,
        grossWeight: numOrNull(r.gross_weight),
        shipperId: ids.shipper_id,
        consigneeId: ids.consignee_id,
        notifyPartyId: ids.notify_party_id,
        personId: ids.person_id,
        portId: ids.port_id,
        terminalId: ids.terminal_id,
        jobTypeId: ids.job_type_id,
        loadingTypeId: ids.loading_type_id,
      },
    });
  });

  /* ---------- ตรวจซ้ำกับของที่มีอยู่ ---------- */
  for (const p of planned) {
    const [dupNo] = await db.select({ n: sql<number>`count(*)::int` })
      .from(jobs).where(eq(jobs.jobNo, p.job.jobNo));
    if (dupNo.n > 0) issues.push({ row: 0, msg: `job_no ${p.job.jobNo} มีอยู่ในระบบแล้ว` });

    /*
     * id ซ้ำเจอบ่อยกว่าที่คิด เพราะคนคัด id ตัวอย่างจากคู่มือไปวางในไฟล์
     * ถ้าไม่ดักตรงนี้จะไปพังตอน insert ซึ่งบอกแค่ว่า "duplicate key" ไม่บอกว่าแถวไหน
     */
    const [dupId] = await db.select({ jobNo: jobs.jobNo })
      .from(jobs).where(eq(jobs.id, p.job.id!)).limit(1);
    if (dupId) {
      issues.push({
        row: 0,
        msg: `id ${p.job.id} ถูกใช้โดยงาน ${dupId.jobNo} อยู่แล้ว`
          + ' — เว้นช่อง id ว่างไว้ให้สคริปต์สร้างให้เอง',
      });
    }
  }

  /* ---------- สรุป ---------- */
  console.log('\n========== ค่าที่จะเขียนลงฐานข้อมูล ==========');
  for (const p of planned) {
    const j = p.job;
    console.log(`\n  ${j.jobNo}  (${j.id})`);
    const show: Array<[string, unknown]> = [
      ['status', j.status], ['source_type', j.sourceType],
      ['bl_no', j.blNo], ['vessel', j.vessel], ['voyage', j.voyage],
      ['eta', j.eta], ['shipline', j.shipline], ['origin_port', j.originPort],
      ['dem/det', `${j.demDays} / ${j.detDays}`],
      ['อนุมัติ AN', p.anApproved ? 'ใช่ — สร้างแถวใน approvals ให้' : 'ยังไม่อนุมัติ'],
      ['shipper_id', j.shipperId], ['consignee_id', j.consigneeId],
      ['notify_party_id', j.notifyPartyId], ['person_id', j.personId],
      ['port_id', j.portId], ['terminal_id', j.terminalId], ['job_type_id', j.jobTypeId],
    ];
    for (const [k, v] of show) {
      console.log(`     ${k.padEnd(17)} ${v === null || v === '' ? '—' : v}`);
    }
  }

  if (issues.length) {
    console.log('\n========== ปัญหาที่ต้องแก้ ==========');
    for (const p of issues) console.log(`  ${p.row ? `แถว ${p.row}: ` : ''}${p.msg}`);
    console.log('\nไม่เขียนอะไรลงฐานข้อมูล แก้ไฟล์แล้วรันใหม่');
    process.exit(1);
  }

  if (DRY) {
    console.log('\n[--dry] ตรวจผ่านหมด ยังไม่เขียนอะไรลงฐานข้อมูล');
    console.log('เขียนจริงด้วยคำสั่งเดิมแต่ตัด --dry ออก');
    process.exit(0);
  }

  /* ---------- เขียนจริง ---------- */
  await db.transaction(async (tx) => {
    for (const p of planned) {
      await tx.insert(jobs).values(p.job);
      // ลง bls ด้วยเสมอ เหมือนที่หน้ารับงานทำ แม้งานจะมี BL ใบเดียว
      if (p.blNo) {
        await tx.insert(bls).values({
          id: newId('BL'),
          jobId: p.job.id!,
          blNo: p.blNo,
          blType: p.job.blType ?? null,
          shipperId: p.job.shipperId ?? null,
          shipperName: p.shipperName,
        });
      }

      /*
       * แถวอนุมัติ AN ที่ NAMKANG กดผ่านแล้ว
       *
       * เขียนค่าเดียวกับที่ decideApproval() เขียนตอนกดบนหน้าจอจริง
       * requested_at ใช้หาแถวล่าสุดของงาน จึงต้องมีค่าเสมอ ปล่อยให้ฐานข้อมูลใส่ now()
       */
      if (p.anApproved) {
        await tx.insert(approvals).values({
          id: newId('APR'),
          jobId: p.job.id!,
          approvalType: 'AN',
          status: 'APPROVED',
          decidedAt: new Date(),
        });
      }
    }

    /*
     * ดันลำดับเลขงานให้เลยเลขที่เพิ่ง import
     * ไม่งั้นงานที่รับใหม่ในระบบจะได้เลขซ้ำกับที่ import เข้ามา
     */
    const maxSeq = Math.max(
      ...planned.map((p) => Number(/KOLA-\d{4}-(\d+)/.exec(p.job.jobNo)?.[1] ?? 0)),
    );
    const year = String(new Date().getFullYear());
    const [seq] = await tx.select().from(jobSequences)
      .where(and(eq(jobSequences.year, year), eq(jobSequences.prefix, 'KOLA')))
      .limit(1);
    if (seq && maxSeq > seq.lastNumber) {
      await tx.update(jobSequences)
        .set({ lastNumber: maxSeq, updatedAt: new Date() })
        .where(eq(jobSequences.id, seq.id));
      console.log(`\nดันลำดับเลขงาน KOLA-${year} จาก ${seq.lastNumber} → ${maxSeq}`);
    }
  });

  console.log(`\nเขียนเรียบร้อย ${planned.length} งาน`);
  process.exit(0);
}

main().catch((e) => {
  console.error('\nล้มเหลว:', e instanceof Error ? e.message : e);
  process.exit(1);
});
