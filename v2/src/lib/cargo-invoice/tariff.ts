import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { masterRecords } from '@/db/schema';
import { loadTariffRows, tariffKey, type TariffRow } from '@/lib/draft/invoice';
import { loadWorkbook, sheetReader } from '@/lib/draft/sheet';

/**
 * พิกัดศุลกากรของรถแต่ละคัน — แทนชีต datatariff ในไฟล์ Excel เดิม
 *
 * ตารางหลัก: assets/netbay/DATA TARIFF.xlsx (ชุดเดียวกับที่ worker สร้าง Draft ใช้ 852 กฎ)
 * กฎเพิ่มเติม: รถรุ่นใหม่ที่ PAINT เพิ่มจากหน้า Create Cargo Invoice เก็บใน master_records type=tariffs
 *   ไม่ต้องสร้างตารางใหม่ — แถวหนึ่งต่อกฎ ค่าจริงเก็บเป็น JSON ใน value
 *
 * กฎหนึ่ง = ยี่ห้อ+รุ่น+เชื้อเพลิง และช่วง CC / น้ำหนัก → พิกัด 8 หลัก
 * ตรงกฎเดียว = ได้พิกัด · ตรงหลายกฎคนละพิกัด = ให้คนเลือก · ไม่ตรงเลย = ต้องเพิ่มกฎ
 */

export const TARIFF_TYPE = 'tariffs';

export type TariffRule = {
  id: string; seq: string; code: string; brand: string; model: string; fuel: string;
  ccMin: number; ccMax: number; wMin: number; wMax: number; source: 'base' | 'added';
};

export type TariffResult = {
  status: 'found' | 'ambiguous' | 'missing';
  /** พิกัด 8 หลักเมื่อหาได้ตัวเดียว */
  code: string;
  candidates: Array<{ code: string; rules: string[] }>;
};

let baseCache: TariffRule[] | null = null;

/** ตารางหลักจากไฟล์ — โหลดครั้งเดียวต่อเครื่องเซิร์ฟเวอร์ (ไฟล์ไม่เปลี่ยนระหว่างรัน) */
export async function baseRules(): Promise<TariffRule[]> {
  if (baseCache) return baseCache;
  const wb = await loadWorkbook(readFileSync(join(process.cwd(), 'assets', 'netbay', 'DATA TARIFF.xlsx')));
  const ws = sheetReader(wb, wb.worksheets[0]);
  // loadTariffRows ให้คีย์ที่รวมแล้ว — อ่านชื่อแยกช่องเองอีกรอบไว้แสดงบนหน้าจอ
  const rows: TariffRow[] = loadTariffRows(ws);
  const names = new Map<string, { brand: string; model: string; fuel: string }>();
  for (let r = 3; r <= ws.maxRow; r++) {
    const seq = String(ws.value(r, 1) ?? '').trim();
    if (seq) names.set(seq, { brand: String(ws.value(r, 3) ?? '').trim(), model: String(ws.value(r, 4) ?? '').trim(), fuel: String(ws.value(r, 5) ?? '').trim() });
  }
  baseCache = rows.map(([seq, code, , ccMin, ccMax, wMin, wMax]) => ({
    id: `base-${seq}`, seq, code, ...(names.get(seq) ?? { brand: '', model: '', fuel: '' }),
    ccMin, ccMax, wMin, wMax, source: 'base' as const,
  }));
  return baseCache;
}

type Stored = Omit<TariffRule, 'id' | 'seq' | 'source'>;

/** กฎที่เพิ่มเองจากหน้าเว็บ (ยังใช้งานอยู่) */
export async function addedRules(): Promise<TariffRule[]> {
  const rows = await db
    .select({ id: masterRecords.id, code: masterRecords.code, value: masterRecords.value })
    .from(masterRecords)
    .where(and(eq(masterRecords.type, TARIFF_TYPE), eq(masterRecords.isActive, true)));
  const out: TariffRule[] = [];
  for (const r of rows) {
    try {
      const v = JSON.parse(r.value ?? '') as Stored;
      out.push({ ...v, id: r.id, seq: r.code ?? r.id, source: 'added' });
    } catch { /* แถวเสียข้ามไป ไม่ทำให้ทั้งหน้าใช้ไม่ได้ */ }
  }
  return out;
}

export async function allRules() {
  const [base, added] = await Promise.all([baseRules(), addedRules()]);
  return [...base, ...added];
}

const ruleKey = (r: Pick<TariffRule, 'brand' | 'model' | 'fuel'>) => tariffKey(r.brand, r.model, r.fuel);

/** หาพิกัดของรถหนึ่งคัน — เงื่อนไขเดียวกับ lookupTariff ของ worker (คีย์ชื่อ + ช่วง CC + ช่วงน้ำหนัก) */
export function lookup(rules: TariffRule[], car: { brand: string; model: string; fuel: string; cc: number | null; weight: number | null }): TariffResult {
  const key = tariffKey(car.brand, car.model, car.fuel);
  const cc = car.cc ?? -1;
  const w = car.weight ?? -1;
  const hits = rules.filter((t) => ruleKey(t) === key && t.ccMin <= cc && cc <= t.ccMax && t.wMin <= w && w <= t.wMax);
  const byCode = new Map<string, string[]>();
  for (const h of hits) byCode.set(h.code, [...(byCode.get(h.code) ?? []), h.source === 'added' ? `เพิ่มเอง #${h.seq}` : `ลำดับ ${h.seq}`]);
  const candidates = [...byCode].sort(([a], [b]) => a.localeCompare(b)).map(([code, rs]) => ({ code, rules: rs }));
  if (candidates.length === 1) return { status: 'found', code: candidates[0].code, candidates };
  if (candidates.length > 1) return { status: 'ambiguous', code: '', candidates };
  return { status: 'missing', code: '', candidates: [] };
}

/** กฎของยี่ห้อ+รุ่นเดียวกัน (ไม่สนช่วง) — ช่วยคนเพิ่มกฎใหม่เห็นว่ารุ่นนี้เคยใช้พิกัดอะไร */
export function similarRules(rules: TariffRule[], car: { brand: string; model: string }) {
  const bm = tariffKey(car.brand, car.model);
  return rules.filter((t) => tariffKey(t.brand, t.model) === bm).slice(0, 8);
}

export const TARIFF_CODE = /^87\d{6}$/;

/**
 * ช่วง CC ที่ใช้บ่อยที่สุดในตารางซึ่งครอบ CC นี้ — เป็นค่าตั้งต้นตอนเพิ่มกฎใหม่
 * พิกัดรถแบ่งตามช่วงความจุกระบอกสูบ (เช่น 1001-1500 · 1501-1800) กฎของรถรุ่นใหม่ควรใช้ช่วงเดียวกัน
 * ไม่ใช่ CC เดียวของคันนี้ ไม่งั้นคันถัดไปรุ่นเดียวกันแต่ CC ต่างนิดเดียวจะหาไม่เจออีก
 */
export function suggestCcRange(rules: TariffRule[], cc: number | null): { ccMin: number; ccMax: number } {
  if (cc === null) return { ccMin: 0, ccMax: 99999 };
  const count = new Map<string, number>();
  for (const r of rules) {
    if (r.ccMin <= cc && cc <= r.ccMax && !(r.ccMin === 0 && r.ccMax >= 99999)) {
      const k = `${r.ccMin}-${r.ccMax}`;
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  const best = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!best) return { ccMin: cc, ccMax: cc };
  const [ccMin, ccMax] = best.split('-').map(Number);
  return { ccMin, ccMax };
}
