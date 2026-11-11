/**
 * ตารางของเมนู Total cost (ACCOUNT) — ค่าใช้จ่ายราย BL ที่ ERP SHIPME ส่งมา
 * (shipme_costs / shipme_cost_lines) ดูสเปก docs/SHIPME-COSTS-API.md
 *
 * SQL ตรง ๆ แบบเดียวกับ migrate-sale · รันซ้ำได้ — สร้างเฉพาะที่ยังไม่มี ไม่แตะข้อมูลเดิม
 *
 *   npm run migrate:total-cost
 */
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

loadEnv();

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  await sql`
    create table if not exists shipme_costs (
      id text primary key,
      bl_key text not null,
      bl_no text not null,
      job_id text,
      customer text,
      batch_name text,
      invoices_json text not null default '[]',
      received_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`;
  await sql`create unique index if not exists shipme_costs_bl_key on shipme_costs (bl_key)`;
  await sql`create index if not exists shipme_costs_updated_idx on shipme_costs (updated_at)`;
  await sql`
    create table if not exists shipme_cost_lines (
      id text primary key,
      cost_id text not null references shipme_costs(id) on delete cascade,
      line_no integer not null,
      source text not null,
      ref text,
      kind text,
      source_key text,
      label text not null,
      amount numeric(18,2) not null,
      vat numeric(18,2) not null default 0,
      note text
    )`;
  await sql`create index if not exists shipme_cost_lines_cost_idx on shipme_cost_lines (cost_id, line_no)`;
  // ตารางใหม่ของ Supabase เปิด RLS ไว้เหมือนตารางอื่น (แอปต่อด้วย DATABASE_URL ไม่ผ่าน PostgREST)
  await sql`alter table shipme_costs enable row level security`;
  await sql`alter table shipme_cost_lines enable row level security`;
  await sql.end();
  console.log('✓ shipme_costs / shipme_cost_lines พร้อมใช้');
}

main().catch((e) => { console.error(e); process.exit(1); });
