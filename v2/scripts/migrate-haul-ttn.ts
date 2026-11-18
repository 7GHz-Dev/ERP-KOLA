/**
 * เพิ่มสถานะการส่งแพลนลากตู้ไป ERP TTN ใน haul_plans
 *
 *   ttn_sent_at  ส่งเข้า ERP TTN สำเร็จครั้งล่าสุด
 *   ttn_error    ส่งไม่สำเร็จครั้งล่าสุด (ว่าง = ไม่มีปัญหา) — หน้า Transport Request แสดงให้กดส่งซ้ำ
 *
 * ต้องรันก่อน deploy เพราะโค้ดใหม่อ่านคอลัมน์นี้ทุกครั้งที่เปิดหน้า
 */
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

loadEnv();

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  await sql`alter table haul_plans add column if not exists ttn_sent_at timestamptz`;
  await sql`alter table haul_plans add column if not exists ttn_error text`;
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from information_schema.columns
    where table_name = 'haul_plans' and column_name in ('ttn_sent_at', 'ttn_error')`;
  console.log(n === 2 ? 'มีคอลัมน์ ttn_sent_at / ttn_error แล้ว' : `พบคอลัมน์เพียง ${n} จาก 2`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
