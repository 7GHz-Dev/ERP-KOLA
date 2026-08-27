/**
 * ย้ายชื่อ Partner ที่เคยพิมพ์มือไว้ในงาน ขึ้นเป็น Master Data
 *
 * ก่อนหน้านี้ FAH พิมพ์ชื่อเอง ชื่อเดียวกันจึงสะกดต่างกันได้
 * ตอนนี้เป็น dropdown แล้ว ต้องมีรายการตั้งต้นก่อน ไม่งั้นช่องจะว่าง
 * ดึงจากข้อมูลที่มีอยู่จริงเท่านั้น ไม่ได้แต่งชื่อขึ้นมาเอง
 */
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { loadEnv } from '../src/lib/env';

loadEnv();

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });

  const names = await sql<{ name: string; n: number }[]>`
    select trim(release_partner) as name, count(*)::int as n
    from jobs
    where release_partner is not null and trim(release_partner) <> ''
    group by trim(release_partner)
    order by n desc`;

  const handoff = await sql<{ name: string; n: number }[]>`
    select trim(partner_name) as name, count(*)::int as n
    from do_handoffs
    where partner_name is not null and trim(partner_name) <> ''
    group by trim(partner_name)`;

  const merged = new Map<string, number>();
  [...names, ...handoff].forEach((r) => merged.set(r.name, (merged.get(r.name) ?? 0) + r.n));

  if (!merged.size) {
    console.log('ยังไม่มีชื่อ Partner ในข้อมูลเดิม — ให้ ADMIN เพิ่มเองที่ Master Data');
    await sql.end();
    return;
  }

  const existing = await sql<{ name: string }[]>`
    select name from master_records where type = 'partners'`;
  const have = new Set(existing.map((r) => r.name.trim().toUpperCase()));

  const [{ max }] = await sql<{ max: number }[]>`
    select coalesce(max(nullif(regexp_replace(code, '^PTN', ''), '')::int), 0) as max
    from master_records where type = 'partners' and code ~ '^PTN[0-9]+$'`;

  let next = Number(max);
  let added = 0;
  for (const [name, n] of [...merged.entries()].sort((a, b) => b[1] - a[1])) {
    if (have.has(name.toUpperCase())) continue;
    next += 1;
    const code = `PTN${String(next).padStart(4, '0')}`;
    await sql`insert into master_records (id, type, code, name, is_active)
              values (${`MD-${randomBytes(8).toString('hex').toUpperCase()}`},
                      'partners', ${code}, ${name}, true)`;
    console.log(`  เพิ่ม ${code} · ${name}  (ใช้อยู่ ${n} งาน)`);
    added += 1;
  }

  console.log(added ? `\nเพิ่ม Partner ${added} รายการ` : '\nมีครบอยู่แล้ว ไม่ได้เพิ่มอะไร');
  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
