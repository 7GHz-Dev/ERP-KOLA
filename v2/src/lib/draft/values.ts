/**
 * ค่าจากเซลล์ Excel -> ข้อความ/ตัวเลข แบบเดียวกับโปรแกรม imp (Python: core/values.py)
 *
 * ต้องได้ผลตรงกันทุกตัวอักษร เพราะค่าพวกนี้ไปอยู่ใน CSV ที่นำเข้า NETBAY
 * (เช่น 1370 ไม่ใช่ 1370.0 · วันที่ dd/mm/yyyy · ทศนิยมแบบ Decimal ไม่ใช่ float)
 */

/** ค่าเซลล์ที่อ่านแล้ว แบบเดียวกับ openpyxl (data_only) */
export type CellValue = null | string | number | boolean | { date: { y: number; m: number; d: number } };

const EXCEL_ERRORS = new Set(['#N/A', '#VALUE!', '#REF!', '#DIV/0!', '#NUM!', '#NAME?',
  '#NULL!', '#SPILL!', '#CALC!', '#GETTING_DATA']);

export const pad2 = (n: number) => String(n).padStart(2, '0');

/** ทศนิยมแบบ Decimal ของ Python: ค่า = (neg ? -1 : 1) * coeff * 10^exp */
export class Dec {
  constructor(readonly neg: boolean, readonly coeff: bigint, readonly exp: number) {}

  static parse(s: string): Dec | null {
    const m = /^([+-])?(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(s);
    if (!m) return null;
    const int = m[2] || '';
    const frac = m[3] !== undefined ? m[3] : (m[4] || '');
    return new Dec(m[1] === '-', BigInt((int + frac) || '0'), parseInt(m[5] || '0', 10) - frac.length);
  }

  static fromInt(n: number) { return new Dec(n < 0, BigInt(Math.abs(n)), 0); }

  isIntegral() { return this.exp >= 0 || this.coeff % (10n ** BigInt(-this.exp)) === 0n; }

  /** int(d) — ตัดทศนิยมทิ้ง */
  trunc(): bigint {
    const v = this.exp >= 0 ? this.coeff * 10n ** BigInt(this.exp) : this.coeff / 10n ** BigInt(-this.exp);
    return this.neg ? -v : v;
  }

  toNumber() { return parseFloat(`${this.neg ? '-' : ''}${this.coeff}e${this.exp}`); }

  add(o: Dec): Dec {
    const e = Math.min(this.exp, o.exp);
    const a = (this.neg ? -1n : 1n) * this.coeff * 10n ** BigInt(this.exp - e);
    const b = (o.neg ? -1n : 1n) * o.coeff * 10n ** BigInt(o.exp - e);
    const s = a + b;
    return new Dec(s < 0n, s < 0n ? -s : s, e);
  }

  /** str(Decimal) ของ Python */
  toString() {
    const coeff = this.coeff.toString();
    const left = this.exp + coeff.length;
    const dot = this.exp <= 0 && left > -6 ? left : 1;
    let intpart: string; let fracpart: string;
    if (dot <= 0) { intpart = '0'; fracpart = '.' + '0'.repeat(-dot) + coeff; }
    else if (dot >= coeff.length) { intpart = coeff + '0'.repeat(dot - coeff.length); fracpart = ''; }
    else { intpart = coeff.slice(0, dot); fracpart = '.' + coeff.slice(dot); }
    const e = left === dot ? '' : 'E' + (left - dot >= 0 ? '+' : '') + (left - dot);
    return (this.neg ? '-' : '') + intpart + fracpart + e;
  }
}

/** repr(float) ของ Python สำหรับค่าที่ไม่ใช่จำนวนเต็ม */
function floatRepr(v: number) {
  const a = Math.abs(v);
  if (a !== 0 && a < 1e-4) {
    const [m, e] = v.toExponential().split('e');
    const n = parseInt(e, 10);
    return `${m}e${n < 0 ? '-' : '+'}${pad2(Math.abs(n))}`;
  }
  return String(v);
}

/** ค่าในเซลล์ -> ข้อความที่ตัดช่องว่างซ้ำแล้ว  ว่างหรือ error ของ Excel -> '' */
export function clean(v: CellValue | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') {
    const s = v.split(/\s+/).filter(Boolean).join(' ');
    return EXCEL_ERRORS.has(s.toUpperCase()) ? '' : s;
  }
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : floatRepr(v);
  return `${pad2(v.date.d)}/${pad2(v.date.m)}/${v.date.y}`;
}

/** str(value) ของ Python (ไม่ตัดช่องว่าง) — ใช้กับค่าที่โปรแกรมเดิมไม่ได้ผ่าน clean() */
export function pyStr(v: CellValue | undefined): string {
  if (v === null || v === undefined || v === '' || v === 0 || v === false) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return 'True';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : floatRepr(v);
  return `${v.date.y}-${pad2(v.date.m)}-${pad2(v.date.d)} 00:00:00`;
}

export function toDecimal(v: CellValue | undefined): Dec | null {
  const s = clean(v).replace(/,/g, '');
  return s ? Dec.parse(s) : null;
}

/** Decimal -> ข้อความ  1370 ไม่ใช่ 1370.0  ส่วน 172700.1 คงทศนิยมไว้ */
export function fmtNumber(d: Dec): string {
  if (d.isIntegral()) return d.trunc().toString();
  let c = d.coeff; let e = d.exp;
  while (c % 10n === 0n) { c /= 10n; e += 1; }
  const digits = c.toString(); const k = -e;
  const body = digits.length > k
    ? `${digits.slice(0, digits.length - k)}.${digits.slice(digits.length - k)}`
    : `0.${'0'.repeat(k - digits.length)}${digits}`;
  return (d.neg ? '-' : '') + body;
}

/** วันที่ invoice -> dd/mm/yyyy  (รับได้ทั้งเซลล์วันที่และข้อความ 7/8/2026) */
export function fmtDate(v: CellValue | undefined): string {
  const s = clean(v);
  if (v && typeof v === 'object') return s;
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  return m ? `${pad2(parseInt(m[1], 10))}/${pad2(parseInt(m[2], 10))}/${m[3]}` : s;
}

/** repr(str) ของ Python — ใช้ในข้อความแจ้งเตือนให้หน้าตาเหมือนโปรแกรมเดิม */
export function pyRepr(s: string): string {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (ch === '\\' || ch === q) out += '\\' + ch;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch !== ' ' && /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u.test(ch)) {
      out += cp < 0x100 ? '\\x' + cp.toString(16).padStart(2, '0')
        : cp < 0x10000 ? '\\u' + cp.toString(16).padStart(4, '0')
          : '\\U' + cp.toString(16).padStart(8, '0');
    } else out += ch;
  }
  return q + out + q;
}
