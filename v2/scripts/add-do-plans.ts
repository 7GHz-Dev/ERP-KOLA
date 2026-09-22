/**
 * เพิ่มตาราง do_plans และคอลัมน์ do_handoffs.do_plan_id
 *
 * เขียน DDL เองแทน drizzle-kit push เพราะ push พังตอนอ่าน schema กลับมาจาก
 * Postgres 17 (อ่าน check constraint ไม่ออกแล้ว throw) ซึ่งไม่เกี่ยวกับตารางนี้
 *
 * ทุกคำสั่งเป็น IF NOT EXISTS จึงรันซ้ำได้ และไม่แตะตารางหรือข้อมูลเดิม
 * ต้องตรงกับที่ประกาศไว้ใน src/db/schema.ts
 *
 *   npx tsx scripts/add-do-plans.ts
 */
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('ไม่พบ DATABASE_URL ใน .env.local');
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 1 });

async function main() {
  await sql`
    create table if not exists do_plans (
      id          text primary key,
      plan_no     text not null,
      plan_date   date not null,
      note        text,
      created_by  text,
      created_at  timestamptz not null default now(),
      updated_at  timestamptz not null default now()
    )`;
  await sql`create unique index if not exists do_plans_no_key on do_plans (plan_no)`;
  await sql`create index if not exists do_plans_date_idx on do_plans (plan_date)`;

  await sql`alter table do_handoffs add column if not exists do_plan_id text`;
  await sql`create index if not exists do_handoffs_plan_idx on do_handoffs (do_plan_id)`;

  /*
   * foreign key ไม่มี IF NOT EXISTS ต้องเช็กเองก่อนว่ามีหรือยัง
   * on delete set null — ลบ Plan แล้วใบกลับไปเป็นใบเดี่ยว ไม่ลบงานตามไปด้วย
   */
  const [existing] = await sql`
    select 1 from pg_constraint where conname = 'do_handoffs_do_plan_id_fkey'`;
  if (!existing) {
    await sql`
      alter table do_handoffs
        add constraint do_handoffs_do_plan_id_fkey
        foreign key (do_plan_id) references do_plans (id) on delete set null`;
  }

  const columns = await sql`
    select column_name from information_schema.columns
     where table_name = 'do_plans' order by ordinal_position`;
  console.log('ตาราง do_plans:', columns.map((c) => c.column_name).join(', '));
  const [handoff] = await sql`
    select column_name from information_schema.columns
     where table_name = 'do_handoffs' and column_name = 'do_plan_id'`;
  console.log('do_handoffs.do_plan_id:', handoff ? 'มีแล้ว' : 'ไม่พบ');
  console.log('เสร็จเรียบร้อย');
}

main()
  .catch((e) => { console.error('ล้มเหลว:', e); process.exitCode = 1; })
  .finally(() => sql.end());
