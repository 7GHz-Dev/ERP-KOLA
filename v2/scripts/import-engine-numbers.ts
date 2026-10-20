/**
 * นำเข้าเลขเครื่องที่ออกไปแล้วเข้าตาราง engine_numbers
 *
 *   npx tsx scripts/import-engine-numbers.ts <ไฟล์.csv>
 *
 * รับ CSV ที่มีหัวคอลัมน์ RANDOM_ENG, FULL_ENG, CHASSIS, DATE_RAN (+ BL_NO, INVOICE_NO, SOURCE_FILE ถ้ามี)
 *   - export ของตาราง APP_RANDOM_ENG บน SQL Server ของโปรแกรมเก่า (db_random_engine.csv)
 *   - export ของ engine.db ของโปรแกรม imp
 * รันซ้ำได้ แถวที่มีแล้ว (เลข + chassis เดียวกัน) จะข้าม · ต้องสร้างตารางก่อนด้วย scripts/migrate-engine-numbers.ts
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

loadEnv();

/** CSV แบบมีเครื่องหมายคำพูด  คืนแถวเป็น object ตามหัวคอลัมน์ */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = []; let field = ''; let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  const cols = (head ?? []).map((h) => h.trim().toUpperCase());
  return body.map((r) => Object.fromEntries(cols.map((c, i) => [c, (r[i] ?? '').trim()])));
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error('ระบุไฟล์ CSV: npx tsx scripts/import-engine-numbers.ts <ไฟล์.csv>');
  const rows = parseCsv(readFileSync(file, 'utf8'));
  const valid = rows.filter((r) => /^\d{7}$/.test(r.RANDOM_ENG ?? '') && r.CHASSIS);
  const skipped = rows.length - valid.length;
  const source = `import:${basename(file)}`;

  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  let added = 0;
  try {
    for (let i = 0; i < valid.length; i += 500) {
      const chunk = valid.slice(i, i + 500).map((r) => ({
        id: `ENG-${randomBytes(10).toString('hex').toUpperCase()}`,
        random_eng: r.RANDOM_ENG, full_eng: r.FULL_ENG || null, chassis: r.CHASSIS,
        date_ran: r.DATE_RAN || null, bl_no: r.BL_NO || null, invoice_no: r.INVOICE_NO || null,
        source_file: r.SOURCE_FILE || source,
      }));
      const res = await sql`insert into engine_numbers ${sql(chunk)}
        on conflict (random_eng, chassis) do nothing returning id`;
      added += res.length;
    }
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from engine_numbers`;
    console.log(`เพิ่ม ${added} จาก ${valid.length} แถว${skipped ? ` · ข้าม ${skipped} แถวที่เลขไม่ใช่ 7 หลักหรือไม่มี chassis` : ''}`);
    console.log(`ในตารางมีทั้งหมด ${n} เลข`);
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
