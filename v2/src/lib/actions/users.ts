'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, ne, sql } from 'drizzle-orm';
import { db } from '@/db';
import { sessions, users } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import { scryptHash, validatePassword } from '@/lib/password';
import {
  ASSIGNABLE_ROLES, DEPARTMENTS, POSITIONS, rolesForDepartment,
} from '@/lib/org';
import { logActivity, newId, runAction, required, text } from './common';

/**
 * จัดการผู้ใช้ — เฉพาะ ADMIN
 *
 * ตั้งรหัสผ่านให้ตอนสร้าง แล้วบังคับเปลี่ยนตอนล็อกอินครั้งแรกเสมอ
 * ผู้ดูแลจึงไม่ต้องเก็บรหัสของคนอื่นไว้กับตัวหลังส่งมอบ
 */

/** ตรวจว่าแผนก ตำแหน่ง บริษัท และ role ที่ส่งมาเข้ากันจริง */
function readOrg(formData: FormData) {
  const department = required(formData.get('department'), 'แผนก', 40);
  const position = required(formData.get('position'), 'ตำแหน่ง', 40);
  const role = required(formData.get('role'), 'สิทธิ์การใช้งาน', 40);

  const dept = DEPARTMENTS.find((d) => d.key === department);
  if (!dept) throw new Error('ไม่พบแผนกที่เลือก');
  if (!POSITIONS.some((p) => p === position)) throw new Error('ไม่พบตำแหน่งที่เลือก');
  if (!ASSIGNABLE_ROLES.includes(role)) throw new Error('ไม่พบสิทธิ์ที่เลือก');

  // สิทธิ์ต้องเป็นหนึ่งในที่แผนกนั้นใช้ได้ กันการตั้งสิทธิ์ข้ามแผนกโดยไม่ตั้งใจ
  if (!rolesForDepartment(department).includes(role)) {
    throw new Error(`แผนก${dept.label}ใช้สิทธิ์ ${role} ไม่ได้`);
  }

  // บริษัทมาจากแผนก ไม่ให้ฟอร์มส่งมาเอง จะได้ไม่มีทางขัดกัน
  return { department, position, role, company: dept.company };
}

async function createUserImpl(formData: FormData) {
  const admin = await requireActiveSession(['ADMIN']);

  const username = required(formData.get('username'), 'ชื่อผู้ใช้', 60).toLowerCase();
  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw new Error('ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 จุด ขีดกลาง และขีดล่าง');
  }
  const displayName = required(formData.get('displayName'), 'ชื่อที่แสดง', 120);
  const password = validatePassword(required(formData.get('password'), 'รหัสผ่าน', 200));
  const org = readOrg(formData);

  const [exists] = await db.select({ id: users.id }).from(users)
    .where(eq(users.username, username)).limit(1);
  if (exists) throw new Error(`มีชื่อผู้ใช้ "${username}" อยู่แล้ว`);

  const { hash, salt } = await scryptHash(password);
  const id = newId('USR');
  await db.insert(users).values({
    id, username, displayName,
    passwordHash: hash, salt, passwordAlgo: 'scrypt',
    ...org,
    isActive: true,
    // บังคับเปลี่ยนรหัสตอนล็อกอินครั้งแรก ผู้ดูแลจะได้ไม่ถือรหัสของคนอื่นต่อ
    mustChangePassword: true,
  });

  await logActivity(admin.id, 'CREATE_USER', 'USER', id, {
    username, role: org.role, department: org.department,
  });
  revalidatePath('/master/users');
}

async function updateUserImpl(formData: FormData) {
  const admin = await requireActiveSession(['ADMIN']);
  const id = required(formData.get('id'), 'ผู้ใช้', 80);
  const displayName = required(formData.get('displayName'), 'ชื่อที่แสดง', 120);
  const org = readOrg(formData);

  const [target] = await db.select({ id: users.id, username: users.username, role: users.role })
    .from(users).where(eq(users.id, id)).limit(1);
  if (!target) throw new Error('ไม่พบผู้ใช้');

  /*
   * กันผู้ดูแลคนสุดท้ายถอดสิทธิ์ตัวเอง มิฉะนั้นจะไม่เหลือใครเข้า Master Data ได้อีกเลย
   * นับเฉพาะบัญชีที่ยังเปิดใช้อยู่ เพราะบัญชีที่ถูกระงับล็อกอินไม่ได้
   */
  if (target.role === 'ADMIN' && org.role !== 'ADMIN') {
    await assertNotLastAdmin(id);
  }

  await db.update(users)
    .set({ displayName, ...org, updatedAt: new Date() })
    .where(eq(users.id, id));

  await logActivity(admin.id, 'UPDATE_USER', 'USER', id, {
    username: target.username, role: org.role, department: org.department,
  });
  revalidatePath('/master/users');
}

/** เปิด/ปิดการใช้งานบัญชี — ปิดแล้วล็อกอินไม่ได้ และตัด session ที่ค้างอยู่ทิ้ง */
async function setUserActiveImpl(formData: FormData) {
  const admin = await requireActiveSession(['ADMIN']);
  const id = required(formData.get('id'), 'ผู้ใช้', 80);
  const active = text(formData.get('active'), 10) === '1';

  const [target] = await db.select({ username: users.username, role: users.role })
    .from(users).where(eq(users.id, id)).limit(1);
  if (!target) throw new Error('ไม่พบผู้ใช้');
  if (!active) {
    if (id === admin.id) throw new Error('ระงับบัญชีของตัวเองไม่ได้');
    if (target.role === 'ADMIN') await assertNotLastAdmin(id);
  }

  await db.update(users)
    .set({ isActive: active, updatedAt: new Date() })
    .where(eq(users.id, id));

  // ปิดบัญชีแล้วต้องเตะออกจากระบบทันที ไม่ใช่รอคุกกี้หมดอายุเอง
  if (!active) await db.delete(sessions).where(eq(sessions.userId, id));

  await logActivity(admin.id, active ? 'ENABLE_USER' : 'DISABLE_USER', 'USER', id,
    { username: target.username });
  revalidatePath('/master/users');
}

/** ตั้งรหัสผ่านใหม่ให้ผู้ใช้ แล้วบังคับให้เปลี่ยนเองตอนล็อกอินครั้งถัดไป */
async function resetPasswordImpl(formData: FormData) {
  const admin = await requireActiveSession(['ADMIN']);
  const id = required(formData.get('id'), 'ผู้ใช้', 80);
  const password = validatePassword(required(formData.get('password'), 'รหัสผ่านใหม่', 200));

  const [target] = await db.select({ username: users.username })
    .from(users).where(eq(users.id, id)).limit(1);
  if (!target) throw new Error('ไม่พบผู้ใช้');

  const { hash, salt } = await scryptHash(password);
  await db.update(users)
    .set({
      passwordHash: hash, salt, passwordAlgo: 'scrypt',
      mustChangePassword: true,
      // ปลดล็อกที่เกิดจากกรอกรหัสผิดหลายครั้งไปด้วย รหัสใหม่แล้วไม่ควรต้องรอ
      failedAttempts: 0, lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, id));

  // รหัสเปลี่ยนแล้ว session เดิมต้องใช้ไม่ได้ต่อ
  await db.delete(sessions).where(eq(sessions.userId, id));

  await logActivity(admin.id, 'RESET_PASSWORD', 'USER', id, { username: target.username });
  revalidatePath('/master/users');
}

/**
 * ผู้ดูแลที่ยังเปิดใช้อยู่ต้องเหลืออย่างน้อยหนึ่งคนเสมอ
 * นับเฉพาะบัญชีที่ยังเปิดใช้ เพราะบัญชีที่ถูกระงับล็อกอินเข้ามาแก้อะไรไม่ได้
 */
async function assertNotLastAdmin(excludeId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(and(
      eq(users.role, 'ADMIN'),
      eq(users.isActive, true),
      ne(users.id, excludeId),
    ));
  if (!row?.count) throw new Error('ต้องเหลือผู้ดูแลระบบอย่างน้อยหนึ่งคน');
}

export async function createUser(formData: FormData) {
  return runAction(() => createUserImpl(formData));
}
export async function updateUser(formData: FormData) {
  return runAction(() => updateUserImpl(formData));
}
export async function setUserActive(formData: FormData) {
  return runAction(() => setUserActiveImpl(formData));
}
export async function resetUserPassword(formData: FormData) {
  return runAction(() => resetPasswordImpl(formData));
}
