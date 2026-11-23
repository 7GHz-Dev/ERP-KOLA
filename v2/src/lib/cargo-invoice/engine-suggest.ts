import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { tariffKey } from '@/lib/draft/invoice';
import { listCarCodes } from './car-codes';
import { chassisKey } from './chassis-check';

/**
 * แนะนำรหัสเครื่อง (ส่วนหน้าขีด) ให้รถที่ OG Invoice ไม่มี ENGINE NO.
 *
 * 1. รหัสหน้า CHASSIS เดียวกัน (ก่อนขีด / 8 ตัวแรกของ VIN) จากเลขเครื่องที่ระบบเคยออก (engine_numbers ~130,000 คัน) — แม่นที่สุด
 * 2. ยี่ห้อ+รุ่นเดียวกัน จากชุดที่ระบบจำจากใบที่บันทึกแล้ว (master_records type=carCodes)
 * เรียงตามจำนวนคันที่เคยใช้ — คนเลือกเอง ระบบไม่เติมให้
 */
export type EngineHint = { code: string; count: number; by: 'chassis' | 'model' };
type CarIn = { brand: string; model: string; chassis: string };

const MAX = 5;

export async function suggestEngines(cars: CarIn[]): Promise<EngineHint[][]> {
  const keys = [...new Set(cars.map((c) => chassisKey(c.chassis)?.key).filter((k): k is string => Boolean(k)))];
  const [rows, known] = await Promise.all([
    keys.length ? db.execute(sql`
      select key, eng, count(*)::int as n from (
        select case when position('-' in chassis) > 1 then upper(split_part(chassis, '-', 1))
                    else upper(left(regexp_replace(chassis, '\s', '', 'g'), 8)) end as key,
               regexp_replace(upper(split_part(full_eng, '-', 1)), '\s', '', 'g') as eng
        from engine_numbers where full_eng like '%-%'
      ) t
      where key in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)}) and eng <> ''
      group by 1, 2`) as unknown as Promise<Array<{ key: string; eng: string; n: number }>>
      : Promise.resolve([]),
    listCarCodes().catch(() => []),
  ]);

  const byChassis = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!byChassis.has(r.key)) byChassis.set(r.key, new Map());
    byChassis.get(r.key)!.set(r.eng, r.n);
  }
  const byModel = new Map<string, Map<string, number>>();
  for (const k of known) {
    if (!k.engine) continue;
    const mk = tariffKey(k.brand, k.model);
    if (!byModel.has(mk)) byModel.set(mk, new Map());
    const m = byModel.get(mk)!;
    m.set(k.engine, (m.get(k.engine) ?? 0) + k.count);
  }

  /*
   * ตัดข้อมูลเก่าที่พิมพ์ผิด: เลขเต็มไม่มีขีด ("F33A0153307") ไม่ใช่รหัสหน้าขีด
   * และรหัสที่เจอคันเดียวเมื่อรหัสอันดับหนึ่งมีหลายคัน (มักพิมพ์ผิด)
   */
  const top = (m: Map<string, number> | undefined, by: EngineHint['by']) => {
    const list = [...(m ?? [])].filter(([code]) => !/\d{6,}/.test(code)).sort((a, b) => b[1] - a[1]);
    const most = list[0]?.[1] ?? 0;
    return list.filter(([, n]) => n >= 2 || most < 10).map(([code, count]): EngineHint => ({ code, count, by }));
  };

  return cars.map((c) => {
    const key = chassisKey(c.chassis)?.key;
    const out = top(key ? byChassis.get(key) : undefined, 'chassis');
    if (c.brand && c.model) {
      for (const h of top(byModel.get(tariffKey(c.brand, c.model)), 'model')) {
        if (!out.some((o) => o.code === h.code)) out.push(h);
      }
    }
    return out.slice(0, MAX);
  });
}
