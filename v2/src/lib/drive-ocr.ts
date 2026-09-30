import { createSign } from 'node:crypto';
import { loadEnv } from './env';

/**
 * อ่านข้อความจากรูปด้วย Google Drive OCR — วิธีเดียวกับที่ระบบเดิมบน Apps Script ใช้
 *
 *   อัปรูปขึ้น Drive โดยสั่งให้แปลงเป็น Google Doc (mimeType ปลายทาง = ...google-apps.document)
 *   พร้อมบอกใบ้ภาษาด้วย ocrLanguage=th → Drive ทำ OCR ให้ตอนแปลง
 *   แล้ว export เป็น text/plain → ลบไฟล์ชั่วคราวทิ้ง
 *
 * Drive API เป็น Workspace API จึง **ฟรีและไม่ต้องเปิด billing** ต่างจาก Cloud Vision
 * ที่ Apps Script ทำได้เลยเพราะมี ScriptApp.getOAuthToken() ให้ ส่วนที่นี่ต้องขอโทเคนเอง
 *
 * ขอโทเคนได้ 2 ทาง เลือก service account ก่อนถ้าตั้งไว้:
 *
 *   1. service account — เซ็น JWT ด้วย private key ที่เราถือเอง ไม่มีอะไรหมดอายุ
 *   2. refresh token ของบัญชีผู้ใช้ — ใช้ได้ แต่หมดอายุใน 7 วันถ้า consent screen
 *      ยังเป็น Testing (Google บังคับ) ต้องมาขอใหม่เรื่อย ๆ
 */

/** ไอดีโฟลเดอร์ — วางทั้งลิงก์ของโฟลเดอร์มาก็ได้ ตัดเอาเฉพาะไอดีให้ */
const folderId = (value: string | undefined) => {
  const raw = String(value ?? '').trim().replace(/^['"]|['"]$/g, '');
  return (/\/folders\/([^/?#]+)/.exec(raw)?.[1] ?? raw.split(/[?#]/)[0]).trim();
};

/**
 * private key ของ service account — รับได้ทุกรูปแบบที่คนมักวางลง Vercel
 *
 * ช่องค่าของ Vercel ไม่ได้บอกว่าต้องวางแบบไหน ของที่ได้มาจริงจึงมีหลายหน้าตา
 *   - วางทั้งไฟล์ JSON · ติดเครื่องหมายคำพูดหรือลูกน้ำท้ายบรรทัดมาจาก JSON
 *   - \n เป็นอักษรสองตัว · ขึ้นบรรทัดจริง · หรือขึ้นบรรทัดหายกลายเป็นช่องว่าง
 * ถ้าไปรับแค่แบบเดียว OpenSSL จะตอบแค่ "DECODER routines::unsupported" ซึ่งไม่บอกอะไร
 *
 * จึงดึงเฉพาะเนื้อกุญแจ (base64) ระหว่างหัวกับท้ายออกมา แล้วประกอบ PEM ใหม่ให้ถูกรูป
 * ไม่ว่าจะวางมาแบบไหนก็ได้ผลเดียวกัน
 */
export function normalizePrivateKey(value: string | undefined): string {
  let raw = String(value ?? '').trim();
  if (raw.startsWith('{')) {
    try { raw = String(JSON.parse(raw).private_key ?? ''); } catch { /* ไม่ใช่ JSON ที่อ่านได้ ลองแบบข้อความต่อ */ }
  }
  raw = raw.replace(/\\r/g, '').replace(/\\n/g, '\n');
  const match = /-----BEGIN ([A-Z ]*PRIVATE KEY)-----([\s\S]*?)-----END \1-----/.exec(raw);
  const label = match?.[1] ?? 'PRIVATE KEY';
  // ไม่มีหัวท้ายเลย — ถือว่าวางมาแต่เนื้อกุญแจ
  const body = (match ? match[2] : raw).replace(/["',\s]/g, '');
  if (!body) return '';
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

/*
 * โปรเจกต์นี้ไม่มีอ็อบเจ็กต์ env กลาง อ่านจาก process.env ตรง ๆ แบบเดียวกับที่อื่น
 * ชื่อตัวแปรตรงกับ ERP-SHIPME ใช้ service account กับ Shared Drive ชุดเดียวกันได้เลย
 */
function readEnv() {
  loadEnv();
  return {
    googleServiceEmail: (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim(),
    googleServiceKey: normalizePrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
    googleDriveFolderId: folderId(process.env.GOOGLE_DRIVE_FOLDER_ID),
    googleClientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
    googleClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
    googleRefreshToken: process.env.GOOGLE_OAUTH_REFRESH_TOKEN || '',
  };
}

/** ใช้ service account ได้ = ตั้งครบทั้งอีเมลและ private key */
export const driveServiceAccount = () => {
  const env = readEnv();
  return Boolean(env.googleServiceEmail && env.googleServiceKey);
};

export const driveOcrConfigured = () => {
  const env = readEnv();
  return driveServiceAccount()
    || Boolean(env.googleClientId && env.googleClientSecret && env.googleRefreshToken);
};

const DOC_MIME = 'application/vnd.google-apps.document';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// access token อายุราว 1 ชั่วโมง — เก็บไว้ใช้ซ้ำ ไม่ต้องขอใหม่ทุกใบ
let cached: { token: string; expiresAt: number } | null = null;

const base64url = (input: Buffer | string) =>
  Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * เซ็น JWT ด้วย private key ของ service account แล้วเอาไปแลก access token
 *
 * ต่างจาก refresh token ตรงที่ไม่มี "ใบอนุญาต" ที่ Google ออกให้แล้วหมดอายุได้
 * เราถือกุญแจเซ็นเองทุกครั้ง จึงไม่มีอะไรให้หมดอายุหรือถูกเพิกถอนตามรอบ
 */
async function serviceAccountToken(): Promise<string> {
  const env = readEnv();
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: env.googleServiceEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600
  };
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claim))}`;

  let signature: string;
  try {
    signature = base64url(createSign('RSA-SHA256').update(unsigned).sign(env.googleServiceKey));
  } catch (error) {
    /*
     * รูปแบบถูกแล้วแต่ยังเซ็นไม่ได้ แปลว่าเนื้อกุญแจเองไม่ครบหรือไม่ใช่ private key
     * บอกความยาวไว้ให้เทียบ — กุญแจ RSA 2048 ของ Google ยาวราว 1,600 ตัว สั้นกว่านั้นคือคัดลอกขาด
     * ไม่แสดงตัวกุญแจเด็ดขาด เพราะข้อความนี้ขึ้นบนหน้าจอผู้ใช้
     */
    const length = env.googleServiceKey.replace(/-----[^-]+-----|\s/g, '').length;
    throw new Error(
      'เซ็น JWT ด้วย GOOGLE_SERVICE_ACCOUNT_KEY ไม่สำเร็จ — วางค่า private_key จากไฟล์ JSON ใหม่ ' +
      `หรือวางทั้งไฟล์ JSON ก็ได้ (อ่านได้ ${length} ตัว ปกติราว 1,600) (${(error as Error).message})`
    );
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`
    }),
    signal: AbortSignal.timeout(15000)
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.access_token) {
    const reason = body?.error_description || body?.error || `HTTP ${response.status}`;
    throw new Error(`ขอ access token ด้วย service account ไม่สำเร็จ: ${reason}`);
  }
  return body.access_token;
}

/** OAuth ของบัญชีผู้ใช้ — refresh token หมดอายุได้ (ดูหมายเหตุใน env.ts) */
async function refreshTokenGrant(): Promise<string> {
  const env = readEnv();
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      refresh_token: env.googleRefreshToken,
      grant_type: 'refresh_token'
    }),
    signal: AbortSignal.timeout(15000)
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.access_token) {
    const reason = body?.error_description || body?.error || `HTTP ${response.status}`;
    // สาเหตุนี้แก้ด้วยการขอ token ใหม่อย่างเดียว บอกทางออกไปเลยจะได้ไม่ต้องมานั่งไล่หา
    const hint = /expired or revoked|invalid_grant/i.test(String(reason))
      ? ' — refresh token หมดอายุแล้ว ย้ายไปใช้ service account เพื่อไม่ให้เกิดซ้ำ (ดู v2/.env.example)'
      : '';
    throw new Error(`ขอ access token จาก Google ไม่สำเร็จ: ${reason}${hint}`);
  }
  return body.access_token;
}

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  // service account มาก่อนเสมอ เพราะไม่มีวันหมดอายุ
  const token = driveServiceAccount() ? await serviceAccountToken() : await refreshTokenGrant();
  cached = { token, expiresAt: Date.now() + 3600 * 1000 };
  return token;
}

function decode(dataUrl: string) {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(String(dataUrl || ''));
  const base64 = (match ? match[2] : String(dataUrl || '')).replace(/\s+/g, '');
  return {
    bytes: Buffer.from(base64, 'base64'),
    contentType: (match?.[1] || 'image/jpeg').toLowerCase()
  };
}

/** ประกอบ multipart/related เอง — Drive ต้องการ metadata กับตัวไฟล์ในคำขอเดียว */
function multipart(metadata: object, bytes: Buffer, contentType: string) {
  const boundary = `slip${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`
  );
  const tail = Buffer.from(`\r\n--${boundary}--`);
  return { boundary, body: Buffer.concat([head, bytes, tail]) };
}

async function removeFile(fileId: string, token: string) {
  // ลบไม่สำเร็จก็ไม่ต้องทำให้ทั้งคำขอพัง แค่ทิ้งขยะไว้ใน Drive
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000)
    });
  } catch { /* ปล่อยผ่าน */ }
}

export async function driveOcrText(dataUrl: string): Promise<string> {
  const env = readEnv();
  const token = await accessToken();
  const { bytes, contentType } = decode(dataUrl);
  if (!bytes.length) throw new Error('ไม่มีข้อมูลรูปภาพ');

  const { boundary, body } = multipart(
    {
      name: `slip_ocr_${Date.now()}`,
      mimeType: DOC_MIME,                                     // mimeType ปลายทาง = สั่งให้แปลงเป็น Doc
      // ไม่ระบุโฟลเดอร์ = ไฟล์ไปกองที่ไดรฟ์ของเจ้าของโทเคน ซึ่ง service account ไม่มี
      ...(env.googleDriveFolderId ? { parents: [env.googleDriveFolderId] } : {})
    },
    bytes,
    contentType
  );

  const upload = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&ocrLanguage=th&fields=id&supportsAllDrives=true',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/related; boundary=${boundary}` },
      body,
      signal: AbortSignal.timeout(45000)
    }
  );
  const created = await upload.json().catch(() => null);
  if (!upload.ok || !created?.id) {
    const reason = created?.error?.message || `HTTP ${upload.status}`;
    // service account ไม่มีพื้นที่เก็บของตัวเอง ต้องยืมโฟลเดอร์ของบัญชีคนจริง
    // อาการนี้รอไปก็ไม่หาย แยกออกจากโควตาเต็มชั่วคราวเพื่อไม่ให้เข้าใจผิด
    /*
     * ตั้งโฟลเดอร์ไว้แล้วก็ยังเจอได้ ถ้าเป็นโฟลเดอร์ธรรมดาใน "ไดรฟ์ของฉัน" ที่แชร์ให้
     * เพราะไฟล์ในนั้นนับเป็นของคนอัป (service account) ไม่ใช่ของเจ้าของโฟลเดอร์
     * ต้องเช็กก่อนกรณีโควตาชั่วคราวข้างล่าง ไม่งั้นข้อความจะบอกให้รอ ซึ่งรอเท่าไหร่ก็ไม่หาย
     */
    if (/storage quota has been exceeded/i.test(reason)) {
      throw new Error(
        'service account ไม่มีพื้นที่ Drive ของตัวเอง — GOOGLE_DRIVE_FOLDER_ID ต้องเป็น Shared Drive (ไดรฟ์ที่แชร์) ' +
        'ที่ให้ service account เป็น Content manager ไม่ใช่โฟลเดอร์ใน "ไดรฟ์ของฉัน" (ดู v2/.env.example)'
      );
    }
    // โควตา OCR ของ Drive เต็มได้ถ้ายิงถี่ ๆ บอกให้ชัดจะได้รู้ว่ารอแล้วลองใหม่
    if (/rate limit|quota|limit exceeded/i.test(reason)) {
      throw new Error(`Drive OCR ใช้โควตาเกินชั่วคราว — รอสักครู่แล้วกดอ่านใหม่ (${reason})`);
    }
    throw new Error(`Drive OCR อัปโหลดไม่สำเร็จ: ${reason}`);
  }

  try {
    const exported = await fetch(
      `https://www.googleapis.com/drive/v3/files/${created.id}/export?mimeType=text/plain`,
      { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000) }
    );
    if (!exported.ok) {
      const reason = await exported.json().catch(() => null);
      throw new Error(`Drive OCR อ่านเอกสารไม่สำเร็จ: ${reason?.error?.message || `HTTP ${exported.status}`}`);
    }
    return await exported.text();
  } finally {
    await removeFile(created.id, token);
  }
}
