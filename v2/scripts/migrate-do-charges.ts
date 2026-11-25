/**
 * ค่าใช้จ่ายแลก DO หลายหัวข้อต่อ BL (MAY · รอแลก DO — ยอดชำระ)
 *
 *   do_charges              หนึ่งแถวต่อหนึ่งหัวข้อค่าใช้จ่ายของงาน (ค่ามัดจำตู้ · ค่าแลก DO ล่าช้า · DEM · DET …)
 *                           claimed_at ว่าง = ยังไม่ได้ตั้งเบิก — งานที่ตั้งเบิกแล้วเพิ่มค่าใช้จ่ายภายหลังได้
 *   files.do_charge_id      Invoice / Slip ของหัวข้อนั้น (หมวด DO_CHARGE_INV · DO_CHARGE_SLIP)
 *   master_records doCharges หัวข้อใน dropdown — เพิ่ม/แก้ได้ที่ Master Data
 *
 * ย้ายยอดเดิม (jobs.do_deposit_amount · do_other_amount/label) เข้าเป็นแถวของ do_charges
 * รันซ้ำได้ — สร้างเฉพาะที่ยังไม่มี ย้ายเฉพาะงานที่ยังไม่มีแถวของหัวข้อนั้น
 *
 *   npm run migrate:do-charges
 */
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

loadEnv();

/** หัวข้อเริ่มต้น — เรียงตามเวลาที่สร้าง (dropdown เรียงแบบนี้) */
const TOPICS: Array<[code: string, name: string]> = [
  ['DEPOSIT', 'ค่ามัดจำตู้'],
  ['LATE', 'ค่าแลก DO ล่าช้า'],
  ['DEM', 'ค่า Demurrage'],
  ['DET', 'ค่า Detention'],
  ['OTHER', 'ค่าอื่นๆ'],
];

const rid = (prefix: string) => `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  await sql`
    create table if not exists do_charges (
      id text primary key,
      job_id text not null references jobs(id) on delete cascade,
      topic_id text,
      topic_name text not null,
      amount numeric(18,2) not null,
      note text,
      claimed_at timestamptz,
      claimed_by text,
      created_by text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )`;
  await sql`create index if not exists do_charges_job_idx on do_charges (job_id, created_at)`;
  await sql`alter table do_charges enable row level security`;
  await sql`alter table files add column if not exists do_charge_id text`;
  await sql`create index if not exists files_do_charge_idx on files (do_charge_id) where do_charge_id is not null`;

  // หัวข้อเริ่มต้น — ทีละตัวห่างกัน 1 วินาทีให้ลำดับตาม created_at ตรงกับรายการ
  const base = Date.now() - TOPICS.length * 1000;
  for (const [i, [code, name]] of TOPICS.entries()) {
    await sql`
      insert into master_records (id, type, code, name, is_active, created_at, updated_at)
      values (${rid('MST')}, 'doCharges', ${code}, ${name}, true, ${new Date(base + i * 1000)}, now())
      on conflict (type, code) do nothing`;
  }
  const topics = new Map((await sql<{ id: string; code: string; name: string }[]>`
    select id, code, name from master_records where type = 'doCharges'`).map((t) => [t.code, t]));

  // ยอดเดิม → แถวของ do_charges (ตั้งเบิกพร้อมงาน ถ้างานตั้งเบิกแล้ว)
  const legacy = await sql<{ id: string; dep: string | null; oth: string | null; label: string | null; claimed_at: Date | null; claimed_by: string | null }[]>`
    select id, do_deposit_amount::text as dep, do_other_amount::text as oth, do_other_label as label, do_claimed_at as claimed_at, do_claimed_by as claimed_by
    from jobs where do_deposit_amount is not null or do_other_amount is not null`;
  let moved = 0;
  for (const j of legacy) {
    for (const [code, amount, note] of [['DEPOSIT', j.dep, null], ['OTHER', j.oth, j.label]] as const) {
      if (!amount || Number(amount) <= 0) continue;
      const topic = topics.get(code)!;
      const [has] = await sql`select 1 from do_charges where job_id = ${j.id} and topic_id = ${topic.id} limit 1`;
      if (has) continue;
      await sql`
        insert into do_charges (id, job_id, topic_id, topic_name, amount, note, claimed_at, claimed_by, created_by)
        values (${rid('DCH')}, ${j.id}, ${topic.id}, ${topic.name}, ${amount}, ${note}, ${j.claimed_at}, ${j.claimed_by}, ${j.claimed_by})`;
      moved += 1;
    }
  }
  await sql.end();
  console.log(`✓ do_charges พร้อมใช้ · หัวข้อ ${topics.size} · ย้ายยอดเดิม ${moved} แถว`);
}

main().catch((e) => { console.error(e); process.exit(1); });
