'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { db } from '@/db';
import { masterRecords } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import {
  EOFFICE_FORM_FIELDS, EOFFICE_FORM_TYPE, OVERLAY_SLOTS, slotCode,
  TEMPLATE_AT, TEMPLATE_KEY, TEMPLATE_NAME,
} from '@/lib/eoffice-form';
import { ensureBucket, removeFile, safeName, uploadFile } from '@/lib/storage';
import { logActivity, newId, number, runAction, text } from './common';

const MAX_TEMPLATE_BYTES = 8 * 1024 * 1024;

/** แบบฟอร์มพื้นหลังไม่ผูกกับงานใดงานหนึ่ง จึงอยู่นอกโฟลเดอร์ของงาน */
const TEMPLATE_PREFIX = '_form-templates';

/**
 * บันทึกแบบฟอร์มปะหน้าที่ผู้ดูแลแก้จากหน้า /master/eoffice
 *
 * เก็บทีละช่องใน master_records (type = eofficeForm, code = ชื่อช่อง)
 * ช่องที่เว้นว่างไว้ = ใช้ค่าเริ่มต้นตามแบบฟอร์มเดิม จึงบันทึกเป็นค่าว่างไปตรง ๆ
 * ไม่ต้องเดาว่าผู้ใช้ตั้งใจลบหรือแค่ยังไม่ได้กรอก
 */
async function saveEofficeFormImpl(formData: FormData) {
  const user = await requireActiveSession(['ADMIN']);

  // ทั้งช่องกรอกปกติและพิกัดบนแบบฟอร์มพื้นหลังเก็บด้วยวิธีเดียวกัน ต่างกันแค่ที่มาของโค้ด
  const values: Array<{ field: { key: string; label: string }; value: string }> =
    EOFFICE_FORM_FIELDS.map((field) => {
      const raw = text(formData.get(field.key), 500);
      if (field.kind === 'number' && raw) {
        const n = Number(raw);
        if (!Number.isFinite(n) || n <= 0) {
          throw new Error(`${field.label} ต้องเป็นตัวเลขมากกว่า 0`);
        }
        return { field, value: String(n) };
      }
      return { field, value: raw };
    });

  /*
   * พิกัดของค่าบนแบบฟอร์มพื้นหลัง
   * ต่างจากช่องอื่นตรงที่ 0 เป็นค่าที่ใช้ได้จริง (ชิดขอบซ้าย / ความกว้างไม่จำกัด)
   * จึงตรวจแค่ว่าเป็นตัวเลขและไม่ติดลบ
   */
  for (const slot of OVERLAY_SLOTS) {
    for (const part of ['x', 'y', 'w'] as const) {
      const code = slotCode(slot.key, part);
      const raw = text(formData.get(code), 20);
      if (!raw) {
        values.push({ field: { key: code, label: slot.label }, value: '' });
        continue;
      }
      const n = number(raw, NaN);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error(`พิกัดของ ${slot.label} ต้องเป็นตัวเลขไม่ติดลบ`);
      }
      values.push({ field: { key: code, label: `${slot.label} (${part})` }, value: String(n) });
    }
    const alignCode = slotCode(slot.key, 'align');
    const align = text(formData.get(alignCode), 10);
    values.push({
      field: { key: alignCode, label: `${slot.label} (ชิด)` },
      value: align === 'center' || align === 'left' ? align : '',
    });
  }

  const changed: string[] = [];
  await db.transaction(async (tx) => {
    for (const { field, value } of values) {
      const [existing] = await tx
        .select({ id: masterRecords.id, value: masterRecords.value })
        .from(masterRecords)
        .where(and(
          eq(masterRecords.type, EOFFICE_FORM_TYPE),
          eq(masterRecords.code, field.key),
        ))
        .limit(1);

      if (existing) {
        if ((existing.value ?? '') === value) continue;
        changed.push(field.key);
        await tx.update(masterRecords)
          .set({ name: field.label, value, isActive: true, updatedAt: new Date() })
          .where(eq(masterRecords.id, existing.id));
      } else {
        if (!value) continue;
        changed.push(field.key);
        await tx.insert(masterRecords).values({
          id: newId('MD'),
          type: EOFFICE_FORM_TYPE,
          code: field.key,
          name: field.label,
          value,
        });
      }
    }
  });

  await logActivity(user.id, 'UPDATE_EOFFICE_FORM', EOFFICE_FORM_TYPE, 'form', { changed });

  revalidatePath('/master/eoffice');
  revalidatePath('/eoffice/[jobId]', 'page');
  redirect(`/master/eoffice?ok=${encodeURIComponent(
    changed.length ? `บันทึกแล้ว ${changed.length} ช่อง` : 'ไม่มีอะไรเปลี่ยน',
  )}`);
}

export async function saveEofficeForm(formData: FormData) {
  return runAction(() => saveEofficeFormImpl(formData));
}

/** ล้างค่าที่แก้ไว้ทั้งหมด กลับไปใช้แบบฟอร์มเริ่มต้น */
async function resetEofficeFormImpl() {
  const user = await requireActiveSession(['ADMIN']);
  // เก็บแถวของแบบฟอร์มพื้นหลังไว้ ไฟล์ที่อัปโหลดมีปุ่มเอาออกของตัวเองแยกต่างหาก
  await db.delete(masterRecords).where(and(
    eq(masterRecords.type, EOFFICE_FORM_TYPE),
    notInArray(masterRecords.code, [TEMPLATE_KEY, TEMPLATE_NAME, TEMPLATE_AT]),
  ));
  await logActivity(user.id, 'RESET_EOFFICE_FORM', EOFFICE_FORM_TYPE, 'form');

  revalidatePath('/master/eoffice');
  revalidatePath('/eoffice/[jobId]', 'page');
  redirect('/master/eoffice?ok=' + encodeURIComponent('กลับไปใช้แบบฟอร์มเริ่มต้นแล้ว'));
}

export async function resetEofficeForm() {
  return runAction(() => resetEofficeFormImpl());
}

/* ---------------- แบบฟอร์มพื้นหลัง ---------------- */

/** เขียนค่าที่ระบบดูแลเอง (ไม่ใช่ช่องกรอก) ลง master_records */
async function setCodes(entries: Array<[code: string, value: string]>) {
  for (const [code, value] of entries) {
    const [existing] = await db
      .select({ id: masterRecords.id })
      .from(masterRecords)
      .where(and(eq(masterRecords.type, EOFFICE_FORM_TYPE), eq(masterRecords.code, code)))
      .limit(1);
    if (existing) {
      await db.update(masterRecords)
        .set({ value, isActive: true, updatedAt: new Date() })
        .where(eq(masterRecords.id, existing.id));
    } else {
      await db.insert(masterRecords).values({
        id: newId('MD'), type: EOFFICE_FORM_TYPE, code, name: 'แบบฟอร์มพื้นหลัง', value,
      });
    }
  }
}

/**
 * อัปโหลดแบบฟอร์มปะหน้าเป็น PDF เพื่อใช้เป็นพื้นหลัง
 *
 * รับเฉพาะ PDF เพราะเป็นชนิดเดียวที่เอามาเป็นหน้ากระดาษได้ตรง ๆ โดยไม่ต้องแปลง
 * ถ้าต้นฉบับเป็น Word ให้ Save as PDF จาก Word ก่อน หน้าตาจะตรงกับที่พิมพ์ออกมาที่สุด
 */
async function uploadEofficeTemplateImpl(formData: FormData) {
  const user = await requireActiveSession(['ADMIN']);

  const blob = formData.get('template');
  if (!(blob instanceof File) || blob.size === 0) throw new Error('กรุณาเลือกไฟล์');
  if (blob.size > MAX_TEMPLATE_BYTES) throw new Error('ไฟล์ต้องมีขนาดไม่เกิน 8 MB');

  const bytes = Buffer.from(await blob.arrayBuffer());
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('ต้องเป็นไฟล์ PDF — ถ้าเป็น Word ให้ Save as PDF จาก Word ก่อน');
  }

  // เปิดดูก่อนว่าอ่านออกจริง จะได้ไม่ไปพังตอนออกคำร้องใบแรก
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
    .where(and(eq(masterRecords.type, EOFFICE_FORM_TYPE), eq(masterRecords.code, TEMPLATE_KEY)))
    .limit(1);

  await setCodes([
    [TEMPLATE_KEY, key],
    [TEMPLATE_NAME, blob.name],
    [TEMPLATE_AT, new Date().toISOString()],
  ]);

  // ลบของเดิมหลังบันทึกตัวใหม่แล้ว ถ้าลบก่อนแล้วบันทึกพลาดจะไม่เหลืออะไรเลย
  if (previous?.value && previous.value !== key) await removeFile(previous.value).catch(() => {});

  await logActivity(user.id, 'UPLOAD_EOFFICE_TEMPLATE', EOFFICE_FORM_TYPE, 'form', {
    fileName: blob.name, pages, bytes: bytes.length,
  });

  revalidatePath('/master/eoffice');
  revalidatePath('/eoffice/[jobId]', 'page');
  redirect(`/master/eoffice?ok=${encodeURIComponent(
    `อัปโหลดแบบฟอร์มพื้นหลังแล้ว (${pages} หน้า) — ตรวจตำแหน่งค่าด้วยปุ่มดูตัวอย่าง`,
  )}`);
}

export async function uploadEofficeTemplate(formData: FormData) {
  return runAction(() => uploadEofficeTemplateImpl(formData));
}

/** เอาแบบฟอร์มพื้นหลังออก กลับไปให้ระบบวาดทั้งใบเอง */
async function removeEofficeTemplateImpl() {
  const user = await requireActiveSession(['ADMIN']);

  const [current] = await db
    .select({ value: masterRecords.value })
    .from(masterRecords)
    .where(and(eq(masterRecords.type, EOFFICE_FORM_TYPE), eq(masterRecords.code, TEMPLATE_KEY)))
    .limit(1);
  if (!current?.value) throw new Error('ยังไม่ได้อัปโหลดแบบฟอร์มพื้นหลังไว้');

  await db.delete(masterRecords).where(and(
    eq(masterRecords.type, EOFFICE_FORM_TYPE),
    inArray(masterRecords.code, [TEMPLATE_KEY, TEMPLATE_NAME, TEMPLATE_AT]),
  ));
  await removeFile(current.value).catch(() => {});
  await logActivity(user.id, 'REMOVE_EOFFICE_TEMPLATE', EOFFICE_FORM_TYPE, 'form');

  revalidatePath('/master/eoffice');
  revalidatePath('/eoffice/[jobId]', 'page');
  redirect(`/master/eoffice?ok=${encodeURIComponent('เอาแบบฟอร์มพื้นหลังออกแล้ว ระบบจะวาดทั้งใบเอง')}`);
}

export async function removeEofficeTemplate() {
  return runAction(() => removeEofficeTemplateImpl());
}
