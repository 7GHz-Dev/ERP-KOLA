/**
 * สร้างตาราง engine_numbers — เลขเครื่องที่ worker สร้าง Draft ใบขนออกให้ (ย้ายมาจาก engine.db ของ imp)
 *
 * ทำด้วย SQL ตรง ๆ แบบ migrate-container-no.ts เพราะ drizzle-kit push พังกลางทางกับสถานะฐานปัจจุบัน
 * รันซ้ำได้ (if not exists) · นำเข้าเลขเดิมด้วย scripts/import-engine-numbers.ts
 *
 *   npx tsx scripts/migrate-engine-numbers.ts
 */
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

loadEnv();

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

  await sql`create table if not exists engine_numbers (
    id text primary key,
    random_eng text not null,
    full_eng text,
    chassis text not null,
    date_ran text,
    bl_no text,
    invoice_no text,
    source_file text,
    job_id text,
    task_id text,
    created_at timestamptz not null default now()
  )`;
  await sql`create unique index if not exists engine_numbers_number_chassis_key on engine_numbers (random_eng, chassis)`;
  await sql`create index if not exists engine_numbers_chassis_idx on engine_numbers (chassis)`;

  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from engine_numbers`;
  console.log(`มีตาราง engine_numbers แล้ว · ${n} เลข`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
