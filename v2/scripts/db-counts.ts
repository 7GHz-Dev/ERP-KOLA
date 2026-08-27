/** นับแถวในแต่ละตาราง ใช้ตรวจหลังย้ายข้อมูล */
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

async function main() {
  loadEnv();
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  const tables = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema = 'public' order by table_name`;

  let total = 0;
  for (const t of tables) {
    const [row] = await sql.unsafe<{ c: number }[]>(`select count(*)::int as c from "${t.table_name}"`);
    total += row.c;
    console.log(`  ${t.table_name.padEnd(22)} ${String(row.c).padStart(6)}`);
  }
  console.log(`  ${'รวม'.padEnd(22)} ${String(total).padStart(6)} แถว`);

  const [algo] = await sql<{ legacy: number; scrypt: number }[]>`
    select count(*) filter (where password_algo = 'legacy')::int as legacy,
           count(*) filter (where password_algo = 'scrypt')::int as scrypt
    from users`;
  console.log(`\nรหัสผ่าน: legacy ${algo.legacy} คน · scrypt ${algo.scrypt} คน`);

  const masters = await sql<{ type: string; c: number }[]>`
    select type, count(*)::int as c from master_records group by type order by type`;
  if (masters.length) {
    console.log('\nmaster_records แยกตามชนิด:');
    masters.forEach((m) => console.log(`  ${m.type.padEnd(18)} ${m.c}`));
  }
  await sql.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
