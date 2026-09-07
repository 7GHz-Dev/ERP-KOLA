'use server';

import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { refreshSessionCookie, requireActiveSession } from '@/lib/auth';
import { scryptHash, validatePassword, verifyPassword } from '@/lib/password';
import { logActivity, required, runAction } from './common';

/**
 * ผู้ใช้เปลี่ยนรหัสผ่านของตัวเอง
 *
 * ใช้ทั้งตอนถูกบังคับเปลี่ยนครั้งแรก และตอนเปลี่ยนเองภายหลัง
 * ต้องกรอกรหัสเดิมด้วยเสมอ กันคนที่มาใช้เครื่องต่อจากเจ้าของเปลี่ยนรหัสยึดบัญชี
 */
async function changeOwnPasswordImpl(formData: FormData) {
  const user = await requireActiveSession();
  const current = required(formData.get('current'), 'รหัสผ่านเดิม', 200);
  const next = validatePassword(required(formData.get('next'), 'รหัสผ่านใหม่', 200));
  const confirm = required(formData.get('confirm'), 'ยืนยันรหัสผ่านใหม่', 200);
  if (next !== confirm) throw new Error('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
  if (next === current) throw new Error('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม');

  const [row] = await db
    .select({
      passwordHash: users.passwordHash, salt: users.salt, passwordAlgo: users.passwordAlgo,
    })
    .from(users).where(eq(users.id, user.id)).limit(1);
  if (!row) throw new Error('ไม่พบผู้ใช้');

  const checked = await verifyPassword(current, row);
  if (!checked.ok) throw new Error('รหัสผ่านเดิมไม่ถูกต้อง');

  const { hash, salt } = await scryptHash(next);
  await db.update(users)
    .set({
      passwordHash: hash, salt, passwordAlgo: 'scrypt',
      mustChangePassword: false,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  // คุกกี้เก็บ mustChangePassword ไว้ด้วย ต้องออกใบใหม่ ไม่งั้นจะถูกไล่มาหน้านี้ซ้ำ
  await refreshSessionCookie();
  await logActivity(user.id, 'CHANGE_PASSWORD', 'USER', user.id, {});
}

export async function changeOwnPassword(formData: FormData) {
  await runAction(() => changeOwnPasswordImpl(formData));
  redirect('/overview');
}
