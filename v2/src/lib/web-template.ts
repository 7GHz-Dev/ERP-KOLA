import { z } from 'zod';
import { parseLocator } from '@/lib/playwright-code';

/**
 * Template กรอกเว็บ — ขั้นตอนเปิดเว็บ คลิก กรอก แนบไฟล์ ที่ผู้ดูแลบันทึกไว้แล้วกลายเป็นปุ่ม
 *
 * worker (scripts/web-template-worker.ts) เป็นคนเล่นขั้นตอนจริงบนเครื่องที่ล็อกอินเว็บไว้
 * ระบบนี้เก็บแค่ "ทำอะไรกับช่องไหน" ไม่เก็บพิกัดบนจอ เพราะพิกัดเพี้ยนทันทีที่หน้าต่างเปลี่ยนขนาด
 * หรือเว็บเพิ่มแถบอะไรขึ้นมา — ช่องหาจากชื่อปุ่ม ป้ายช่อง placeholder ก่อน แล้วค่อยถอยไป CSS
 *
 * ขั้นตอนมีได้แค่ชนิดที่กำหนดไว้ข้างล่าง ไม่มีชนิดที่ฝังโค้ดได้
 * เพราะ worker รันบนเครื่องที่ล็อกอินเว็บสายเรือด้วยบัญชีพนักงาน
 *
 * เก็บใน master_records แบบเดียวกับฟอร์มจดหมายและแบบร่างการอ่าน — หนึ่งแถวต่อหนึ่ง Template
 * ค่าทั้งชุดเป็น JSON ในช่อง value
 *
 * ไฟล์นี้เป็นค่าคงที่กับตัวตรวจล้วน ไม่แตะฐานข้อมูล นำเข้าได้ทั้งเบราว์เซอร์ เซิร์ฟเวอร์ และ worker
 */

export const WEB_TEMPLATE_TYPE = 'webTemplate';

/** ชนิดงานในคิว automation_tasks */
export const WEB_TASK = {
  /** เล่น Template กับงานหนึ่ง */
  RUN: 'WEB_TEMPLATE',
  /** เปิด Chrome ให้คนทำตามขั้นตอนจริง แล้วเก็บเป็นขั้นตอนของ Template */
  RECORD: 'WEB_RECORD',
} as const;

/** หน้าที่วางปุ่มได้ — เริ่มจากหน้าจัดการแลก DO ก่อน */
export const BUTTON_PAGES = [
  { key: 'do-exchange', label: 'จัดการแลก DO (ANN)' },
] as const;

/** หมวดไฟล์ที่เก็บภาพหน้าจอหลังส่งสำเร็จ */
export const WEB_PROOF_CATEGORY = 'WEB_PROOF';

/**
 * ค่าจากงานที่ใช้ในช่องกรอกได้ — เขียนเป็น {{job.blNo}} ในค่าของขั้นตอน
 * ตอนบันทึกจากงานตัวอย่าง ค่าที่ตรงกับช่องเหล่านี้ถูกแทนเป็นตัวแปรให้เอง
 */
export const JOB_VARS = [
  { key: 'blNo', label: 'เลข BL' },
  { key: 'jobNo', label: 'Job No.' },
  { key: 'vessel', label: 'ชื่อเรือ' },
  { key: 'voyage', label: 'เที่ยวเรือ' },
  { key: 'eta', label: 'ETA (2026-10-16)' },
  { key: 'etaSlash', label: 'ETA (16/10/2026)' },
  { key: 'shipline', label: 'สายเรือ' },
  { key: 'consignee', label: 'Consignee' },
  { key: 'originPort', label: 'เมืองต้นทาง' },
] as const;

export type JobVarKey = (typeof JOB_VARS)[number]['key'];
export type JobVars = Partial<Record<JobVarKey, string>>;

/** ตัวช่วยของช่องที่ถามตอนกดปุ่ม */
export const INPUT_ASSISTS = [
  { key: '', label: '-' },
  { key: 'slipRef', label: 'ปุ่มอ่านเลขที่รายการจากสลิป' },
  { key: 'billing', label: 'ตัวเลือกที่อยู่ออกใบเสร็จ' },
] as const;

const str = (max: number) => z.string().trim().max(max);
const optStr = (max: number) => str(max).optional().transform((v) => (v ? v : undefined));

/**
 * วิธีหาช่องบนหน้าเว็บ — มีหลายทางเผื่อทางแรกหาไม่เจอ
 * worker ลองตามลำดับ locator → role+name → label → placeholder → css → text
 */
export const targetSchema = z.object({
  /**
   * locator แบบที่ Playwright codegen เขียน เช่น getByRole('button', { name: 'Add' }).nth(1)
   * ชี้แม่นที่สุดเพราะ Playwright เลือกให้แล้วว่าชี้ได้ตัวเดียว worker จึงลองทางนี้ก่อน
   */
  locator: optStr(1000).refine((v) => {
    if (!v) return true;
    try { parseLocator(v); return true; } catch { return false; }
  }, 'locator เขียนผิดรูปแบบ (ใช้ได้เฉพาะ getByRole/getByText/getByLabel/locator/nth/... แบบ codegen)'),
  role: optStr(40),
  name: optStr(300),
  label: optStr(300),
  placeholder: optStr(300),
  text: optStr(300),
  css: optStr(500),
  /** ลำดับของช่องที่ css ซ้ำกัน เช่นช่องแนบไฟล์ช่องที่สอง — เริ่มที่ 0 */
  nth: z.number().int().min(0).max(50).optional(),
  /** ช่องที่อยู่ใน iframe — ต้นของ URL ของ frame นั้น */
  frame: optStr(500),
}).refine((t) => t.locator || t.role || t.label || t.placeholder || t.text || t.css, {
  message: 'ขั้นตอนต้องระบุช่องบนหน้าเว็บอย่างน้อยหนึ่งทาง',
});

export type Target = z.infer<typeof targetSchema>;

const common = {
  note: optStr(200),
  /** วินาทีที่รอช่องนี้ — ไม่ระบุใช้ 30 */
  timeout: z.number().int().min(1).max(600).optional(),
};

export const stepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('goto'), url: str(1000).min(1), ...common }),
  z.object({
    type: z.literal('click'), target: targetSchema,
    /** หาไม่เจอก็ข้ามไป — ใช้กับของที่ขึ้นบ้างไม่ขึ้นบ้าง เช่นหน้าต่าง Upload ที่มีปุ่ม Done */
    optional: z.boolean().optional(),
    ...common,
  }),
  z.object({ type: z.literal('fill'), target: targetSchema, value: str(4000), ...common }),
  z.object({ type: z.literal('select'), target: targetSchema, value: str(300).min(1), ...common }),
  z.object({
    type: z.literal('upload'), target: targetSchema,
    /** หมวดไฟล์ของงานที่จะแนบ เช่น DO_MERGED */
    file: str(60).min(1),
    ...common,
  }),
  z.object({ type: z.literal('waitText'), text: str(300).min(1), ...common }),
  /** รอให้ช่องนี้ขึ้นบนหน้า — จาก expect(...).toBeVisible() ของ codegen */
  z.object({ type: z.literal('waitFor'), target: targetSchema, ...common }),
  /** กดคีย์ที่ช่องนี้ เช่น Enter เพื่อค้นหา */
  z.object({ type: z.literal('press'), target: targetSchema, key: str(40).min(1), ...common }),
  /**
   * ปุ่มส่งขั้นสุดท้าย — โหมดปกติกรอกครบแล้วรอคนตรวจและกดเอง
   * โหมดอัตโนมัติกดให้ · โหมดทดลองหยุดก่อนถึงขั้นนี้
   */
  z.object({ type: z.literal('submit'), target: targetSchema, ...common }),
  /** หยุดให้คนทำอะไรบางอย่างเอง (เช่นกรอก OTP) แล้วกด "ทำต่อ" บนแถบด้านบนของหน้า */
  z.object({ type: z.literal('pause'), message: str(300).min(1), ...common }),
]);

export type Step = z.infer<typeof stepSchema>;
export type StepType = Step['type'];

export const STEP_TYPES: { key: StepType; label: string }[] = [
  { key: 'click', label: 'คลิก' },
  { key: 'fill', label: 'กรอก' },
  { key: 'select', label: 'เลือกจากรายการ' },
  { key: 'upload', label: 'แนบไฟล์' },
  { key: 'press', label: 'กดคีย์' },
  { key: 'waitText', label: 'รอข้อความขึ้น' },
  { key: 'waitFor', label: 'รอช่องขึ้น' },
  { key: 'submit', label: 'ปุ่มส่ง (ขั้นสุดท้าย)' },
  { key: 'pause', label: 'หยุดให้คนทำ' },
  { key: 'goto', label: 'เปิดลิงก์' },
];

export const inputSchema = z.object({
  key: z.string().trim().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,30}$/, 'ชื่อตัวแปรใช้ a-z 0-9 _ และขึ้นต้นด้วยตัวอักษร'),
  label: str(100).min(1),
  multiline: z.boolean().optional(),
  assist: z.enum(['', 'slipRef', 'billing']).optional(),
});

export type TemplateInput = z.infer<typeof inputSchema>;

const httpUrl = str(1000).refine((u) => {
  try {
    return ['http:', 'https:'].includes(new URL(u).protocol);
  } catch {
    return false;
  }
}, 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://');

export const definitionSchema = z.object({
  startUrl: httpUrl,
  /** ข้อความที่เห็นเมื่อล็อกอินอยู่แล้ว — ไม่เห็นภายใน 20 วินาที worker จะรอให้คนล็อกอินก่อน */
  loggedInText: optStr(300),
  button: z.object({
    label: str(60).min(1),
    page: z.enum(['do-exchange']),
    roles: z.array(z.string().trim().max(20)).max(20),
    /** แสดงปุ่มเฉพาะงานที่ SHIPLINE ตรงรูปแบบนี้ (regex ไม่สนตัวพิมพ์) — ว่าง = ทุกงาน */
    shiplinePattern: optStr(200),
    /** ต้องมีไฟล์หมวดนี้ก่อนปุ่มจึงจะกดได้ */
    requireFile: optStr(60),
    /** ส่งสำเร็จแล้วย้ายงานไปแท็บ "ส่งแลก DO แล้ว" */
    markDoExchanged: z.boolean(),
  }),
  inputs: z.array(inputSchema).max(10),
  /** regex ดึงเลขคำขอจากหน้าหลังส่ง — กลุ่มแรกคือเลข */
  refPattern: optStr(200),
  steps: z.array(stepSchema).max(200),
}).superRefine((def, ctx) => {
  for (const pattern of [def.button.shiplinePattern, def.refPattern]) {
    if (!pattern) continue;
    try {
      new RegExp(pattern, 'i');
    } catch {
      ctx.addIssue({ code: 'custom', message: `รูปแบบ ${pattern} เขียนผิด` });
    }
  }
  const keys = def.inputs.map((i) => i.key);
  if (new Set(keys).size !== keys.length) ctx.addIssue({ code: 'custom', message: 'ชื่อตัวแปรของช่องที่ถามซ้ำกัน' });
  if (def.steps.filter((s) => s.type === 'submit').length > 1) {
    ctx.addIssue({ code: 'custom', message: 'มีปุ่มส่ง (ขั้นสุดท้าย) ได้ขั้นเดียว' });
  }
});

export type WebTemplateDefinition = z.infer<typeof definitionSchema>;

/** ข้อความผิดพลาดแรกที่อ่านออก พร้อมบอกว่าอยู่ขั้นไหน */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'ข้อมูล Template ไม่ถูกต้อง';
  const [head, index] = issue.path;
  const where = head === 'steps' && typeof index === 'number' ? `ขั้นที่ ${index + 1}: ` : '';
  return `${where}${issue.message}`;
}

export function blankDefinition(startUrl = 'https://'): WebTemplateDefinition {
  return {
    startUrl,
    button: { label: 'ส่งผ่านเว็บ', page: 'do-exchange', roles: ['ANN'], markDoExchanged: false },
    inputs: [],
    steps: [],
  };
}

/** อ่าน JSON ที่เก็บไว้ — เสียหรือไม่ผ่านตัวตรวจคืน null ให้หน้าแก้แสดงว่าต้องแก้ */
export function parseDefinition(raw: string | null): WebTemplateDefinition | null {
  if (!raw) return null;
  try {
    const parsed = definitionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/* ---------------- ตัวแปรในค่า ---------------- */

const VAR_RE = /\{\{\s*(job|input)\.([a-zA-Z0-9_]+)\s*\}\}/g;

/** แทน {{job.x}} และ {{input.x}} ด้วยค่าจริง — ตัวแปรที่ไม่มีค่าแทนด้วยค่าว่าง */
export function fillVars(text: string, vars: { job: JobVars; input: Record<string, string> }): string {
  return text.replace(VAR_RE, (_, scope: string, key: string) => {
    const bag = (scope === 'job' ? vars.job : vars.input) as Record<string, string | undefined>;
    return bag[key] ?? '';
  });
}

/** ตัวแปรที่ขั้นตอนเหล่านี้ใช้ — ใช้เตือนเวลาอ้างช่องที่ถามซึ่งไม่ได้ประกาศไว้ */
export function usedVars(def: WebTemplateDefinition) {
  const out = new Set<string>();
  const scan = (s: string | undefined) => {
    for (const m of (s ?? '').matchAll(VAR_RE)) out.add(`${m[1]}.${m[2]}`);
  };
  for (const step of def.steps) {
    for (const v of Object.values(step)) {
      if (typeof v === 'string') scan(v);
      else if (v && typeof v === 'object') for (const t of Object.values(v)) if (typeof t === 'string') scan(t);
    }
  }
  return [...out];
}

/** หมวดไฟล์ทั้งหมดที่ Template นี้แนบ */
export function uploadCategories(def: WebTemplateDefinition): string[] {
  return [...new Set(def.steps.flatMap((s) => (s.type === 'upload' ? [s.file] : [])))];
}

/**
 * แทนค่าที่บันทึกมาจากงานตัวอย่างด้วยตัวแปร
 *
 * บันทึกตอนกรอก BL ของงานตัวอย่างไว้ ถ้าเก็บตามนั้นทุกงานจะได้ BL เดียวกันหมด
 * ค่าที่สั้นกว่า 3 ตัวอักษรไม่แทน เพราะชนกับข้อความทั่วไปได้ง่าย
 * แทนค่ายาวก่อน กันเลขที่เป็นส่วนหนึ่งของอีกเลขถูกแทนผิดตัว
 */
export function templatize(value: string, sample: { job: JobVars; input: Record<string, string> }): string {
  const pairs: [string, string][] = [
    ...Object.entries(sample.job).map(([k, v]) => [String(v ?? ''), `{{job.${k}}}`] as [string, string]),
    ...Object.entries(sample.input).map(([k, v]) => [String(v ?? ''), `{{input.${k}}}`] as [string, string]),
  ].filter(([v]) => v.trim().length >= 3).sort((a, b) => b[0].length - a[0].length);

  let out = value;
  for (const [raw, token] of pairs) out = out.split(raw).join(token);
  return out;
}

/** คำอธิบายขั้นตอนสั้น ๆ ใช้ในรายการขั้นและข้อความแจ้งพัง */
export function describeTarget(t: Target): string {
  if (t.locator) return t.locator;
  if (t.role && t.name) return `${t.role} "${t.name}"`;
  if (t.label) return `ช่อง "${t.label}"`;
  if (t.placeholder) return `ช่อง "${t.placeholder}"`;
  if (t.text) return `"${t.text}"`;
  if (t.role) return t.role;
  return `${t.css ?? '?'}${t.nth ? ` #${t.nth + 1}` : ''}`;
}

export function describeStep(step: Step): string {
  switch (step.type) {
    case 'goto': return `เปิด ${step.url}`;
    case 'click': return `คลิก ${describeTarget(step.target)}${step.optional ? ' (ถ้ามี)' : ''}`;
    case 'fill': return `กรอก ${describeTarget(step.target)} = ${step.value}`;
    case 'select': return `เลือก ${describeTarget(step.target)} = ${step.value}`;
    case 'upload': return `แนบไฟล์ ${step.file} ที่ ${describeTarget(step.target)}`;
    case 'waitText': return `รอข้อความ "${step.text}"`;
    case 'waitFor': return `รอ ${describeTarget(step.target)} ขึ้น`;
    case 'press': return `กด ${step.key} ที่ ${describeTarget(step.target)}`;
    case 'submit': return `ปุ่มส่ง ${describeTarget(step.target)}`;
    case 'pause': return `หยุดให้คนทำ: ${step.message}`;
  }
}

/**
 * ตัวอย่าง — ขั้นตอนขอ D/O เว็บ CMA CGM แบบเดียวกับ scripts/do-request-worker.ts
 * ใช้เป็นจุดเริ่มต้นและเป็นตัวพิสูจน์ว่า Template ทำแทน worker ที่เขียนเองได้
 */
export const CMA_EXAMPLE: WebTemplateDefinition = {
  startUrl: 'https://mycustomerservice.cma-cgm.com/s/importdorequest',
  loggedInText: 'Create new request',
  button: {
    label: 'ส่งแลกเว็บ CMA (Template)',
    page: 'do-exchange',
    roles: ['ANN'],
    shiplinePattern: '\\b(CNC|CMA|APL|ANL)\\b',
    requireFile: 'DO_MERGED',
    markDoExchanged: true,
  },
  inputs: [
    { key: 'paymentRef', label: 'หมายเลขอ้างอิงในสลิป (Payment reference number)', assist: 'slipRef' },
    { key: 'billing', label: 'ที่อยู่ออกใบเสร็จ (Additional information)', multiline: true, assist: 'billing' },
  ],
  steps: [
    { type: 'select', target: { label: 'Service Type' }, value: 'New Delivery Order' },
    { type: 'select', target: { label: 'Agency Location' }, value: 'Thailand' },
    { type: 'fill', target: { role: 'textbox', name: 'BL Reference' }, value: '{{job.blNo}}' },
    { type: 'click', target: { role: 'button', name: 'Add' } },
    { type: 'waitText', text: '{{job.blNo}}', note: 'เลข BL ต้องขึ้นใน Approved BL Reference(s) ก่อน' },
    { type: 'click', target: { role: 'button', name: 'Next' } },
    { type: 'waitText', text: 'Upload your documents' },
    { type: 'upload', target: { css: 'input[type="file"]', nth: 0 }, file: 'DO_MERGED', note: 'Payment Document(s)' },
    { type: 'click', target: { role: 'button', name: 'Done' }, optional: true, timeout: 90 },
    { type: 'upload', target: { css: 'input[type="file"]', nth: 1 }, file: 'DO_MERGED', note: 'Supporting Document(s)' },
    { type: 'click', target: { role: 'button', name: 'Done' }, optional: true, timeout: 90 },
    { type: 'fill', target: { role: 'textbox', name: 'Payment reference number' }, value: '{{input.paymentRef}}' },
    { type: 'fill', target: { role: 'textbox', name: 'Additional information' }, value: '{{input.billing}}' },
    { type: 'submit', target: { role: 'button', name: 'Submit' } },
  ],
};
