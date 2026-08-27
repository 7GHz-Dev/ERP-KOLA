import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { masterRecords } from '@/db/schema';

export const MASTER_TYPES = [
  { key: 'shippers', label: 'Shipper' },
  { key: 'consignees', label: 'Consignee' },
  { key: 'notify', label: 'Notify Party' },
  { key: 'people', label: 'ผู้รับผิดชอบ' },
  { key: 'ports', label: 'Port of Discharge' },
  { key: 'terminals', label: 'Port Terminal' },
  { key: 'jobTypes', label: 'Job Type' },
  { key: 'partners', label: 'Port Release Partner' },
  { key: 'loadingTypes', label: 'Loading Type' },
  { key: 'containerTypes', label: 'ขนาดตู้' },
  { key: 'packageTypes', label: 'หน่วยนับ' },
  { key: 'settings', label: 'ค่าตั้งต้น' },
] as const;

export type MasterType = (typeof MASTER_TYPES)[number]['key'];

export async function listMaster(type: string, search?: string) {
  const conditions = [eq(masterRecords.type, type)];
  if (search?.trim()) {
    const like = `%${search.trim()}%`;
    conditions.push(
      or(ilike(masterRecords.code, like), ilike(masterRecords.name, like))!,
    );
  }
  return db
    .select()
    .from(masterRecords)
    .where(and(...conditions))
    .orderBy(asc(masterRecords.code), asc(masterRecords.name))
    .limit(500);
}

export async function masterCounts() {
  const rows = await db
    .select({ type: masterRecords.type, count: sql<number>`count(*)::int` })
    .from(masterRecords)
    .groupBy(masterRecords.type);
  return new Map(rows.map((r) => [r.type, r.count]));
}

export type Option = { id: string; code: string | null; name: string };

/** ตัวเลือกทั้งหมดของ master ที่หน้ารับงานต้องใช้ ดึงรอบเดียวแล้วแยกตามชนิด */
export async function intakeOptions() {
  const rows = await db
    .select({ id: masterRecords.id, type: masterRecords.type, code: masterRecords.code, name: masterRecords.name })
    .from(masterRecords)
    .where(eq(masterRecords.isActive, true))
    .orderBy(asc(masterRecords.code), asc(masterRecords.name));

  const group = (type: string): Option[] =>
    rows.filter((r) => r.type === type).map(({ id, code, name }) => ({ id, code, name }));

  return {
    shippers: group('shippers'),
    consignees: group('consignees'),
    notify: group('notify'),
    people: group('people'),
    ports: group('ports'),
    terminals: group('terminals'),
    jobTypes: group('jobTypes'),
    containerTypes: group('containerTypes'),
    packageTypes: group('packageTypes'),
    settings: group('settings'),
  };
}

/** ค่าตั้งต้นที่ผู้ดูแลแก้ได้จากหน้า Master Data */
export async function settingValue(code: string, fallback: string): Promise<string> {
  const [row] = await db
    .select({ value: masterRecords.value })
    .from(masterRecords)
    .where(and(eq(masterRecords.type, 'settings'), eq(masterRecords.code, code), eq(masterRecords.isActive, true)))
    .limit(1);
  const value = (row?.value ?? '').trim();
  return value || fallback;
}
