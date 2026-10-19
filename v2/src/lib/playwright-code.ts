/**
 * อ่านโค้ดที่ Playwright codegen สร้าง แล้วแปลงเป็นขั้นตอนของ Template กรอกเว็บ
 *
 * ไม่ได้รันโค้ดนั้น — อ่านเป็นข้อความแล้วแยกส่วนเอง รับเฉพาะรูปแบบที่ codegen เขียนจริง
 * (เรียก method ต่อกันเป็นสาย อาร์กิวเมนต์เป็นค่าคงที่ล้วน) อะไรที่นอกเหนือจากนี้ถูกข้ามและแจ้งว่าข้ามบรรทัดไหน
 * จึงปลอดภัยถึงจะวางโค้ดที่ใครเขียนมาก็ตาม
 *
 * locator ของแต่ละขั้นเก็บเป็นข้อความแบบที่ codegen เขียน เช่น
 *   getByRole('button', { name: 'Upload Files' }).nth(1)
 * ตัวเล่น (scripts/web-template-runner.ts) แยกส่วนด้วยตัวอ่านเดียวกันนี้แล้วสร้าง locator จริง
 *
 * ไฟล์นี้ไม่แตะฐานข้อมูล นำเข้าได้ทั้งเบราว์เซอร์ เซิร์ฟเวอร์ และ worker
 */
import type { Step, Target } from '@/lib/web-template';

/* ---------------- อ่านค่าคงที่แบบ JavaScript ---------------- */

export type JsValue = string | number | boolean | null | RegExpValue | JsValue[] | { [k: string]: JsValue };
export type RegExpValue = { regex: string; flags: string };
export type Call = { method: string; args: JsValue[] };

export const isRegex = (v: unknown): v is RegExpValue =>
  Boolean(v && typeof v === 'object' && 'regex' in (v as object));

class Reader {
  i = 0;
  constructor(readonly s: string) {}

  fail(msg: string): never {
    throw new Error(`${msg} (ตำแหน่ง ${this.i + 1})`);
  }
  ws() {
    while (this.i < this.s.length && /\s/.test(this.s[this.i])) this.i++;
  }
  peek() {
    this.ws();
    return this.s[this.i];
  }
  eat(ch: string) {
    if (this.peek() !== ch) this.fail(`ต้องการ ${ch}`);
    this.i++;
  }
  ident(): string {
    this.ws();
    const m = /^[A-Za-z_$][\w$]*/.exec(this.s.slice(this.i));
    if (!m) this.fail('ต้องการชื่อ');
    this.i += m[0].length;
    return m[0];
  }
  string(): string {
    const quote = this.s[this.i];
    this.i++;
    let out = '';
    while (this.i < this.s.length) {
      const ch = this.s[this.i++];
      if (ch === quote) return out;
      if (quote === '`' && ch === '$' && this.s[this.i] === '{') this.fail('template string ที่มี ${} ใช้ไม่ได้');
      if (ch === '\\') {
        const next = this.s[this.i++];
        const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };
        if (next === 'u') {
          const hex = this.s[this.i] === '{' ? this.s.slice(this.i + 1, this.s.indexOf('}', this.i)) : this.s.slice(this.i, this.i + 4);
          this.i += this.s[this.i] === '{' ? hex.length + 2 : 4;
          out += String.fromCodePoint(parseInt(hex, 16));
        } else if (next === 'x') {
          out += String.fromCharCode(parseInt(this.s.slice(this.i, this.i + 2), 16));
          this.i += 2;
        } else {
          out += map[next] ?? next;
        }
        continue;
      }
      out += ch;
    }
    this.fail('ข้อความไม่ปิดเครื่องหมายคำพูด');
  }
  regex(): RegExpValue {
    this.i++; // /
    let body = '';
    let inClass = false;
    while (this.i < this.s.length) {
      const ch = this.s[this.i++];
      if (ch === '\\') { body += ch + this.s[this.i++]; continue; }
      if (ch === '[') inClass = true;
      if (ch === ']') inClass = false;
      if (ch === '/' && !inClass) {
        const flags = /^[dgimsuyv]*/.exec(this.s.slice(this.i))![0];
        this.i += flags.length;
        return { regex: body, flags };
      }
      body += ch;
    }
    this.fail('regex ไม่ปิด');
  }
  value(): JsValue {
    const ch = this.peek();
    if (ch === "'" || ch === '"' || ch === '`') return this.string();
    if (ch === '/') return this.regex();
    if (ch === '{') {
      this.i++;
      const obj: Record<string, JsValue> = {};
      while (this.peek() !== '}') {
        const p = this.peek();
        const key = p === "'" || p === '"' ? this.string() : this.ident();
        this.eat(':');
        obj[key] = this.value();
        if (this.peek() === ',') this.i++;
        else break;
      }
      this.eat('}');
      return obj;
    }
    if (ch === '[') {
      this.i++;
      const arr: JsValue[] = [];
      while (this.peek() !== ']') {
        arr.push(this.value());
        if (this.peek() === ',') this.i++;
        else break;
      }
      this.eat(']');
      return arr;
    }
    const m = /^-?\d+(\.\d+)?/.exec(this.s.slice(this.i));
    if (m) { this.i += m[0].length; return Number(m[0]); }
    const word = this.ident();
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (word === 'null' || word === 'undefined') return null;
    this.fail(`ใช้ตัวแปร ${word} ไม่ได้ — ต้องเป็นค่าคงที่`);
  }
  args(): JsValue[] {
    this.eat('(');
    const out: JsValue[] = [];
    while (this.peek() !== ')') {
      out.push(this.value());
      if (this.peek() === ',') this.i++;
      else break;
    }
    this.eat(')');
    return out;
  }
  /** สายการเรียก .a(...).b(...) ต่อจากตำแหน่งปัจจุบัน */
  chain(): Call[] {
    const calls: Call[] = [];
    while (this.peek() === '.') {
      this.i++;
      const method = this.ident();
      calls.push({ method, args: this.args() });
    }
    return calls;
  }
}

/* ---------------- locator ---------------- */

/** method ที่ใช้สร้าง locator ได้ — นอกจากนี้ไม่รับ */
const LOCATOR_METHODS = new Set([
  'getByRole', 'getByText', 'getByLabel', 'getByPlaceholder', 'getByAltText', 'getByTitle', 'getByTestId',
  'locator', 'frameLocator', 'contentFrame', 'first', 'last', 'nth', 'filter', 'owner',
]);

/** แยกข้อความ locator เป็นสายการเรียก — ขึ้นต้นด้วย page. หรือไม่ก็ได้ */
export function parseLocator(text: string): Call[] {
  const src = text.trim().replace(/^[A-Za-z_$][\w$]*(?=\s*\.)/, (m) => (LOCATOR_METHODS.has(m) ? m : ''));
  const r = new Reader(src.startsWith('.') ? src : `.${src}`);
  const calls = r.chain();
  r.ws();
  if (r.i < r.s.length) r.fail('มีข้อความเกินมาหลัง locator');
  if (!calls.length) r.fail('ไม่มี locator');
  for (const c of calls) if (!LOCATOR_METHODS.has(c.method)) throw new Error(`ไม่รองรับ .${c.method}() ใน locator`);
  return calls;
}

const quote = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

export function formatValue(v: JsValue): string {
  if (typeof v === 'string') return quote(v);
  if (isRegex(v)) return `/${v.regex}/${v.flags}`;
  if (Array.isArray(v)) return `[${v.map(formatValue).join(', ')}]`;
  if (v && typeof v === 'object') {
    return `{ ${Object.entries(v).map(([k, x]) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : quote(k)}: ${formatValue(x)}`).join(', ')} }`;
  }
  return String(v);
}

export function formatLocator(calls: Call[]): string {
  return calls.map((c) => `${c.method}(${c.args.map(formatValue).join(', ')})`).join('.');
}

/** แทนค่าในข้อความทุกตัวของ locator — ใช้ใส่ตัวแปร {{job.x}} หลังแยกส่วนแล้ว ค่าจึงมีเครื่องหมายคำพูดได้ */
export function mapLocatorStrings(calls: Call[], fn: (s: string) => string): Call[] {
  const walk = (v: JsValue): JsValue => {
    if (typeof v === 'string') return fn(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object' && !isRegex(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return calls.map((c) => ({ method: c.method, args: c.args.map(walk) }));
}

/* ---------------- โค้ดทั้งไฟล์ของ codegen ---------------- */

export type CodegenImport = {
  startUrl?: string;
  steps: Step[];
  /** บรรทัดที่ไม่ได้แปลง พร้อมเหตุผล */
  skipped: string[];
  /** ขั้นที่แปลงได้แต่ต้องแก้เอง (เลขขั้นเริ่ม 1) เช่น locator ป้ายว่าง */
  warnings: string[];
};

/**
 * locator ที่ชี้อะไรไม่ได้ — codegen เขียน getByLabel('') หรือ getByRole('combobox', { name: '' })
 * เมื่อช่องบนเว็บไม่มีชื่อให้อ่าน (เจอบ่อยกับ combobox ของ Salesforce) ตอนเล่นจะหาไม่เจอเสมอ
 */
export function isBlankLocator(text: string | undefined): boolean {
  if (!text) return false;
  let calls: Call[];
  try { calls = parseLocator(text); } catch { return false; }
  return calls.some((c) => {
    if (!c.method.startsWith('getBy')) return false;
    const [first, opts] = c.args;
    if (typeof first === 'string' && !first.trim() && c.method !== 'getByRole') return true;
    const name = opts && typeof opts === 'object' && !Array.isArray(opts) && !isRegex(opts)
      ? (opts as Record<string, JsValue>).name : undefined;
    return c.method === 'getByRole' && typeof name === 'string' && !name.trim();
  });
}

/**
 * id ที่เว็บสุ่มใหม่ทุกครั้งที่โหลดหน้า — Salesforce/Lightning ตั้ง id แบบ input-38, file-selector-label-55
 * codegen เลือก id พวกนี้เพราะตอนบันทึกมันชี้ได้ตัวเดียว แต่รอบหน้าเลขเปลี่ยนแล้วหาไม่เจอ
 */
export function hasVolatileId(text: string | undefined): boolean {
  if (!text) return false;
  let calls: Call[];
  try { calls = parseLocator(text); } catch { return false; }
  return calls.some((c) => c.method === 'locator' && typeof c.args[0] === 'string'
    && /#[A-Za-z][\w-]*?-\d{2,}\b/.test(c.args[0]));
}

export const VOLATILE_ID_NOTE = '⚠️ id นี้เว็บสุ่มใหม่ทุกครั้งที่โหลดหน้า — ควรเปลี่ยนเป็น getByRole/getByLabel';

export const BLANK_LOCATOR_NOTE = '⚠️ codegen อ่านชื่อช่องนี้ไม่ได้ (locator ว่าง) — ต้องแก้ขั้นนี้เอง';

const str = (v: JsValue | undefined) => (typeof v === 'string' ? v : '');

/** ช่องรหัสผ่าน — ไม่เก็บค่าที่พิมพ์ลงไป เพราะ codegen เขียนรหัสผ่านเป็นตัวหนังสือตรง ๆ */
const PASSWORD_RE = /pass(word)?|pwd|รหัสผ่าน|รหัส/i;

/**
 * แยกบรรทัด `await <ตัวแปรหน้า>.<locator>.<คำสั่ง>(...)` และ `await expect(<locator>).<ตรวจ>(...)`
 *
 * ตัวแปรหน้า (page, page1, ...) ไม่สนใจ — ตัวเล่นสลับไปแท็บใหม่ให้เองเมื่อเว็บเปิด popup
 * ขั้นตรวจ "มองเห็น" บนปุ่มเป็นขั้นสุดท้าย ถือเป็นปุ่มส่ง — ใน codegen ใช้ปุ่ม Assert visibility
 * ชี้ปุ่มส่งแทนการกดจริง จะได้ไม่ยื่นจริงตอนบันทึก
 */
export function parseCodegen(code: string): CodegenImport {
  const steps: Step[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];
  let startUrl: string | undefined;

  /*
   * แยกเป็นคำสั่ง — codegen จบทุกคำสั่งด้วย ; ท้ายบรรทัด
   * คำสั่งที่ยาวหลายบรรทัด (เช่น chromium.launch({ ... }) หรือ selectOption([...])) จึงรวมเป็นคำสั่งเดียว
   */
  const statements = code.replace(/\r/g, '').split(/;\s*\n|\n(?=\s*(?:await|const|let|\/\/))/)
    .map((s) => s.replace(/\s*\n\s*/g, ' ').trim().replace(/;$/, ''))
    .filter(Boolean);

  for (const raw of statements) {
    const line = raw.replace(/^(const|let)\s+[\w$]+\s*=\s*/, '');
    // ขั้นตอนจริงขึ้นต้นด้วยตัวแปรหน้า (page, page1, ...) หรือ expect เท่านั้น ที่เหลือเป็นโครงไฟล์
    // (chromium.launch, browser.newContext, context.newPage, page.close, page1Promise)
    if (!/^await\s+(page\d*\.|expect\s*\()/.test(line) || /^await\s+page\d*\.close\(\)$/.test(line)) {
      // โครงไฟล์ของ codegen (require, launch, newPage, close) ไม่ใช่ขั้นตอน — ไม่ต้องแจ้ง
      if (/getBy|locator\(|\.goto\(|expect\(/.test(line)) skipped.push(`${raw} — ไม่รู้จักรูปแบบนี้`);
      continue;
    }
    try {
      const step = parseStatement(line.slice(6).trim());
      if (!step) { skipped.push(`${raw} — ไม่ได้แปลงคำสั่งนี้`); continue; }
      if (step === 'password') { skipped.push(`${raw} — ช่องรหัสผ่าน ไม่เก็บค่า`); continue; }
// codegen เขียนแนบไฟล์ซ้ำสองบรรทัดติดกันบ่อย (ตอนเลือกไฟล์กับตอนช่องเปลี่ยนค่า) — เก็บครั้งเดียว
      const prev = steps[steps.length - 1];
      if (step.type === 'upload' && prev?.type === 'upload' && prev.target.locator === step.target.locator) continue;
      if ('target' in step && isBlankLocator(step.target.locator)) {
        step.note = BLANK_LOCATOR_NOTE;
        warnings.push(`ขั้นที่ ${steps.length + 1}: ${step.target.locator} — อ่านชื่อช่องไม่ได้`);
      } else if ('target' in step && hasVolatileId(step.target.locator)) {
        step.note = VOLATILE_ID_NOTE;
        warnings.push(`ขั้นที่ ${steps.length + 1}: ${step.target.locator} — id สุ่มใหม่ทุกครั้ง`);
      }
      if (step.type === 'goto') {
        // หน้าแรกคือ startUrl ของ Template ไม่ต้องเป็นขั้น · เปิดหน้าเดิมซ้ำก่อนเริ่มทำอะไร (แท็บใหม่ตอนเริ่มบันทึก) ก็ไม่ต้อง
        if (!steps.length && (!startUrl || startUrl === step.url)) { startUrl = step.url; continue; }
      }
      steps.push(step);
    } catch (error) {
      skipped.push(`${raw} — ${error instanceof Error ? error.message : error}`);
    }
  }

  const last = steps[steps.length - 1];
  if (last?.type === 'waitFor' && /getByRole\('button'|getByRole\("button"/.test(last.target.locator ?? '')) {
    steps[steps.length - 1] = { type: 'submit', target: last.target };
  }
  return { startUrl, steps, skipped, warnings };
}

function parseStatement(src: string): Step | 'password' | null {
  // await expect(<locator>).toBeVisible() / toContainText('x') / toHaveText('x')
  const expectMatch = /^expect\s*\(/.exec(src);
  if (expectMatch) {
    const r = new Reader(src.slice(expectMatch[0].length - 1));
    r.eat('(');
    r.ident(); // ตัวแปรหน้า
    const locator = r.chain();
    r.eat(')');
    for (const c of locator) if (!LOCATOR_METHODS.has(c.method)) throw new Error(`ไม่รองรับ .${c.method}()`);
    const checks = r.chain();
    const check = checks.find((c) => c.method !== 'not');
    if (!check || !locator.length) return null;
    const target: Target = { locator: formatLocator(locator) };
    if (check.method === 'toBeVisible') {
      const only = locator.length === 1 && locator[0].method === 'getByText' && typeof locator[0].args[0] === 'string';
      return only ? { type: 'waitText', text: locator[0].args[0] as string } : { type: 'waitFor', target };
    }
    if (check.method === 'toContainText' || check.method === 'toHaveText') {
      const text = str(check.args[0]);
      return text ? { type: 'waitText', text } : { type: 'waitFor', target };
    }
    return null;
  }

  const r = new Reader(src);
  r.ident(); // page / page1 / frame
  const calls = r.chain();
  r.ws();
  if (r.i < r.s.length) throw new Error('มีข้อความเกินมาท้ายบรรทัด');
  if (!calls.length) return null;

  const action = calls[calls.length - 1];
  if (action.method === 'goto') return { type: 'goto', url: str(action.args[0]) };

  const locatorCalls = calls.slice(0, -1);
  for (const c of locatorCalls) if (!LOCATOR_METHODS.has(c.method)) throw new Error(`ไม่รองรับ .${c.method}()`);
  if (!locatorCalls.length) return null;
  const target: Target = { locator: formatLocator(locatorCalls) };

  switch (action.method) {
    case 'click': case 'dblclick': case 'check': case 'uncheck': case 'tap':
      return { type: 'click', target };
    case 'fill': case 'pressSequentially': case 'type':
      if (PASSWORD_RE.test(target.locator!)) return 'password';
      return { type: 'fill', target, value: str(action.args[0]) };
    case 'press':
      return { type: 'press', target, key: str(action.args[0]) || 'Enter' };
    case 'selectOption': {
      const arg = action.args[0];
      const first = Array.isArray(arg) ? arg[0] : arg;
      const value = typeof first === 'string' ? first
        : first && typeof first === 'object' && !isRegex(first) && !Array.isArray(first)
          ? str((first as Record<string, JsValue>).label ?? (first as Record<string, JsValue>).value)
          : '';
      return value ? { type: 'select', target, value } : null;
    }
    case 'setInputFiles': {
      const arg = action.args[0];
      const names = (Array.isArray(arg) ? arg : [arg]).filter((x): x is string => typeof x === 'string');
      return {
        type: 'upload', target, file: 'DO_MERGED',
        ...(names.length ? { note: `ไฟล์ตอนบันทึก: ${names.join(', ')}`.slice(0, 200) } : {}),
      };
    }
    default:
      return null;
  }
}
