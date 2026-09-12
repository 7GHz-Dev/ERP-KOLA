/**
 * ถอดงานที่มีอยู่ในระบบออกมาเป็นไฟล์ CSV ที่ import กลับเข้าไปได้
 *
 *   npx tsx scripts/export-jobs.ts KOLA-2026-0041
 *   npx tsx scripts/export-jobs.ts KOLA-2026-0041 KOLA-2026-0037 -o งาน.csv
 *   npx tsx scripts/export-jobs.ts --all -o ทั้งหมด.csv
 *
 * เป็นคู่ตรงข้ามของ import-jobs.ts — หัวคอลัมน์และค่าที่ได้ ป้อนกลับเข้าสคริปต์นั้นได้เลย
 * ใช้ทำ template จากงานจริงที่กรอกครบแล้ว จะได้ไม่ต้องนั่งไล่ว่าช่องไหนใส่อะไร
 *
 * แปลง id ของ Master Data กลับเป็นชื่อให้ เพราะ import อ่านชื่อได้อยู่แล้ว
 * และชื่อเป็นสิ่งที่คนตรวจทานในไฟล์ได้จริง ต่างจาก MD-xxxx ที่มองแล้วไม่รู้ว่าอะไร
 *
 * ไม่รวมช่องที่เป็นร่องรอยการทำงาน (ใครกดอะไรเมื่อไหร่) เพราะ import กลับเข้าไป
 * แล้วจะทำให้งานใหม่ไปโผล่ผิดคิว — ยกเว้นธง an_approved ที่ import รองรับอยู่แล้ว
 */
import { loadEnv } from '../src/lib/env';
loadEnv();

import { writeFileSync } from 'node:fs';
import { inArray, sql } from 'drizzle-orm';
import { db } from '../src/db';

const args = process.argv.slice(2);
const outIdx = args.findIndex((a) => a === '-o' || a === '--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
const all = args.includes('--all');
const jobNos = args.filter((a, i) =>
  !a.startsWith('-') && i !== outIdx + 1);

if (!all && !jobNos.length) {
  console.error('ใช้: npx tsx scripts/export-jobs.ts <job_no...> [-o ไฟล์.csv]');
  console.error('     npx tsx scripts/export-jobs.ts --all -o ทั้งหมด.csv');
  process.exit(1);
}

/*
 * หัวคอลัมน์ — ต้องตรงกับที่ import-jobs.ts อ่าน
 * เรียงตามลำดับที่คนกรอกจริง: ระบุงาน → เรือ → สินค้า → คู่ค้า
 */
const COLUMNS = [
  'id', 'job_no', 'status', 'an_approved', 'source_type',
  'bl_no', 'bl_type', 'vessel', 'voyage', 'eta',
  'shipline', 'origin_port', 'dem_days', 'det_days',
  'product', 'unit_amount', 'package_type', 'gross_weight',
  'shipper_id', 'consignee_id', 'notify_party_id',
  'person_id', 'port_id', 'terminal_id', 'job_type_id',
];

/** ตัวเลข numeric ของ Postgres มาเป็น "4.000" — ตัดศูนย์ท้ายให้อ่านง่ายและกรอกกลับง่าย */
const trimNum = (v: unknown): string => {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : s;
};

/** ใส่เครื่องหมายคำพูดเมื่อค่ามีลูกน้ำ คำพูด หรือขึ้นบรรทัดใหม่ ตามมาตรฐาน CSV */
const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function main() {
  const rows = await db.execute(sql`
    select j.job_no, j.status, j.source_type,
           j.bl_no, j.bl_type, j.vessel, j.voyage, j.eta,
           j.shipline, j.origin_port, j.dem_days, j.det_days,
           j.product, j.unit_amount, j.package_type, j.gross_weight,
           s.name  as shipper_name,
           c.name  as consignee_name,
           n.name  as notify_name,
           p.name  as person_name,
           po.name as port_name,
           t.name  as terminal_name,
           jt.name as job_type_name,
           /* ผ่านอนุมัติ AN แล้วหรือยัง — ดูแถวล่าสุดเหมือนที่คิวงานดู */
           (select a.status from approvals a
             where a.job_id = j.id and a.approval_type = 'AN'
             order by a.requested_at desc limit 1) as an_status
      from jobs j
      left join master_records s  on s.id = j.shipper_id
      left join master_records c  on c.id = j.consignee_id
      left join master_records n  on n.id = j.notify_party_id
      left join master_records p  on p.id = j.person_id
      left join master_records po on po.id = j.port_id
      left join master_records t  on t.id = j.terminal_id
      left join master_records jt on jt.id = j.job_type_id
     where j.is_archived = false
       ${all ? sql`` : sql`and j.job_no in ${jobNos}`}
     order by j.job_no
  `) as unknown as Record<string, unknown>[];

  if (!rows.length) {
    console.error(`ไม่พบงาน: ${jobNos.join(', ')}`);
    process.exit(1);
  }

  const lines = [COLUMNS.join(',')];
  for (const r of rows) {
    const cell: Record<string, unknown> = {
      // เว้น id ว่างเสมอ ให้ import สร้างใหม่ ไม่งั้นชนกับงานเดิมที่ยังอยู่ในระบบ
      id: '',
      job_no: r.job_no,
      status: r.status,
      an_approved: r.an_status === 'APPROVED' ? 'TRUE' : '',
      source_type: r.source_type,
      bl_no: r.bl_no,
      bl_type: r.bl_type,
      vessel: r.vessel,
      voyage: r.voyage,
      eta: r.eta,
      shipline: r.shipline,
      origin_port: r.origin_port,
      dem_days: r.dem_days,
      det_days: r.det_days,
      product: r.product,
      unit_amount: trimNum(r.unit_amount),
      package_type: r.package_type,
      gross_weight: trimNum(r.gross_weight),
      shipper_id: r.shipper_name,
      consignee_id: r.consignee_name,
      notify_party_id: r.notify_name,
      person_id: r.person_name,
      port_id: r.port_name,
      terminal_id: r.terminal_name,
      job_type_id: r.job_type_name,
    };
    lines.push(COLUMNS.map((c) => csvCell(cell[c])).join(','));
  }

  const csv = `${lines.join('\n')}\n`;
  if (outFile) {
    // BOM นำหน้า ไม่งั้น Excel เปิดแล้วภาษาไทยเป็นตัวยึกยือ
    writeFileSync(outFile, `﻿${csv}`, 'utf8');
    console.log(`เขียนไฟล์: ${outFile}  (${rows.length} งาน)`);
  } else {
    process.stdout.write(csv);
  }

  /* เตือนเรื่องที่ไฟล์นี้พาไปด้วยไม่ได้ */
  const extra = await db.execute(sql`
    select j.job_no,
           (select count(*)::int from containers c where c.job_id = j.id) as containers,
           (select count(*)::int from bls b where b.job_id = j.id) as bls,
           (select count(*)::int from files f where f.job_id = j.id and f.is_current) as files
      from jobs j
     where j.job_no in ${rows.map((r) => String(r.job_no))}
  `) as unknown as Array<{ job_no: string; containers: number; bls: number; files: number }>;

  const notes = extra.filter((e) => e.containers || e.files || e.bls > 1);
  if (notes.length) {
    console.error('\nสิ่งที่ไฟล์ CSV พาไปด้วยไม่ได้ ต้องทำแยก:');
    for (const e of notes) {
      const parts = [];
      if (e.containers) parts.push(`ตู้ ${e.containers} ตู้`);
      if (e.bls > 1) parts.push(`BL ${e.bls} ใบ`);
      if (e.files) parts.push(`ไฟล์แนบ ${e.files} ไฟล์`);
      console.error(`  ${e.job_no}: ${parts.join(' · ')}`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('ล้มเหลว:', e instanceof Error ? e.message : e);
  process.exit(1);
});
