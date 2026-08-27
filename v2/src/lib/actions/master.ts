'use server';

import { revalidatePath } from 'next/cache';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { masterRecords } from '@/db/schema';
import { requireActiveSession } from '@/lib/auth';
import { MASTER_TYPES } from '@/lib/queries/master';
import { logActivity, newId, required, runAction, text } from './common';

/**
 * เพิ่มและแก้ Master Data ทุกหัวข้อ
 *
 * รหัสเว้นว่างได้ ระบบจะรันต่อจากเลขสูงสุดที่ใช้อยู่ในหัวข้อนั้น
 * (ไม่ใช่นับจำนวนแถว เพราะถ้าเคยลบแถวไปเลขจะชนกับของเดิม)
 */
const CODE_PREFIX: Record<string, string> = {
  shippers: 'SHP',
  consignees: 'CNE',
  notify: 'NTP',
  people: 'PSN',
  ports: 'PORT',
  terminals: 'TML',
  jobTypes: 'JT',
  partners: 'PTN',
  loadingTypes: 'LT',
  containerTypes: 'CT',
  packageTypes: 'PKG',
  settings: 'SET',
};

async function nextCode(type: string): Promise<string> {
  const prefix = CODE_PREFIX[type] ?? 'MD';
  const [row] = await db
    .select({
      max: sql<number>`coalesce(max(nullif(regexp_replace(code, ${`^${prefix}`}, ''), '')::int), 0)`,
    })
    .from(masterRecords)
    .where(and(eq(masterRecords.type, type), sql`code ~ ${`^${prefix}[0-9]+$`}`));
  return `${prefix}${String(Number(row?.max ?? 0) + 1).padStart(4, '0')}`;
}

async function saveMasterRecordImpl(formData: FormData) {
  const user = await requireActiveSession(['ADMIN']);
  const type = required(formData.get('type'), 'หัวข้อ', 40);
  if (!MASTER_TYPES.some((t) => t.key === type)) throw new Error('หัวข้อไม่ถูกต้อง');

  const id = text(formData.get('id'), 80);
  const name = required(formData.get('name'), 'ชื่อ', 200);
  const description = text(formData.get('description'), 500);
  const value = text(formData.get('value'), 500);
  const isActive = text(formData.get('isActive'), 4) !== '0';
  let code = text(formData.get('code'), 60).toUpperCase();

  // ชื่อซ้ำในหัวข้อเดียวกันไม่ได้ เพราะทุกหน้าจอเลือกจากชื่อ
  const [dup] = await db
    .select({ id: masterRecords.id })
    .from(masterRecords)
    .where(and(
      eq(masterRecords.type, type),
      sql`upper(${masterRecords.name}) = ${name.toUpperCase()}`,
      id ? sql`${masterRecords.id} <> ${id}` : sql`true`,
    ))
    .limit(1);
  if (dup) throw new Error(`มี "${name}" อยู่ในหัวข้อนี้แล้ว`);

  if (id) {
    const [existing] = await db.select().from(masterRecords)
      .where(eq(masterRecords.id, id)).limit(1);
    if (!existing) throw new Error('ไม่พบรายการที่จะแก้');
    await db.update(masterRecords)
      .set({ code: code || existing.code, name, description, value, isActive, updatedAt: new Date() })
      .where(eq(masterRecords.id, id));
    await logActivity(user.id, 'UPDATE_MASTER', type, id, { name });
  } else {
    if (!code) code = await nextCode(type);
    const created = newId('MD');
    await db.insert(masterRecords).values({
      id: created, type, code, name, description, value, isActive,
    });
    await logActivity(user.id, 'CREATE_MASTER', type, created, { code, name });
  }

  revalidatePath('/master');
  revalidatePath('/intake/an');
  revalidatePath('/intake/bl');
  revalidatePath('/fah/do');
}

export async function saveMasterRecord(formData: FormData) {
  return runAction(() => saveMasterRecordImpl(formData));
}
