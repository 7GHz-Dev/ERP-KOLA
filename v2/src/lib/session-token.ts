import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Session แบบ cookie ที่เซ็นชื่อ
 *
 * เดิมทุก request ต้อง query ตาราง sessions เพื่อรู้ว่าใครล็อกอินอยู่ = เสียเวลาไป-กลับฐานข้อมูล 1 รอบ
 * แบบนี้ใส่ตัวตนไว้ในคุกกี้แล้วเซ็นด้วย HMAC ฝั่งเซิร์ฟเวอร์ตรวจลายเซ็นเองได้เลย ไม่ต้องแตะฐานข้อมูล
 *
 * ข้อแลกเปลี่ยนที่ต้องรู้: การเพิกถอนไม่มีผลทันทีถ้าไม่ตรวจฐานข้อมูล
 * จึงแบ่งเป็นสองระดับ — การอ่านหน้าใช้คุกกี้อย่างเดียว ส่วนการเขียนข้อมูลยังตรวจฐานข้อมูลจริง
 * (ดู requireUser / requireActiveSession ใน auth.ts)
 */

export type SessionPayload = {
  sid: string;          // id ของแถวในตาราง sessions ใช้ตอนเพิกถอน
  uid: string;
  username: string;
  name: string;
  role: string;
  mcp: boolean;         // mustChangePassword
  exp: number;          // เวลาหมดอายุ (epoch ms)
};

function secret(): string {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error(
      'ต้องตั้ง SESSION_SECRET ใน .env.local ให้ยาวอย่างน้อย 32 ตัวอักษร\n' +
        'สร้างได้ด้วย: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
    );
  }
  return value;
}

const b64 = (input: string) => Buffer.from(input, 'utf8').toString('base64url');
const unb64 = (input: string) => Buffer.from(input, 'base64url').toString('utf8');

function sign(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url');
}

export function encodeSession(payload: SessionPayload): string {
  const body = b64(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

/** คืน null ถ้าลายเซ็นไม่ถูก หมดอายุ หรือรูปแบบเพี้ยน — ไม่โยน error เพื่อให้ผู้เรียกเด้งไปหน้าล็อกอินได้เลย */
export function decodeSession(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const body = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  const expected = sign(body);

  // เทียบแบบเวลาคงที่ กันการเดาลายเซ็นทีละไบต์จากเวลาตอบกลับ
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const payload = JSON.parse(unb64(body)) as SessionPayload;
    if (!payload?.uid || !payload?.sid) return null;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
