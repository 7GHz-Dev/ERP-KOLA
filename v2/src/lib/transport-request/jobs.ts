import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { blCandidates, keyOf, type JobLite } from './parse';

/**
 * ค้นงาน KOLA สำหรับ Transport Request / ไฟล์ใบขน·E-Office / สถานะ DO ที่ SHIPME ถาม
 *
 * ตรงทั้งค่าเท่านั้น (ไม่ใช้ like) — แถวที่จับผิดงานจะไปถึงชิปปิ้งโดยไม่มีใครสังเกต จับไม่ได้ยังดีกว่า
 * BL ของงานดูทั้ง jobs.bl_no และตาราง bls · BL แบบ X(Y) จับได้ทั้ง X, Y และค่าเต็ม
 * key ที่ตรงกับหลายงานไม่คืน (กันแนบผิดงาน)
 */
type Row = {
  id: string; job_no: string; bls: string[] | null; containers: string[] | null; shipline: string | null;
  vessel: string | null; eta: string | null; do_exchanged_at: string | null; declaration_nos: string[] | null;
};

const full = (col: string) => sql.raw(`upper(regexp_replace(coalesce(${col}, ''), '[^A-Za-z0-9]', '', 'g'))`);
const inner = (col: string) => sql.raw(`upper(regexp_replace(coalesce(substring(${col} from '\\(([^)]*)\\)'), ''), '[^A-Za-z0-9]', '', 'g'))`);
const outer = (col: string) => sql.raw(`upper(regexp_replace(split_part(coalesce(${col}, ''), '(', 1), '[^A-Za-z0-9]', '', 'g'))`);
const anyKey = (col: string, list: SQL) => sql`(${full(col)} in (${list}) or (${sql.raw(col)} like '%(%' and (${inner(col)} in (${list}) or ${outer(col)} in (${list}))))`;

async function find(where: SQL): Promise<(JobLite & { bls: string[]; declarationNos: string[] })[]> {
  const rows = await db.execute<Row>(sql`
    select j.id, j.job_no,
           array_remove(array[j.bl_no] || coalesce((select array_agg(b.bl_no) from bls b where b.job_id = j.id), '{}'), null) as bls,
           (select array_agg(c.container_no order by c.container_no) from containers c where c.job_id = j.id) as containers,
           (select array_agg(e.declaration_no) from customs_entries e where e.job_id = j.id and e.declaration_no is not null) as declaration_nos,
           j.shipline, j.vessel, j.eta::text as eta, j.do_exchanged_at::text as do_exchanged_at
      from jobs j
     where j.is_archived = false and (${where})
     limit 500`);
  return [...rows].map((r) => ({
    id: r.id, jobNo: r.job_no, blNo: (r.bls ?? [])[0] ?? '', bls: r.bls ?? [],
    containers: (r.containers ?? []).filter(Boolean).map(keyOf),
    declarationNos: (r.declaration_nos ?? []).map(keyOf),
    shipline: r.shipline ?? '', vessel: r.vessel ?? '', eta: r.eta,
    doExchangedAt: r.do_exchanged_at ? new Date(r.do_exchanged_at).toISOString() : null,
  }));
}

/** key ที่ตรงกับงานเดียวเท่านั้น → งาน */
function uniqueMap(pairs: [string, JobLite][]) {
  const seen = new Map<string, JobLite | null>();
  for (const [k, job] of pairs) {
    const prev = seen.get(k);
    seen.set(k, prev === undefined || prev?.id === job.id ? job : null);
  }
  return new Map([...seen].filter((e): e is [string, JobLite] => e[1] !== null));
}

/** BL key (keyOf) → งาน — ส่งได้ทั้ง key ของ BL เต็มหรือส่วนในวงเล็บ */
export async function jobsByBlKeys(keys: string[]): Promise<Map<string, JobLite>> {
  const wanted = new Set(keys.map(keyOf).filter((k) => k.length >= 4));
  if (!wanted.size) return new Map();
  const list = sql.join([...wanted].map((k) => sql`${k}`), sql`, `);
  const jobs = await find(sql`${anyKey('j.bl_no', list)}
    or exists (select 1 from bls b where b.job_id = j.id and ${anyKey('b.bl_no', list)})`);
  const pairs: [string, JobLite][] = [];
  for (const job of jobs) {
    const { bls: _bls, declarationNos: _d, ...lite } = job;
    for (const bl of job.bls) for (const k of blCandidates(bl)) if (wanted.has(k)) pairs.push([k, lite]);
  }
  return uniqueMap(pairs);
}

/** เลขใบขน (keyOf เช่น A0310691002615) → งาน ผ่าน customs_entries.declaration_no */
export async function jobsByDeclarationNos(nos: string[]): Promise<Map<string, JobLite>> {
  const wanted = new Set(nos.map(keyOf).filter((k) => k.length >= 10));
  if (!wanted.size) return new Map();
  const list = sql.join([...wanted].map((k) => sql`${k}`), sql`, `);
  const jobs = await find(sql`exists (select 1 from customs_entries e where e.job_id = j.id and ${full('e.declaration_no')} in (${list}))`);
  const pairs: [string, JobLite][] = [];
  for (const job of jobs) {
    const { bls: _bls, declarationNos, ...lite } = job;
    for (const k of declarationNos) if (wanted.has(k)) pairs.push([k, lite]);
  }
  return uniqueMap(pairs);
}
