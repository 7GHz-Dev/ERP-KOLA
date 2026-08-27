/**
 * ย้ายข้อมูลจากระบบเดิม (Apps Script + Sheets) เข้า Postgres
 *
 * ดึงผ่าน API ของระบบเดิมที่มีอยู่แล้ว ไม่ต้องเปิดสิทธิ์สเปรดชีตให้ใครเพิ่ม
 * รันซ้ำได้ปลอดภัย ใช้ upsert ตาม id เดิม ข้อมูลจึงไม่ซ้ำ
 *
 *   npm run migrate:sheets           ย้ายจริง
 *   npm run migrate:sheets -- --dry  ดูจำนวนแถวเฉย ๆ ไม่เขียนอะไร
 */
import { loadEnv } from '../src/lib/env';
loadEnv();

import { sql } from 'drizzle-orm';
import { db } from '../src/db';
import * as t from '../src/db/schema';

const EXEC_URL = process.env.LEGACY_EXEC_URL;
const USERNAME = process.env.LEGACY_ADMIN_USERNAME;
const PASSWORD = process.env.LEGACY_ADMIN_PASSWORD;
const DRY_RUN = process.argv.includes('--dry');

type Row = Record<string, unknown>;

async function call(fn: string, args: unknown[]): Promise<any> {
  const res = await fetch(EXEC_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fn, args }),
    redirect: 'follow',
  });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`ระบบเดิมตอบกลับไม่ใช่ JSON: ${text.slice(0, 200)}`);
  }
  if (!body.ok) throw new Error(String(body.error));
  return body.data;
}

/* ---------- ตัวช่วยแปลงค่า ---------- */

const str = (v: unknown): string | null => {
  const s = v === null || v === undefined ? '' : String(v).trim();
  return s === '' ? null : s;
};
const bool = (v: unknown): boolean =>
  v === true || v === 'true' || v === 'TRUE' || v === 1 || v === '1';
const int = (v: unknown, fallback = 0): number => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};
const num = (v: unknown): string | null => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? String(n) : null;
};
/** ชีตเก็บวันที่หลายรูปแบบปนกัน ต้องกรองค่าที่แปลงไม่ได้ทิ้ง ไม่ให้ INSERT ล้มทั้งชุด */
const ts = (v: unknown): Date | null => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};
const day = (v: unknown): string | null => {
  const d = ts(v);
  return d ? d.toISOString().slice(0, 10) : null;
};

/** master 11 ชีตเดิม -> ตารางเดียวแยกด้วย type */
const MASTER_MAP: Record<string, string> = {
  MD_SHIPPERS: 'shippers',
  MD_CONSIGNEES: 'consignees',
  MD_NOTIFY: 'notify',
  MD_PEOPLE: 'people',
  MD_PORTS: 'ports',
  MD_TERMINALS: 'terminals',
  MD_JOB_TYPES: 'jobTypes',
  MD_LOADING_TYPES: 'loadingTypes',
  MD_CONTAINER_TYPES: 'containerTypes',
  MD_PACKAGE_TYPES: 'packageTypes',
  MD_SETTINGS: 'settings',
};

async function insertChunked(table: any, rows: Row[], label: string) {
  if (!rows.length) {
    console.log(`   ${label}: 0 แถว`);
    return;
  }
  const size = 500;
  for (let i = 0; i < rows.length; i += size) {
    await db.insert(table).values(rows.slice(i, i + size)).onConflictDoNothing();
  }
  console.log(`   ${label}: ${rows.length} แถว`);
}

async function main() {
  if (!EXEC_URL || !USERNAME || !PASSWORD) {
    throw new Error('ต้องตั้ง LEGACY_EXEC_URL, LEGACY_ADMIN_USERNAME, LEGACY_ADMIN_PASSWORD ใน .env.local');
  }

  console.log('เข้าสู่ระบบเดิม...');
  const login = await call('authLogin', [USERNAME, PASSWORD]);
  const token = login.token;

  const counts = await call('exportRowCounts', [token]);
  console.log('\nจำนวนแถวในระบบเดิม:');
  Object.keys(counts).forEach((k) => console.log(`   ${k.padEnd(22)} ${counts[k]}`));

  if (DRY_RUN) {
    console.log('\n--dry: ไม่เขียนอะไรลงฐานข้อมูล');
    return;
  }

  console.log('\nกำลังดึงข้อมูล...');
  const dump = await call('exportAllData', [token, []]);
  const T = dump.tables as Record<string, Row[]>;
  const get = (name: string): Row[] => T[name] ?? [];

  console.log('\nกำลังเขียนลง Postgres...');

  await insertChunked(t.users, get('_USERS').map((r) => ({
    id: String(r.id),
    username: String(r.username),
    passwordHash: String(r.passwordHash),
    // รหัสเดิมยังใช้ได้ ระบบจะอัปเกรดเป็น scrypt ให้เองตอนแต่ละคนล็อกอินสำเร็จ
    passwordAlgo: 'legacy',
    salt: String(r.salt),
    displayName: String(r.displayName ?? ''),
    role: String(r.role ?? 'PAINT'),
    isActive: bool(r.isActive),
    mustChangePassword: bool(r.mustChangePassword),
    failedAttempts: int(r.failedAttempts),
    lockedUntil: ts(r.lockedUntil),
    lastLoginAt: ts(r.lastLoginAt),
    createdAt: ts(r.createdAt) ?? new Date(),
    updatedAt: ts(r.updatedAt) ?? new Date(),
  })), 'users');

  // session เดิมไม่ย้าย ให้ทุกคนล็อกอินใหม่ ปลอดภัยกว่าและไม่มีอะไรเสียหาย

  const masters: Row[] = [];
  Object.keys(MASTER_MAP).forEach((sheet) => {
    get(sheet).forEach((r) => {
      masters.push({
        id: String(r.id),
        type: MASTER_MAP[sheet],
        code: str(r.code),
        name: String(r.name ?? ''),
        description: str(r.description),
        value: str(r.value),
        taxId: str(r.taxId),
        address: str(r.address),
        contactName: str(r.contactName),
        phone: str(r.phone),
        email: str(r.email),
        roleName: str(r.roleName),
        country: str(r.country),
        portId: str(r.portId),
        isActive: bool(r.isActive),
        createdAt: ts(r.createdAt) ?? new Date(),
        updatedAt: ts(r.updatedAt) ?? new Date(),
      });
    });
  });
  await insertChunked(t.masterRecords, masters, 'master_records');

  await insertChunked(t.jobs, get('JOBS').map((r) => ({
    id: String(r.id),
    jobNo: String(r.jobNo),
    blNo: str(r.blNo),
    vessel: str(r.vessel),
    voyage: str(r.voyage),
    eta: day(r.eta),
    etd: day(r.etd),
    etaIsOfficial: bool(r.etaIsOfficial),
    transportDate: day(r.transportDate),
    shipperId: str(r.shipperId),
    consigneeId: str(r.consigneeId),
    notifyPartyId: str(r.notifyPartyId),
    loadingTypeId: str(r.loadingTypeId),
    portId: str(r.portId),
    terminalId: str(r.terminalId),
    personId: str(r.personId),
    jobTypeId: str(r.jobTypeId),
    status: String(r.status ?? 'WAITING_ENTER_BL'),
    surrenderStatus: String(r.surrenderStatus || 'PENDING'),
    customsStatus: String(r.customsStatus || 'NOT_STARTED'),
    releaseStatus: String(r.releaseStatus || 'PENDING'),
    hasInvoiceAlert: bool(r.hasInvoiceAlert),
    isArchived: bool(r.isArchived),
    sourceType: str(r.sourceType),
    blType: str(r.blType),
    product: str(r.product),
    unitAmount: num(r.unitAmount),
    packageType: str(r.packageType),
    grossWeight: num(r.grossWeight),
    goodsValue: num(r.goodsValue),
    goodsCurrency: str(r.goodsCurrency) ?? 'USD',
    shipline: str(r.shipline),
    demDays: int(r.demDays),
    detDays: int(r.detDays),
    releasePartner: str(r.releasePartner),
    customerNote: str(r.customerNote),
    draftRefNo: str(r.draftRefNo),
    draftStatus: str(r.draftStatus),
    draftRejectReason: str(r.draftRejectReason),
    draftTaskId: str(r.draftTaskId),
    customsTaskId: str(r.customsTaskId),
    createdBy: str(r.createdBy),
    updatedBy: str(r.updatedBy),
    createdAt: ts(r.createdAt) ?? new Date(),
    updatedAt: ts(r.updatedAt) ?? new Date(),
  })), 'jobs');

  // ตารางลูกต้องเขียนหลัง jobs เพราะมี foreign key
  const jobIds = new Set(get('JOBS').map((r) => String(r.id)));
  const childOf = (rows: Row[]) => rows.filter((r) => jobIds.has(String(r.jobId)));

  await insertChunked(t.bls, childOf(get('BLS')).map((r) => ({
    id: String(r.id), jobId: String(r.jobId), blNo: str(r.blNo), blType: str(r.blType),
    marks: str(r.marks), description: str(r.description),
    packageCount: num(r.packageCount), grossWeight: num(r.grossWeight),
    measurement: str(r.measurement), shipperId: str(r.shipperId), shipperName: str(r.shipperName),
    createdAt: ts(r.createdAt) ?? new Date(), updatedAt: ts(r.updatedAt) ?? new Date(),
  })), 'bls');

  await insertChunked(t.containers, childOf(get('CONTAINERS')).map((r) => ({
    id: String(r.id), jobId: String(r.jobId), jobNo: str(r.jobNo),
    containerNo: str(r.containerNo), containerType: str(r.containerType), sealNo: str(r.sealNo),
    weight: num(r.weight), packageCount: num(r.packageCount),
    createdAt: ts(r.createdAt) ?? new Date(), updatedAt: ts(r.updatedAt) ?? new Date(),
  })), 'containers');

  await insertChunked(t.files, childOf(get('FILES')).map((r) => ({
    id: String(r.id), jobId: String(r.jobId), category: String(r.category),
    version: int(r.version, 1),
    // ไฟล์ยังอยู่ Drive จนกว่าจะรันขั้นย้ายไฟล์ storage_key จึงชี้ไป Drive ไปก่อน
    storageKey: `drive:${String(r.driveFileId ?? '')}`,
    legacyDriveFileId: str(r.driveFileId),
    fileName: String(r.fileName ?? 'file'),
    mimeType: str(r.mimeType), sizeBytes: int(r.sizeBytes),
    note: str(r.note), changeReason: str(r.changeReason),
    isCurrent: bool(r.isCurrent), isAcknowledged: bool(r.isAcknowledged),
    acknowledgedBy: str(r.acknowledgedBy), acknowledgedAt: ts(r.acknowledgedAt),
    supersededBy: str(r.supersededBy), uploadedBy: str(r.uploadedBy),
    uploadedAt: ts(r.uploadedAt) ?? new Date(),
  })), 'files');

  await insertChunked(t.approvals, childOf(get('APPROVALS')).map((r) => ({
    id: String(r.id), jobId: String(r.jobId), approvalType: String(r.approvalType),
    status: String(r.status), reason: str(r.reason),
    requestedBy: str(r.requestedBy), requestedAt: ts(r.requestedAt) ?? new Date(),
    decidedBy: str(r.decidedBy), decidedAt: ts(r.decidedAt),
  })), 'approvals');

  await insertChunked(t.statusHistory, childOf(get('STATUS_HISTORY')).map((r) => ({
    id: String(r.id), jobId: String(r.jobId), fromStatus: str(r.fromStatus),
    toStatus: str(r.toStatus), note: str(r.note), actorId: str(r.actorId),
    createdAt: ts(r.createdAt) ?? new Date(),
  })), 'status_history');

  await insertChunked(t.customsEntries, childOf(get('CUSTOMS_ENTRIES')).map((r) => ({
    id: String(r.id), jobId: String(r.jobId), entryNo: str(r.entryNo), status: str(r.status),
    declarationNo: str(r.declarationNo), amount: num(r.amount), note: str(r.note),
    createdBy: str(r.createdBy), filedBy: str(r.filedBy), filedAt: ts(r.filedAt),
    createdAt: ts(r.createdAt) ?? new Date(), updatedAt: ts(r.updatedAt) ?? new Date(),
  })), 'customs_entries');

  await insertChunked(t.doHandoffs, childOf(get('DO_HANDOFFS')).map((r) => ({
    id: String(r.id), jobId: String(r.jobId), etaOfficial: day(r.etaOfficial),
    transportDate: day(r.transportDate), portId: str(r.portId), terminalId: str(r.terminalId),
    partnerName: str(r.partnerName), invoiceDoFileId: str(r.invoiceDoFileId), note: str(r.note),
    sentBy: str(r.sentBy), sentAt: ts(r.sentAt), updatedAt: ts(r.updatedAt) ?? new Date(),
  })), 'do_handoffs');

  await insertChunked(t.inspectionReleases, childOf(get('INSPECTION_RELEASES')).map((r) => ({
    id: String(r.id), jobId: String(r.jobId), inspectionRequired: bool(r.inspectionRequired),
    inspectionResult: str(r.inspectionResult), releaseNote: str(r.releaseNote),
    releasedBy: str(r.releasedBy), releasedAt: ts(r.releasedAt),
    updatedAt: ts(r.updatedAt) ?? new Date(),
  })), 'inspection_releases');

  await insertChunked(t.eofficeRequests, childOf(get('EOFFICE_REQUESTS')).map((r) => ({
    id: String(r.id), jobId: String(r.jobId), jobNo: str(r.jobNo),
    requestNo: String(r.requestNo), bookNo: str(r.bookNo), runningNo: str(r.runningNo),
    requestDate: day(r.requestDate), entryNo: str(r.entryNo),
    packageCount: str(r.packageCount), netWeight: str(r.netWeight),
    goodsValue: str(r.goodsValue), goodsType: str(r.goodsType),
    storageKey: r.driveFileId ? `drive:${String(r.driveFileId)}` : null,
    fileRecordId: str(r.fileRecordId), createdBy: str(r.createdBy),
    createdAt: ts(r.createdAt) ?? new Date(), updatedAt: ts(r.updatedAt) ?? new Date(),
  })), 'eoffice_requests');

  await insertChunked(t.jobSequences, get('JOB_SEQUENCES').map((r) => ({
    id: String(r.id), year: String(r.year), prefix: String(r.prefix),
    lastNumber: int(r.lastNumber), updatedAt: ts(r.updatedAt) ?? new Date(),
  })), 'job_sequences');

  await insertChunked(t.activityLog, get('ACTIVITY_LOG').map((r) => ({
    id: String(r.id), userId: str(r.userId), action: String(r.action ?? ''),
    entityType: str(r.entityType), entityId: str(r.entityId), detail: str(r.detail),
    createdAt: ts(r.createdAt) ?? new Date(),
  })), 'activity_log');

  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(t.jobs);
  console.log(`\nเสร็จแล้ว — ตาราง jobs มี ${count} แถว`);
  console.log('ขั้นถัดไป: ย้ายไฟล์จาก Drive เข้า Supabase Storage แล้วอัปเดต storage_key');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\nย้ายข้อมูลไม่สำเร็จ:', error.message);
    process.exit(1);
  });
