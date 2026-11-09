import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';

/**
 * งานในระบบที่ตรงกับ Invoice — Final Invoice ต้องผูกกับงานที่มีอยู่แล้ว
 *
 * หาด้วย BL ก่อน (เทียบแบบไม่สนช่องว่างและตัวพิมพ์ ดูทั้ง jobs.bl_no และตาราง bls เพราะงานหนึ่งมีได้หลาย BL)
 * ไม่เจอแบบตรงตัว ลองแบบ "มีเลขนี้อยู่ข้างใน" — BL บางงานบันทึกแบบ KG1042026-73133-2(AMP0561328B)
 * ใบผู้ขายที่ช่อง B/L ว่าง (ออก invoice ก่อนได้เลข BL) หาจากเลขตู้แทน — ตู้ในใบตรงกับตู้ในงาน
 */
export type JobMatch = {
  id: string; jobNo: string; blNo: string | null; containers: string[];
  fnStatus: string | null; finalInvoice: { fileName: string; version: number } | null;
  /** ตู้ในใบที่ตรงกับตู้ของงานนี้ (ตอนหาด้วยเลขตู้) */
  sharedBoxes?: number;
};

type Row = {
  id: string; job_no: string; bl_no: string | null; containers: string[] | null; fn_status: string | null;
  fi_name: string | null; fi_version: number | null;
};

const norm = (col: string) => sql.raw(`upper(regexp_replace(coalesce(${col}, ''), '[[:space:]-]', '', 'g'))`);

async function find(where: SQL) {
  const rows = await db.execute<Row>(sql`
    select j.id, j.job_no, j.bl_no,
           (select array_agg(c.container_no order by c.container_no) from containers c where c.job_id = j.id) as containers,
           (select a.status from approvals a where a.job_id = j.id and a.approval_type = 'FN'
             order by a.requested_at desc limit 1) as fn_status,
           f.file_name as fi_name, f.version as fi_version
      from jobs j
      left join files f on f.job_id = j.id and f.category = 'FINAL_INVOICE' and f.is_current = true
     where j.is_archived = false and (${where})
     order by j.created_at desc
     limit 10`);
  return [...rows].map((r): JobMatch => ({
    id: r.id, jobNo: r.job_no, blNo: r.bl_no,
    containers: (r.containers ?? []).filter(Boolean).map((c) => c.replace(/[\s-]/g, '').toUpperCase()),
    fnStatus: r.fn_status,
    finalInvoice: r.fi_name ? { fileName: r.fi_name, version: Number(r.fi_version) } : null,
  }));
}

/** หาด้วย BL (หรือ Job No. ที่คนพิมพ์ค้นเอง) */
export async function jobsForBl(blNo: string): Promise<JobMatch[]> {
  const key = blNo.replace(/[\s-]/g, '').toUpperCase();
  if (key.length < 4) return [];
  const blIs = (cond: (col: ReturnType<typeof norm>) => SQL) =>
    sql`${cond(norm('j.bl_no'))} or ${cond(norm('j.job_no'))}
        or exists (select 1 from bls b where b.job_id = j.id and ${cond(norm('b.bl_no'))})`;
  const exact = await find(blIs((col) => sql`${col} = ${key}`));
  return exact.length ? exact : find(blIs((col) => sql`${col} like ${`%${key}%`}`));
}

/** หาด้วยเลขตู้ — เรียงงานที่ตู้ตรงมากที่สุดก่อน */
export async function jobsForContainers(boxes: string[]): Promise<JobMatch[]> {
  const keys = [...new Set(boxes.map((b) => b.replace(/[\s-]/g, '').toUpperCase()).filter(Boolean))];
  if (!keys.length) return [];
  const list = sql.join(keys.map((k) => sql`${k}`), sql`, `);
  const rows = await find(sql`exists (select 1 from containers c where c.job_id = j.id and ${norm('c.container_no')} in (${list}))`);
  return rows
    .map((j) => ({ ...j, sharedBoxes: j.containers.filter((c) => keys.includes(c)).length }))
    .sort((a, b) => b.sharedBoxes - a.sharedBoxes);
}

/** งานของ Invoice นี้: BL ก่อน ไม่มี BL หรือหาไม่เจอ ใช้เลขตู้ */
export async function jobsForInvoice(inv: { blNo: string; containers: string[] }) {
  if (inv.blNo) {
    const byBl = await jobsForBl(inv.blNo);
    if (byBl.length) return { jobs: byBl, by: 'bl' as const };
  }
  return { jobs: await jobsForContainers(inv.containers), by: 'containers' as const };
}
