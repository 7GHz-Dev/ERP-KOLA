/**
 * เตรียมชุดไฟล์ทดสอบทุกขั้นตอน จากงานจริงที่ผ่านระบบแล้ว (อ่าน production อย่างเดียว ไม่เขียน)
 *
 *   npx tsx --tsconfig tsconfig.json scripts/test-pack-export.ts [โฟลเดอร์ปลายทาง] KOLA-2026-0402 KOLA-2026-0144 …
 *
 * ต่องาน: โฟลเดอร์ "<ลำดับ> <BL>" แยกไฟล์ตามขั้น (ไฟล์ที่คนต้องอัปโหลด) + "ผลที่ควรได้" (ไฟล์ที่ระบบเคยสร้าง ไว้เทียบ)
 * พร้อม README.md สรุปค่าที่ควรเห็นในแต่ละขั้น (BL · เรือ · ETA · ตู้ · Shipper ฯลฯ)
 * โฟลเดอร์ test/ อยู่ใน .gitignore — เอกสารลูกค้าจริงไม่เข้า git
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from '../src/lib/env';

loadEnv();

/** ขั้นที่ไฟล์ถูกใช้ — ไฟล์ที่คนอัปโหลด */
const STEPS: Array<{ dir: string; cats: string[]; how: string }> = [
  { dir: '1 AN-BL', cats: ['ARRIVAL_NOTICE', 'BL'], how: 'Arrival notice upload (ทีละใบ / หลายใบพร้อมกัน) → ระบบอ่าน BL เรือ ETA ตู้' },
  { dir: '2 Cargo Invoice (ผู้ขาย)', cats: ['INVOICE_GOODS', 'SURRENDER'], how: 'Upload cargo Invoice + Surrender · และใช้ไฟล์เดียวกันที่ Create Cargo Invoice' },
  { dir: '3 DO', cats: ['INVOICE_DO', 'DO_SLIP', 'DO_SLIP_DEPOSIT', 'DO_SLIP_DEM', 'DO_SLIP_DET', 'DO_SLIP_LATE', 'DO_INV_DEPOSIT', 'DO_INV_DEM', 'DO_INV_DET', 'DO_INV_LATE', 'DO_OTHER', 'DO_LETTER_SIGNED', 'DO_LETTER_UPLOADED'], how: 'แลก DO: Invoice DO (กรอกยอด) · Slip ค่า DO · จดหมายแลกที่ประทับตรา' },
  { dir: '4 ใบขน + E-Office', cats: ['CUSTOMS_ENTRY_DOC', 'EOFFICE_SIGNED'], how: 'ใบขนสินค้า (ได้จาก NETBAY) · ชุดปล่อย E-Office ที่เซ็นแล้ว (อัปโหลดก่อนส่ง Partner)' },
];
/** ไฟล์ที่ระบบสร้าง — เก็บไว้เทียบผล */
const OUTPUTS = ['FINAL_INVOICE', 'FINAL_INVOICE_PDF', 'FINAL_INVOICE_ENGINE', 'DRAFT_CSV', 'DO_LETTER', 'DO_MERGED', 'EOFFICE_REQUEST', 'EOFFICE_MERGED'];

const safe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').trim();
const d = (v: unknown) => (v ? String(v).slice(0, 10) : '-');

async function main() {
  const args = process.argv.slice(2);
  const out = args[0] && !/^KOLA-/i.test(args[0]) ? args.shift()! : 'test/E2E';
  const jobNos = args;
  if (!jobNos.length) throw new Error('ใส่เลขงาน เช่น KOLA-2026-0402');
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const lines: string[] = [
    '# ชุดทดสอบ ERP KOLA — 5 ชุดงาน', '',
    'ไฟล์จริงจากงานที่ผ่านระบบแล้ว ใช้ทดสอบในระบบทดสอบ (ไม่มีงาน) ตามลำดับขั้นของแต่ละโฟลเดอร์',
    'โฟลเดอร์ "ผลที่ควรได้" = ไฟล์ที่ระบบเคยสร้างให้งานนี้ ใช้เทียบกับผลในระบบทดสอบ', '',
    '| ขั้น | โฟลเดอร์ | ใช้ที่ |', '|---|---|---|',
    ...STEPS.map((s) => `| ${s.dir.split(' ')[0]} | ${s.dir} | ${s.how} |`),
    '| 5 | – | Create Cargo Invoice (ไฟล์จากขั้น 2) → ส่งอนุมัติ FN → Draft ใบขน (CSV) |',
    '| 6 | – | Transport Request: สั่งลาก (ระบบทดสอบไม่ได้เชื่อม TTN / LINE / NETBAY) |', '',
  ];
  let total = 0;
  for (const [n, jobNo] of jobNos.entries()) {
    const [j] = await sql`
      select j.id, j.job_no, j.bl_no, j.vessel, j.voyage, j.eta::text eta, j.etd::text etd, j.shipline, j.dem_days, j.det_days,
             j.gross_weight::text gw, j.unit_amount::text units, j.product, j.origin_port,
             s.name shipper, c.name consignee, nt.name notify, p.name person, jt.name job_type, t.name terminal, pt.name port
        from jobs j
        left join master_records s on s.id = j.shipper_id left join master_records c on c.id = j.consignee_id
        left join master_records nt on nt.id = j.notify_party_id left join master_records p on p.id = j.person_id
        left join master_records jt on jt.id = j.job_type_id left join master_records t on t.id = j.terminal_id
        left join master_records pt on pt.id = j.port_id
       where j.job_no = ${jobNo}`;
    if (!j) throw new Error(`ไม่พบงาน ${jobNo}`);
    const boxes = await sql`select container_no, container_type, seal_no, weight::text w from containers where job_id = ${j.id} order by container_no`;
    const files = await sql`select category, file_name, storage_key from files where job_id = ${j.id} and is_current order by category`;
    total += boxes.length;
    const root = join(out, `${n + 1} ${safe(j.bl_no ?? j.job_no)}`);
    let got = 0;
    for (const f of files) {
      const step = STEPS.find((s) => s.cats.includes(f.category));
      const dir = step ? step.dir : OUTPUTS.includes(f.category) ? 'ผลที่ควรได้' : null;
      if (!dir) continue;
      const { data, error } = await sb.storage.from('job-files').download(f.storage_key);
      if (error || !data) { console.log(`  ข้าม ${f.file_name}: ${error?.message}`); continue; }
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, `${f.category} - ${safe(f.file_name)}`), Buffer.from(await data.arrayBuffer()));
      got++;
    }
    console.log(`${j.job_no} ${j.bl_no} · ${boxes.length} ตู้ · ${got} ไฟล์ → ${root}`);
    lines.push(
      `## ${n + 1}. ${j.bl_no} (งานเดิม ${j.job_no})`, '',
      `| ช่อง | ค่าที่ควรได้ |`, '|---|---|',
      `| Shipper | ${j.shipper ?? '-'} |`, `| Consignee / Notify | ${j.consignee ?? '-'} / ${j.notify ?? '-'} |`,
      `| Client in Charge | ${j.person ?? '-'} |`, `| Job Type | ${j.job_type ?? '-'} |`,
      `| สายเรือ | ${j.shipline ?? '-'} |`, `| เรือ / เที่ยว | ${j.vessel ?? '-'} / ${j.voyage ?? '-'} |`,
      `| ETD / ETA | ${d(j.etd)} / ${d(j.eta)} |`, `| ท่าต้นทาง / ปลายทาง / Terminal | ${j.origin_port ?? '-'} / ${j.port ?? '-'} / ${j.terminal ?? '-'} |`,
      `| DEM / DET (วัน) | ${j.dem_days} / ${j.det_days} |`, `| น้ำหนักรวม / จำนวน | ${j.gw ?? '-'} / ${j.units ?? '-'} |`,
      `| ตู้ (${boxes.length}) | ${boxes.map((b) => `${b.container_no}${b.container_type ? ` ${b.container_type}` : ''}${b.seal_no ? ` ซีล ${b.seal_no}` : ''}`).join('<br>')} |`, '',
      'ไฟล์:', ...files.filter((f) => STEPS.some((s) => s.cats.includes(f.category)) || OUTPUTS.includes(f.category))
        .map((f) => `- ${STEPS.find((s) => s.cats.includes(f.category))?.dir ?? 'ผลที่ควรได้'} / ${f.category} — ${f.file_name}`), '',
    );
  }
  lines.splice(3, 0, `รวม ${jobNos.length} ชุดงาน · ${total} ตู้`, '');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'README.md'), lines.join('\n'));
  console.log(`รวม ${total} ตู้ · README → ${join(out, 'README.md')}`);
  await sql.end();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
