/**
 * นำเข้าที่อยู่ Shipper จากชีต "address" ของไฟล์ Final Invoice เดิม (zone · shipper_wms · shipper · adr_row1-4)
 *
 *   npx tsx --tsconfig tsconfig.json --env-file=.env.local scripts/import-shipper-addresses.ts <ไฟล์.xlsx>           ดูผลก่อน (ไม่เขียน)
 *   npx tsx --tsconfig tsconfig.json --env-file=.env.local scripts/import-shipper-addresses.ts <ไฟล์.xlsx> --apply   เขียนจริง
 *
 * จับคู่กับ Shipper ใน Master Data ด้วยชื่อเต็ม (คอลัมน์ shipper) ก่อน แล้วชื่อย่อ (shipper_wms) — เทียบแบบไม่สนช่องว่าง จุด จุลภาค
 *   เจอและยังไม่มีที่อยู่     ใส่ที่อยู่ (บรรทัด adr_row1-4)
 *   เจอและมีที่อยู่แล้ว        ไม่ทับ (คนแก้ที่ Master Data แล้ว)
 *   ไม่เจอ                   เพิ่ม Shipper ใหม่ (รหัส SHP ถัดไป) พร้อมที่อยู่
 * ชื่อเดียวกันหลายแถวในชีต (ที่อยู่ต่างกัน) ใช้แถวแรก
 */
import ExcelJS from 'exceljs';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { masterRecords } from '@/db/schema';
import { newId } from '@/lib/actions/common';

const key = (s: string) => s.toUpperCase().replace(/[\s.,()&-]/g, '');
const text = (v: ExcelJS.CellValue) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'richText' in v) return v.richText.map((t) => t.text).join('');
  if (typeof v === 'object' && 'text' in v) return String(v.text);
  return String(v);
};

async function main() {
  const [file, flag] = process.argv.slice(2);
  if (!file) throw new Error('ใส่ไฟล์ .xlsx ที่มีชีต address');
  const apply = flag === '--apply';
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.getWorksheet('address');
  if (!ws) throw new Error('ไม่พบชีต address');

  type Entry = { short: string; name: string; address: string };
  const entries: Entry[] = [];
  const seen = new Set<string>();
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const name = text(row.getCell(3).value).trim().replace(/\s+/g, ' ');
    const short = text(row.getCell(2).value).trim().replace(/\s+/g, ' ');
    const lines = [4, 5, 6, 7].map((c) => text(row.getCell(c).value).trim().replace(/\s+/g, ' ')).filter((l) => l && l !== '-');
    if (!name || !lines.length || seen.has(key(name))) return;
    seen.add(key(name));
    entries.push({ short, name, address: lines.map((l) => l.slice(0, 160)).join('\n') });
  });

  const shippers = await db.select({ id: masterRecords.id, name: masterRecords.name, shortName: masterRecords.shortName, address: masterRecords.address })
    .from(masterRecords).where(eq(masterRecords.type, 'shippers'));
  const byKey = new Map<string, (typeof shippers)[number]>();
  for (const s of shippers) {
    byKey.set(key(s.name), s);
    if (s.shortName && !byKey.has(key(s.shortName))) byKey.set(key(s.shortName), s);
  }

  const update: Array<{ id: string; name: string; address: string }> = [];
  const create: Entry[] = [];
  let kept = 0;
  const touched = new Set<string>();
  for (const e of entries) {
    const hit = byKey.get(key(e.name)) ?? (e.short ? byKey.get(key(e.short)) : undefined);
    if (hit) {
      if (touched.has(hit.id)) continue;
      touched.add(hit.id);
      if (hit.address?.trim()) kept++;
      else update.push({ id: hit.id, name: hit.name, address: e.address });
    } else create.push(e);
  }
  console.log(`ในชีต ${entries.length} ราย · Shipper ในระบบ ${shippers.length} ราย`);
  console.log(`ใส่ที่อยู่ให้ Shipper เดิม ${update.length} ราย · มีที่อยู่อยู่แล้ว (ไม่ทับ) ${kept} ราย · เพิ่ม Shipper ใหม่ ${create.length} ราย`);
  for (const u of update.slice(0, 5)) console.log(`  แก้  ${u.name} ← ${u.address.split('\n')[0]}`);
  for (const c of create.slice(0, 5)) console.log(`  เพิ่ม ${c.name} ← ${c.address.split('\n')[0]}`);
  if (!apply) { console.log('\n(ยังไม่เขียน — ใส่ --apply เพื่อนำเข้าจริง)'); return; }

  await db.transaction(async (tx) => {
    for (const u of update) {
      await tx.update(masterRecords).set({ address: u.address, updatedAt: new Date() }).where(eq(masterRecords.id, u.id));
    }
    const [row] = await tx.select({ max: sql<number>`coalesce(max(nullif(regexp_replace(code, '^SHP', ''), '')::int), 0)` })
      .from(masterRecords).where(and(eq(masterRecords.type, 'shippers'), sql`code ~ '^SHP[0-9]+$'`));
    let next = Number(row?.max ?? 0);
    for (const c of create) {
      next += 1;
      await tx.insert(masterRecords).values({
        id: newId('MD'), type: 'shippers', code: `SHP${String(next).padStart(4, '0')}`, name: c.name,
        shortName: c.short && key(c.short) !== key(c.name) ? c.short.slice(0, 60) : null, address: c.address, isActive: true,
      });
    }
  });
  console.log('นำเข้าแล้ว');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
