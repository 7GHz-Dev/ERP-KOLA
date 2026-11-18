/**
 * สร้างฐานข้อมูลระบบทดสอบ (แยกจาก production) — โครงตารางครบ · ข้อมูลพื้นฐานครบ · ไม่มีงาน (Job)
 *
 *   npx tsx scripts/test-env-clone.ts                 ดูแผน (อ่าน production อย่างเดียว ไม่เขียนที่ไหน)
 *   TEST_DATABASE_URL=... TEST_SUPABASE_URL=... TEST_SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx tsx scripts/test-env-clone.ts --apply      สร้างตาราง + คัดลอกข้อมูลพื้นฐานไปฐานทดสอบ
 *
 * คัดลอก   master_records (Shipper · ลูกค้า · Consignee · Notify · ท่า · Job Type · พิกัด · แบบฟอร์มจดหมาย/E-Office ฯลฯ)
 *          users (ล็อกอินชุดเดิม) · engine_numbers (กันเลขเครื่องซ้ำกับที่ออกไปแล้ว)
 *          ไฟล์ใน Storage ที่ข้อมูลพื้นฐานอ้างถึง (แม่แบบจดหมาย DO / E-Office / Web template)
 * ไม่คัดลอก งานทุกอย่าง (jobs · bls · containers · files · approvals · ประวัติ · แพลนลากตู้ · ใบขน · DO · ค่าใช้จ่าย SHIPME ฯลฯ)
 *          sessions · activity_log · job_sequences (เลขงาน/เลขตู้เริ่ม 0001 ใหม่)
 *          ค่าเชื่อมต่อภายนอก: LINE OA / NETBAY / Gmail / worker — ระบบทดสอบต้องไม่ส่งอะไรออกไปจริง
 *
 * ปลอดภัย: ไม่เขียน production เลย · ปลายทางต้องไม่ใช่ฐานเดียวกับ production · ปลายทางมีงานอยู่แล้วไม่ทำต่อ
 */
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from '../src/lib/env';

loadEnv();

const COPY_TABLES = ['users', 'master_records', 'engine_numbers'] as const;
/** master_records ที่เป็นค่าเชื่อมต่อ/สถานะเครื่อง — ไม่พาไประบบทดสอบ */
const SKIP_MASTER_TYPES = ['lineAccount', 'lineSetting', 'netbayAccount', 'workerHeartbeat', 'workerSetting', 'agentVersion', 'customsMonitor'];
const SKIP_MASTER_IDS = /^SET-MAIL/;

const apply = process.argv.includes('--apply');
const hostOf = (url: string) => { try { const u = new URL(url); return `${u.hostname}:${u.port}/${u.pathname}#${u.username}`; } catch { return url; } };

async function ddl(src: postgres.Sql) {
  const tables = (await src<{ t: string }[]>`
    select c.relname as t from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r' order by c.relname`).map((r) => r.t);
  const seqs = await src<{ s: string }[]>`
    select c.relname as s from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'S'`;
  const out: string[] = [
    'create extension if not exists pgcrypto with schema extensions;',
    'create extension if not exists "uuid-ossp" with schema extensions;',
    ...seqs.map((s) => `create sequence if not exists public."${s.s}";`),
  ];
  for (const t of tables) {
    const cols = await src<{ name: string; type: string; notnull: boolean; def: string | null }[]>`
      select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, a.attnotnull as notnull,
             pg_get_expr(d.adbin, d.adrelid) as def
        from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
       where a.attrelid = ${`public."${t}"`}::regclass and a.attnum > 0 and not a.attisdropped order by a.attnum`;
    out.push(`create table if not exists public."${t}" (\n${cols.map((c) =>
      `  "${c.name}" ${c.type}${c.def ? ` default ${c.def}` : ''}${c.notnull ? ' not null' : ''}`).join(',\n')}\n);`);
  }
  const cons = await src<{ t: string; name: string; def: string; kind: string }[]>`
    select c.relname as t, k.conname as name, pg_get_constraintdef(k.oid) as def, k.contype as kind
      from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and k.contype in ('p', 'u', 'c', 'f') order by (k.contype = 'f'), c.relname`;
  for (const k of cons) out.push(`alter table public."${k.t}" add constraint "${k.name}" ${k.def};`);
  const idx = await src<{ def: string }[]>`
    select pg_get_indexdef(i.indexrelid) as def from pg_index i
      join pg_class c on c.oid = i.indrelid join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid)`;
  for (const i of idx) out.push(`${i.def.replace(/^CREATE (UNIQUE )?INDEX /, (m) => `${m}IF NOT EXISTS `)};`);
  return { tables, statements: out };
}

function rowsQuery(src: postgres.Sql, table: string) {
  if (table === 'master_records') {
    return src`select * from master_records where not (type = any(${SKIP_MASTER_TYPES})) and id !~ ${SKIP_MASTER_IDS.source}`;
  }
  return src.unsafe(`select * from "${table}"`);
}

/** storage key ที่ข้อมูลพื้นฐานอ้างถึง — แม่แบบจดหมาย DO / E-Office เก็บไว้ใต้ _form-templates/ */
function storageKeys(rows: Array<Record<string, unknown>>) {
  const keys = new Set<string>();
  for (const r of rows) {
    for (const m of JSON.stringify(r).matchAll(/_form-templates\/[^"\\]+/g)) keys.add(m[0]);
  }
  return [...keys];
}

async function main() {
  const prodUrl = process.env.DATABASE_URL;
  if (!prodUrl) throw new Error('ไม่พบ DATABASE_URL (production)');
  const src = postgres(prodUrl, { prepare: false, max: 1 });
  const plan = await ddl(src);
  console.log(`โครงตาราง: ${plan.tables.length} ตาราง · ${plan.statements.length} คำสั่ง`);
  const data: Record<string, Array<Record<string, unknown>>> = {};
  for (const t of COPY_TABLES) {
    data[t] = [...await rowsQuery(src, t)] as Array<Record<string, unknown>>;
    console.log(`  คัดลอก ${t.padEnd(16)} ${String(data[t].length).padStart(7)} แถว`);
  }
  const keys = storageKeys(data.master_records);
  console.log(`  ไฟล์ Storage ที่ข้อมูลพื้นฐานใช้: ${keys.length} ไฟล์${keys.length ? ` (${keys.slice(0, 3).join(', ')}…)` : ''}`);
  console.log(`  ไม่คัดลอก: ${plan.tables.filter((t) => !(COPY_TABLES as readonly string[]).includes(t)).join(', ')}`);
  console.log(`  master_records ที่ข้าม: ${SKIP_MASTER_TYPES.join(', ')} + ค่า Gmail`);

  if (!apply) { console.log('\n(ยังไม่เขียน — ใส่ TEST_DATABASE_URL ฯลฯ แล้ว --apply)'); await src.end(); return; }

  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error('ใส่ TEST_DATABASE_URL ของฐานทดสอบ');
  if (hostOf(testUrl) === hostOf(prodUrl)) throw new Error('TEST_DATABASE_URL ชี้ฐานเดียวกับ production — หยุด');
  const dst = postgres(testUrl, { prepare: false, max: 1 });
  const existing = await dst<{ n: number }[]>`select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name = 'jobs'`;
  if (existing[0].n) {
    const [{ n }] = await dst.unsafe<{ n: number }[]>('select count(*)::int as n from jobs');
    if (n > 0) throw new Error(`ฐานทดสอบมีงานอยู่แล้ว ${n} งาน — ใช้ scripts/test-env-reset.ts ล้างก่อน`);
  }
  for (const s of plan.statements) {
    try { await dst.unsafe(s); } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!/already exists|multiple primary keys/.test(msg)) throw new Error(`${msg}\n  ← ${s.slice(0, 160)}`);
    }
  }
  console.log('สร้างโครงตารางแล้ว');
  for (const t of COPY_TABLES) {
    const rows = data[t];
    await dst.unsafe(`delete from "${t}"`);
    for (let i = 0; i < rows.length; i += 2000) {
      await dst`insert into ${dst(t)} ${dst(rows.slice(i, i + 2000) as Record<string, postgres.ParameterOrJSON<never>>[])}`;
    }
    console.log(`  ${t} ${rows.length} แถว`);
  }
  const seqs = await src<{ s: string; v: string }[]>`
    select sequencename as s, coalesce(last_value, 1)::text as v from pg_sequences where schemaname = 'public'`;
  for (const q of seqs) await dst.unsafe(`select setval('public."${q.s}"', ${Number(q.v)})`);

  const sbUrl = process.env.TEST_SUPABASE_URL;
  const sbKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  if (sbUrl && sbKey && keys.length) {
    const from = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const to = createClient(sbUrl, sbKey);
    const { data: buckets } = await to.storage.listBuckets();
    if (!buckets?.some((b) => b.name === 'job-files')) await to.storage.createBucket('job-files', { public: false });
    for (const k of keys) {
      const { data: blob, error } = await from.storage.from('job-files').download(k);
      if (error || !blob) { console.log(`  ข้ามไฟล์ ${k}: ${error?.message}`); continue; }
      await to.storage.from('job-files').upload(k, blob, { upsert: true, contentType: blob.type || undefined });
    }
    console.log(`คัดลอกไฟล์ Storage ${keys.length} ไฟล์`);
  } else if (keys.length) console.log('ไม่ได้ใส่ TEST_SUPABASE_URL / KEY — ข้ามการคัดลอกไฟล์ Storage');
  await dst.end();
  await src.end();
  console.log('ระบบทดสอบพร้อม: ไม่มีงาน · ข้อมูลพื้นฐานครบ');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
