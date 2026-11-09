/**
 * ตารางของงาน Sale — ราคาเก็บลูกค้า (job_price_sets / job_price_lines)
 * และค่าใช้จ่ายพิเศษจาก ERP SHIPME (special_charges / special_charge_items / special_charge_files)
 *
 * ทำด้วย SQL ตรง ๆ เพราะ drizzle-kit push พังกับสถานะฐานปัจจุบัน (เหมือน migrate-customs-flow)
 * รันซ้ำได้ — สร้างเฉพาะที่ยังไม่มี ไม่แตะข้อมูลเดิม
 *
 *   npm run migrate:sale
 */
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

loadEnv();

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  await sql`
    create table if not exists job_price_sets (
      job_id text primary key references jobs(id) on delete cascade,
      currency text not null default 'THB',
      total numeric(18,2) not null default 0,
      note text,
      confirmed_at timestamptz,
      confirmed_by text,
      updated_by text,
      updated_at timestamptz not null default now()
    )`;
  await sql`
    create table if not exists job_price_lines (
      id text primary key,
      job_id text not null references jobs(id) on delete cascade,
      line_no integer not null,
      description text not null,
      unit text not null,
      quantity numeric(12,2) not null,
      unit_price numeric(18,2) not null,
      amount numeric(18,2) not null
    )`;
  await sql`create index if not exists job_price_lines_job_idx on job_price_lines (job_id, line_no)`;
  await sql`
    create table if not exists special_charges (
      id text primary key,
      shipme_batch_id text not null,
      bl_no text not null,
      job_id text,
      invoice_no text,
      issued_at timestamptz,
      currency text not null default 'THB',
      requested_total numeric(18,2) not null default 0,
      agreed_total numeric(18,2),
      shipme_note text,
      status text not null default 'NEW',
      sale_note text,
      sale_by text,
      sale_at timestamptz,
      review_note text,
      review_by text,
      review_at timestamptz,
      received_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`;
  await sql`create unique index if not exists special_charges_batch_key on special_charges (shipme_batch_id)`;
  await sql`create index if not exists special_charges_status_idx on special_charges (status)`;
  await sql`
    create table if not exists special_charge_items (
      id text primary key,
      charge_id text not null references special_charges(id) on delete cascade,
      line_no integer not null,
      code text,
      description text not null,
      quantity numeric(12,2) not null default 1,
      requested_amount numeric(18,2) not null,
      agreed_amount numeric(18,2),
      shipme_note text,
      sale_note text
    )`;
  await sql`create index if not exists special_charge_items_charge_idx on special_charge_items (charge_id, line_no)`;
  await sql`
    create table if not exists special_charge_files (
      id text primary key,
      charge_id text not null references special_charges(id) on delete cascade,
      source text not null,
      storage_key text not null,
      file_name text not null,
      mime_type text,
      size_bytes integer,
      note text,
      uploaded_by text,
      uploaded_at timestamptz not null default now()
    )`;
  await sql`create index if not exists special_charge_files_charge_idx on special_charge_files (charge_id)`;
  console.log('ตาราง Sale พร้อมใช้: job_price_sets · job_price_lines · special_charges · special_charge_items · special_charge_files');
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
