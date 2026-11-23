/**
 * ตรวจว่า BRAND · MODEL สัมพันธ์กับรหัสหน้า CHASSIS NO. ไหม — เทียบกับ DATA_BRAND MODEL CHASSIS.xlsx (ชีต Prefix_Rules)
 *
 * ไฟล์ Excel แปลงเป็น chassis-rules.json ตอน build (scripts/build-chassis-rules.ts) ไม่ import อะไรที่ผูกกับเซิร์ฟเวอร์
 * หน้าเว็บจึงตรวจได้ทันทีที่พิมพ์
 *
 * รหัสมีสองแบบ
 *   ก่อนขีด   ZVW30-1234567       → ZVW30
 *   VIN 17 ตัว JTMAA7BJ4S4118676  → 8 ตัวแรก JTMAA7BJ
 *
 * เตือนอย่างเดียว ไม่บล็อกการบันทึก — ข้อมูลอ้างอิงมาจากใบที่ผ่านมา รุ่นใหม่ ๆ อาจยังไม่มี
 */
import RULES from './chassis-rules.json';

type Rule = [string, 'D' | 'V', string[], string[]];
const BY_KEY = new Map((RULES as Rule[]).map((r) => [r[0], r]));

export type ChassisCheck = {
  /** warn = ไม่สัมพันธ์กัน · unknown = ไม่มีรหัสนี้ในข้อมูลอ้างอิง (บอกไว้เฉย ๆ) · ok = ตรง */
  level: 'ok' | 'warn' | 'unknown';
  /** รหัสที่ใช้เทียบ เช่น ZVW30 / JTMAA7BJ */
  key: string;
  text: string;
};

const squash = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const list = (a: string[], max = 4) => a.slice(0, max).join(', ') + (a.length > max ? ' …' : '');

/** รหัสที่ใช้เทียบจากเลขตัวถัง — '' = บอกไม่ได้ (ไม่มีขีด และไม่ใช่ VIN 17 ตัว) */
export function chassisKey(chassis: string): { key: string; kind: 'D' | 'V' } | null {
  const s = chassis.replace(/\s+/g, '').toUpperCase();
  const dash = s.indexOf('-');
  if (dash > 0) return { key: s.slice(0, dash), kind: 'D' };
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(s)) return { key: s.slice(0, 8), kind: 'V' };
  return null;
}

/** รุ่นตรงกัน — ไม่สนช่องว่าง/ขีด และยอมให้ตัวหนึ่งขึ้นต้นด้วยอีกตัว (RX ↔ RX450H · CROWN ↔ CROWN ATHLETE) */
const sameModel = (a: string, b: string) => {
  const x = squash(a);
  const y = squash(b);
  return Boolean(x && y) && (x === y || x.startsWith(y) || y.startsWith(x));
};

export function checkChassis(brand: string, model: string, chassis: string): ChassisCheck | null {
  const k = chassisKey(chassis);
  if (!k) return null;
  const rule = BY_KEY.get(k.key);
  const what = k.kind === 'V' ? `VIN ${k.key}` : k.key;
  if (!rule) return { level: 'unknown', key: k.key, text: `ไม่มีรหัส ${what} ในข้อมูลอ้างอิง — ตรวจ BRAND/MODEL เอง` };

  const [, , brands, models] = rule;
  const b = brand.trim().toUpperCase();
  if (b && brands.length && !brands.some((x) => squash(x) === squash(b))) {
    return { level: 'warn', key: k.key, text: `CHASSIS ${what} เป็นของ ${list(brands)} ไม่ใช่ ${b}` };
  }
  // รายการรุ่นที่ไม่ระบุ / ถูกตัดท้าย (+n) เทียบไม่ได้ครบ — ข้ามการเตือนรุ่น
  const named = models.filter((m) => !/^\(.*\)$/.test(m));
  const partial = models.some((m) => /^\(\+\d+\)$|\(\+\d+\)$/.test(m) || m === '(NOT SPECIFIED)');
  const m = model.trim().toUpperCase();
  if (m && named.length && !named.some((x) => sameModel(x, m))) {
    if (partial) return { level: 'unknown', key: k.key, text: `CHASSIS ${what} ปกติเป็น ${list(named)} — ไม่พบ ${m} ในรายการ ตรวจอีกครั้ง` };
    return { level: 'warn', key: k.key, text: `CHASSIS ${what} เป็นรุ่น ${list(named)} ไม่ใช่ ${m}` };
  }
  return { level: 'ok', key: k.key, text: `CHASSIS ${what} ตรงกับ ${b || list(brands)}${m ? ` ${m}` : ''}` };
}
