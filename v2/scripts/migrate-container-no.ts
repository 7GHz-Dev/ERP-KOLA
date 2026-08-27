/**
 * เพิ่มคอลัมน์เลขประจำตู้
 *
 * ทำด้วย SQL ตรง ๆ เพราะ drizzle-kit push พังกลางทางกับสถานะฐานปัจจุบัน
 * unique index บนคอลัมน์ที่เป็น null ได้ Postgres ยอมให้มี null ซ้ำกันหลายแถว
 * ตู้เก่าที่ยังไม่มีเลขจึงอยู่ต่อได้โดยไม่ต้องเติมย้อนหลัง
 */
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

loadEnv();

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

  await sql`alter table containers add column if not exists running_no text`;
  await sql`create unique index if not exists containers_running_key
            on containers (running_no)`;

  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from information_schema.columns
    where table_name = 'containers' and column_name = 'running_no'`;
  const [{ i }] = await sql<{ i: number }[]>`
    select count(*)::int as i from pg_indexes
    where tablename = 'containers' and indexname = 'containers_running_key'`;

  console.log(n === 1 ? 'มีคอลัมน์ running_no แล้ว' : 'ไม่พบคอลัมน์ running_no');
  console.log(i === 1 ? 'มี unique index แล้ว' : 'ไม่พบ unique index');

  const [{ total, filled }] = await sql<{ total: number; filled: number }[]>`
    select count(*)::int as total, count(running_no)::int as filled from containers`;
  console.log(`ตู้ทั้งหมด ${total} แถว · มีเลขประจำตู้แล้ว ${filled} แถว`);

  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
