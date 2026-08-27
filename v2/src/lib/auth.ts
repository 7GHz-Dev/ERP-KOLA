import { createHash, randomBytes } from 'node:crypto';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '@/db';
import { sessions, users } from '@/db/schema';
import { scryptHash, verifyPassword } from './password';
import { decodeSession, encodeSession } from './session-token';

const COOKIE = 'kola_session';
const SESSION_HOURS = 8;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const hashToken = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');
const newId = (prefix: string) =>
  `${prefix}-${randomBytes(10).toString('hex').toUpperCase()}`;

export class AppError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export type SessionUser = {
  id: string;
  username: string;
  displayName: string;
  role: string;
  mustChangePassword: boolean;
};

export async function login(username: string, password: string): Promise<SessionUser> {
  const generic = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
  const key = String(username ?? '').trim().toLowerCase();

  const [user] = await db.select().from(users).where(eq(users.username, key)).limit(1);
  // ตอบข้อความเดียวกันทุกกรณี ไม่บอกว่ามีผู้ใช้นี้จริงหรือไม่
  if (!user) throw new AppError('INVALID_LOGIN', generic);
  if (!user.isActive) throw new AppError('ACCOUNT_DISABLED', 'บัญชีนี้ถูกระงับการใช้งาน');
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new AppError('ACCOUNT_LOCKED', 'บัญชีถูกล็อกชั่วคราว กรุณารอสักครู่');
  }

  const result = await verifyPassword(password, {
    passwordHash: user.passwordHash,
    salt: user.salt,
    passwordAlgo: user.passwordAlgo,
  });

  if (!result.ok) {
    const failed = user.failedAttempts + 1;
    await db.update(users).set({
      failedAttempts: failed,
      lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      updatedAt: new Date(),
    }).where(eq(users.id, user.id));
    throw new AppError('INVALID_LOGIN', generic);
  }

  // ผ่านด้วยสูตรเดิม -> อัปเกรดเป็น scrypt ทันที ผู้ใช้ไม่ต้องทำอะไร
  const upgrade = result.needsUpgrade ? await scryptHash(password) : null;

  await db.update(users).set({
    failedAttempts: 0,
    lockedUntil: null,
    lastLoginAt: new Date(),
    updatedAt: new Date(),
    ...(upgrade ? { passwordHash: upgrade.hash, salt: upgrade.salt, passwordAlgo: 'scrypt' } : {}),
  }).where(eq(users.id, user.id));

  // ยังบันทึกแถวใน sessions ไว้เพื่อให้เพิกถอนได้ แต่การอ่านหน้าปกติจะไม่แตะตารางนี้
  const sessionId = newId('SES');
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3_600_000);
  const token = randomBytes(32).toString('hex');
  await db.insert(sessions).values({
    id: sessionId,
    tokenHash: hashToken(token),
    userId: user.id,
    expiresAt,
    lastSeenAt: new Date(),
  });

  const cookieValue = encodeSession({
    sid: sessionId,
    uid: user.id,
    username: user.username,
    name: user.displayName,
    role: user.role,
    mcp: user.mustChangePassword,
    exp: expiresAt.getTime(),
  });

  (await cookies()).set(COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_HOURS * 3600,
  });

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };
}

export async function logout(): Promise<void> {
  const store = await cookies();
  const payload = decodeSession(store.get(COOKIE)?.value);
  if (payload) await db.delete(sessions).where(eq(sessions.id, payload.sid));
  store.delete(COOKIE);
}

/**
 * ตัวตนของผู้ใช้ปัจจุบัน อ่านจากคุกกี้ที่เซ็นชื่อไว้ — ไม่มีการ query ฐานข้อมูลเลย
 *
 * ใช้กับการแสดงผลหน้าเว็บ ซึ่งเป็นงานส่วนใหญ่และต้องการความเร็ว
 * ถ้าต้องการความมั่นใจว่า session ยังไม่ถูกเพิกถอน ให้ใช้ requireActiveSession แทน
 */
export const currentUser = cache(async function currentUser(): Promise<SessionUser | null> {
  const payload = decodeSession((await cookies()).get(COOKIE)?.value);
  if (!payload) return null;
  return {
    id: payload.uid,
    username: payload.username,
    displayName: payload.name,
    role: payload.role,
    mustChangePassword: payload.mcp,
  };
});

/**
 * ตรวจกับฐานข้อมูลจริงว่า session ยังใช้ได้และบัญชียังไม่ถูกระงับ
 *
 * ใช้ก่อนการเขียนข้อมูลทุกครั้ง เพราะคุกกี้ที่เซ็นชื่อยังใช้ได้จนหมดอายุแม้จะกดออกจากระบบไปแล้ว
 * แลกความเร็วของการอ่าน กับความถูกต้องของการเขียน
 */
export async function requireActiveSession(roles?: string[]): Promise<SessionUser> {
  const payload = decodeSession((await cookies()).get(COOKIE)?.value);
  if (!payload) throw new AppError('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ');

  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      role: users.role,
      mustChangePassword: users.mustChangePassword,
      isActive: users.isActive,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, payload.sid), gt(sessions.expiresAt, new Date())))
    .limit(1);

  if (!row) throw new AppError('SESSION_EXPIRED', 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่');
  if (!row.isActive) throw new AppError('ACCOUNT_DISABLED', 'บัญชีนี้ถูกระงับการใช้งาน');
  if (roles && row.role !== 'ADMIN' && !roles.includes(row.role)) {
    throw new AppError('FORBIDDEN', 'คุณไม่มีสิทธิ์ดำเนินการนี้');
  }
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    mustChangePassword: row.mustChangePassword,
  };
}

export async function requireUser(roles?: string[]): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) throw new AppError('UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ');
  if (roles && user.role !== 'ADMIN' && !roles.includes(user.role)) {
    throw new AppError('FORBIDDEN', 'คุณไม่มีสิทธิ์ดำเนินการนี้');
  }
  return user;
}
