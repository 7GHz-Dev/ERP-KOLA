/**
 * ฐานข้อมูลของเส้นงานใบขน → เดิน E → ลากตู้
 *
 *   automation_tasks.external_status / checked_at   ตัว monitor ใบขน: สถานะล่าสุดใน NETBAY + เวลาที่เช็ก
 *   jobs.eoffice_handover_at / _by                  PAINT ส่งมอบคนเดินเอกสาร (แท็บ 4 -> Upload ชุดปล่อย)
 *   haul_plans                                      แพลนลากตู้ NAMKANG -> MAY (ตู้ละแถว)
 *
 * ทำด้วย SQL ตรง ๆ เพราะ drizzle-kit push พังกลางทางกับสถานะฐานปัจจุบัน (เหมือน migrate-do-other)
 * ทุกคอลัมน์ว่างได้ งานเดิมจึงไม่ต้องเติมย้อนหลัง · รันซ้ำได้
 * ต้องรันก่อน deploy เพราะโค้ดใหม่ select คอลัมน์เหล่านี้ทุกครั้งที่อ่านงานและคิว
 *
 *   npm run migrate:customs-flow
 */
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

loadEnv();

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

  await sql`alter table automation_tasks add column if not exists external_status text`;
  await sql`alter table automation_tasks add column if not exists checked_at timestamptz`;

  await sql`alter table jobs add column if not exists eoffice_handover_at timestamptz`;
  await sql`alter table jobs add column if not exists eoffice_handover_by text`;

  await sql`create table if not exists haul_plans (
    id text primary key,
    job_id text not null references jobs(id) on delete cascade,
    container_id text not null references containers(id) on delete cascade,
    haul_date date not null,
    sent_at timestamptz,
    sent_by text,
    ack_at timestamptz,
    ack_by text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )`;
  await sql`create unique index if not exists haul_plans_container_key on haul_plans (container_id)`;
  await sql`create index if not exists haul_plans_job_idx on haul_plans (job_id)`;
  await sql`create index if not exists haul_plans_date_idx on haul_plans (haul_date)`;

  const columns = await sql<{ table_name: string; column_name: string }[]>`
    select table_name, column_name from information_schema.columns
    where (table_name = 'automation_tasks' and column_name in ('external_status', 'checked_at'))
       or (table_name = 'jobs' and column_name in ('eoffice_handover_at', 'eoffice_handover_by'))
       or (table_name = 'haul_plans' and column_name = 'haul_date')`;
  const want = 5;
  console.log(columns.length === want
    ? 'พร้อมแล้ว: automation_tasks.external_status/checked_at · jobs.eoffice_handover_at/by · ตาราง haul_plans'
    : `ขาด ${want - columns.length} คอลัมน์ — พบแค่ ${columns.map((c) => `${c.table_name}.${c.column_name}`).join(', ')}`);

  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
