'use server';

import { revalidatePath } from 'next/cache';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { jobs } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import {
  DO_LETTER_FIELDS, LETTER_BLOCKS, SHIPPING_LINES,
  blockCode, lineKey, saveDoLetterValues,
} from '@/lib/do-letter';
import { storeDoLetterPdf } from '@/lib/do-letter-store';
import { logActivity, newId, runAction, text } from './common';

/**
 * บันทึกแบบฟอร์มจดหมายแลก D/O จากหน้า /master/do-letter
 *
 * ช่องที่เว้นว่าง = กลับไปใช้ค่าที่สืบทอดมา (ค่ากลาง แล้วค่าตั้งต้นในโค้ด)
 * จึงลบแถวนั้นทิ้งแทนการเก็บค่าว่าง เพื่อไม่ให้ค่าว่างไปบังค่ากลาง
 *
 * รวบทุกช่องใส่ Map ก่อนแล้วค่อยยิงทีเดียว — เดิมบันทึกทีละช่องจนกดทีรอหลายวินาที
 */
async function saveDoLetterFormImpl(formData: FormData) {
  const user = await requireActiveSession(['ADMIN']);
  const line = text(formData.get('line'), 60);
  if (line && !SHIPPING_LINES.includes(line as (typeof SHIPPING_LINES)[number])) {
    throw new Error('ไม่พบสายเรือที่เลือก');
  }

  const entries = new Map<string, string>();
  /** ช่องที่ฟอร์มไม่ได้ส่งมาต้องคงค่าเดิมไว้ ไม่ใช่ลบทิ้ง */
  const collect = (field: string, maxLength: number) => {
    if (!formData.has(field)) return;
    entries.set(line ? lineKey(line, field) : field, text(formData.get(field), maxLength));
  };

  for (const field of DO_LETTER_FIELDS) {
    if (line && field.sharedOnly) continue;
    collect(field.key, 4000);
  }

  // พิกัดของแต่ละบล็อก — ว่าง = กลับไปใช้ตำแหน่งเริ่มต้น
  for (const block of LETTER_BLOCKS) {
    for (const part of ['x', 'y', 'gap'] as const) collect(blockCode(block.key, part), 12);
  }

  await saveDoLetterValues(entries, () => newId('MD'));

  await logActivity(user.id, 'SAVE_DO_LETTER_FORM', 'doLetterForm', line || 'shared', { line });
  revalidatePath('/master/do-letter');
}

export async function saveDoLetterForm(formData: FormData) {
  return runAction(() => saveDoLetterFormImpl(formData));
}

/*
 * แก้ข้อความบนจดหมายแลก D/O ของงานหนึ่ง แล้วออกจดหมายใหม่ทันที
 *
 * เก็บค่าที่แก้ไว้กับงาน ไม่ไปแตะ blNo / eta / vessel ตัวจริง
 * เพราะสายเรือขอให้แก้ถ้อยคำบนจดหมายไม่ได้แปลว่าข้อมูลงานผิด
 * ตารางงาน ใบขน และชุด E-Office จึงยังเห็นค่าเดิมทุกที่
 *
 * ช่องที่ล้างจนว่างคือขอให้กลับไปใช้ค่าจากงาน จึงเก็บเป็น null ไม่ใช่สตริงว่าง
 * ออกจดหมายใหม่ให้เลยในคำสั่งเดียว ผู้ใช้จะได้ไม่ต้องกดสองครั้งแล้วลืมกดปุ่มที่สอง
 */
async function saveDoLetterTextImpl(formData: FormData) {
  const user = await requireActiveSession(['ANN']);
  const jobId = text(formData.get('jobId'), 80);
  if (!jobId) throw new Error('ไม่พบงาน');

  const field = (name: string) => text(formData.get(name), 200) || null;

  await db.update(jobs).set({
    doLetterBlNo: field('blNo'),
    doLetterOrigin: field('origin'),
    doLetterDestination: field('destination'),
    doLetterVessel: field('vessel'),
    doLetterEta: field('eta'),
    updatedAt: new Date(),
  }).where(eq(jobs.id, jobId));

  const { id } = await storeDoLetterPdf(jobId, user.id);
  await logActivity(user.id, 'EDIT_DO_LETTER_TEXT', 'JOB', jobId, { fileId: id });

  revalidatePath('/do-exchange');
  revalidatePath(`/do-exchange/${jobId}/letter`);
}

export async function saveDoLetterText(formData: FormData) {
  return runAction(() => saveDoLetterTextImpl(formData));
}
