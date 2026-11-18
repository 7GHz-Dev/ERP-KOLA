import { inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { haulPlans } from '@/db/schema';
import { demUntil, doStage, DO_TEXT, returnDue } from '@/lib/haul-risk';

/**
 * ส่งแพลนลากตู้เข้า ERP TTN (ทีมจัดรถ) — เรียกตอน NAMKANG กด "สั่งลาก" ที่หน้า Transport Request
 *
 * ฝั่ง TTN เป็น Supabase แยกโปรเจกต์ รับผ่าน RPC public.kola_receive_plan (security definer)
 * ด้วย publishable key ของ TTN + คีย์ลับของการเชื่อม — ไม่ต้องถือ secret key ของ TTN
 *   TTN_SUPABASE_URL       https://<ref>.supabase.co
 *   TTN_SUPABASE_ANON_KEY  publishable key ของ TTN
 *   TTN_INBOUND_KEY        คีย์ลับ (ฝั่ง TTN เก็บเป็น sha256 ใน integration_keys)
 *
 * ตู้ละแถว ผูกด้วย id ตู้ของ KOLA — ส่งซ้ำได้ (เปลี่ยนวันลาก) ฝั่ง TTN ไม่ทับคนขับ/ราคาที่จัดไว้
 * ผลการส่งเก็บใน haul_plans.ttn_sent_at / ttn_error ให้หน้าเว็บบอกว่าตู้ไหนยังไม่ถึง TTN
 */
export function ttnConfigured() {
  return Boolean(process.env.TTN_SUPABASE_URL && process.env.TTN_SUPABASE_ANON_KEY && process.env.TTN_INBOUND_KEY);
}

type Row = {
  container_id: string; container_no: string | null; weight: string | null; job_no: string; bl_no: string | null;
  shipper: string | null; shipline: string | null; vessel: string | null; voyage: string | null; eta: string | null;
  eta_official: boolean; dem_days: number; det_days: number; terminal: string | null;
  job_type: string | null; job_type_short: string | null; do_exchanged_at: string | null; do_pay_amount: string | null;
  do_claimed_at: string | null; bl_containers: number; haul_date: string;
};

export type TtnRow = Record<string, string | number | boolean | null>;

/** แถวที่ส่ง TTN ของตู้ในแพลน (วันลากจาก haul_plans) */
export async function ttnRows(containerIds: string[]): Promise<TtnRow[]> {
  if (!containerIds.length) return [];
  const rows = await db.execute<Row>(sql`
    select c.id as container_id, c.container_no, c.weight::text as weight, j.job_no, j.bl_no,
           shipper.name as shipper, j.shipline, j.vessel, j.voyage, j.eta::text as eta, j.eta_is_official as eta_official,
           j.dem_days, j.det_days, terminal.name as terminal, jt.name as job_type, jt.short_name as job_type_short,
           j.do_exchanged_at::text as do_exchanged_at, j.do_pay_amount::text as do_pay_amount,
           j.do_claimed_at::text as do_claimed_at,
           (select count(*)::int from containers x where x.job_id = j.id) as bl_containers,
           hp.haul_date::text as haul_date
      from haul_plans hp
      join containers c on c.id = hp.container_id
      join jobs j on j.id = hp.job_id
      left join master_records shipper on shipper.id = j.shipper_id
      left join master_records terminal on terminal.id = j.terminal_id
      left join master_records jt on jt.id = j.job_type_id
     where hp.container_id in (${sql.join(containerIds.map((id) => sql`${id}`), sql`, `)})
  `);
  return rows.map((r) => {
    const msfz = /MSFZ/i.test(`${r.job_type_short ?? ''} ${r.job_type ?? ''}`);
    return {
      source_ref: r.container_id,
      source_job_no: r.job_no,
      plan_date: r.haul_date,
      container_no: (r.container_no ?? '').replace(/[\s-]/g, '').toUpperCase(),
      bl_no: r.bl_no?.trim() || null,
      weight_doc_kg: r.weight ? Number(r.weight) : null,
      port: r.terminal,
      // ปลายทาง/ประเภทงานใช้ค่าตามตัวเลือกของ TTN เฉพาะที่แน่ใจ (MSFZ) — นอกนั้นให้ทีมจัดรถเลือกเอง
      destination: msfz ? 'MSFZ' : null,
      job_type: msfz ? 'MSFZ - รถยนต์เก่า' : (r.job_type_short || r.job_type),
      customer: r.shipper,
      shipping: 'KOLA SHIPPING',
      shipper: r.shipper,
      shipline: r.shipline,
      vessel: [r.vessel, r.voyage].filter(Boolean).join(' ') || null,
      eta: r.eta,
      eta_official: Boolean(r.eta_official),
      do_status: DO_TEXT[doStage({ doExchangedAt: r.do_exchanged_at, doPayAmount: r.do_pay_amount, doClaimedAt: r.do_claimed_at })],
      dem_free_until: demUntil({ eta: r.eta, demDays: Number(r.dem_days) || 0 }),
      det_days: Number(r.det_days) || null,
      return_due_date: returnDue(r.haul_date, Number(r.det_days) || 0),
      bl_containers: Number(r.bl_containers) || null,
    };
  }).filter((r) => r.container_no);
}

export type TtnResult = { ok: true; inserted: number; updated: number; locked: number } | { ok: false; error: string };

/** ส่งตู้เข้า TTN แล้วบันทึกผลลง haul_plans — ไม่ throw (แพลนฝั่ง KOLA บันทึกไปแล้ว) */
export async function pushToTtn(containerIds: string[]): Promise<TtnResult> {
  const ids = [...new Set(containerIds)];
  if (!ids.length) return { ok: true, inserted: 0, updated: 0, locked: 0 };
  let result: TtnResult;
  if (!ttnConfigured()) {
    result = { ok: false, error: 'ยังไม่ได้ตั้งค่าการเชื่อม ERP TTN (TTN_SUPABASE_URL / TTN_SUPABASE_ANON_KEY / TTN_INBOUND_KEY)' };
  } else {
    try {
      const rows = await ttnRows(ids);
      const res = await fetch(`${process.env.TTN_SUPABASE_URL!.replace(/\/$/, '')}/rest/v1/rpc/kola_receive_plan`, {
        method: 'POST',
        headers: {
          apikey: process.env.TTN_SUPABASE_ANON_KEY!,
          authorization: `Bearer ${process.env.TTN_SUPABASE_ANON_KEY!}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ p_key: process.env.TTN_INBOUND_KEY, p_rows: rows }),
        signal: AbortSignal.timeout(20_000),
        cache: 'no-store',
      });
      const text = await res.text();
      if (!res.ok) {
        let msg = text.slice(0, 200);
        try { msg = (JSON.parse(text) as { message?: string }).message ?? msg; } catch { /* ข้อความดิบ */ }
        result = { ok: false, error: res.status === 404 ? 'ERP TTN ยังไม่มีช่องรับแพลน (ยังไม่ได้รัน migration kola_inbound)' : `ERP TTN ตอบ ${res.status}: ${msg}` };
      } else {
        const body = JSON.parse(text) as { inserted?: number; updated?: number; locked?: number };
        result = { ok: true, inserted: body.inserted ?? 0, updated: body.updated ?? 0, locked: body.locked ?? 0 };
      }
    } catch (e) {
      result = { ok: false, error: `ติดต่อ ERP TTN ไม่ได้: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  const now = new Date();
  await db.update(haulPlans)
    .set(result.ok ? { ttnSentAt: now, ttnError: null } : { ttnError: result.error.slice(0, 300) })
    .where(inArray(haulPlans.containerId, ids));
  return result;
}
