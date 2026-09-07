import { asc, ilike, or } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';

/**
 * รายชื่อผู้ใช้ทั้งหมดสำหรับหน้าจัดการผู้ใช้
 *
 * ไม่ดึง passwordHash และ salt ออกมาเลย แม้หน้านี้จะเปิดให้ ADMIN เท่านั้น
 * ค่าที่ไม่ได้ใช้แสดงผลไม่ควรเดินทางออกจากฐานข้อมูลตั้งแต่แรก
 */
export async function listUsers(search?: string) {
  const like = search?.trim() ? `%${search.trim()}%` : null;
  return db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      company: users.company,
      department: users.department,
      position: users.position,
      isActive: users.isActive,
      mustChangePassword: users.mustChangePassword,
      lastLoginAt: users.lastLoginAt,
      lockedUntil: users.lockedUntil,
    })
    .from(users)
    .where(like
      ? or(ilike(users.username, like), ilike(users.displayName, like))
      : undefined)
    .orderBy(asc(users.username))
    .limit(500);
}

export type UserRow = Awaited<ReturnType<typeof listUsers>>[number];
