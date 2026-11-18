/**
 * DEM / DET ว่างได้ (N/A) + Storage free time
 *
 *   jobs.dem_days / det_days     เลิกบังคับค่า — งานใหม่ตั้งต้นเป็น N/A (null) ตั้งแต่ใส่ข้อมูล BL
 *                                FAH ต้องกรอกที่ Upload Invoice of D/O ก่อนส่ง Partner · ค่าเดิมของงานที่มีอยู่ไม่แตะ
 *   jobs.storage_free_days       วันฟรีค่าฝากตู้ที่ท่า (ค่าตั้งต้น 3) นับ ETA เป็นวันที่ 1
 *   jobs.dem_det_combined        Combine — DEM = DET จำนวนวันเดียวกัน
 *
 *   npx tsx scripts/migrate-free-time.ts                    production (.env.local)
 *   DATABASE_URL=<ฐานทดสอบ> npx tsx scripts/migrate-free-time.ts
 * ต้องรันก่อน deploy เพราะโค้ดใหม่อ่าน storage_free_days ทุกครั้งที่อ่านงาน
 */
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

loadEnv();

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  await sql`alter table jobs alter column dem_days drop not null`;
  await sql`alter table jobs alter column dem_days drop default`;
  await sql`alter table jobs alter column det_days drop not null`;
  await sql`alter table jobs alter column det_days drop default`;
  await sql`alter table jobs add column if not exists storage_free_days integer not null default 3`;
  // Combine: DEM กับ DET ใช้จำนวนวันเดียวกัน (ปุ่มที่หัวข้อ DET ในแผง Invoice DO)
  await sql`alter table jobs add column if not exists dem_det_combined boolean not null default false`;
  const cols = await sql<{ column_name: string; is_nullable: string; column_default: string | null }[]>`
    select column_name, is_nullable, column_default from information_schema.columns
     where table_name = 'jobs' and column_name in ('dem_days', 'det_days', 'storage_free_days', 'dem_det_combined') order by column_name`;
  console.log(cols.map((c) => `${c.column_name} null=${c.is_nullable} default=${c.column_default}`).join(' · '));
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
