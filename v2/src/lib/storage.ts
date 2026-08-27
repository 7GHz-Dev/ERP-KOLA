import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * ที่เก็บไฟล์บน Supabase Storage
 *
 * bucket เป็นแบบส่วนตัว ไม่เปิดให้เข้าถึงตรง ๆ จาก URL
 * การเปิดไฟล์ต้องผ่านเส้นทาง /files/[id] ของแอป ซึ่งตรวจสิทธิ์ก่อนเสมอ
 * เพราะเอกสารพวกนี้เป็นข้อมูลลูกค้า ไม่ควรหลุดเพียงเพราะใครเดา URL ถูก
 */
export const BUCKET = 'job-files';

let cached: SupabaseClient | null = null;

export function storage(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'ต้องตั้ง NEXT_PUBLIC_SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ใน .env.local\n' +
        'หาได้จาก Supabase → Project Settings → API',
    );
  }
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export function storageConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/** ชื่อไฟล์ที่ปลอดภัยสำหรับใช้เป็น key — เก็บชื่อจริงไว้ในฐานข้อมูลอยู่แล้ว */
export function safeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, '_').replace(/_{2,}/g, '_').slice(0, 120) || 'file';
}

export function buildKey(jobId: string, category: string, fileId: string, fileName: string): string {
  return `${jobId}/${category}/${fileId}-${safeName(fileName)}`;
}

export async function ensureBucket(): Promise<void> {
  const client = storage();
  const { data } = await client.storage.listBuckets();
  if (data?.some((b) => b.name === BUCKET)) return;
  const { error } = await client.storage.createBucket(BUCKET, { public: false });
  // ถ้ามีคนสร้างพร้อมกันจะได้ error ว่ามีอยู่แล้ว ซึ่งไม่ใช่ปัญหา
  if (error && !/already exists/i.test(error.message)) throw error;
}

export async function uploadFile(
  key: string, body: Buffer | Uint8Array, contentType: string,
): Promise<void> {
  const { error } = await storage().storage.from(BUCKET).upload(key, body, {
    contentType: contentType || 'application/octet-stream',
    upsert: true,
  });
  if (error) throw new Error(`อัปโหลดไฟล์ไม่สำเร็จ: ${error.message}`);
}

export async function downloadFile(key: string): Promise<{ body: Buffer; contentType: string }> {
  const { data, error } = await storage().storage.from(BUCKET).download(key);
  if (error || !data) throw new Error(`ดาวน์โหลดไฟล์ไม่สำเร็จ: ${error?.message ?? 'ไม่พบไฟล์'}`);
  return {
    body: Buffer.from(await data.arrayBuffer()),
    contentType: data.type || 'application/octet-stream',
  };
}

export async function removeFile(key: string): Promise<void> {
  await storage().storage.from(BUCKET).remove([key]);
}
