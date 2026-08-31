/**
 * Schema ของ KOLA ERP บน Postgres
 *
 * แปลงตรงจาก SHEET_SCHEMAS ใน Config.gs ของระบบเดิม (25 ตาราง / 275 คอลัมน์)
 * คง id เป็น text แบบเดิม (เช่น JOB-xxxx, USR-xxxx) เพื่อให้ย้ายข้อมูลเก่าเข้ามาได้ตรง ๆ
 * โดยไม่ต้อง map id ใหม่ทั้งระบบ ของใหม่ที่สร้างหลังย้ายค่อยใช้รูปแบบเดิมต่อได้
 *
 * ต่างจากเดิมตรงที่ใส่ index ในคอลัมน์ที่ระบบเดิมต้องอ่านทั้งชีตมา filter เอง
 * ซึ่งเป็นต้นตอที่ทำให้ยิ่งข้อมูลเยอะยิ่งช้าทวีคูณ
 */
import {
  pgTable, text, integer, numeric, boolean, timestamp, date, index, uniqueIndex,
} from 'drizzle-orm/pg-core';

const id = () => text('id').primaryKey();
const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();

/* ---------------- ผู้ใช้และ session ---------------- */

export const users = pgTable('users', {
  id: id(),
  username: text('username').notNull(),
  passwordHash: text('password_hash').notNull(),
  salt: text('salt').notNull(),
  // legacy = SHA-256 วน 600 รอบแบบระบบเดิม, scrypt = ของใหม่
  // ผู้ใช้ที่ย้ายมาจะถูกอัปเกรดเป็น scrypt อัตโนมัติตอนล็อกอินสำเร็จครั้งแรก
  passwordAlgo: text('password_algo').default('scrypt').notNull(),
  displayName: text('display_name').notNull(),
  role: text('role').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  mustChangePassword: boolean('must_change_password').default(true).notNull(),
  failedAttempts: integer('failed_attempts').default(0).notNull(),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => ({
  usernameKey: uniqueIndex('users_username_key').on(t.username),
}));

export const sessions = pgTable('sessions', {
  id: id(),
  tokenHash: text('token_hash').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => ({
  // ระบบเดิมไล่อ่านทุกแถวของชีต _SESSIONS ทุกครั้งที่ตรวจ token
  tokenKey: uniqueIndex('sessions_token_hash_key').on(t.tokenHash),
  userIdx: index('sessions_user_idx').on(t.userId),
  expiresIdx: index('sessions_expires_idx').on(t.expiresAt),
}));

/* ---------------- Master data ---------------- */

/** โครงร่วมของ master ทุกชนิด ใช้ตารางเดียวแยกด้วย type แทน 11 ชีตแยกกัน */
export const masterRecords = pgTable('master_records', {
  id: id(),
  type: text('type').notNull(),           // shippers | consignees | notify | people | ports | terminals | jobTypes | loadingTypes | containerTypes | packageTypes | settings
  code: text('code'),
  name: text('name').notNull(),
  description: text('description'),
  value: text('value'),                    // ใช้เฉพาะ type=settings
  taxId: text('tax_id'),
  address: text('address'),
  contactName: text('contact_name'),
  phone: text('phone'),
  email: text('email'),
  roleName: text('role_name'),
  country: text('country'),
  portId: text('port_id'),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => ({
  typeCodeKey: uniqueIndex('master_type_code_key').on(t.type, t.code),
  typeIdx: index('master_type_idx').on(t.type, t.isActive),
}));

/* ---------------- งานหลัก ---------------- */

export const jobs = pgTable('jobs', {
  id: id(),
  jobNo: text('job_no').notNull(),
  blNo: text('bl_no'),
  vessel: text('vessel'),
  voyage: text('voyage'),
  eta: date('eta'),
  etd: date('etd'),
  etaIsOfficial: boolean('eta_is_official').default(false).notNull(),
  transportDate: date('transport_date'),

  shipperId: text('shipper_id'),
  consigneeId: text('consignee_id'),
  notifyPartyId: text('notify_party_id'),
  loadingTypeId: text('loading_type_id'),
  portId: text('port_id'),
  terminalId: text('terminal_id'),
  personId: text('person_id'),
  jobTypeId: text('job_type_id'),

  status: text('status').notNull(),
  surrenderStatus: text('surrender_status').default('PENDING').notNull(),
  customsStatus: text('customs_status').default('NOT_STARTED').notNull(),
  releaseStatus: text('release_status').default('PENDING').notNull(),
  hasInvoiceAlert: boolean('has_invoice_alert').default(false).notNull(),
  isArchived: boolean('is_archived').default(false).notNull(),

  sourceType: text('source_type'),
  blType: text('bl_type'),
  product: text('product'),
  unitAmount: numeric('unit_amount', { precision: 18, scale: 3 }),
  packageType: text('package_type'),
  grossWeight: numeric('gross_weight', { precision: 18, scale: 3 }),
  goodsValue: numeric('goods_value', { precision: 18, scale: 2 }),
  goodsCurrency: text('goods_currency').default('USD'),
  shipline: text('shipline'),
  demDays: integer('dem_days').default(0).notNull(),
  detDays: integer('det_days').default(0).notNull(),
  releasePartner: text('release_partner'),
  customerNote: text('customer_note'),
  /** NAMKANG กดยืนยันข้อมูลลูกค้าแล้ว — ใช้แยกแท็บรออัปเดต/อัปเดตแล้ว */
  customerConfirmedAt: timestamp('customer_confirmed_at', { withTimezone: true }),
  customerConfirmedBy: text('customer_confirmed_by'),
  /** PAINT ส่งชุดปล่อย E-Office ให้ Partner แล้ว — ใช้แยกแท็บรอส่ง/ส่งแล้ว */
  eofficeSentAt: timestamp('eoffice_sent_at', { withTimezone: true }),
  eofficeSentBy: text('eoffice_sent_by'),
  /** ขั้นแลก DO — สายเรือที่ใช้เลือกแบบฟอร์มจดหมาย และเวลาที่ทำจดหมายเสร็จ */
  doShippingLine: text('do_shipping_line'),
  doLetterAt: timestamp('do_letter_at', { withTimezone: true }),
  doLetterBy: text('do_letter_by'),

  draftRefNo: text('draft_ref_no'),
  draftStatus: text('draft_status'),
  draftRejectReason: text('draft_reject_reason'),
  draftTaskId: text('draft_task_id'),
  customsTaskId: text('customs_task_id'),

  createdBy: text('created_by'),
  updatedBy: text('updated_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => ({
  jobNoKey: uniqueIndex('jobs_job_no_key').on(t.jobNo),
  // คิวงานทุกหน้ากรองด้วยสถานะเหล่านี้ ระบบเดิมต้องดึงทั้งชีตมาไล่เอง
  statusIdx: index('jobs_status_idx').on(t.isArchived, t.status),
  customsIdx: index('jobs_customs_idx').on(t.customsStatus),
  draftIdx: index('jobs_draft_idx').on(t.draftStatus),
  etaIdx: index('jobs_eta_idx').on(t.eta),
  blIdx: index('jobs_bl_idx').on(t.blNo),
}));

export const bls = pgTable('bls', {
  id: id(),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  blNo: text('bl_no'),
  blType: text('bl_type'),
  marks: text('marks'),
  description: text('description'),
  packageCount: numeric('package_count', { precision: 18, scale: 3 }),
  grossWeight: numeric('gross_weight', { precision: 18, scale: 3 }),
  measurement: text('measurement'),
  shipperId: text('shipper_id'),
  shipperName: text('shipper_name'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => ({ jobIdx: index('bls_job_idx').on(t.jobId) }));

export const containers = pgTable('containers', {
  id: id(),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  jobNo: text('job_no'),
  /**
   * เลขประจำตู้ของบริษัท เช่น MU2026080001
   * = รหัส Job Type + ปี ค.ศ. + เดือน + เลขรัน 4 หลัก
   * ห้ามซ้ำ เพราะใช้เป็นตัวผูกค่าใช้จ่ายรายตู้ต่อไป
   */
  runningNo: text('running_no'),
  containerNo: text('container_no'),
  containerType: text('container_type'),
  sealNo: text('seal_no'),
  weight: numeric('weight', { precision: 18, scale: 3 }),
  packageCount: numeric('package_count', { precision: 18, scale: 3 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => ({
  jobIdx: index('containers_job_idx').on(t.jobId),
  runningKey: uniqueIndex('containers_running_key').on(t.runningNo),
}));

export const files = pgTable('files', {
  id: id(),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  category: text('category').notNull(),
  version: integer('version').default(1).notNull(),
  storageKey: text('storage_key').notNull(),   // แทน driveFileId — ชี้ไป Supabase Storage
  legacyDriveFileId: text('legacy_drive_file_id'),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type'),
  sizeBytes: integer('size_bytes'),
  note: text('note'),
  changeReason: text('change_reason'),
  isCurrent: boolean('is_current').default(true).notNull(),
  isAcknowledged: boolean('is_acknowledged').default(true).notNull(),
  acknowledgedBy: text('acknowledged_by'),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  supersededBy: text('superseded_by'),
  uploadedBy: text('uploaded_by'),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  // หน้าจอถามเสมอว่า "ไฟล์ปัจจุบันของงานนี้หมวดนี้คืออะไร"
  currentIdx: index('files_current_idx').on(t.jobId, t.category, t.isCurrent),
}));

export const approvals = pgTable('approvals', {
  id: id(),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  approvalType: text('approval_type').notNull(),   // AN | FN
  status: text('status').notNull(),                // PENDING | APPROVED | REJECTED
  reason: text('reason'),
  requestedBy: text('requested_by'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).defaultNow().notNull(),
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
}, (t) => ({
  jobTypeIdx: index('approvals_job_type_idx').on(t.jobId, t.approvalType, t.requestedAt),
  statusIdx: index('approvals_status_idx').on(t.approvalType, t.status),
}));

export const statusHistory = pgTable('status_history', {
  id: id(),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  fromStatus: text('from_status'),
  toStatus: text('to_status'),
  note: text('note'),
  actorId: text('actor_id'),
  createdAt: createdAt(),
}, (t) => ({ jobIdx: index('status_history_job_idx').on(t.jobId, t.createdAt) }));

export const activityLog = pgTable('activity_log', {
  id: id(),
  userId: text('user_id'),
  action: text('action').notNull(),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  detail: text('detail'),
  createdAt: createdAt(),
}, (t) => ({ createdIdx: index('activity_created_idx').on(t.createdAt) }));

export const jobSequences = pgTable('job_sequences', {
  id: id(),
  year: text('year').notNull(),
  prefix: text('prefix').notNull(),
  lastNumber: integer('last_number').default(0).notNull(),
  updatedAt: updatedAt(),
}, (t) => ({ key: uniqueIndex('job_sequences_key').on(t.year, t.prefix) }));

export const doHandoffs = pgTable('do_handoffs', {
  id: id(),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  etaOfficial: date('eta_official'),
  transportDate: date('transport_date'),
  portId: text('port_id'),
  terminalId: text('terminal_id'),
  partnerName: text('partner_name'),
  invoiceDoFileId: text('invoice_do_file_id'),
  note: text('note'),
  sentBy: text('sent_by'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  updatedAt: updatedAt(),
}, (t) => ({ jobIdx: index('do_handoffs_job_idx').on(t.jobId) }));

export const customsEntries = pgTable('customs_entries', {
  id: id(),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  entryNo: text('entry_no'),
  status: text('status'),
  declarationNo: text('declaration_no'),
  amount: numeric('amount', { precision: 18, scale: 2 }),
  note: text('note'),
  createdBy: text('created_by'),
  filedBy: text('filed_by'),
  filedAt: timestamp('filed_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => ({ jobIdx: index('customs_entries_job_idx').on(t.jobId) }));

export const inspectionReleases = pgTable('inspection_releases', {
  id: id(),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  inspectionRequired: boolean('inspection_required').default(false).notNull(),
  inspectionResult: text('inspection_result'),
  releaseNote: text('release_note'),
  releasedBy: text('released_by'),
  releasedAt: timestamp('released_at', { withTimezone: true }),
  updatedAt: updatedAt(),
}, (t) => ({ jobIdx: index('inspection_releases_job_idx').on(t.jobId) }));

export const eofficeRequests = pgTable('eoffice_requests', {
  id: id(),
  jobId: text('job_id').notNull().references(() => jobs.id, { onDelete: 'cascade' }),
  jobNo: text('job_no'),
  requestNo: text('request_no').notNull(),
  bookNo: text('book_no'),
  runningNo: text('running_no'),
  requestDate: date('request_date'),
  entryNo: text('entry_no'),
  packageCount: text('package_count'),
  netWeight: text('net_weight'),
  goodsValue: text('goods_value'),
  goodsType: text('goods_type'),
  /** ชื่อคนที่จ่าหน้าถึงในบรรทัด "เรียน คุณ ..." กรอกใหม่ได้ทุกใบ */
  attentionName: text('attention_name'),
  storageKey: text('storage_key'),
  fileRecordId: text('file_record_id'),
  createdBy: text('created_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => ({
  jobKey: uniqueIndex('eoffice_requests_job_key').on(t.jobId),
  requestNoKey: uniqueIndex('eoffice_requests_no_key').on(t.requestNo),
}));

/** คิวงานของ Automation Hub ย้ายมาอยู่ตารางเดียวกัน ไม่ต้องมีเว็บแยกอีก */
export const automationTasks = pgTable('automation_tasks', {
  id: id(),
  type: text('type').notNull(),            // DRAFT_ENTRY | CUSTOMS_ENTRY
  status: text('status').notNull(),        // QUEUED | PROCESSING | DONE | ERROR
  jobId: text('job_id').references(() => jobs.id, { onDelete: 'cascade' }),
  payload: text('payload'),
  inputStorageKey: text('input_storage_key'),
  inputFileName: text('input_file_name'),
  resultRefNo: text('result_ref_no'),
  resultEntryNo: text('result_entry_no'),
  resultStorageKey: text('result_storage_key'),
  resultFileName: text('result_file_name'),
  error: text('error'),
  attempts: integer('attempts').default(0).notNull(),
  claimedBy: text('claimed_by'),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => ({
  queueIdx: index('automation_queue_idx').on(t.type, t.status, t.createdAt),
  jobIdx: index('automation_job_idx').on(t.jobId),
}));
