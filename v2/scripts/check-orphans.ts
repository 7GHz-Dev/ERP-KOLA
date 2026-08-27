/** หา job ที่อ้าง master ซึ่งไม่มีอยู่จริงในปลายทาง (เช่นแถวที่ถูกตัดเพราะ code ซ้ำ) */
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

loadEnv();

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  const columns: Array<[string, string]> = [
    ['shipper_id', 'shippers'], ['consignee_id', 'consignees'], ['notify_party_id', 'notify'],
    ['person_id', 'people'], ['port_id', 'ports'], ['terminal_id', 'terminals'],
    ['job_type_id', 'jobTypes'], ['loading_type_id', 'loadingTypes'],
  ];

  let bad = 0;
  for (const [col, type] of columns) {
    const rows = await sql.unsafe<{ job_no: string; ref: string }[]>(`
      select j.job_no, j.${col} as ref from jobs j
      where j.${col} is not null and j.${col} <> ''
        and not exists (select 1 from master_records m where m.id = j.${col})`);
    if (rows.length) {
      bad += rows.length;
      console.log(` ! ${col} (${type}) — ${rows.length} งานอ้างถึงรายการที่ไม่มีอยู่`);
      rows.forEach((r) => console.log(`      ${r.job_no} -> ${r.ref}`));
    }
  }
  console.log(bad ? `\nพบ ${bad} รายการที่ต้องแก้` : 'ไม่มีงานไหนอ้างถึงรายการที่หายไป — ข้อมูลครบถ้วน');
  await sql.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
