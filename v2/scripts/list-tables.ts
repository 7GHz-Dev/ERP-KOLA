/** แสดงตารางและ index ที่มีอยู่จริงในฐานข้อมูล ใช้ตรวจหลัง db:push */
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

async function main() {
  loadEnv();
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

  const tables = await sql<{ table_name: string; cols: number }[]>`
    select t.table_name,
           (select count(*)::int from information_schema.columns c
             where c.table_schema = 'public' and c.table_name = t.table_name) as cols
    from information_schema.tables t
    where t.table_schema = 'public' order by t.table_name`;

  console.log(`ตาราง (${tables.length}):`);
  tables.forEach((t, i) => console.log(`  ${String(i + 1).padStart(2)}. ${t.table_name.padEnd(22)} ${t.cols} คอลัมน์`));

  const idx = await sql<{ c: number }[]>`
    select count(*)::int as c from pg_indexes where schemaname = 'public'`;
  const cols = tables.reduce((sum, t) => sum + t.cols, 0);
  console.log(`\nรวม ${cols} คอลัมน์ · index ${idx[0].c} ตัว`);
  await sql.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
