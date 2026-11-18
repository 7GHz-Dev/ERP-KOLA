/**
 * ล้างงานทั้งหมดในฐานทดสอบ ให้กลับไปเหมือน "ไม่มี Job" — ข้อมูลพื้นฐาน / ผู้ใช้ / เลขเครื่องเดิมยังอยู่
 *
 *   npx tsx --tsconfig tsconfig.json --env-file=.env.test scripts/test-env-reset.ts            ดูว่าจะล้างอะไร
 *   npx tsx --tsconfig tsconfig.json --env-file=.env.test scripts/test-env-reset.ts --apply    ล้างจริง
 *
 * ทำกับ TEST_DATABASE_URL เท่านั้น — ชี้ฐานเดียวกับ production (DATABASE_URL ใน .env.local) จะหยุดทันที
 * ไฟล์ที่อัปโหลดในระบบทดสอบ (Storage ของ project ทดสอบ) ลบตามด้วย ยกเว้นแม่แบบใน _form-templates/
 * เลขเครื่องที่ออกระหว่างทดสอบ (engine_numbers ที่มี job_id) ลบออก เลขที่คัดลอกมาจาก production ยังอยู่
 */
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from '../src/lib/env';

loadEnv();

const JOB_TABLES = [
  'activity_log', 'approvals', 'automation_tasks', 'bls', 'containers', 'customs_entries', 'do_handoffs', 'eoffice_requests',
  'files', 'haul_plans', 'inspection_releases', 'job_price_lines', 'job_price_sets', 'job_sequences', 'jobs', 'sessions',
  'shipme_cost_lines', 'shipme_costs', 'special_charge_files', 'special_charge_items', 'special_charges', 'status_history', 'waiting_bls',
];
const hostOf = (url: string) => { try { const u = new URL(url); return `${u.hostname}:${u.port}/${u.pathname}#${u.username}`; } catch { return url; } };

async function main() {
  const apply = process.argv.includes('--apply');
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error('ใส่ TEST_DATABASE_URL (ใช้ --env-file=.env.test)');
  if (process.env.DATABASE_URL && hostOf(testUrl) === hostOf(process.env.DATABASE_URL)) throw new Error('TEST_DATABASE_URL ชี้ฐาน production — หยุด');
  const sql = postgres(testUrl, { prepare: false, max: 1 });
  const counts: string[] = [];
  for (const t of JOB_TABLES) {
    const [{ n }] = await sql.unsafe<{ n: number }[]>(`select count(*)::int as n from "${t}"`);
    if (n) counts.push(`${t} ${n}`);
  }
  // เวลาที่สร้างฐานทดสอบ (test-env-clone.ts บันทึกไว้) — เลขเครื่องหลังเวลานี้ = ออกระหว่างทดสอบ
  const [mark] = await sql<{ at: string }[]>`select value as at from master_records where id = 'TEST-CLONED-AT'`;
  if (!mark) throw new Error('ไม่พบเวลาที่สร้างฐานทดสอบ (TEST-CLONED-AT) — ฐานนี้ไม่ได้สร้างจาก test-env-clone.ts');
  const [{ n: engines }] = await sql<{ n: number }[]>`select count(*)::int as n from engine_numbers where created_at > ${mark.at}::timestamptz`;
  counts.push(`engine_numbers ที่ออกระหว่างทดสอบ ${engines}`);
  console.log(`จะล้าง: ${counts.join(' · ') || 'ไม่มีงาน'}`);
  if (!apply) { console.log('(ยังไม่ล้าง — ใส่ --apply)'); await sql.end(); return; }

  await sql.unsafe(`truncate ${JOB_TABLES.map((t) => `"${t}"`).join(', ')} cascade`);
  await sql`delete from engine_numbers where created_at > ${mark.at}::timestamptz`;
  console.log('ล้างงานแล้ว');

  const sbUrl = process.env.TEST_SUPABASE_URL;
  const sbKey = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
  if (sbUrl && sbKey) {
    const sb = createClient(sbUrl, sbKey);
    let removed = 0;
    const walk = async (prefix: string): Promise<void> => {
      const { data } = await sb.storage.from('job-files').list(prefix, { limit: 1000 });
      for (const item of data ?? []) {
        const path = prefix ? `${prefix}/${item.name}` : item.name;
        if (path.startsWith('_form-templates')) continue;
        if (item.id === null) await walk(path);
        else { await sb.storage.from('job-files').remove([path]); removed++; }
      }
    };
    await walk('');
    console.log(`ลบไฟล์งานใน Storage ทดสอบ ${removed} ไฟล์ (แม่แบบยังอยู่)`);
  }
  await sql.end();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
