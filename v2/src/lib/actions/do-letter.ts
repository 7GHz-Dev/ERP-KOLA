'use server';

import { revalidatePath } from 'next/cache';
import { requireActiveSession } from '@/lib/auth';
import {
  DO_LETTER_FIELDS, DO_LETTER_TYPE, LETTER_BLOCKS, SHIPPING_LINES,
  blockCode, lineKey, saveDoLetterValue,
} from '@/lib/do-letter';
import { logActivity, newId, runAction, text } from './common';

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
