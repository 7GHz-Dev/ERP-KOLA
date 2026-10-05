/**
 * เพิ่มคอลัมน์ค่าอื่น ๆ ของค่าแลก D/O (ยอด + หัวข้อที่ MAY ระบุเอง)
 *
 * ทำด้วย SQL ตรง ๆ เพราะ drizzle-kit push พังกลางทางกับสถานะฐานปัจจุบัน
 * เป็นคอลัมน์ว่างได้ งานเดิมจึงไม่ต้องเติมย้อนหลัง
 * ต้องรันก่อน deploy เพราะโค้ดใหม่ select คอลัมน์นี้ทุกครั้งที่อ่านงาน
 */
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

loadEnv();

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

  await sql`alter table jobs add column if not exists do_other_amount numeric(18, 2)`;
  await sql`alter table jobs add column if not exists do_other_label text`;

  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from information_schema.columns
    where table_name = 'jobs' and column_name in ('do_other_amount', 'do_other_label')`;
  console.log(n === 2 ? 'มีคอลัมน์ do_other_amount / do_other_label แล้ว' : `พบคอลัมน์เพียง ${n} จาก 2`);

  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
