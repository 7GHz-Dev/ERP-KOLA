'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { masterRecords } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import {
  DO_LETTER_FIELDS, DO_LETTER_TYPE, LETTER_BLOCKS, SHIPPING_LINES,
  TEMPLATE_AT, TEMPLATE_KEY, TEMPLATE_NAME,
  blockCode, lineKey, saveDoLetterValue,
} from '@/lib/do-letter';
import { ensureBucket, removeFile, safeName, uploadFile } from '@/lib/storage';
import { logActivity, newId, runAction, text } from './common';

const MAX_TEMPLATE_BYTES = 8 * 1024 * 1024;

/** แบบฟอร์มพื้นหลังไม่ผูกกับงานใดงานหนึ่ง จึงอยู่นอกโฟลเดอร์ของงาน */
const TEMPLATE_PREFIX = '_form-templates';

async function setCodes(entries: Array<[code: string, value: string]>) {
  for (const [code, value] of entries) {
    const [existing] = await db
      .select({ id: masterRecords.id })
      .from(masterRecords)
      .where(and(eq(masterRecords.type, DO_LETTER_TYPE), eq(masterRecords.code, code)))
      .limit(1);
    if (existing) {
      await db.update(masterRecords)
        .set({ value, isActive: true, updatedAt: new Date() })
        .where(eq(masterRecords.id, existing.id));
    } else {
      await db.insert(masterRecords).values({
        id: newId('MD'), type: DO_LETTER_TYPE, code, name: 'แบบฟอร์มพื้นหลัง', value,
      });
    }
  }
}

/**
 * บันทึกแบบฟอร์มจดหมายแลก D/O จากหน้า /master/do-letter
 *
 * บันทึกทีละช่อง ช่องที่เว้นว่าง = กลับไปใช้ค่าที่สืบทอดมา (ค่ากลาง แล้วค่าตั้งต้นในโค้ด)
 * จึงลบแถวนั้นทิ้งแทนการเก็บค่าว่าง เพื่อไม่ให้ค่าว่างไปบังค่ากลาง
 */
async function saveDoLetterFormImpl(formData: FormData) {
  const user = await requireActiveSession(['ADMIN']);
  const line = text(formData.get('line'), 60);
  if (line && !SHIPPING_LINES.includes(line as (typeof SHIPPING_LINES)[number])) {
    throw new Error('ไม่พบสายเรือที่เลือก');
  }

  for (const field of DO_LETTER_FIELDS) {
    if (line && field.sharedOnly) continue;
    const key = line ? lineKey(line, field.key) : field.key;
    // ช่องที่ฟอร์มไม่ได้ส่งมาต้องคงค่าเดิมไว้ ไม่ใช่ลบทิ้ง
    if (!formData.has(field.key)) continue;
    await saveDoLetterValue(key, text(formData.get(field.key), 4000), () => newId('MD'));
  }

  // พิกัดของแต่ละบล็อก — ว่าง = กลับไปใช้ตำแหน่งเริ่มต้น
  for (const block of LETTER_BLOCKS) {
    for (const part of ['x', 'y', 'gap'] as const) {
      const field = blockCode(block.key, part);
      if (!formData.has(field)) continue;
      const key = line ? lineKey(line, field) : field;
      await saveDoLetterValue(key, text(formData.get(field), 12), () => newId('MD'));
    }
  }

  await logActivity(user.id, 'SAVE_DO_LETTER_FORM', 'doLetterForm', line || 'shared', { line });
  revalidatePath('/master/do-letter');
}

export async function saveDoLetterForm(formData: FormData) {
  return runAction(() => saveDoLetterFormImpl(formData));
}

/**
 * อัปโหลดกระดาษหัวจดหมายเป็น PDF เพื่อใช้เป็นพื้นหลัง
 *
 * แบบเดียวกับแบบฟอร์มปะหน้า E-Office — มีไฟล์แล้วระบบจะเติมเฉพาะค่าลงไป
 * ไม่วาดหัวจดหมายเอง หัวบริษัทและโลโก้จึงตรงกับกระดาษจริงทุกจุด
 */
async function uploadDoLetterTemplateImpl(formData: FormData) {
  const user = await requireActiveSession(['ADMIN']);

  const blob = formData.get('template');
  if (!(blob instanceof File) || blob.size === 0) throw new Error('กรุณาเลือกไฟล์');
  if (blob.size > MAX_TEMPLATE_BYTES) throw new Error('ไฟล์ต้องมีขนาดไม่เกิน 8 MB');

  const bytes = Buffer.from(await blob.arrayBuffer());
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('ต้องเป็นไฟล์ PDF — ถ้าเป็น Word ให้ Save as PDF จาก Word ก่อน');
  }

  // เปิดดูก่อนว่าอ่านออกจริง จะได้ไม่ไปพังตอนออกจดหมายใบแรก
  const { PDFDocument } = await import('@cantoo/pdf-lib');
  let pages: number;
  try {
    pages = (await PDFDocument.load(bytes, { password: '' })).getPageCount();
  } catch {
    throw new Error('เปิดไฟล์ PDF นี้ไม่ได้ อาจถูกล็อกด้วยรหัสผ่าน');
  }
  if (pages === 0) throw new Error('ไฟล์ PDF นี้ไม่มีหน้าเลย');

  const key = `${TEMPLATE_PREFIX}/${newId('TPL')}-${safeName(blob.name)}`;
  await ensureBucket();
  await uploadFile(key, bytes, 'application/pdf');

  const [previous] = await db
    .select({ value: masterRecords.value })
    .from(masterRecords)
    .where(and(eq(masterRecords.type, DO_LETTER_TYPE), eq(masterRecords.code, TEMPLATE_KEY)))
    .limit(1);

  await setCodes([
    [TEMPLATE_KEY, key],
    [TEMPLATE_NAME, blob.name],
    [TEMPLATE_AT, new Date().toISOString()],
  ]);

  // ลบของเดิมหลังบันทึกตัวใหม่แล้ว ถ้าลบก่อนแล้วบันทึกพลาดจะไม่เหลืออะไรเลย
  if (previous?.value && previous.value !== key) await removeFile(previous.value).catch(() => {});

  await logActivity(user.id, 'UPLOAD_DO_LETTER_TEMPLATE', DO_LETTER_TYPE, 'form', {
    fileName: blob.name, pages, bytes: bytes.length,
  });

  revalidatePath('/master/do-letter');
  redirect(`/master/do-letter?ok=${encodeURIComponent(
    `อัปโหลดแบบฟอร์มพื้นหลังแล้ว (${pages} หน้า) — ตรวจตำแหน่งค่าด้วยปุ่มดูตัวอย่าง`,
  )}`);
}

export async function uploadDoLetterTemplate(formData: FormData) {
  return runAction(() => uploadDoLetterTemplateImpl(formData));
}

/** เอาแบบฟอร์มพื้นหลังออก กลับไปให้ระบบวาดทั้งใบเอง */
async function removeDoLetterTemplateImpl() {
  const user = await requireActiveSession(['ADMIN']);

  const [current] = await db
    .select({ value: masterRecords.value })
    .from(masterRecords)
    .where(and(eq(masterRecords.type, DO_LETTER_TYPE), eq(masterRecords.code, TEMPLATE_KEY)))
    .limit(1);
  if (!current?.value) throw new Error('ยังไม่ได้อัปโหลดแบบฟอร์มพื้นหลังไว้');

  await db.delete(masterRecords).where(and(
    eq(masterRecords.type, DO_LETTER_TYPE),
    inArray(masterRecords.code, [TEMPLATE_KEY, TEMPLATE_NAME, TEMPLATE_AT]),
  ));
  await removeFile(current.value).catch(() => {});
  await logActivity(user.id, 'REMOVE_DO_LETTER_TEMPLATE', DO_LETTER_TYPE, 'form');

  revalidatePath('/master/do-letter');
  redirect(`/master/do-letter?ok=${encodeURIComponent('เอาแบบฟอร์มพื้นหลังออกแล้ว ระบบจะวาดทั้งใบเอง')}`);
}

export async function removeDoLetterTemplate() {
  return runAction(() => removeDoLetterTemplateImpl());
}
