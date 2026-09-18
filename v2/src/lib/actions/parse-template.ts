'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { masterRecords } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import { TEMPLATE_FIELD_KEYS, type TemplateArea, type TemplateFieldKey } from '@/lib/parse-template';
import { PARSE_TEMPLATE_TYPE, serializeAreas } from '@/lib/parse-template-store';
import { logActivity, newId, runAction, text } from './common';

/**
 * บันทึกแบบร่างพื้นที่อ่านค่า
 *
 * กรอบถูกลากบนหน้าจอฝั่งเบราว์เซอร์ ส่งมาเป็น JSON ก้อนเดียว
 * ตรวจทุกค่าที่รับมาอีกครั้งที่นี่ เพราะค่าที่ส่งจากหน้าจอแก้ได้ก่อนส่ง
 */
function readAreas(raw: string): TemplateArea[] {
  let data: unknown;
  try {
    data = JSON.parse(raw || '[]');
  } catch {
    throw new Error('ข้อมูลกรอบไม่ถูกต้อง');
  }
  if (!Array.isArray(data)) throw new Error('ข้อมูลกรอบไม่ถูกต้อง');
  if (data.length > 60) throw new Error('กรอบมากเกินไป (ไม่เกิน 60 กรอบ)');

  const out: TemplateArea[] = [];
  for (const item of data) {
    const row = (item ?? {}) as Record<string, unknown>;
    const field = String(row.field ?? '');
    if (!TEMPLATE_FIELD_KEYS.includes(field as TemplateFieldKey)) {
      throw new Error(`ไม่รู้จักช่อง "${field}"`);
    }
    const page = Number(row.page);
    const x = Number(row.x); const y = Number(row.y);
    const w = Number(row.w); const h = Number(row.h);
    if (!Number.isInteger(page) || page < 1 || page > 50) throw new Error('เลขหน้าไม่ถูกต้อง');
    if ([x, y, w, h].some((v) => !Number.isFinite(v))) throw new Error('พิกัดกรอบไม่ถูกต้อง');
    if (w <= 0 || h <= 0) throw new Error('กรอบต้องมีขนาด ลากให้กว้างกว่านี้');
    if (x < 0 || y < 0 || x + w > 1.0001 || y + h > 1.0001) throw new Error('กรอบอยู่นอกหน้ากระดาษ');
    out.push({ field: field as TemplateFieldKey, page, x, y, w, h });
  }
  return out;
}

async function saveParseTemplateImpl(formData: FormData) {
  const user = await requireActiveSession(['ADMIN']);

  const id = text(formData.get('id'), 40);
  const name = text(formData.get('name'), 120);
  if (!name) throw new Error('กรุณาตั้งชื่อแบบร่าง');

  /*
   * คำที่ใช้จับแบบ — ต้องมีอย่างน้อยหนึ่งคำ ไม่งั้นแบบนี้จะไม่ถูกเลือกใช้เลย
   * และคำสั้นเกินไปจะไปตรงกับเอกสารทุกใบ ทำให้จับแบบผิด
   */
  const matchLines = text(formData.get('match'), 500)
    .split('\n').map((v) => v.trim()).filter(Boolean);
  if (!matchLines.length) throw new Error('กรุณาใส่คำที่ใช้จับแบบ อย่างน้อย 1 คำ');
  const tooShort = matchLines.find((v) => v.length < 3);
  if (tooShort) throw new Error(`คำที่ใช้จับแบบต้องยาวอย่างน้อย 3 ตัวอักษร ("${tooShort}" สั้นเกินไป)`);

  const areas = readAreas(text(formData.get('areas'), 20000));
  if (!areas.length) throw new Error('กรุณาลากกรอบอย่างน้อย 1 ช่อง');

  const isActive = formData.get('isActive') !== null;
  const value = serializeAreas(areas);
  const description = matchLines.join('\n');

  if (id) {
    const [existing] = await db.select({ id: masterRecords.id }).from(masterRecords)
      .where(and(eq(masterRecords.type, PARSE_TEMPLATE_TYPE), eq(masterRecords.id, id))).limit(1);
    if (!existing) throw new Error('ไม่พบแบบร่างนี้');
    await db.update(masterRecords)
      .set({ name, description, value, isActive, updatedAt: new Date() })
      .where(eq(masterRecords.id, id));
    await logActivity(user.id, 'UPDATE_PARSE_TEMPLATE', PARSE_TEMPLATE_TYPE, id, {
      name, areas: areas.length,
    });
  } else {
    const newRecordId = newId('MD');
    await db.insert(masterRecords).values({
      id: newRecordId, type: PARSE_TEMPLATE_TYPE, code: null,
      name, description, value, isActive,
    });
    await logActivity(user.id, 'CREATE_PARSE_TEMPLATE', PARSE_TEMPLATE_TYPE, newRecordId, {
      name, areas: areas.length,
    });
  }

  revalidatePath('/master/parse-template');
  redirect(`/master/parse-template?ok=${encodeURIComponent(
    `บันทึก "${name}" แล้ว · ${areas.length} กรอบ`,
  )}`);
}

export async function saveParseTemplate(formData: FormData) {
  return runAction(() => saveParseTemplateImpl(formData));
}

async function deleteParseTemplateImpl(formData: FormData) {
  const user = await requireActiveSession(['ADMIN']);
  const id = text(formData.get('id'), 40);
  if (!id) throw new Error('ไม่พบแบบร่างที่จะลบ');

  const [existing] = await db.select({ name: masterRecords.name }).from(masterRecords)
    .where(and(eq(masterRecords.type, PARSE_TEMPLATE_TYPE), eq(masterRecords.id, id))).limit(1);
  if (!existing) throw new Error('ไม่พบแบบร่างนี้');

  await db.delete(masterRecords).where(eq(masterRecords.id, id));
  await logActivity(user.id, 'DELETE_PARSE_TEMPLATE', PARSE_TEMPLATE_TYPE, id, { name: existing.name });

  revalidatePath('/master/parse-template');
  redirect(`/master/parse-template?ok=${encodeURIComponent(`ลบ "${existing.name}" แล้ว`)}`);
}

export async function deleteParseTemplate(formData: FormData) {
  return runAction(() => deleteParseTemplateImpl(formData));
}
