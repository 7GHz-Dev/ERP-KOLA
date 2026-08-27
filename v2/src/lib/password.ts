import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

/** จำนวนรอบของระบบเดิม (APP_CONFIG.PASSWORD_ROUNDS) เปลี่ยนไม่ได้ ไม่งั้นรหัสเดิมจะตรวจไม่ผ่าน */
const LEGACY_ROUNDS = 600;

const SCRYPT_KEYLEN = 64;

/**
 * สูตรแฮชของระบบเดิม — คัดลอกมาตรงจาก passwordHash_() ใน Auth.gs
 *
 *   current = salt|password|pepper
 *   ทำซ้ำ 600 รอบ: current = sha256(current|salt|i)
 *
 * pepper เป็นความลับที่เก็บใน Script Properties ของโปรเจกต์เดิม
 * ต้องคัดลอกมาใส่ LEGACY_PASSWORD_PEPPER ด้วยมือ ไม่มีช่องทางดึงผ่าน API โดยตั้งใจ
 */
export function legacyHash(password: string, salt: string, pepper: string): string {
  let current = `${salt}|${password}|${pepper}`;
  for (let i = 0; i < LEGACY_ROUNDS; i += 1) {
    current = createHash('sha256').update(`${current}|${salt}|${i}`, 'utf8').digest('hex');
  }
  return current;
}

/** แฮชแบบใหม่ คืนค่าเป็น "salt:hash" ในคอลัมน์เดียว */
export async function scryptHash(password: string): Promise<{ hash: string; salt: string }> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return { hash: derived.toString('hex'), salt };
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type StoredPassword = {
  passwordHash: string;
  salt: string;
  passwordAlgo: string;
};

/**
 * ตรวจรหัสผ่าน รองรับทั้งของเดิมและของใหม่
 *
 * คืน needsUpgrade = true เมื่อผ่านด้วยสูตรเดิม ผู้เรียกควรแฮชใหม่ด้วย scrypt แล้วบันทึกทับ
 * ทำให้ผู้ใช้ย้ายระบบได้โดยไม่ต้องตั้งรหัสใหม่ และความปลอดภัยค่อย ๆ ดีขึ้นเองตามการใช้งาน
 */
export async function verifyPassword(
  password: string,
  stored: StoredPassword,
): Promise<{ ok: boolean; needsUpgrade: boolean }> {
  if (stored.passwordAlgo === 'legacy') {
    const pepper = process.env.LEGACY_PASSWORD_PEPPER;
    if (!pepper) {
      throw new Error(
        'ผู้ใช้รายนี้ยังใช้รหัสผ่านรูปแบบเดิม ต้องตั้ง LEGACY_PASSWORD_PEPPER ใน .env.local ก่อน',
      );
    }
    const ok = safeEqual(legacyHash(password, stored.salt, pepper), stored.passwordHash);
    return { ok, needsUpgrade: ok };
  }

  const derived = (await scryptAsync(password, stored.salt, SCRYPT_KEYLEN)) as Buffer;
  return { ok: safeEqual(derived.toString('hex'), stored.passwordHash), needsUpgrade: false };
}

/** กติกาความแข็งแรงของรหัสผ่าน ยกมาจาก validatePassword_() เดิมเพื่อให้ไม่ขัดกัน */
export function validatePassword(password: string): string {
  const value = String(password ?? '');
  if (value.length < 10) throw new Error('รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร');
  if (!/[A-Za-z฀-๿]/.test(value) || !/[0-9]/.test(value)) {
    throw new Error('รหัสผ่านต้องมีตัวอักษรและตัวเลข');
  }
  return value;
}
