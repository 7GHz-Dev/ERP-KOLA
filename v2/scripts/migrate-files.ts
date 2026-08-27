/**
 * ย้ายไฟล์จาก Google Drive เข้า Supabase Storage
 *
 * ดึงผ่าน downloadJobFile() ของระบบเดิม ไม่ต้องเปิดสิทธิ์ Drive ให้ใครเพิ่ม
 * รันซ้ำได้ ไฟล์ที่ย้ายแล้ว (storage_key ไม่ขึ้นต้นด้วย drive:) จะถูกข้าม
 *
 *   npm run migrate:files -- --dry   ดูว่ามีอะไรต้องย้ายบ้าง
 *   npm run migrate:files            ย้ายจริง
 */
import { loadEnv } from '../src/lib/env';
loadEnv();

import { eq, like, sql } from 'drizzle-orm';
import { db } from '../src/db';
import { files } from '../src/db/schema';
import { buildKey, ensureBucket, uploadFile } from '../src/lib/storage';

const DRY = process.argv.includes('--dry');

async function call(fn: string, args: unknown[]): Promise<any> {
  const res = await fetch(process.env.LEGACY_EXEC_URL!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fn, args }),
    redirect: 'follow',
  });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`ระบบเดิมตอบกลับไม่ใช่ JSON: ${text.slice(0, 160)}`);
  }
  if (!body.ok) throw new Error(String(body.error));
  return body.data;
}

async function main() {
  for (const key of ['LEGACY_EXEC_URL', 'LEGACY_ADMIN_USERNAME', 'LEGACY_ADMIN_PASSWORD']) {
    if (!process.env[key]) throw new Error(`ต้องตั้ง ${key} ใน .env.local`);
  }

  const pending = await db
    .select({
      id: files.id, jobId: files.jobId, category: files.category,
      fileName: files.fileName, mimeType: files.mimeType, sizeBytes: files.sizeBytes,
    })
    .from(files)
    .where(like(files.storageKey, 'drive:%'));

  const [{ done }] = await db
    .select({ done: sql<number>`count(*)::int` })
    .from(files)
    .where(sql`${files.storageKey} not like 'drive:%'`);

  console.log(`ไฟล์ที่ย้ายแล้ว : ${done}`);
  console.log(`ไฟล์ที่ต้องย้าย : ${pending.length}\n`);
  if (!pending.length) {
    console.log('ไม่มีอะไรต้องย้าย');
    return;
  }
  if (DRY) {
    pending.slice(0, 20).forEach((f) =>
      console.log(`   ${f.category.padEnd(20)} ${f.fileName} (${f.sizeBytes ?? '?'} bytes)`));
    if (pending.length > 20) console.log(`   ... และอีก ${pending.length - 20} ไฟล์`);
    console.log('\n--dry: ไม่ได้ย้ายอะไร');
    return;
  }

  await ensureBucket();
  const login = await call('authLogin', [process.env.LEGACY_ADMIN_USERNAME, process.env.LEGACY_ADMIN_PASSWORD]);

  let moved = 0;
  const failures: string[] = [];

  for (const file of pending) {
    try {
      const blob = await call('downloadJobFile', [login.token, file.id]);
      const body = Buffer.from(blob.base64, 'base64');
      const key = buildKey(file.jobId, file.category, file.id, file.fileName);

      await uploadFile(key, body, blob.mimeType || file.mimeType || 'application/octet-stream');
      await db.update(files).set({
        storageKey: key,
        mimeType: blob.mimeType || file.mimeType,
        // ขนาดจริงจากไฟล์ที่โหลดมา เชื่อถือได้กว่าค่าที่บันทึกไว้เดิม
        sizeBytes: body.length,
      }).where(eq(files.id, file.id));

      moved += 1;
      console.log(`   ${String(moved).padStart(3)}/${pending.length}  ${file.fileName}`);
    } catch (error: any) {
      failures.push(`${file.fileName}: ${error.message}`);
      console.log(`   ข้าม  ${file.fileName} — ${error.message}`);
    }
  }

  console.log(`\nย้ายสำเร็จ ${moved} ไฟล์`);
  if (failures.length) {
    console.log(`ย้ายไม่ได้ ${failures.length} ไฟล์:`);
    failures.forEach((f) => console.log(`   ${f}`));
    console.log('\nไฟล์ที่ย้ายไม่ได้ยังชี้ไป Drive อยู่ รันคำสั่งนี้ซ้ำได้ ระบบจะลองเฉพาะตัวที่ค้าง');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error('\nล้มเหลว:', e.message); process.exit(1); });
