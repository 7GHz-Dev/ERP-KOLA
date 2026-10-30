/**
 * ฐานข้อมูลของทะเบียนงานแบบตารางเดิม + ช่องทางแจ้ง Port Release Partner
 *
 *   master_records.short_name     ชื่อย่อที่ทะเบียนงานแสดง (MSFZ · KOLA · KMW …) ว่าง = ใช้ชื่อเต็ม
 *   master_records.line_group_id  กลุ่ม LINE ของ Partner — ส่งลิงก์ชุดปล่อย E-Office ที่เซ็นแล้วเข้ากลุ่มนี้
 *   (อีเมลของ Partner ใช้ช่อง email ที่มีอยู่แล้ว)
 *
 * เพิ่ม Port Release Partner PTN0002–PTN0015 ตามรายชื่อที่ผู้ใช้ส่งมา (ชื่อเดียวกับ Notify Party NTP0002–NTP0015)
 * และใส่ชื่อย่อตั้งต้นตามที่ตารางงานเดิมเขียน — แก้ได้ที่หน้า Master Data
 *
 * ทำด้วย SQL ตรง ๆ เพราะ drizzle-kit push พังกับสถานะฐานปัจจุบัน (เหมือน migrate-customs-flow)
 * รันซ้ำได้: เพิ่มเฉพาะที่ยังไม่มี · ชื่อย่อเติมเฉพาะแถวที่ยังว่าง ไม่ทับค่าที่ผู้ดูแลแก้ไว้
 * ต้องรันก่อน deploy เพราะโค้ดใหม่ select สองคอลัมน์นี้ทุกครั้งที่อ่าน Master Data
 *
 *   npm run migrate:partner-channels
 */
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

loadEnv();

/** รหัส · ชื่อเต็ม · ชื่อย่อ — ตามรูปรายชื่อ Port Release Partner */
const PARTNERS: Array<[string, string, string]> = [
  ['PTN0002', 'KMW GROUP SHIPMENT (THAILAND) CO.,LTD.', 'KMW'],
  ['PTN0003', 'R.S.D IMPORT EXPORT CO.,LTD.', 'R.S.D'],
  ['PTN0004', 'A&M TRADING (THAILAND) CO.,LTD.', 'A&M'],
  ['PTN0005', 'BLUE MARINE SERVICE BANGKOK CO.,LTD.', 'BLUE MARINE'],
  ['PTN0006', 'IONIC LOGISTICS CO.,LTD.', 'IONIC'],
  ['PTN0007', 'SP & SUN IMPORT EXPORT LIMITED PARTNERSHIP', 'SP & SUN'],
  ['PTN0008', 'RED IMPALA CO.,LTD.', 'RED IMPALA'],
  ['PTN0009', 'MD.H&S INTER LIMITED PARTNERSHIP', 'MD.H&S'],
  ['PTN0010', 'DIAMOND CORPORATION IMPORT EXPORT LIMITED PARTNERSHIP', 'DIAMOND'],
  ['PTN0011', 'AMI IMPORT EXPORT CO.,LTD.', 'AMI'],
  ['PTN0012', 'IMPERIAL GLOBAL LOGISTICS CO.,LTD.', 'IMPERIAL'],
  ['PTN0013', 'AL-YUNUS TRADING CO.,LTD.', 'AL-YUNUS'],
  ['PTN0014', 'ZM TRADING IMPORT & EXPORT CO., LTD', 'ZM'],
  ['PTN0015', 'HAJI OF TRANSHIPMENT CO., LTD.', 'HAJI'],
];

/** ชื่อย่อตั้งต้นของรายการอื่น — จับจากชื่อ ไม่ผูกรหัส เผื่อ Master ถูกสร้างใหม่ */
const SHORT_BY_NAME: Array<[string, RegExp, string]> = [
  ['consignees', /MAESOT\s*FREEZONE/i, 'MSFZ'],
  ['notify', /KOLA\s*SHIPPING/i, 'KOLA'],
  // ทั้งคำ — "KMW GROUP SHIPMENT" ไม่ใช่ SHIPME
  ['partners', /\bSHIPME\b/i, 'SHIPME'],
  ['jobTypes', /^MSFZ - USED CAR$/i, 'MSFZ - รถยนต์เก่า'],
];

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

  await sql`alter table master_records add column if not exists short_name text`;
  await sql`alter table master_records add column if not exists line_group_id text`;

  let added = 0;
  for (const [code, name, short] of PARTNERS) {
    const [have] = await sql<{ id: string }[]>`
      select id from master_records
       where type = 'partners' and (code = ${code} or upper(name) = ${name.toUpperCase()}) limit 1`;
    if (have) continue;
    await sql`insert into master_records (id, type, code, name, description, short_name, is_active)
              values (${`MD-${randomBytes(8).toString('hex').toUpperCase()}`}, 'partners',
                      ${code}, ${name}, ${name}, ${short}, true)`;
    added += 1;
  }

  // Notify Party ชื่อเดียวกับ Partner ใช้ชื่อย่อเดียวกัน (ช่อง NOTIFY ของตารางงานเดิมเขียนชื่อย่อ)
  for (const [, name, short] of PARTNERS) {
    await sql`update master_records set short_name = ${short}
               where type in ('partners', 'notify') and upper(name) = ${name.toUpperCase()}
                 and coalesce(short_name, '') = ''`;
  }
  for (const [type, pattern, short] of SHORT_BY_NAME) {
    const rows = await sql<{ id: string; name: string }[]>`
      select id, name from master_records where type = ${type} and coalesce(short_name, '') = ''`;
    for (const r of rows.filter((row) => pattern.test(row.name))) {
      await sql`update master_records set short_name = ${short} where id = ${r.id}`;
    }
  }

  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from information_schema.columns
     where table_name = 'master_records' and column_name in ('short_name', 'line_group_id')`;
  const [{ partners }] = await sql<{ partners: number }[]>`
    select count(*)::int as partners from master_records where type = 'partners'`;
  console.log(n === 2
    ? `พร้อมแล้ว: master_records.short_name/line_group_id · เพิ่ม Partner ${added} รายการ (รวม ${partners})`
    : `ขาด ${2 - n} คอลัมน์ใน master_records`);

  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
