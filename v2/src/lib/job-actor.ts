import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { jobs, masterRecords } from '@/db/schema';
import { AppError, requireActiveSession, requireUserReady, roleAllows, type SessionUser } from '@/lib/auth';
import { isOtherCargo } from '@/lib/other-cargo';

/**
 * ตรวจสิทธิ์ของคำสั่งที่ทำกับงานใดงานหนึ่ง
 *
 * ผ่านถ้า role ตรงตามที่คำสั่งกำหนด (เหมือน requireActiveSession เดิม)
 * หรือเป็น Head Officer (NAMKANG) และงานเป็น Other cargo (MO / TO) — กลุ่มที่ Head Officer ทำเองทั้งเส้น
 * งานอื่นทุกงานยังใช้กติกาเดิมทุกอย่าง
 */
export async function requireJobActor(jobId: string, roles: string[]): Promise<SessionUser> {
  return requireJobsActor([jobId], roles);
}

/** แบบหลายงาน (ส่งมอบคนเดินเอกสารหลายรายการ) — Head Officer ต้องเป็น Other cargo ทุกงาน */
export async function requireJobsActor(jobIds: string[], roles: string[]): Promise<SessionUser> {
  const user = await requireActiveSession([...roles, 'NAMKANG']);
  if (roleAllows(user.role, roles)) return user;
  const codes = await jobTypeCodes(jobIds);
  if (jobIds.length && jobIds.every((id) => isOtherCargo(codes.get(id)))) return user;
  throw new AppError('FORBIDDEN', 'Head Officer ทำขั้นนี้ได้เฉพาะงาน Other cargo (MO / TO)');
}

/** แบบหน้าเว็บ (อ่านอย่างเดียว ตรวจคุกกี้) — หน้าแก้ BL · หน้าคำร้อง E-Office ของงานหนึ่ง */
export async function requireJobPage(jobId: string, roles: string[]): Promise<SessionUser> {
  const user = await requireUserReady([...roles, 'NAMKANG']);
  if (roleAllows(user.role, roles) || await jobIsOtherCargo(jobId)) return user;
  throw new AppError('FORBIDDEN', 'Head Officer เปิดหน้านี้ได้เฉพาะงาน Other cargo (MO / TO)');
}

/** งานเป็น Other cargo หรือไม่ — ใช้ตัดสินว่าอนุมัติอัตโนมัติไหม */
export async function jobIsOtherCargo(jobId: string): Promise<boolean> {
  return isOtherCargo((await jobTypeCodes([jobId])).get(jobId));
}

async function jobTypeCodes(jobIds: string[]) {
  if (!jobIds.length) return new Map<string, string | null>();
  const rows = await db.select({ id: jobs.id, code: masterRecords.code })
    .from(jobs)
    .leftJoin(masterRecords, eq(masterRecords.id, jobs.jobTypeId))
    .where(inArray(jobs.id, jobIds));
  return new Map(rows.map((r) => [r.id, r.code]));
}
