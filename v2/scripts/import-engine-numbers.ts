/**
 * นำเข้าเลขเครื่องที่ออกไปแล้วเข้าตาราง engine_numbers — เลขที่อยู่ในตารางนี้ระบบจะไม่สุ่มซ้ำอีก
 *
 *   npm run engine:import -- <ไฟล์.csv|ไฟล์.xlsx> [ไฟล์อื่น ...] [--dry]
 *
 * รับได้สองแบบ
 *   CSV  หัวคอลัมน์ RANDOM_ENG, FULL_ENG, CHASSIS, DATE_RAN (+ BL_NO, INVOICE_NO, SOURCE_FILE ถ้ามี)
 *        export ของตาราง APP_RANDOM_ENG บน SQL Server ของโปรแกรมเก่า (db_random_engine.csv) / engine.db ของโปรแกรม imp
 *   XLSX ชีตแรก หัวคอลัมน์มี "Chassis" กับ "Engine" (เช่น "Chassis No" / "Engine No") — เลขสุ่มคือ 7 หลักท้ายเลขเครื่อง
 *        เช่น HR16-7702758 → 7702758 · แถวที่เลขเครื่องไม่ได้ลงท้าย -7 หลัก (เลขจริงของรถ) ไม่ใช่เลขสุ่ม ข้ามไป
 * CSV ที่เลขหน้าเป็นศูนย์หายไปตอนเปิดใน Excel (RANDOM_ENG 100709 แต่ FULL_ENG 1AZ-0100709) ใช้ 7 หลักท้าย FULL_ENG แทน
 *
 * รันซ้ำได้ แถวที่มีแล้ว (เลข + chassis เดียวกัน) จะข้าม · --dry ตรวจอย่างเดียวไม่เขียน
 * ต้องสร้างตารางก่อนด้วย scripts/migrate-engine-numbers.ts
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';
import { loadWorkbook, sheetReader } from '../src/lib/draft/sheet';

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

type Row = { number: string; full: string; chassis: string; date: string | null; bl: string | null; invoice: string | null; file: string | null };

const tail7 = (full: string) => /-(\d{7})$/.exec(full.replace(/\s+/g, ''))?.[1] ?? '';

/** อ่านไฟล์เป็นแถวเลขเครื่อง — คืนแถวที่ใช้ได้ กับแถวที่ข้าม (พร้อมเหตุผล) */
export async function readEngineFile(file: string): Promise<{ rows: Row[]; skipped: string[] }> {
  const rows: Row[] = [];
  const skipped: string[] = [];
  if (/\.xlsx$/i.test(file)) {
    const wb = await loadWorkbook(readFileSync(file));
    const ws = sheetReader(wb, wb.worksheets[0]);
    let headRow = 0; let cChassis = 0; let cEngine = 0;
    for (let r = 1; r <= Math.min(ws.maxRow, 10) && !headRow; r++) {
      for (let c = 1; c <= 30; c++) {
        const h = String(ws.value(r, c) ?? '').toUpperCase();
        if (h.includes('CHASSIS')) cChassis = c;
        if (h.includes('ENGINE')) cEngine = c;
      }
      if (cChassis && cEngine) headRow = r; else { cChassis = 0; cEngine = 0; }
    }
    if (!headRow) throw new Error(`${basename(file)}: ไม่พบหัวคอลัมน์ Chassis / Engine ใน 10 แถวแรก`);
    for (let r = headRow + 1; r <= ws.maxRow; r++) {
      const chassis = String(ws.value(r, cChassis) ?? '').trim().replace(/\s+/g, '');
      const full = String(ws.value(r, cEngine) ?? '').trim().replace(/\s+/g, '');
      if (!chassis && !full) continue;
      const number = tail7(full);
      if (!chassis || !number) { skipped.push(`แถว ${r}: ${chassis || '(ไม่มี chassis)'} · ${full || '(ไม่มีเลขเครื่อง)'}`); continue; }
      rows.push({ number, full, chassis, date: null, bl: null, invoice: null, file: null });
    }
    return { rows, skipped };
  }
  for (const r of parseCsv(readFileSync(file, 'utf8'))) {
    const number = /^\d{7}$/.test(r.RANDOM_ENG ?? '') ? r.RANDOM_ENG : tail7(r.FULL_ENG ?? '');
    if (!number || !r.CHASSIS) { skipped.push(`${r.RANDOM_ENG ?? ''} · ${r.FULL_ENG ?? ''} · ${r.CHASSIS ?? ''}`); continue; }
    rows.push({ number, full: r.FULL_ENG ?? '', chassis: r.CHASSIS, date: r.DATE_RAN || null,
      bl: r.BL_NO || null, invoice: r.INVOICE_NO || null, file: r.SOURCE_FILE || null });
  }
  return { rows, skipped };
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const files = args.filter((a) => a !== '--dry');
  if (!files.length) throw new Error('ระบุไฟล์: npm run engine:import -- <ไฟล์.csv|ไฟล์.xlsx> [--dry]');

  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  try {
    const existing = await sql<{ n: string; c: string }[]>`select random_eng as n, chassis as c from engine_numbers`;
    const owners = new Map<string, Set<string>>();
    for (const e of existing) owners.set(e.n, (owners.get(e.n) ?? new Set()).add(e.c));
    console.log(`ในตารางตอนนี้ ${existing.length} แถว${dry ? ' · โหมดตรวจอย่างเดียว (--dry) ไม่เขียนข้อมูล' : ''}`);

    for (const file of files) {
      const { rows, skipped } = await readEngineFile(file);
      const source = `import:${basename(file)}`;
      // ซ้ำกันเองในไฟล์ (เลข + chassis เดียวกัน) เก็บแถวเดียว
      const seen = new Set<string>();
      const fresh = rows.filter((r) => {
        const k = `${r.number}|${r.chassis}`;
        if (seen.has(k) || owners.get(r.number)?.has(r.chassis)) return false;
        seen.add(k);
        return true;
      });
      // เลขเดียวกันแต่คนละ chassis — ยังนำเข้า (กันไม่ให้สุ่มเลขนี้อีก) แต่แจ้งให้ตรวจ
      const clash = fresh.filter((r) => owners.has(r.number));
      let added = 0;
      if (!dry) {
        for (let i = 0; i < fresh.length; i += 1000) {
          const chunk = fresh.slice(i, i + 1000).map((r) => ({
            id: `ENG-${randomBytes(10).toString('hex').toUpperCase()}`,
            random_eng: r.number, full_eng: r.full || null, chassis: r.chassis,
            date_ran: r.date, bl_no: r.bl, invoice_no: r.invoice, source_file: r.file || source,
          }));
          const res = await sql`insert into engine_numbers ${sql(chunk)}
            on conflict (random_eng, chassis) do nothing returning id`;
          added += res.length;
        }
      }
      for (const r of fresh) owners.set(r.number, (owners.get(r.number) ?? new Set()).add(r.chassis));
      console.log(`\n${basename(file)}: อ่านได้ ${rows.length} แถว · ${dry ? `จะเพิ่ม ${fresh.length}` : `เพิ่ม ${added}`} · มีอยู่แล้ว ${rows.length - fresh.length}`
        + (skipped.length ? ` · ข้าม ${skipped.length} แถวที่ไม่ใช่เลขสุ่ม 7 หลักหรือไม่มี chassis` : ''));
      if (skipped.length) console.log(`  ตัวอย่างที่ข้าม: ${skipped.slice(0, 5).join(' | ')}`);
      if (clash.length) {
        console.log(`  ⚠ เลขเดียวกับที่มีอยู่แล้วแต่คนละ chassis ${clash.length} แถว (นำเข้าด้วย ตรวจได้ที่หน้า Create Cargo Invoice → เลขเครื่องที่ระบบออก):`);
        for (const r of clash.slice(0, 10)) console.log(`    ${r.number} · ${r.full} · ${r.chassis}`);
      }
    }
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from engine_numbers`;
    const [{ u }] = await sql<{ u: number }[]>`select count(distinct random_eng)::int as u from engine_numbers`;
    console.log(`\nในตารางมีทั้งหมด ${n} แถว · เลขสุ่มที่ห้ามออกซ้ำ ${u} เลข`);
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
