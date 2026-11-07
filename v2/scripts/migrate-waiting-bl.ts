/**
 * ตาราง waiting_bls ของเมนู Waiting BL (NAMKANG / FAH)
 *
 * ทำด้วย SQL ตรง ๆ เพราะ drizzle-kit push พังกับสถานะฐานปัจจุบัน (เหมือน migrate-customs-flow)
 * รันซ้ำได้ — สร้างเฉพาะที่ยังไม่มี ไม่แตะข้อมูลเดิม
 * ต้องรันก่อน deploy เพราะหน้า Waiting BL · หน้ารับ AN · การอนุมัติ AN อ่านตารางนี้
 *
 *   npm run migrate:waiting-bl
 */
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

loadEnv();

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  await sql`
    create table if not exists waiting_bls (
      id text primary key,
      bl_no text not null,
      bl_key text not null,
      customer text,
      shipper text,
      vessel text,
      voyage text,
      eta date,
      container_nos text,
      product text,
      channel text,
      note text,
      created_by text,
      created_at timestamptz not null default now(),
      updated_by text,
      updated_at timestamptz not null default now(),
      resolved_at timestamptz,
      resolved_job_id text,
      cancelled_at timestamptz,
      cancelled_by text
    )`;
  await sql`create index if not exists waiting_bls_key_idx on waiting_bls (bl_key)`;
  await sql`create index if not exists waiting_bls_open_idx on waiting_bls (resolved_at, cancelled_at)`;
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from waiting_bls`;
  console.log(`waiting_bls พร้อมใช้ (${n} แถว)`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
