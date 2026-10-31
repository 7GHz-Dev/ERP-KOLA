/**
 * คำร้อง E-Office: เจ้าหน้าที่ในช่องบันทึกการอนุญาต + ฝ่ายที่ส่ง E
 *
 *   eoffice_requests.officer_prefix    คำนำหน้า (นาย · นาง · นางสาว)
 *   eoffice_requests.officer_surname   นามสกุล (ชื่อใช้ attention_name ตัวเดิม — ชื่อเดียวกับ "เรียน คุณ…")
 *   eoffice_requests.officer_position  ตำแหน่ง เช่น นักวิชาการศุลกากรชำนาญการ
 *   eoffice_requests.section_code      ฝศ,สบศ ตามท่าเรือ เช่น 3,1
 *
 * ทำด้วย SQL ตรง ๆ เหมือน migrate-customs-flow · รันซ้ำได้
 * ต้องรันก่อน deploy เพราะโค้ดใหม่ select คอลัมน์เหล่านี้ทุกครั้งที่อ่านคำร้อง
 *
 *   npm run migrate:eoffice-officer
 */
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

loadEnv();

const COLUMNS = ['officer_prefix', 'officer_surname', 'officer_position', 'section_code'];

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  for (const c of COLUMNS) await sql.unsafe(`alter table eoffice_requests add column if not exists ${c} text`);
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from information_schema.columns
     where table_name = 'eoffice_requests' and column_name in ${sql(COLUMNS)}`;
  console.log(n === COLUMNS.length ? `พร้อมแล้ว: eoffice_requests ${COLUMNS.join(' · ')}` : `ขาด ${COLUMNS.length - n} คอลัมน์ใน eoffice_requests`);
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
