import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { masterRecords } from '@/db/schema';
import {
  TEMPLATE_FIELD_KEYS, type ParseTemplate, type TemplateArea, type TemplateFieldKey,
} from '@/lib/parse-template';

/**
 * ที่เก็บแบบร่างพื้นที่อ่านค่า
 *
 * เก็บใน master_records แบบเดียวกับฟอร์มปะหน้า E-Office และฟอร์มจดหมายแลก D/O
 * หนึ่งแถวคือหนึ่งแบบร่าง — ชื่ออยู่ในช่อง name คำที่ใช้จับแบบอยู่ใน description
 * และกรอบทั้งหมดเก็บเป็น JSON ในช่อง value
 *
 * ไม่ทำตารางใหม่เพราะข้อมูลชุดนี้เป็นค่าตั้งค่าของระบบ ไม่ใช่ข้อมูลงาน
 * และ db:push ของโครงการนี้ใช้ไม่ได้อยู่ (drizzle-kit อ่าน CHECK constraint ไม่ผ่าน)
 * การเพิ่มตารางจึงต้องไปแก้ฐานข้อมูลด้วยมือ ซึ่งเสี่ยงกว่าการใช้ที่เก็บเดิมที่มีอยู่แล้ว
 */

export const PARSE_TEMPLATE_TYPE = 'parseTemplate';

/**
 * อ่านกรอบจาก JSON ที่เก็บไว้
 *
 * ข้อมูลในฐานถูกเขียนโดยรุ่นก่อนหน้าได้ จึงตรวจทุกค่าก่อนใช้ ไม่เชื่อว่าถูกต้องเสมอ
 * กรอบที่พิกัดเพี้ยนหรือชื่อช่องไม่รู้จักถูกข้ามไป ดีกว่าทำให้หน้าทั้งหน้าพัง
 */
function parseAreas(raw: string | null): TemplateArea[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];

  const out: TemplateArea[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const field = String(row.field ?? '');
    if (!TEMPLATE_FIELD_KEYS.includes(field as TemplateFieldKey)) continue;

    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
    const page = Math.trunc(num(row.page));
    const x = num(row.x); const y = num(row.y);
    const w = num(row.w); const h = num(row.h);
    if (!Number.isFinite(page) || page < 1) continue;
    if ([x, y, w, h].some((v) => !Number.isFinite(v))) continue;
    // กรอบต้องมีพื้นที่จริงและอยู่ในหน้ากระดาษ
    if (w <= 0 || h <= 0 || x < 0 || y < 0 || x + w > 1.0001 || y + h > 1.0001) continue;

    out.push({ field: field as TemplateFieldKey, page, x, y, w, h });
  }
  return out;
}

/** คำที่ใช้จับแบบ เก็บเป็นบรรทัดละคำ — ว่างแปลว่าแบบนี้จับอัตโนมัติไม่ได้ */
function parseMatch(raw: string | null): string[] {
  return String(raw ?? '')
    .split('\n')
    .map((v) => v.trim())
    .filter(Boolean);
}

export function serializeAreas(areas: TemplateArea[]): string {
  // ปัดทศนิยมให้สั้นลง พิกัดละเอียดกว่านี้ไม่มีผลกับการอ่าน แต่ทำให้ JSON ยาวขึ้นเปล่า ๆ
  const round = (v: number) => Math.round(v * 10000) / 10000;
  return JSON.stringify(areas.map((a) => ({
    field: a.field, page: a.page, x: round(a.x), y: round(a.y), w: round(a.w), h: round(a.h),
  })));
}

function toTemplate(row: {
  id: string; name: string; description: string | null; value: string | null; isActive: boolean;
}): ParseTemplate {
  return {
    id: row.id,
    name: row.name,
    match: parseMatch(row.description),
    areas: parseAreas(row.value),
    isActive: row.isActive,
  };
}

/** แบบร่างทั้งหมด รวมที่ปิดใช้งานไว้ — สำหรับหน้าตั้งค่า */
export async function listParseTemplates(): Promise<ParseTemplate[]> {
  const rows = await db
    .select({
      id: masterRecords.id, name: masterRecords.name,
      description: masterRecords.description, value: masterRecords.value,
      isActive: masterRecords.isActive,
    })
    .from(masterRecords)
    .where(eq(masterRecords.type, PARSE_TEMPLATE_TYPE))
    .orderBy(asc(masterRecords.name));
  return rows.map(toTemplate);
}

/** แบบร่างที่เปิดใช้งาน — สำหรับตอนอ่านไฟล์จริง */
export async function activeParseTemplates(): Promise<ParseTemplate[]> {
  const rows = await db
    .select({
      id: masterRecords.id, name: masterRecords.name,
      description: masterRecords.description, value: masterRecords.value,
      isActive: masterRecords.isActive,
    })
    .from(masterRecords)
    .where(and(eq(masterRecords.type, PARSE_TEMPLATE_TYPE), eq(masterRecords.isActive, true)))
    .orderBy(asc(masterRecords.name));
  return rows.map(toTemplate).filter((t) => t.areas.length > 0);
}

export async function getParseTemplate(id: string): Promise<ParseTemplate | null> {
  const [row] = await db
    .select({
      id: masterRecords.id, name: masterRecords.name,
      description: masterRecords.description, value: masterRecords.value,
      isActive: masterRecords.isActive,
    })
    .from(masterRecords)
    .where(and(eq(masterRecords.type, PARSE_TEMPLATE_TYPE), eq(masterRecords.id, id)))
    .limit(1);
  return row ? toTemplate(row) : null;
}
