import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { files } from '@/db/schema';
import { newId } from '@/lib/actions/common';
import { buildKey, ensureBucket, uploadFile } from '@/lib/storage';

/**
 * เก็บไฟล์เข้างานเป็นเวอร์ชันใหม่ของหมวดนั้น — ใบเดิมยังอยู่ ถูกตั้งเป็นเวอร์ชันก่อนหน้า
 *
 * ใช้ร่วมกันระหว่างการอัปโหลดทั่วไป (actions/files.ts) กับไฟล์ที่ระบบสร้างเอง เช่น Create Cargo Invoice
 * ไม่ตรวจสิทธิ์และไม่ทำเรื่องข้างเคียงของแต่ละหมวด (แปลง PDF · แจ้งเตือน) — ผู้เรียกทำเอง
 * multi = หมวดที่มีหลายไฟล์ต่องานได้ (Slip ฯลฯ) อัปเพิ่มแล้วไม่ทับใบเดิม
 */
export async function storeJobFileVersion(input: {
  jobId: string; category: string; bytes: Buffer; fileName: string; mimeType: string;
  userId: string; note?: string; changeReason?: string; multi?: boolean; isAcknowledged?: boolean;
}) {
  const [current] = input.multi ? [] : await db
    .select()
    .from(files)
    .where(and(eq(files.jobId, input.jobId), eq(files.category, input.category), eq(files.isCurrent, true)))
    .limit(1);

  const id = newId('FIL');
  const version = (current?.version ?? 0) + 1;
  const key = buildKey(input.jobId, input.category, id, input.fileName);

  await ensureBucket();
  await uploadFile(key, input.bytes, input.mimeType);

  await db.insert(files).values({
    id, jobId: input.jobId, category: input.category, version,
    storageKey: key,
    fileName: input.fileName,
    mimeType: input.mimeType || 'application/octet-stream',
    sizeBytes: input.bytes.length,
    note: input.note ?? '',
    changeReason: current ? input.changeReason ?? '' : '',
    isCurrent: true,
    isAcknowledged: input.isAcknowledged ?? true,
    uploadedBy: input.userId,
  });

  if (current) {
    await db.update(files)
      .set({ isCurrent: false, supersededBy: id })
      .where(eq(files.id, current.id));
  }
  return { id, version, current: current ?? null };
}
