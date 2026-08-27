import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { files } from '@/db/schema';

/**
 * ข้อมูลทั้งหมดของงานหนึ่งใบ สำหรับหน้าสรุปงานและแผงรายละเอียด
 *
 * รวมทุกตารางเป็น query เดียวโดยให้ Postgres ประกอบเป็น JSON ให้เลย
 * ตอนแรกเขียนแยกเป็น 11 คำสั่งแล้วยิงพร้อมกัน แต่ฐานข้อมูลอยู่สิงคโปร์
 * และ pooler ต้องจับคู่คอนเนกชันให้ทุกคำสั่ง วัดได้ราว 600 ms ต่อครั้ง
 * เหลือรอบเดียวแล้วเร็วขึ้นมาก
 */

type Json = Record<string, unknown>;

export type JobDetailJob = {
  id: string; jobNo: string; blNo: string | null; blType: string | null;
  vessel: string | null; voyage: string | null;
  eta: string | null; etd: string | null; etaIsOfficial: boolean; transportDate: string | null;
  status: string; surrenderStatus: string; customsStatus: string; releaseStatus: string;
  hasInvoiceAlert: boolean; sourceType: string | null; product: string | null;
  unitAmount: string | number | null; packageType: string | null;
  grossWeight: string | number | null; goodsValue: string | number | null;
  goodsCurrency: string | null; shipline: string | null;
  demDays: number; detDays: number;
  releasePartner: string | null; customerNote: string | null;
  draftRefNo: string | null; draftStatus: string | null; draftRejectReason: string | null;
  createdAt: string; updatedAt: string;
  shipperName: string | null; consigneeName: string | null; notifyName: string | null;
  personName: string | null; jobTypeName: string | null;
  portName: string | null; terminalName: string | null;
  createdByName: string | null; updatedByName: string | null;
};

export type JobFile = {
  id: string; category: string; version: number; fileName: string;
  sizeBytes: number | null; note: string | null; changeReason: string | null;
  isCurrent: boolean; isAcknowledged: boolean; uploadedAt: string; uploaderName: string | null;
};

export type JobDetail = {
  job: JobDetailJob;
  bls: Array<{
    id: string; blNo: string | null; shipperName: string | null;
    packageCount: string | number | null; grossWeight: string | number | null;
  }>;
  containers: Array<{
    id: string; runningNo: string | null; containerNo: string | null;
    containerType: string | null; sealNo: string | null; weight: string | number | null;
  }>;
  files: JobFile[];
  approvals: Array<{
    id: string; approvalType: string; status: string; reason: string | null;
    requestedAt: string; decidedAt: string | null;
    requestedByName: string | null; decidedByName: string | null;
  }>;
  history: Array<{
    id: string; toStatus: string | null; note: string | null;
    createdAt: string; actorName: string | null;
  }>;
  entries: Array<{ declarationNo: string | null; filedAt: string | null }>;
  handoff: { partnerName: string | null } | null;
  release: { inspectionResult: string | null; releasedAt: string | null } | null;
  eoffice: {
    requestNo: string; requestDate: string | null; packageCount: string | null;
    netWeight: string | null; goodsValue: string | null;
  } | null;
  tasks: Array<{
    id: string; type: string; status: string; resultRefNo: string | null;
    resultEntryNo: string | null; error: string | null;
    completedAt: string | null; createdAt: string;
  }>;
};

export async function loadJobDetail(jobId: string): Promise<JobDetail | null> {
  const result = await db.execute<Json>(sql`
    select
      (select to_jsonb(t) from (
        select j.id, j.job_no as "jobNo", j.bl_no as "blNo", j.bl_type as "blType",
               j.vessel, j.voyage, j.eta, j.etd,
               j.eta_is_official as "etaIsOfficial", j.transport_date as "transportDate",
               j.status, j.surrender_status as "surrenderStatus",
               j.customs_status as "customsStatus", j.release_status as "releaseStatus",
               j.has_invoice_alert as "hasInvoiceAlert", j.source_type as "sourceType",
               j.product, j.unit_amount as "unitAmount", j.package_type as "packageType",
               j.gross_weight as "grossWeight", j.goods_value as "goodsValue",
               j.goods_currency as "goodsCurrency", j.shipline,
               j.dem_days as "demDays", j.det_days as "detDays",
               j.release_partner as "releasePartner", j.customer_note as "customerNote",
               j.draft_ref_no as "draftRefNo", j.draft_status as "draftStatus",
               j.draft_reject_reason as "draftRejectReason",
               j.created_at as "createdAt", j.updated_at as "updatedAt",
               shipper.name as "shipperName", consignee.name as "consigneeName",
               notify.name as "notifyName", person.name as "personName",
               job_type.name as "jobTypeName", port.name as "portName",
               terminal.name as "terminalName",
               creator.display_name as "createdByName", updater.display_name as "updatedByName"
        from jobs j
        left join master_records shipper on shipper.id = j.shipper_id
        left join master_records consignee on consignee.id = j.consignee_id
        left join master_records notify on notify.id = j.notify_party_id
        left join master_records person on person.id = j.person_id
        left join master_records job_type on job_type.id = j.job_type_id
        left join master_records port on port.id = j.port_id
        left join master_records terminal on terminal.id = j.terminal_id
        left join users creator on creator.id = j.created_by
        left join users updater on updater.id = j.updated_by
        where j.id = ${jobId}
      ) t) as job,

      coalesce((select jsonb_agg(t) from (
        select b.id, b.bl_no as "blNo", b.shipper_name as "shipperName",
               b.package_count as "packageCount", b.gross_weight as "grossWeight"
        from bls b where b.job_id = ${jobId} order by b.created_at
      ) t), '[]'::jsonb) as bls,

      coalesce((select jsonb_agg(t) from (
        select c.id, c.running_no as "runningNo",
               c.container_no as "containerNo", c.container_type as "containerType",
               c.seal_no as "sealNo", c.weight
        from containers c where c.job_id = ${jobId} order by c.created_at
      ) t), '[]'::jsonb) as containers,

      coalesce((select jsonb_agg(t) from (
        select f.id, f.category, f.version, f.file_name as "fileName",
               f.size_bytes as "sizeBytes", f.note, f.change_reason as "changeReason",
               f.is_current as "isCurrent", f.is_acknowledged as "isAcknowledged",
               f.uploaded_at as "uploadedAt", uploader.display_name as "uploaderName"
        from files f
        left join users uploader on uploader.id = f.uploaded_by
        where f.job_id = ${jobId}
        order by f.category, f.version desc
      ) t), '[]'::jsonb) as files,

      coalesce((select jsonb_agg(t) from (
        select a.id, a.approval_type as "approvalType", a.status, a.reason,
               a.requested_at as "requestedAt", a.decided_at as "decidedAt",
               requester.display_name as "requestedByName",
               decider.display_name as "decidedByName"
        from approvals a
        left join users requester on requester.id = a.requested_by
        left join users decider on decider.id = a.decided_by
        where a.job_id = ${jobId}
        order by a.requested_at desc
      ) t), '[]'::jsonb) as approvals,

      coalesce((select jsonb_agg(t) from (
        select h.id, h.to_status as "toStatus", h.note,
               h.created_at as "createdAt", actor.display_name as "actorName"
        from status_history h
        left join users actor on actor.id = h.actor_id
        where h.job_id = ${jobId}
        order by h.created_at desc
        limit 40
      ) t), '[]'::jsonb) as history,

      coalesce((select jsonb_agg(t) from (
        select e.declaration_no as "declarationNo", e.filed_at as "filedAt"
        from customs_entries e where e.job_id = ${jobId} order by e.updated_at desc
      ) t), '[]'::jsonb) as entries,

      (select to_jsonb(t) from (
        select d.partner_name as "partnerName"
        from do_handoffs d where d.job_id = ${jobId} limit 1
      ) t) as handoff,

      (select to_jsonb(t) from (
        select r.inspection_result as "inspectionResult", r.released_at as "releasedAt"
        from inspection_releases r where r.job_id = ${jobId} limit 1
      ) t) as release,

      (select to_jsonb(t) from (
        select o.request_no as "requestNo", o.request_date as "requestDate",
               o.package_count as "packageCount", o.net_weight as "netWeight",
               o.goods_value as "goodsValue"
        from eoffice_requests o where o.job_id = ${jobId} limit 1
      ) t) as eoffice,

      coalesce((select jsonb_agg(t) from (
        select k.id, k.type, k.status, k.result_ref_no as "resultRefNo",
               k.result_entry_no as "resultEntryNo", k.error,
               k.completed_at as "completedAt", k.created_at as "createdAt"
        from automation_tasks k where k.job_id = ${jobId}
        order by k.created_at desc limit 10
      ) t), '[]'::jsonb) as tasks
  `);

  const row = result[0] as unknown as JobDetail | undefined;
  // แถวกลับมาเสมอแม้ไม่มีงาน คอลัมน์ job จะเป็น null จึงเช็คที่ตรงนั้น
  if (!row?.job) return null;
  return row;
}

/** จำนวนไฟล์แนบปัจจุบันของทุกงาน */
export async function fileCountByJob(jobIds: string[]) {
  const map = new Map<string, number>();
  if (!jobIds.length) return map;
  const rows = await db
    .select({ jobId: files.jobId, n: sql<number>`count(*)::int` })
    .from(files)
    .where(and(eq(files.isCurrent, true), inArray(files.jobId, jobIds)))
    .groupBy(files.jobId);
  rows.forEach((r) => map.set(r.jobId, r.n));
  return map;
}

/** ชื่อหมวดไฟล์ ใช้คำเดียวกับระบบเดิมเพื่อให้คนอ่านคุ้นตา */
export const FILE_LABELS: Record<string, string> = {
  ARRIVAL_NOTICE: 'Arrival Notice',
  BL: 'Bill of Lading',
  INVOICE_DO: 'DO Invoice',
  INVOICE_GOODS: 'OG Invoice & Packing list',
  SURRENDER: 'Surrender BL',
  FINAL_INVOICE: 'FN Invoice & Packing list',
  FINAL_INVOICE_PDF: 'FN Invoice (ฉบับ PDF สำหรับรวมชุด)',
  DRAFT_ENTRY: 'Draft ใบขน',
  CUSTOMS_ENTRY_DOC: 'ใบขนสินค้า',
  EOFFICE: 'ชุดตรวจปล่อย (E-Office)',
  EOFFICE_REQUEST: 'คำร้อง E-Office',
  EOFFICE_MERGED: 'ชุด E-Office รวม',
  OTHER: 'อื่น ๆ',
};

export function fileLabel(category: string) {
  return FILE_LABELS[category] ?? category;
}

/** ลำดับการแสดง เรียงตามขั้นงานจริง ไม่ใช่ตามตัวอักษร */
export const FILE_ORDER = [
  'ARRIVAL_NOTICE', 'BL', 'INVOICE_GOODS', 'FINAL_INVOICE', 'FINAL_INVOICE_PDF', 'INVOICE_DO', 'SURRENDER',
  'DRAFT_ENTRY', 'CUSTOMS_ENTRY_DOC', 'EOFFICE', 'EOFFICE_REQUEST', 'EOFFICE_MERGED', 'OTHER',
];
