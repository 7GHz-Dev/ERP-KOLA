import { or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { listJobs, searchCondition, type JobRow } from '@/lib/queries/jobs';
import { isPartnerRelease } from '@/lib/job-types';
import { isOtherCargo } from '@/lib/other-cargo';

/**
 * เช็คสถานะงานด้วย BL — วาดเป็นหลอดแบ่งช่องตามขั้นงาน (ไม่ใช้ AI อ่านจากฐานข้อมูลตรง ๆ)
 *
 * หลอดหลักไล่ตามลำดับที่งานเดินจริง แต่ละช่องมีเจ้าของ (ตำแหน่ง) และสถานะ
 *   done = ผ่านแล้ว (มีวันที่) · now = ตอนนี้อยู่ตรงนี้ · todo = ยังไม่ถึง · skip = งานนี้ไม่ต้องทำ
 * งานคู่ขนานที่ไม่ได้ขวางหลอดหลัก (Invoice DO · Client in Charge · Surrender · ตั้งเบิก) แสดงแยกเป็นชิป
 */

export type StageState = 'done' | 'now' | 'todo' | 'skip';
export type Stage = { key: string; icon: string; label: string; owner: string; state: StageState; at: string | null; note?: string };
export type SideTask = { key: string; icon: string; label: string; owner: string; done: boolean; at: string | null; note?: string };
export type Track = {
  id: string; jobNo: string; blNo: string | null; vessel: string | null; eta: string | null;
  jobType: string | null; client: string | null; shipper: string | null; containers: number;
  declarationNo: string | null;
  stages: Stage[]; side: SideTask[];
  /** ช่องที่ผ่านแล้ว / ช่องที่ต้องทำทั้งหมด (ไม่นับ skip) */
  progress: { done: number; total: number };
  /** ช่องปัจจุบัน — null = เสร็จครบทุกช่องแล้ว */
  current: Stage | null;
  /** ค้างที่ช่องปัจจุบันมากี่วัน (นับจากวันที่ช่องก่อนหน้าเสร็จ) */
  waitingDays: number | null;
};

const OWNER = {
  import: 'Import Officer', senior: 'Senior Officer', head: 'Head Officer', ann: 'ANN', may: 'MAY',
};

type Extra = {
  an_at: string | null; fn_at: string | null; filed_at: string | null; handoff_at: string | null;
  signed_at: string | null; haul_at: string | null;
};

/** วันที่ของแต่ละเหตุการณ์ที่ listJobs ไม่ได้ให้มา — รวมในคำสั่งเดียว */
async function extraDates(ids: string[]): Promise<Map<string, Extra>> {
  if (!ids.length) return new Map();
  const rows = await db.execute<Extra & { id: string }>(sql`
    select j.id,
      (select max(a.decided_at) from approvals a where a.job_id = j.id and a.approval_type = 'AN' and a.status = 'APPROVED') as an_at,
      (select max(a.decided_at) from approvals a where a.job_id = j.id and a.approval_type = 'FN' and a.status = 'APPROVED') as fn_at,
      (select max(coalesce(ce.filed_at, ce.updated_at)) from customs_entries ce where ce.job_id = j.id and ce.declaration_no is not null) as filed_at,
      (select min(dh.sent_at) from do_handoffs dh where dh.job_id = j.id) as handoff_at,
      (select max(f.uploaded_at) from files f where f.job_id = j.id and f.category = 'EOFFICE_SIGNED' and f.is_current) as signed_at,
      (select max(hp.sent_at) from haul_plans hp where hp.job_id = j.id) as haul_at
    from jobs j where j.id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
  return new Map([...rows].map((r) => [r.id, r]));
}

const iso = (v: unknown) => (v ? (v instanceof Date ? v.toISOString() : String(v)) : null);

function buildTrack(r: JobRow, x: Extra | undefined): Track {
  const muo = isPartnerRelease(r.jobTypeCode);
  const other = isOtherCargo(r.jobTypeCode);
  const filed = r.customsStatus === 'FILED';
  const draftSent = r.draftStatus === 'SUBMITTED' || filed;
  const handover = Boolean(r.eofficeHandoverAt || r.currentFiles?.EOFFICE_SIGNED);
  const head = OWNER.head;
  const imp = other ? head : OWNER.import;
  const senior = other ? head : OWNER.senior;

  // [key, icon, label, owner, done?, when, note]
  const raw: Array<[string, string, string, string, boolean | 'skip', string | null, string?]> = [
    ['intake', '📥', 'รับงาน', imp, true, iso(r.createdAt), r.sourceType === 'BL' ? 'เพิ่มจาก BL' : 'จาก Arrival Notice'],
    ['an', '✅', other ? 'ยืนยัน BL' : 'อนุมัติ BL', head, r.anStatus === 'APPROVED', iso(x?.an_at),
      r.anStatus === 'PENDING' ? 'รอ Head Officer อนุมัติ' : r.anStatus === 'REJECTED' ? 'ถูกตีกลับ — แก้แล้วส่งใหม่' : undefined],
    ['fn', '🧾', 'Final Invoice', other ? head : `${imp} → ${senior}`, r.fnStatus === 'APPROVED', iso(x?.fn_at),
      r.fnStatus === 'PENDING' ? 'รอ Senior Officer อนุมัติ' : r.fnStatus === 'REJECTED' ? 'ถูกตีกลับ' : r.currentFiles?.FINAL_INVOICE ? 'อัปไฟล์แล้ว ยังไม่ส่งอนุมัติ' : undefined],
    ['draft', '📝', 'Draft ใบขน', imp, other ? Boolean(r.draftRefNo) || filed : draftSent, null,
      r.draftStatus === 'REJECTED' ? 'ถูกตีกลับ' : r.draftStatus === 'SENT_TO_HUB' ? 'Automation กำลังสร้าง' : r.draftRefNo && !draftSent ? `Ref ${r.draftRefNo}` : undefined],
    ['customs', '🏛️', 'ได้เลขใบขน', senior, filed, iso(x?.filed_at), r.declarationNo ?? undefined],
    ['eoffice', '📂', 'เอกสาร E-Office', imp, handover, iso(r.eofficeHandoverAt ?? x?.signed_at),
      r.eofficeRequestNo && !handover ? `คำร้อง ${r.eofficeRequestNo}` : undefined],
    ['partner', '🚚', 'ส่ง Partner', imp, Boolean(r.eofficeSentAt), iso(r.eofficeSentAt), r.releasePartner ?? undefined],
    ['exchange', '🔄', 'แลก DO', OWNER.ann, muo ? 'skip' : Boolean(r.doExchangedAt), iso(r.doExchangedAt), muo ? 'MUO — Partner แลกเอง' : undefined],
    ['haul', '🚛', 'ลากตู้', `${head} → ${OWNER.may}`, muo || !r.containerCount ? 'skip' : Boolean(r.haulPlanned), iso(x?.haul_at),
      muo ? 'MUO — Partner ลากเอง' : !r.containerCount ? 'ไม่มีรายการตู้' : undefined],
  ];

  let currentFound = false;
  const stages: Stage[] = raw.map(([key, icon, label, owner, done, at, note]) => {
    let state: StageState;
    if (done === 'skip') state = 'skip';
    else if (done) state = 'done';
    else if (!currentFound) { state = 'now'; currentFound = true; }
    else state = 'todo';
    return { key, icon, label, owner, state, at: state === 'done' ? at : null, note };
  });

  const counted = stages.filter((s) => s.state !== 'skip');
  const current = stages.find((s) => s.state === 'now') ?? null;
  // ค้างมากี่วัน: นับจากวันที่ของช่องก่อนหน้าที่ผ่านแล้ว (ช่องที่ไม่มีวันที่ ใช้ช่องก่อนหน้าอีกที)
  let waitingDays: number | null = null;
  if (current) {
    const before = stages.slice(0, stages.indexOf(current)).reverse().find((s) => s.state === 'done' && s.at);
    if (before?.at) waitingDays = Math.max(0, Math.floor((Date.now() - new Date(before.at).getTime()) / 86_400_000));
  }

  const side: SideTask[] = [
    ...(other || muo ? [] : [{ key: 'invdo', icon: '💴', label: 'Invoice DO → ส่ง Partner', owner: OWNER.senior, done: Boolean(x?.handoff_at), at: iso(x?.handoff_at) }]),
    { key: 'client', icon: '👤', label: 'Client in Charge', owner: head, done: Boolean(r.customerConfirmedAt), at: iso(r.customerConfirmedAt), note: r.personName ?? undefined },
    { key: 'surrender', icon: '📄', label: 'Surrender', owner: head, done: r.surrenderStatus === 'CLEARED', at: null,
      note: r.surrenderStatus === 'ISSUE' ? 'มีปัญหา' : r.surrenderStatus === 'CLEARED' ? undefined : 'รอตรวจ' },
    ...(muo ? [] : [{ key: 'claim', icon: '💰', label: 'ตั้งเบิกค่า DO', owner: OWNER.may, done: Boolean(r.doClaimedAt), at: iso(r.doClaimedAt) }]),
  ];

  return {
    id: r.id, jobNo: r.jobNo, blNo: r.blNo, vessel: [r.vessel, r.voyage].filter(Boolean).join(' / ') || null,
    eta: r.eta ? String(r.eta).slice(0, 10) : null, jobType: r.jobTypeName, client: r.personName, shipper: r.shipperName,
    containers: r.containerCount, declarationNo: r.declarationNo,
    stages, side, progress: { done: counted.filter((s) => s.state === 'done').length, total: counted.length },
    current, waitingDays,
  };
}

/** ค้นด้วย BL / Job No. / เลขตู้ / Ref / เลขใบขน — คืนไม่เกิน 6 งาน (มากกว่านั้นให้พิมพ์ให้ชัดขึ้น) */
export async function trackJobs(query: string): Promise<{ total: number; jobs: Track[] }> {
  const q = query.trim();
  if (q.length < 3) return { total: 0, jobs: [] };
  const conds = ['blNo', 'jobNo', 'container', 'refNo', 'entryNo'].map((k) => searchCondition(k, q)).filter(Boolean) as SQL[];
  const { rows, total } = await listJobs({ where: () => [or(...conds)], sortBy: 'createdAt', sortDir: 'desc', pageSize: 6 });
  const extra = await extraDates(rows.map((r) => r.id));
  return { total, jobs: rows.map((r) => buildTrack(r, extra.get(r.id))) };
}
