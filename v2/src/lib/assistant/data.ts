import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { jobs } from '@/db/schema';
import { fileLabel } from '@/lib/file-categories';
import { loadJobDetail } from '@/lib/queries/job-detail';
import {
  latestApproval, listJobs, notPartnerRelease, QUEUE, searchCondition, type JobRow, type JoinContext,
} from '@/lib/queries/jobs';
import { STAGES } from '@/lib/queries/overview';

/**
 * ข้อมูลที่ผู้ช่วยถาม (Chatbot) อ่านได้ — อ่านอย่างเดียวทั้งหมด
 *
 * ไม่เปิดให้ AI เขียน SQL เอง ทุกคำถามต้องผ่านฟังก์ชันชุดนี้ซึ่งเลือกตารางและคอลัมน์ไว้แล้ว
 * จึงไม่มีทางไปถึงตารางผู้ใช้ รหัสผ่าน session หรือรหัสลับต่าง ๆ
 *
 * ขั้นงานใช้เงื่อนไข QUEUE ตัวเดียวกับหน้างานจริง ตัวเลขที่บอทตอบจึงตรงกับที่แต่ละแผนกเห็นในหน้าของตัวเอง
 */

export type Step = { key: string; owner: string; label: string; where: (ctx: JoinContext) => (SQL | undefined)[] };

/** ทุกขั้นที่ถามได้ — ขั้นของ PAINT / FAH มาจากหน้าภาพรวมงาน บวกคิวของแผนกอื่น */
export const STEPS: Step[] = [
  { key: 'nam-approve', owner: 'NAMKANG', label: 'รอ NAMKANG อนุมัติ AN (ข้อมูล BL)', where: QUEUE.namApprove() },
  ...STAGES.map((s) => ({ key: s.key, owner: s.owner, label: s.label, where: s.where })),
  { key: 'nam-customer', owner: 'NAMKANG', label: 'รอใส่ Client in Charge / ยืนยันข้อมูลลูกค้า', where: QUEUE.namCustomer('wait') },
  { key: 'nam-haul', owner: 'NAMKANG', label: 'รอส่งแพลนลากตู้', where: QUEUE.haul('wait') },
  { key: 'may-haul-ack', owner: 'MAY', label: 'แพลนลากตู้ที่ MAY ยังไม่กดรับ', where: QUEUE.haul('new') },
  { key: 'ann-do-exchange', owner: 'ANN', label: 'รอแลก DO', where: QUEUE.doExchange('wait') },
  { key: 'may-claim', owner: 'MAY', label: 'รอตั้งเบิกค่า DO', where: QUEUE.mayDoPay('wait') },
  { key: 'customs-filed', owner: '-', label: 'ได้เลขใบขนแล้ว', where: QUEUE.fahDraftDone() },
];
export const STEP_KEYS = STEPS.map((s) => s.key);

const stepCondition = (step: Step, ctx: JoinContext): SQL => and(...step.where(ctx)) ?? sql`false`;

/** ช่องที่ค้นแบบข้อความอิสระ — เลขงาน BL ตู้ ชื่อบริษัท เรือ Ref เลขใบขน */
const FREE_TEXT_KEYS = ['jobNo', 'blNo', 'container', 'shipper', 'consignee', 'notify', 'person', 'vessel', 'refNo', 'entryNo'];

export type JobQuery = {
  query?: string;
  step?: string;
  eta_from?: string; eta_to?: string;
  created_from?: string; created_to?: string;
  job_type?: string;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isoOrNull = (v?: string) => (v && ISO.test(v) ? v : null);

/** เงื่อนไขกรองงานจากพารามิเตอร์ของเครื่องมือ — ใช้ร่วมกันทั้งค้นหาและนับแบบจัดกลุ่ม */
function filterOf(q: JobQuery) {
  return (ctx: JoinContext): (SQL | undefined)[] => {
    const conds: (SQL | undefined)[] = [];
    const text = q.query?.trim();
    if (text) {
      // พิมพ์หลายคำคั่นช่องว่าง = ทุกคำต้องเจอ (คำละช่องไหนก็ได้)
      for (const word of text.split(/\s+/).slice(0, 4)) {
        const any = FREE_TEXT_KEYS.map((k) => searchCondition(k, word)).filter(Boolean) as SQL[];
        conds.push(or(...any));
      }
    }
    if (q.step) {
      const step = STEPS.find((s) => s.key === q.step);
      conds.push(step ? stepCondition(step, ctx) : sql`false`);
    }
    const etaFrom = isoOrNull(q.eta_from); const etaTo = isoOrNull(q.eta_to);
    if (etaFrom) conds.push(sql`${jobs.eta} >= ${etaFrom}::date`);
    if (etaTo) conds.push(sql`${jobs.eta} <= ${etaTo}::date`);
    const cFrom = isoOrNull(q.created_from); const cTo = isoOrNull(q.created_to);
    if (cFrom) conds.push(sql`(${jobs.createdAt} at time zone 'Asia/Bangkok')::date >= ${cFrom}::date`);
    if (cTo) conds.push(sql`(${jobs.createdAt} at time zone 'Asia/Bangkok')::date <= ${cTo}::date`);
    if (q.job_type?.trim()) conds.push(searchCondition('jobType', q.job_type.trim()));
    return conds;
  };
}

/** ขั้นที่แต่ละงานค้างอยู่ตอนนี้ — งานหนึ่งค้างได้หลายขั้นพร้อมกัน */
export async function stepsOf(jobIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!jobIds.length) return map;
  const an = latestApproval('AN');
  const fn = latestApproval('FN');
  const ctx = { an, fn };
  const flags = Object.fromEntries(
    STEPS.map((s) => [s.key, sql<boolean>`coalesce(${stepCondition(s, ctx)}, false)`]),
  ) as Record<string, SQL<boolean>>;
  const rows = await db
    .select({ id: jobs.id, ...flags })
    .from(jobs)
    .leftJoin(an, eq(an.jobId, jobs.id))
    .leftJoin(fn, eq(fn.jobId, jobs.id))
    .where(inArray(jobs.id, jobIds));
  for (const row of rows as Array<Record<string, unknown> & { id: string }>) {
    map.set(row.id, STEPS.filter((s) => row[s.key] === true).map((s) => `${s.owner}: ${s.label}`));
  }
  return map;
}

const day = (v: unknown) => (v ? String(v instanceof Date ? v.toISOString() : v).slice(0, 10) : null);
const when = (v: unknown) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString('sv-SE', { timeZone: 'Asia/Bangkok' }).slice(0, 16);
};

function compactJob(r: JobRow, steps?: string[]) {
  return {
    id: r.id,
    job_no: r.jobNo,
    bl_no: r.blNo,
    job_type: r.jobTypeName,
    client_in_charge: r.personName,
    shipper: r.shipperName,
    consignee: r.consigneeName,
    vessel: [r.vessel, r.voyage].filter(Boolean).join(' / ') || null,
    eta: day(r.eta),
    eta_official: r.etaIsOfficial,
    containers: r.containerNos?.split(',') ?? [],
    an_status: r.anStatus ?? 'ยังไม่ส่ง',
    fn_status: r.fnStatus ?? 'ยังไม่ส่ง',
    customs_status: r.customsStatus,
    declaration_no: r.declarationNo,
    surrender: r.surrenderStatus,
    released: r.releaseStatus,
    created_at: when(r.createdAt),
    current_steps: steps ?? [],
  };
}

/** ค้นงาน — คืนจำนวนทั้งหมดที่ตรง และรายการตามจำนวนที่ขอ */
export async function searchJobs(q: JobQuery & { limit?: number }) {
  const limit = Math.min(Math.max(Number(q.limit) || 15, 1), 50);
  const { rows, total } = await listJobs({ where: filterOf(q), sortBy: 'eta', sortDir: 'asc' });
  const shown = rows.slice(0, limit);
  const steps = await stepsOf(shown.map((r) => r.id));
  const containers = rows.reduce((n, r) => n + (r.containerCount || 0), 0);
  return {
    total_jobs: total,
    total_containers: containers,
    shown: shown.length,
    jobs: shown.map((r) => compactJob(r, steps.get(r.id))),
  };
}

/** หางานจากเลขที่คนพิมพ์มา — Job No. / BL / เลขตู้ / ไอดี */
async function resolveJob(ref: string) {
  const text = ref.trim();
  if (/^JOB-/i.test(text)) {
    const { rows } = await listJobs({ where: () => [eq(jobs.id, text)] });
    if (rows.length) return rows;
  }
  for (const key of ['jobNo', 'blNo', 'container', 'refNo', 'entryNo']) {
    const cond = searchCondition(key, text);
    if (!cond) continue;
    const { rows } = await listJobs({ where: () => [cond], pageSize: 10 });
    if (rows.length) return rows;
  }
  return [];
}

/** รายละเอียดเต็มของงานหนึ่งใบ — ขั้นปัจจุบัน ไฟล์ อนุมัติ ประวัติ ค่า DO ลากตู้ */
export async function getJob(ref: string) {
  const matches = await resolveJob(ref);
  if (!matches.length) return { found: false, message: `ไม่พบงานที่ตรงกับ "${ref}"` };
  if (matches.length > 1) {
    const steps = await stepsOf(matches.map((r) => r.id));
    return {
      found: false,
      message: `เจอ ${matches.length} งานที่ตรงกับ "${ref}" — ระบุให้ชัดขึ้น หรือเลือกจากรายการ`,
      candidates: matches.map((r) => compactJob(r, steps.get(r.id))),
    };
  }
  const row = matches[0];
  const [detail, steps, haul] = await Promise.all([
    loadJobDetail(row.id),
    stepsOf([row.id]),
    db.execute<{ container_no: string | null; plan_date: string | null; sent_at: string | null; ack_at: string | null }>(sql`
      select c.container_no, hp.haul_date::text as plan_date, hp.sent_at, hp.ack_at
        from containers c
        left join lateral (select * from haul_plans h where h.container_id = c.id
                            order by h.sent_at desc nulls last limit 1) hp on true
       where c.job_id = ${row.id}`),
  ]);
  const files = (detail?.files ?? []).filter((f) => f.isCurrent);
  return {
    found: true,
    job: {
      ...compactJob(row, steps.get(row.id)),
      notify: row.notifyName,
      port: row.portName,
      terminal: row.terminalName,
      product: detail?.job.product ?? null,
      packages: [detail?.job.unitAmount, detail?.job.packageType].filter(Boolean).join(' ') || null,
      gross_weight: detail?.job.grossWeight ?? null,
      goods_value: detail?.job.goodsValue ? `${detail.job.goodsValue} ${detail.job.goodsCurrency ?? ''}`.trim() : null,
      dem_days: row.demDays, det_days: row.detDays,
      draft_ref_no: row.draftRefNo,
      draft_status: row.draftStatus,
      draft_reject_reason: row.draftRejectReason,
      invoice_changed_alert: row.hasInvoiceAlert,
      eoffice_handover_at: when(row.eofficeHandoverAt),
      eoffice_sent_partner_at: when(row.eofficeSentAt),
      do_letter_at: when(row.doLetterAt),
      do_exchanged_at: when(row.doExchangedAt),
      do_claimed_at: when(row.doClaimedAt),
      do_pay: { amount: row.doPayAmount, deposit: row.doDepositAmount, other: row.doOtherAmount, other_label: row.doOtherLabel },
      release_partner: row.releasePartner,
    },
    containers: (detail?.containers ?? []).map((c) => ({
      no: c.containerNo, type: c.containerType, seal: c.sealNo, running_no: c.runningNo,
    })),
    haul_plans: [...haul].map((h) => ({ container: h.container_no, plan_date: h.plan_date, sent_at: when(h.sent_at), may_ack_at: when(h.ack_at) })),
    files: files.map((f) => ({
      category: fileLabel(f.category), file_name: f.fileName, version: f.version,
      uploaded_at: when(f.uploadedAt), uploaded_by: f.uploaderName,
    })),
    approvals: (detail?.approvals ?? []).map((a) => ({
      type: a.approvalType, status: a.status, reason: a.reason,
      requested_at: when(a.requestedAt), requested_by: a.requestedByName,
      decided_at: when(a.decidedAt), decided_by: a.decidedByName,
    })),
    customs_entries: detail?.entries ?? [],
    history: (detail?.history ?? []).slice(-25).map((h) => ({
      at: when(h.createdAt), status: h.toStatus, note: h.note, by: h.actorName,
    })),
  };
}

/** จำนวนงาน (และตู้) ที่ค้างแต่ละขั้นตอนนี้ — กรองช่วง ETA ได้ */
export async function countByStep(q: Pick<JobQuery, 'eta_from' | 'eta_to'>) {
  const an = latestApproval('AN');
  const fn = latestApproval('FN');
  const ctx = { an, fn };
  // เฉพาะช่วง ETA — ตัวกรองข้อความต้อง join ตารางชื่อบริษัท ซึ่ง query นี้ไม่มี (ใช้ count_jobs_grouped แทน)
  const base = filterOf({ eta_from: q.eta_from, eta_to: q.eta_to })(ctx);
  const cols = Object.fromEntries(STEPS.flatMap((s) => [
    [s.key, sql<number>`count(*) filter (where ${stepCondition(s, ctx)})::int`],
    [`${s.key}__ct`, sql<number>`coalesce(sum((select count(*) from containers c where c.job_id = ${jobs.id})) filter (where ${stepCondition(s, ctx)}), 0)::int`],
  ])) as Record<string, SQL<number>>;
  const [row] = await db
    .select({ all: sql<number>`count(*)::int`, ...cols })
    .from(jobs)
    .leftJoin(an, eq(an.jobId, jobs.id))
    .leftJoin(fn, eq(fn.jobId, jobs.id))
    .where(and(eq(jobs.isArchived, false), ...base));
  const r = row as Record<string, number>;
  return {
    active_jobs_in_filter: r.all,
    steps: STEPS.map((s) => ({ step: s.key, owner: s.owner, label: s.label, jobs: r[s.key], containers: r[`${s.key}__ct`] })),
  };
}

const GROUPS: Record<string, SQL> = {
  consignee: sql`coalesce(consignee.name, '-')`,
  shipper: sql`coalesce(shipper.name, '-')`,
  client_in_charge: sql`coalesce(person.name, '-')`,
  job_type: sql`coalesce(job_type.name, '-')`,
  vessel: sql`coalesce(${jobs.vessel} || coalesce(' / ' || ${jobs.voyage}, ''), '-')`,
  port: sql`coalesce(port.name, '-')`,
  eta_date: sql`coalesce(${jobs.eta}::text, '-')`,
  eta_month: sql`coalesce(to_char(${jobs.eta}, 'YYYY-MM'), '-')`,
  created_date: sql`to_char(${jobs.createdAt} at time zone 'Asia/Bangkok', 'YYYY-MM-DD')`,
  created_month: sql`to_char(${jobs.createdAt} at time zone 'Asia/Bangkok', 'YYYY-MM')`,
};
export const GROUP_KEYS = Object.keys(GROUPS);

/** นับงานแยกกลุ่ม เช่น ตาม Consignee / เรือ / เดือน ETA — กรองแบบเดียวกับค้นหางาน */
export async function countGrouped(q: JobQuery & { group_by: string }) {
  const group = GROUPS[q.group_by];
  if (!group) return { error: `group_by ต้องเป็นหนึ่งใน ${GROUP_KEYS.join(', ')}` };
  const an = latestApproval('AN');
  const fn = latestApproval('FN');
  const ctx = { an, fn };
  const rows = await db
    .select({
      group: sql<string>`${group}`,
      jobs: sql<number>`count(*)::int`,
      containers: sql<number>`coalesce(sum((select count(*) from containers c where c.job_id = ${jobs.id})), 0)::int`,
    })
    .from(jobs)
    .leftJoin(an, eq(an.jobId, jobs.id))
    .leftJoin(fn, eq(fn.jobId, jobs.id))
    .leftJoin(sql`master_records as shipper`, sql`shipper.id = ${jobs.shipperId}`)
    .leftJoin(sql`master_records as consignee`, sql`consignee.id = ${jobs.consigneeId}`)
    .leftJoin(sql`master_records as notify`, sql`notify.id = ${jobs.notifyPartyId}`)
    .leftJoin(sql`master_records as person`, sql`person.id = ${jobs.personId}`)
    .leftJoin(sql`master_records as job_type`, sql`job_type.id = ${jobs.jobTypeId}`)
    .leftJoin(sql`master_records as port`, sql`port.id = ${jobs.portId}`)
    .leftJoin(sql`(select distinct on (job_id) job_id, declaration_no from customs_entries order by job_id, updated_at desc) as entry`, sql`entry.job_id = ${jobs.id}`)
    .where(and(eq(jobs.isArchived, false), ...filterOf(q)(ctx)))
    .groupBy(sql`1`)
    .orderBy(sql`2 desc`, sql`1`)
    .limit(60);
  return { group_by: q.group_by, groups: rows, total_jobs: rows.reduce((n, r) => n + r.jobs, 0) };
}

/**
 * งานที่ "ค้าง" แต่ละขั้น ณ สิ้นวันที่ระบุ — สร้างย้อนหลังจากเวลาที่บันทึกไว้ของแต่ละขั้น
 *
 * ตอนนี้ระบบไม่ได้เก็บภาพรวมรายวันไว้ จึงใช้เวลาของเหตุการณ์ที่บันทึกในตารางต่าง ๆ แทน
 * เช่น "รอ InvDO" ณ วันที่ D = AN อนุมัติแล้วภายในวัน D แต่ยังไม่ส่ง Partner ภายในวัน D
 * งานที่นำเข้าจากไฟล์ตาราง (ไม่ได้ผ่านขั้นในระบบ) อาจไม่มีเวลาบางขั้น จึงไม่ถูกนับ
 */
const MILESTONE_STEPS: Array<{ key: string; label: string; start: string; end: string; excludeMuo?: boolean }> = [
  { key: 'paint-send-an', label: 'PAINT: รอส่ง AN ให้ NAMKANG', start: 'created', end: 'an_requested' },
  { key: 'nam-approve', label: 'NAMKANG: รออนุมัติ AN', start: 'an_requested', end: 'an_approved' },
  { key: 'fah-do', label: 'FAH: รอ Invoice DO → ส่ง Partner', start: 'an_approved', end: 'invdo_sent' },
  { key: 'paint-fn', label: 'PAINT: รอส่ง Final Invoice', start: 'an_approved', end: 'fn_requested' },
  { key: 'fah-fn', label: 'FAH: รออนุมัติ Final Invoice', start: 'fn_requested', end: 'fn_approved' },
  { key: 'customs', label: 'PAINT/FAH: FN ผ่านแล้ว รอได้เลขใบขน', start: 'fn_approved', end: 'customs_filed' },
  { key: 'eoffice', label: 'PAINT: ได้เลขใบขนแล้ว รอส่งชุดปล่อยให้ Partner', start: 'customs_filed', end: 'eoffice_sent' },
  { key: 'ann-do-exchange', label: 'ANN: รอแลก DO', start: 'partner_sent', end: 'do_exchanged', excludeMuo: true },
  { key: 'may-claim', label: 'MAY: รอตั้งเบิกค่า DO', start: 'partner_sent', end: 'do_claimed', excludeMuo: true },
];

export async function pipelineAsOf(date: string, step?: string, includeJobs = false) {
  if (!ISO.test(date)) return { error: 'date ต้องเป็นรูปแบบ YYYY-MM-DD' };
  // สิ้นวันตามเวลาไทย
  const cutoff = sql`((${date}::date + 1)::timestamp at time zone 'Asia/Bangkok')`;
  const pick = MILESTONE_STEPS.filter((s) => !step || s.key === step);
  if (!pick.length) return { error: `step ต้องเป็นหนึ่งใน ${MILESTONE_STEPS.map((s) => s.key).join(', ')}` };

  const ms = sql`(
    select j.id, j.job_no, j.bl_no, j.job_type_id,
      j.created_at as created,
      (select min(a.requested_at) from approvals a where a.job_id = j.id and a.approval_type = 'AN') as an_requested,
      (select min(a.decided_at) from approvals a where a.job_id = j.id and a.approval_type = 'AN' and a.status = 'APPROVED') as an_approved,
      (select min(a.requested_at) from approvals a where a.job_id = j.id and a.approval_type = 'FN') as fn_requested,
      (select min(a.decided_at) from approvals a where a.job_id = j.id and a.approval_type = 'FN' and a.status = 'APPROVED') as fn_approved,
      (select min(dh.sent_at) from do_handoffs dh where dh.job_id = j.id) as invdo_sent,
      (select min(coalesce(ce.filed_at, ce.created_at)) from customs_entries ce
        where ce.job_id = j.id and ce.declaration_no is not null) as customs_filed,
      j.eoffice_sent_at as eoffice_sent,
      least(j.eoffice_sent_at, (select min(dh.sent_at) from do_handoffs dh where dh.job_id = j.id)) as partner_sent,
      j.do_exchanged_at as do_exchanged,
      j.do_claimed_at as do_claimed
    from jobs j where j.is_archived = false
  ) m`;

  const out = [];
  for (const s of pick) {
    const start = sql.raw(`m.${s.start}`);
    const end = sql.raw(`m.${s.end}`);
    const muo = s.excludeMuo ? sql`and ${notPartnerRelease(sql`m.job_type_id`)}` : sql``;
    const rows = await db.execute<{ id: string; job_no: string; bl_no: string | null }>(sql`
      select m.id, m.job_no, m.bl_no from ${ms}
       where ${start} < ${cutoff} and (${end} is null or ${end} >= ${cutoff}) ${muo}
       order by m.job_no`);
    const list = [...rows];
    out.push({
      step: s.key, label: s.label, jobs: list.length,
      ...(includeJobs ? { job_list: list.slice(0, 60).map((r) => ({ id: r.id, job_no: r.job_no, bl_no: r.bl_no })) } : {}),
    });
  }
  return {
    as_of_end_of_day: date,
    note: 'คำนวณย้อนหลังจากเวลาที่บันทึกในระบบของแต่ละขั้น งานที่นำเข้าจากไฟล์ตาราง (ไม่ได้ผ่านขั้นนั้นในระบบ) อาจไม่มีเวลาขั้นนั้นจึงไม่ถูกนับ',
    steps: out,
  };
}
export const PIPELINE_STEP_KEYS = MILESTONE_STEPS.map((s) => s.key);

/** ชื่อเหตุการณ์ในบันทึกการทำงาน เป็นภาษาคน — ไม่อยู่ในรายการก็แสดงรหัสเดิม */
const ACTION_LABELS: Record<string, string> = {
  CREATE_JOB: 'สร้างงาน', IMPORT_SHIPMENT_CSV: 'นำเข้างานจากไฟล์ตาราง', UPDATE_BL_INFO: 'แก้ข้อมูล BL',
  REQUEST_AN: 'ส่ง AN ให้อนุมัติ', DECIDE_AN: 'NAMKANG ตัดสิน AN', REQUEST_FN: 'ส่ง Final Invoice ให้อนุมัติ',
  DECIDE_FN: 'FAH ตัดสิน Final Invoice', UPLOAD_FILE: 'อัปโหลดไฟล์', REPLACE_FILE: 'เปลี่ยนไฟล์',
  SAVE_DO_HANDOFF: 'บันทึก InvDO / ETA / Terminal', SEND_DO_PARTNER: 'ส่ง InvDO ให้ Partner',
  CONFIRM_CUSTOMER_INFO: 'ยืนยันข้อมูลลูกค้า', SET_CLIENT_IN_CHARGE: 'ใส่ Client in Charge',
  UPDATE_SURRENDER: 'อัปเดต Surrender', SUBMIT_DRAFT_REVIEW: 'ส่ง Draft ให้ FAH ตรวจ', REJECT_DRAFT: 'FAH ตีกลับ Draft',
  SUBMIT_DRAFT_TASK: 'สั่งสร้าง Draft ใน NETBAY', CREATE_EOFFICE_REQUEST: 'ทำคำร้อง E-Office', MERGE_EOFFICE: 'รวมชุด E-Office',
  RENDER_DO_LETTER: 'ออกจดหมายแลก DO', MERGE_DO: 'รวมชุดแลก DO', SAVE_DO_PAY_AMOUNT: 'บันทึกยอดค่า DO',
  MARK_DO_EXCHANGED: 'ส่งแลก DO แล้ว', MARK_DO_CLAIMED: 'ตั้งเบิกค่า DO แล้ว', DELETE_JOB: 'ลบงาน',
  COMPLETE_TASK: 'Automation ทำเสร็จ', FAIL_TASK: 'Automation ล้มเหลว',
};

/** บันทึกการทำงานในช่วงวันที่ — เฉพาะเหตุการณ์ของงาน ไม่รวมการล็อกอินหรือการตั้งค่าระบบ */
export async function activity(q: { date_from: string; date_to?: string; job_ref?: string; action?: string; limit?: number }) {
  if (!ISO.test(q.date_from)) return { error: 'date_from ต้องเป็นรูปแบบ YYYY-MM-DD' };
  const to = q.date_to && ISO.test(q.date_to) ? q.date_to : q.date_from;
  const limit = Math.min(Math.max(Number(q.limit) || 40, 1), 100);
  let jobId: string | null = null;
  if (q.job_ref?.trim()) {
    const m = await resolveJob(q.job_ref);
    if (m.length !== 1) return { error: m.length ? `"${q.job_ref}" ตรงกับหลายงาน ระบุให้ชัดขึ้น` : `ไม่พบงาน "${q.job_ref}"` };
    jobId = m[0].id;
  }
  const rows = await db.execute<{ at: string; action: string; who: string | null; job_id: string | null; job_no: string | null; bl_no: string | null; detail: string | null }>(sql`
    with ev as (
      select l.created_at, l.action, l.user_id, l.detail,
             case l.entity_type
               when 'JOB' then l.entity_id
               -- ไม่ cast เป็น jsonb ตรง ๆ เพราะ detail บางแถวไม่ใช่ JSON แล้วทั้ง query จะล้ม
               when 'FILE' then substring(l.detail from '"jobId":"([^"]+)"')
               when 'APPROVAL' then (select a.job_id from approvals a where a.id = l.entity_id)
             end as job_id
        from activity_log l
       where l.entity_type in ('JOB', 'FILE', 'APPROVAL')
         and (l.created_at at time zone 'Asia/Bangkok')::date between ${q.date_from}::date and ${to}::date
         ${q.action ? sql`and l.action = ${q.action}` : sql``}
    )
    select ev.created_at as at, ev.action, u.display_name as who, ev.job_id, j.job_no, j.bl_no, left(ev.detail, 160) as detail
      from ev
      left join users u on u.id = ev.user_id
      left join jobs j on j.id = ev.job_id
     where ${jobId ? sql`ev.job_id = ${jobId}` : sql`true`}
     order by ev.created_at desc
     limit ${limit + 1}`);
  const list = [...rows];
  const counts = await db.execute<{ action: string; n: number }>(sql`
    select l.action, count(*)::int as n from activity_log l
     where l.entity_type in ('JOB', 'FILE', 'APPROVAL')
       and (l.created_at at time zone 'Asia/Bangkok')::date between ${q.date_from}::date and ${to}::date
       ${jobId ? sql`and (l.entity_id = ${jobId} or l.detail like ${`%${jobId}%`} or l.entity_id in (select a.id from approvals a where a.job_id = ${jobId}))` : sql``}
     group by 1 order by 2 desc`);
  return {
    range: [q.date_from, to],
    totals_by_action: [...counts].map((c) => ({ action: c.action, label: ACTION_LABELS[c.action] ?? c.action, count: c.n })),
    truncated: list.length > limit,
    events: list.slice(0, limit).map((e) => ({
      at: when(e.at), action: ACTION_LABELS[e.action] ?? e.action, by: e.who,
      job_id: e.job_id, job_no: e.job_no, bl_no: e.bl_no, detail: e.detail,
    })),
  };
}
export const ACTION_CODES = Object.keys(ACTION_LABELS);
