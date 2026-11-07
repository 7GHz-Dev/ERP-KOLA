import { sql } from 'drizzle-orm';
import { db } from '@/db';

/**
 * งานในระบบที่ BL ตรงกับ Invoice — Final Invoice ต้องผูกกับงานที่มีอยู่แล้ว
 *
 * เทียบแบบไม่สนช่องว่างและตัวพิมพ์ ดูทั้ง jobs.bl_no และตาราง bls (งานหนึ่งมีได้หลาย BL)
 * ไม่เจอแบบตรงตัว ลองแบบ "มีเลขนี้อยู่ข้างใน" — BL บางงานบันทึกแบบ KG1042026-73133-2(AMP0561328B)
 */
export type JobMatch = {
  id: string; jobNo: string; blNo: string | null; containers: string[];
  fnStatus: string | null; finalInvoice: { fileName: string; version: number } | null;
};

export async function jobsForBl(blNo: string): Promise<JobMatch[]> {
  const key = blNo.replace(/\s/g, '').toUpperCase();
  if (!key) return [];
  const norm = (col: string) => sql.raw(`upper(regexp_replace(coalesce(${col}, ''), '[[:space:]]', '', 'g'))`);
  const run = (cond: (col: ReturnType<typeof norm>) => ReturnType<typeof sql>) => db.execute<{
    id: string; job_no: string; bl_no: string | null; containers: string[] | null; fn_status: string | null;
    fi_name: string | null; fi_version: number | null;
  }>(sql`
    select j.id, j.job_no, j.bl_no,
           (select array_agg(c.container_no order by c.container_no) from containers c where c.job_id = j.id) as containers,
           (select a.status from approvals a where a.job_id = j.id and a.approval_type = 'FN'
             order by a.requested_at desc limit 1) as fn_status,
           f.file_name as fi_name, f.version as fi_version
      from jobs j
      left join files f on f.job_id = j.id and f.category = 'FINAL_INVOICE' and f.is_current = true
     where j.is_archived = false
       and (${cond(norm('j.bl_no'))}
            or exists (select 1 from bls b where b.job_id = j.id and ${cond(norm('b.bl_no'))}))
     order by j.created_at desc
     limit 10`);
  let rows = [...await run((col) => sql`${col} = ${key}`)];
  if (!rows.length) rows = [...await run((col) => sql`${col} like ${`%${key}%`}`)];
  return rows.map((r) => ({
    id: r.id, jobNo: r.job_no, blNo: r.bl_no,
    containers: (r.containers ?? []).filter(Boolean).map((c) => c.replace(/[\s-]/g, '').toUpperCase()),
    fnStatus: r.fn_status,
    finalInvoice: r.fi_name ? { fileName: r.fi_name, version: Number(r.fi_version) } : null,
  }));
}
