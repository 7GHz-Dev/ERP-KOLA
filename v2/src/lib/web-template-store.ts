import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { automationTasks, files, jobs, masterRecords } from '@/db/schema';
import { roleAllows } from '@/lib/auth';
import { downloadFile } from '@/lib/storage';
import { parseCodegen } from '@/lib/playwright-code';
import {
  blankDefinition, definitionSchema, parseDefinition, stepSchema, templatize,
  WEB_TASK, WEB_TEMPLATE_TYPE, type JobVars, type Step, type WebTemplateDefinition,
} from '@/lib/web-template';

/**
 * ที่เก็บ Template กรอกเว็บ — อ่าน/เขียนแถวใน master_records และงานในคิวที่เกี่ยวข้อง
 * ตัวตรวจและค่าคงที่อยู่ที่ web-template.ts ซึ่งไม่แตะฐานข้อมูล
 */

export type WebTemplateRow = {
  id: string;
  name: string;
  isActive: boolean;
  updatedAt: Date;
  raw: string | null;
  /** null = JSON ในฐานเสียหรือไม่ผ่านตัวตรวจ ต้องแก้ที่หน้า JSON */
  definition: WebTemplateDefinition | null;
};

const columns = {
  id: masterRecords.id, name: masterRecords.name, isActive: masterRecords.isActive,
  updatedAt: masterRecords.updatedAt, raw: masterRecords.value,
};

const toRow = (r: Omit<WebTemplateRow, 'definition'>): WebTemplateRow => ({ ...r, definition: parseDefinition(r.raw) });

export async function listWebTemplates(): Promise<WebTemplateRow[]> {
  const rows = await db.select(columns).from(masterRecords)
    .where(eq(masterRecords.type, WEB_TEMPLATE_TYPE))
    .orderBy(masterRecords.name);
  return rows.map(toRow);
}

export async function loadWebTemplate(id: string): Promise<WebTemplateRow | null> {
  const [row] = await db.select(columns).from(masterRecords)
    .where(and(eq(masterRecords.type, WEB_TEMPLATE_TYPE), eq(masterRecords.id, id)))
    .limit(1);
  return row ? toRow(row) : null;
}

/** Template ที่เปิดใช้และวางปุ่มไว้ที่หน้านี้ เฉพาะที่ role ของผู้ใช้กดได้ */
export async function templateButtonsFor(page: string, role: string) {
  const all = await listWebTemplates();
  return all.flatMap((t) => {
    const def = t.definition;
    if (!t.isActive || !def || def.button.page !== page) return [];
    if (!roleAllows(role, def.button.roles)) return [];
    return [{ id: t.id, name: t.name, definition: def }];
  });
}

export type TemplateButton = Awaited<ReturnType<typeof templateButtonsFor>>[number];

/** SHIPLINE ของงานเข้ารูปแบบของปุ่มไหม — รูปแบบว่างคือทุกงาน */
export function shiplineMatches(def: WebTemplateDefinition, shipline: string | null) {
  if (!def.button.shiplinePattern) return true;
  try {
    return new RegExp(def.button.shiplinePattern, 'i').test(shipline ?? '');
  } catch {
    return false;
  }
}

/** ค่าของงานที่ Template ใช้แทน {{job.x}} */
export async function jobVars(jobId: string): Promise<JobVars | null> {
  const [job] = await db.select({
    blNo: jobs.blNo, jobNo: jobs.jobNo, vessel: jobs.vessel, voyage: jobs.voyage,
    eta: jobs.eta, shipline: jobs.shipline, originPort: jobs.originPort,
    consignee: sql<string | null>`consignee.name`,
  }).from(jobs)
    .leftJoin(sql`${masterRecords} as consignee`, sql`consignee.id = ${jobs.consigneeId}`)
    .where(eq(jobs.id, jobId)).limit(1);
  if (!job) return null;
  const eta = job.eta ? String(job.eta).slice(0, 10) : '';
  const [y, m, d] = eta.split('-');
  return {
    blNo: (job.blNo ?? '').trim(), jobNo: job.jobNo, vessel: job.vessel ?? '', voyage: job.voyage ?? '',
    eta, etaSlash: eta ? `${d}/${m}/${y}` : '', shipline: job.shipline ?? '',
    consignee: job.consignee ?? '', originPort: job.originPort ?? '',
  };
}

export async function findJobByBl(blNo: string) {
  const [job] = await db.select({ id: jobs.id }).from(jobs)
    .where(and(sql`upper(trim(${jobs.blNo})) = ${blNo.trim().toUpperCase()}`, eq(jobs.isArchived, false)))
    .orderBy(desc(jobs.createdAt)).limit(1);
  return job?.id ?? null;
}

/** ไฟล์ล่าสุดของงานในหมวดนั้น — หมวดที่มีหลายใบ (เช่น Slip) เอาใบที่อัปล่าสุด */
export async function currentJobFile(jobId: string, category: string) {
  const [file] = await db.select({ storageKey: files.storageKey, fileName: files.fileName })
    .from(files)
    .where(and(eq(files.jobId, jobId), eq(files.category, category), eq(files.isCurrent, true)))
    .orderBy(desc(files.uploadedAt)).limit(1);
  return file ?? null;
}

/* ---------------- งานในคิว ---------------- */

/** templateId ในงานคิว — ใช้ CASE ให้แปลง JSON เฉพาะงานของ Template กันงานชนิดอื่นที่ payload ไม่ใช่ JSON */
const templateIdOf = sql<string>`case when ${automationTasks.type} in (${WEB_TASK.RUN}, ${WEB_TASK.RECORD})
  then ${automationTasks.payload}::jsonb ->> 'templateId' end`;
const dryRunOf = sql<boolean>`case when ${automationTasks.type} = ${WEB_TASK.RUN}
  then coalesce((${automationTasks.payload}::jsonb ->> 'dryRun')::boolean, false) else false end`;

export type WebTaskState = {
  id: string; status: string; error: string | null; resultRefNo: string | null; hasShot: boolean;
};

/**
 * งานล่าสุด (ไม่นับทดลองรัน) ของแต่ละงาน ไม่ว่า Template ไหน — ปุ่ม "ส่งแลกผ่าน web" มีปุ่มเดียวต่อแถว
 * label คือชื่อปุ่มของ Template ที่ใช้ตอนกด
 */
export async function webTasksFor(jobIds: string[]) {
  const map = new Map<string, WebTaskState & { label: string }>();
  if (!jobIds.length) return map;
  const rows = await db.select({
    id: automationTasks.id, jobId: automationTasks.jobId, status: automationTasks.status,
    error: automationTasks.error, resultRefNo: automationTasks.resultRefNo,
    resultStorageKey: automationTasks.resultStorageKey, dryRun: dryRunOf,
    label: sql<string | null>`case when ${automationTasks.type} = ${WEB_TASK.RUN}
      then coalesce(${automationTasks.payload}::jsonb #>> '{definition,button,label}', ${automationTasks.payload}::jsonb ->> 'templateName') end`,
  }).from(automationTasks)
    .where(and(inArray(automationTasks.jobId, jobIds), eq(automationTasks.type, WEB_TASK.RUN)))
    .orderBy(desc(automationTasks.createdAt));
  for (const r of rows) {
    if (r.dryRun || !r.jobId || map.has(r.jobId)) continue;
    map.set(r.jobId, {
      id: r.id, status: r.status, error: r.error, resultRefNo: r.resultRefNo,
      hasShot: r.status === 'ERROR' && Boolean(r.resultStorageKey), label: r.label ?? 'web',
    });
  }
  return map;
}

/** งานล่าสุดของ Template หนึ่ง ทั้งบันทึก ทดลอง และใช้จริง — แสดงที่หน้าแก้ Template */
export async function templateTasks(templateId: string, limit = 15) {
  const rows = await db.select({
    id: automationTasks.id, type: automationTasks.type, status: automationTasks.status,
    error: automationTasks.error, resultRefNo: automationTasks.resultRefNo,
    resultStorageKey: automationTasks.resultStorageKey,
    createdAt: automationTasks.createdAt, completedAt: automationTasks.completedAt,
    claimedBy: automationTasks.claimedBy, blNo: jobs.blNo, dryRun: dryRunOf,
  }).from(automationTasks)
    .leftJoin(jobs, eq(jobs.id, automationTasks.jobId))
    .where(and(
      inArray(automationTasks.type, [WEB_TASK.RUN, WEB_TASK.RECORD]),
      sql`${templateIdOf} = ${templateId}`,
    ))
    .orderBy(desc(automationTasks.createdAt))
    .limit(limit);
  return rows.map(({ resultStorageKey, ...r }) => ({ ...r, hasShot: Boolean(resultStorageKey) }));
}

/** งานที่ยังไม่จบของคู่ งาน×Template เดียวกัน — กดซ้ำไม่สร้างงานใหม่ */
export async function openTemplateTask(type: string, templateId: string, jobId: string | null) {
  const [row] = await db.select({ id: automationTasks.id }).from(automationTasks)
    .where(and(
      eq(automationTasks.type, type),
      inArray(automationTasks.status, ['QUEUED', 'PROCESSING']),
      sql`${templateIdOf} = ${templateId}`,
      jobId ? eq(automationTasks.jobId, jobId) : sql`true`,
    ))
    .limit(1);
  return row ?? null;
}

/* ---------------- ฝั่ง worker ---------------- */

async function processingTask(taskId: string, type: string) {
  const [task] = await db.select().from(automationTasks).where(eq(automationTasks.id, taskId)).limit(1);
  if (!task || task.type !== type) throw new Error('ไม่พบงานในคิว');
  if (task.status !== 'PROCESSING') throw new Error('งานนี้ไม่ได้อยู่ระหว่างทำ');
  let payload: Record<string, any> = {};
  try { payload = JSON.parse(task.payload ?? '{}'); } catch { /* ใช้ค่าว่าง */ }
  return { task, payload };
}

/**
 * ไฟล์ของงานที่ worker จะแนบ — ให้เฉพาะหมวดที่ Template ประกาศไว้ตอนเข้าคิว
 * worker จึงขอไฟล์อื่นของงานเดียวกันไม่ได้ ถึงจะรู้ taskId
 */
export async function downloadTaskFile(taskId: string, category: string) {
  const { task, payload } = await processingTask(taskId, WEB_TASK.RUN);
  const allowed: string[] = Array.isArray(payload.files) ? payload.files : [];
  if (!allowed.includes(category)) throw new Error(`Template นี้ไม่ได้แนบไฟล์หมวด ${category}`);
  if (!task.jobId) throw new Error('งานนี้ไม่ได้ผูกกับ Job');
  const file = await currentJobFile(task.jobId, category);
  if (!file) throw new Error(`งานนี้ยังไม่มีไฟล์หมวด ${category}`);
  const { body, contentType } = await downloadFile(file.storageKey);
  return { fileName: file.fileName, mimeType: contentType, base64: body.toString('base64') };
}

/**
 * แปลงผลบันทึกเป็นขั้นตอน — ขั้นตอนตรง ๆ (แถบบันทึกของระบบ) หรือโค้ด Playwright codegen
 *
 * ตรวจทีละขั้น ขั้นที่ไม่ผ่านตัวตรวจทิ้งไปแล้วบอกจำนวน ดีกว่าทิ้งทั้งชุดเพราะขั้นเดียวเพี้ยน
 * ค่าที่ตรงกับงานตัวอย่าง (เช่นเลข BL) แทนเป็น {{job.x}} ให้เลย
 */
export function toSteps(input: { steps?: unknown; code?: unknown }, sample: { job: JobVars; input: Record<string, string> }) {
  let raw: unknown[] = Array.isArray(input.steps) ? input.steps : [];
  let startUrl: string | undefined;
  let skipped: string[] = [];
  let warnings: string[] = [];
  if (typeof input.code === 'string' && input.code.trim()) {
    const parsed = parseCodegen(input.code.slice(0, 200_000));
    raw = parsed.steps;
    startUrl = parsed.startUrl;
    skipped = parsed.skipped;
    warnings = parsed.warnings;
  }
  const steps: Step[] = [];
  let dropped = 0;
  for (const item of raw.slice(0, 200)) {
    const parsed = stepSchema.safeParse(item);
    if (!parsed.success) { dropped++; continue; }
    const step = parsed.data;
    if (step.type === 'fill' || step.type === 'select') step.value = templatize(step.value, sample);
    if (step.type === 'waitText') step.text = templatize(step.text, sample);
    if ('target' in step) {
      for (const key of ['name', 'text', 'locator'] as const) {
        if (step.target[key]) step.target[key] = templatize(step.target[key]!, sample);
      }
    }
    steps.push(step);
  }
  return { steps, startUrl, dropped, skipped, warnings };
}

/** เก็บขั้นตอนชุดใหม่แทนชุดเดิมของ Template */
export async function replaceSteps(templateId: string, steps: Step[], startUrl?: string) {
  const template = await loadWebTemplate(templateId);
  if (!template) throw new Error('ไม่พบ Template');
  const base = template.definition ?? blankDefinition();
  const next = { ...base, steps };
  if (startUrl && /^https?:\/\//.test(startUrl)) next.startUrl = startUrl.slice(0, 1000);
  const checked = definitionSchema.safeParse(next);
  // ขั้นตอนผ่านทีละตัวแล้ว แต่ชุดรวมอาจติดกติกาข้ามขั้น (เช่นปุ่มส่งสองขั้น) — เก็บไว้ก่อนให้ไปแก้ที่หน้า
  const value = JSON.stringify(checked.success ? checked.data : next);
  await db.update(masterRecords).set({ value, updatedAt: new Date() }).where(eq(masterRecords.id, template.id));
}

/** ผลบันทึกจาก worker → แทนที่ขั้นตอนเดิมของ Template */
export async function saveRecording(taskId: string, input: { startUrl?: unknown; steps?: unknown; code?: unknown }) {
  const { task, payload } = await processingTask(taskId, WEB_TASK.RECORD);
  const sample = { job: (payload.sample ?? {}) as JobVars, input: {} as Record<string, string> };
  const result = toSteps(input, sample);
  if (!result.steps.length) throw new Error('ไม่มีขั้นตอนที่ใช้ได้');
  const startUrl = result.startUrl ?? (typeof input.startUrl === 'string' ? input.startUrl : undefined);
  await replaceSteps(String(payload.templateId ?? ''), result.steps, startUrl);

  const notes = [
    result.warnings.length ? `ต้องแก้ ${result.warnings.length} ขั้น (locator ว่าง)` : '',
    result.dropped ? `ทิ้ง ${result.dropped} ขั้นที่อ่านไม่ได้` : '',
    result.skipped.length ? `ข้าม ${result.skipped.length} บรรทัด: ${result.skipped.join(' | ')}` : '',
  ].filter(Boolean).join(' · ');
  await db.update(automationTasks).set({
    status: 'DONE', error: notes ? notes.slice(0, 1000) : null,
    resultRefNo: `${result.steps.length} ขั้น`, completedAt: new Date(), updatedAt: new Date(),
  }).where(eq(automationTasks.id, task.id));
  return { saved: result.steps.length, dropped: result.dropped, skipped: result.skipped };
}
