import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * เข้ารหัสค่าลับที่ต้องเก็บในฐานข้อมูล เช่น token ของ LINE OA ที่เพิ่มจากหน้าเว็บ
 *
 * ตาราง master_records อ่านได้จากหลายทาง (Supabase dashboard · ไฟล์ backup)
 * token ที่เก็บเป็นข้อความตรง ๆ ใครเห็นแถวก็เอาไปส่งข้อความในนาม OA ได้ทันที
 *
 * กุญแจมาจาก SESSION_SECRET ที่ระบบต้องมีอยู่แล้ว ไม่ต้องตั้งค่าเพิ่ม
 * ผลข้างเคียงคือเปลี่ยน SESSION_SECRET แล้วค่าที่เก็บไว้จะถอดไม่ได้ — ต้องใส่ใหม่
 * open() จึงคืน null แทนการ throw ให้หน้าจอบอกได้ว่าตัวไหนต้องใส่ใหม่
 */

function key(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('ต้องตั้ง SESSION_SECRET ก่อน (ยาวอย่างน้อย 32 ตัวอักษร)');
  // แยกกุญแจออกจากที่ใช้เซ็น session ด้วยป้ายกำกับ ใช้ค่าเดียวกันแต่ไม่ใช่กุญแจเดียวกัน
  return createHash('sha256').update(`kola-secret-box:${secret}`).digest();
}

/** AES-256-GCM — รูปแบบ v1.<iv>.<tag>.<ciphertext> (base64url) */
export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), body].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

export function open(sealed: string | null | undefined): string | null {
  const [version, iv, tag, body] = (sealed ?? '').split('.');
  if (version !== 'v1' || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
