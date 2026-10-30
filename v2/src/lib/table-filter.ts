/**
 * ตัวกรองตารางในหน้าเว็บ — ตรรกะล้วน ไม่แตะ DOM (components/TableFilter.tsx เป็นคนอ่านค่าจากตารางมาให้)
 *
 * ตารางแสดงครบทุกรายการแล้ว (ไม่ตัดหน้า) การกรองจึงทำในเบราว์เซอร์ได้ทันทีโดยไม่โหลดหน้าใหม่
 * ค่าของแต่ละช่อง = ข้อความที่เห็นในช่องนั้น — ใช้ได้กับทุกตารางโดยไม่ต้องบอกว่าคอลัมน์ไหนเก็บอะไร
 */

/**
 * เพดานจำนวนแถวของตารางรายการ — ตารางแสดงครบทุกรายการ (ไม่ตัดหน้า) แต่กันหน้าใหญ่เกินไว้ที่นี่
 * เกินนี้ตารางบอกให้ค้นหาให้แคบลง
 */
export const MAX_ROWS = 5000;

/** ค่าที่ติ๊กในเมนูหัวคอลัมน์ หรือช่วงวันที่ (yyyy-mm-dd ทั้งคู่ ว่างได้ข้างหนึ่ง) */
export type ColumnFilter =
  | { kind: 'values'; values: string[] }
  | { kind: 'date'; from?: string; to?: string };

export type TableFilters = Record<string, ColumnFilter>;

/** ช่องว่าง/ขีด แสดงในรายการติ๊กเป็นคำนี้ ให้เลือกกรองหาแถวที่ยังไม่มีค่าได้ */
export const BLANK = '(ว่าง)';

/** ข้อความในช่อง → ค่าที่ใช้เทียบ: ยุบช่องว่าง · ว่างหรือ "-" = BLANK */
export function cellValue(text: string | null | undefined): string {
  const v = (text ?? '').replace(/\s+/g, ' ').trim();
  return !v || v === '-' ? BLANK : v;
}

/** วันที่ในช่องรูปแบบที่ระบบแสดง (dd/mm/yyyy หรือ dd/mm/yyyy, HH:mm) → yyyy-mm-dd · ไม่ใช่วันที่ = null */
export function cellDay(text: string | null | undefined): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\D|$)/.exec((text ?? '').trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  const day = `${y}-${mo}-${d}`;
  const t = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== day ? null : day;
}

/**
 * คอลัมน์วันที่ = ช่องที่มีค่าเกือบทั้งหมดเป็นวันที่ (ยอมให้มีข้อความอื่นปนได้ไม่ถึงครึ่ง)
 * ดูจากข้อมูลจริง ไม่ต้องไปตั้งชนิดให้ทุกคอลัมน์ของทุกหน้า
 */
export function isDateColumn(texts: string[]): boolean {
  const filled = texts.map(cellValue).filter((v) => v !== BLANK);
  if (!filled.length) return false;
  return filled.filter((v) => cellDay(v)).length / filled.length > 0.5;
}

/** แถวนี้ผ่านตัวกรองทุกคอลัมน์ไหม — except = ไม่นับคอลัมน์นี้ (ใช้ตอนนับรายการติ๊กของคอลัมน์นั้นเอง) */
export function rowPasses(row: Record<string, string>, filters: TableFilters, except?: string): boolean {
  for (const [col, f] of Object.entries(filters)) {
    if (col === except || !(col in row)) continue;
    const text = row[col];
    if (f.kind === 'values') {
      if (!f.values.includes(cellValue(text))) return false;
    } else {
      const day = cellDay(text);
      if (!day) return false;
      if (f.from && day < f.from) return false;
      if (f.to && day > f.to) return false;
    }
  }
  return true;
}

/** ค่าที่มีอยู่จริงในคอลัมน์ พร้อมจำนวนแถว — เรียงตามตัวอักษร (BLANK ไว้ท้าย) */
export function distinctValues(texts: string[]): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const t of texts) {
    const v = cellValue(t);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => (a.value === BLANK ? 1 : b.value === BLANK ? -1 : a.value.localeCompare(b.value, 'th', { numeric: true })));
}

/** ตัวกรองที่ยังมีผล — ติ๊กว่างทั้งหมด หรือช่วงวันที่ไม่ได้ใส่ทั้งสองข้าง = ไม่กรอง */
export function isActive(f: ColumnFilter | undefined): f is ColumnFilter {
  if (!f) return false;
  return f.kind === 'values' ? true : Boolean(f.from || f.to);
}

/** ข้อความสั้นบนชิปของตัวกรอง */
export function describe(f: ColumnFilter): string {
  if (f.kind === 'values') {
    if (!f.values.length) return 'ไม่เลือกค่าใด';
    return f.values.length <= 2 ? f.values.join(', ') : `${f.values.slice(0, 2).join(', ')} +${f.values.length - 2}`;
  }
  const show = (d?: string) => (d ? d.split('-').reverse().join('/') : '');
  if (f.from && f.to) return f.from === f.to ? show(f.from) : `${show(f.from)} – ${show(f.to)}`;
  return f.from ? `ตั้งแต่ ${show(f.from)}` : `ถึง ${show(f.to)}`;
}

/** อ่านค่าที่จำไว้ใน localStorage อย่างระวัง — ค่าเสียหรือผิดรูปแบบ = เริ่มใหม่ */
export function parseSaved(raw: string | null): { filters: TableFilters; hidden: string[] } {
  try {
    const data = JSON.parse(raw ?? 'null') as { filters?: unknown; hidden?: unknown } | null;
    const filters: TableFilters = {};
    for (const [col, f] of Object.entries((data?.filters ?? {}) as Record<string, any>)) {
      if (f?.kind === 'values' && Array.isArray(f.values)) filters[col] = { kind: 'values', values: f.values.map(String) };
      if (f?.kind === 'date') filters[col] = { kind: 'date', from: f.from || undefined, to: f.to || undefined };
    }
    const hidden = Array.isArray(data?.hidden) ? (data!.hidden as unknown[]).map(String) : [];
    return { filters, hidden };
  } catch {
    return { filters: {}, hidden: [] };
  }
}
