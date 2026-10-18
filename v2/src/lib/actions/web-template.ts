'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { automationTasks, jobs, masterRecords } from '@/db/schema';
import { requireActiveSession, roleAllows } from '@/lib/auth';
import {
  blankDefinition, CMA_EXAMPLE, definitionSchema, firstIssue, uploadCategories,
  WEB_TASK, WEB_TEMPLATE_TYPE, type WebTemplateDefinition,
} from '@/lib/web-template';
import {
  currentJobFile, findJobByBl, jobVars, loadWebTemplate, openTemplateTask, replaceSteps, shiplineMatches, toSteps,
} from '@/lib/web-template-store';
import { logActivity, newId, required, runAction, text } from './common';

/**
 * Template กรอกเว็บ — ผู้ดูแลสร้าง/แก้/บันทึกขั้นตอน และคนกดปุ่มที่ Template สร้างไว้
 *
 * ตัวงานจริง (เปิดเว็บ กรอก แนบไฟล์) ทำโดย worker บนเครื่องที่ล็อกอินเว็บไว้
 * ปุ่มทุกปุ่มที่นี่แค่ใส่งานเข้าคิว automation_tasks
 */

const PATH = '/master/web-templates';

async function createImpl(formData: FormData) {
  const user = await requireActiveSession(['ADMIN']);
  const name = required(formData.get('name'), 'ชื่อ Template', 100);
  const example = text(formData.get('example'), 20) === 'cma';
  const definition = example ? CMA_EXAMPLE : blankDefinition(text(formData.get('startUrl'), 1000) || 'https://');

  const id = newId('WTP');
  await db.insert(masterRecords).values({
    id, type: WEB_TEMPLATE_TYPE, code: id, name,
    value: JSON.stringify(definition),
    // ปิดไว้ก่อนจนกว่าจะทดลองรันผ่าน ปุ่มจะได้ไม่โผล่ให้คนใช้ระหว่างที่ยังแก้อยู่
    isActive: false,
  });
  await logActivity(user.id, 'CREATE_WEB_TEMPLATE', 'MASTER', id, { name, example });
  redirect(`${PATH}/${id}`);
}

async function saveImpl(formData: FormData) {
  const user = await requireActiveSession(['ADMIN']);
  const id = required(formData.get('id'), 'Template', 80);
  const name = required(formData.get('name'), 'ชื่อ Template', 100);
  const isActive = formData.get('isActive') === 'on';

  let json: unknown;
  try {
    json = JSON.parse(String(formData.get('definition') ?? ''));
  } catch {
    throw new Error('JSON ของ Template อ่านไม่ได้');
  }
  const parsed = definitionSchema.safeParse(json);
  if (!parsed.success) throw new Error(firstIssue(parsed.error));
  if (isActive && !parsed.data.steps.length) throw new Error('ยังไม่มีขั้นตอน เปิดใช้ไม่ได้');

  const template = await loadWebTemplate(id);
  if (!template) throw new Error('ไม่พบ Template');
  await db.update(masterRecords).set({
    name, isActive, value: JSON.stringify(parsed.data), updatedAt: new Date(),
  }).where(eq(masterRecords.id, id));
  await logActivity(user.id, 'SAVE_WEB_TEMPLATE', 'MASTER', id, { name, isActive, steps: parsed.data.steps.length });

  revalidatePath(PATH);
  revalidatePath('/do-exchange');
  redirect(`${PATH}/${id}?ok=${encodeURIComponent('บันทึกแล้ว')}`);
}

async function deleteImpl(formData: FormData) {
  const user = await requireActiveSession(['ADMIN']);
  const id = required(formData.get('id'), 'Template', 80);
  await db.delete(masterRecords)
    .where(and(eq(masterRecords.id, id), eq(masterRecords.type, WEB_TEMPLATE_TYPE)));
  await logActivity(user.id, 'DELETE_WEB_TEMPLATE', 'MASTER', id, {});
  revalidatePath('/do-exchange');
  redirect(PATH);
}

/** ค่าจากงานตัวอย่าง — ใช้ทั้งตอนบันทึก (แทนค่าเป็นตัวแปร) และตอนทดลองรัน */
async function sampleJob(formData: FormData, need: boolean) {
  const bl = text(formData.get('sampleBl'), 80);
  if (!bl) {
    if (need) throw new Error('กรุณากรอกเลข BL ของงานที่ใช้ทดลอง');
    return null;
  }
  const jobId = await findJobByBl(bl);
  if (!jobId) throw new Error(`ไม่พบงาน BL ${bl}`);
  const vars = await jobVars(jobId);
  if (!vars) throw new Error(`ไม่พบงาน BL ${bl}`);
  return { jobId, vars };
}

async function recordImpl(formData: FormData) {
  const user = await requireActiveSession(['ADMIN']);
  const template = await loadWebTemplate(required(formData.get('id'), 'Template', 80));
  if (!template) throw new Error('ไม่พบ Template');
  const startUrl = text(formData.get('startUrl'), 1000) || template.definition?.startUrl || '';
  if (!/^https?:\/\//.test(startUrl)) throw new Error('กรุณากรอกลิงก์หน้าแรกที่จะเริ่มบันทึก');
  if (await openTemplateTask(WEB_TASK.RECORD, template.id, null)) throw new Error('มีงานบันทึกของ Template นี้รออยู่แล้ว');

  const sample = await sampleJob(formData, false);
  const recorder = text(formData.get('recorder'), 20) === 'kola' ? 'kola' : 'codegen';
  const id = newId('TASK');
  await db.insert(automationTasks).values({
    id, type: WEB_TASK.RECORD, status: 'QUEUED', jobId: null,
    payload: JSON.stringify({
      templateId: template.id, templateName: template.name, startUrl, recorder,
      // codegen เริ่มบันทึกหลังเห็นข้อความนี้ ขั้นตอนล็อกอินจะได้ไม่ถูกเก็บ
      loggedInText: template.definition?.loggedInText,
      sample: sample?.vars ?? {}, requestedBy: user.id,
    }),
  });
  await logActivity(user.id, 'QUEUE_WEB_RECORD', 'MASTER', template.id, { taskId: id });
  revalidatePath(`${PATH}/${template.id}`);
}

/**
 * วางโค้ดจาก npx playwright codegen ที่รันเองบนเครื่องไหนก็ได้ — แปลงเป็นขั้นตอนแทนชุดเดิม
 * ไม่ได้รันโค้ดนั้น แค่อ่าน (src/lib/playwright-code.ts)
 */
async function importCodeImpl(formData: FormData) {
  const user = await requireActiveSession(['ADMIN']);
  const template = await loadWebTemplate(required(formData.get('id'), 'Template', 80));
  if (!template) throw new Error('ไม่พบ Template');
  const code = required(formData.get('code'), 'โค้ดจาก codegen', 200_000);
  const sample = await sampleJob(formData, false);

  const result = toSteps({ code }, { job: sample?.vars ?? {}, input: {} });
  if (!result.steps.length) {
    throw new Error(`ไม่พบขั้นตอนในโค้ด${result.skipped.length ? ` (ข้าม: ${result.skipped[0]})` : ''}`);
  }
  await replaceSteps(template.id, result.steps, result.startUrl);
  await logActivity(user.id, 'IMPORT_WEB_TEMPLATE_CODE', 'MASTER', template.id, { steps: result.steps.length });

  const note = [
    `นำเข้า ${result.steps.length} ขั้น`,
    result.dropped ? `ทิ้ง ${result.dropped} ขั้นที่อ่านไม่ได้` : '',
    result.skipped.length ? `ข้าม ${result.skipped.length} บรรทัด: ${result.skipped.slice(0, 3).join(' | ')}` : '',
  ].filter(Boolean).join(' · ');
  redirect(`${PATH}/${template.id}?ok=${encodeURIComponent(note.slice(0, 600))}`);
}

/** ค่าที่ถามตอนกดปุ่ม — ชื่อช่องในฟอร์มคือ input.<key> */
function readInputs(def: WebTemplateDefinition, formData: FormData) {
  const input: Record<string, string> = {};
  for (const field of def.inputs) {
    input[field.key] = required(formData.get(`input.${field.key}`), field.label, 4000);
  }
  return input;
}

/**
 * ตรวจงานกับ Template ให้ครบก่อนเข้าคิว — ไฟล์ที่ต้องแนบต้องมีอยู่จริง
 * ไม่งั้น worker จะเปิดเว็บกรอกไปครึ่งทางแล้วค่อยพังตอนแนบไฟล์
 */
async function checkJobFiles(def: WebTemplateDefinition, jobId: string) {
  const categories = uploadCategories(def);
  const needed = [...new Set([...categories, ...(def.button.requireFile ? [def.button.requireFile] : [])])];
  for (const category of needed) {
    if (!(await currentJobFile(jobId, category))) throw new Error(`งานนี้ยังไม่มีไฟล์หมวด ${category}`);
  }
  return categories;
}

async function testImpl(formData: FormData) {
  const user = await requireActiveSession(['ADMIN']);
  const template = await loadWebTemplate(required(formData.get('id'), 'Template', 80));
  if (!template?.definition) throw new Error('Template นี้ยังแก้ไม่เสร็จ (JSON ไม่ผ่านตัวตรวจ)');
  const def = template.definition;
  if (!def.steps.length) throw new Error('ยังไม่มีขั้นตอน');

  const sample = (await sampleJob(formData, true))!;
  const input = readInputs(def, formData);
  const files = await checkJobFiles(def, sample.jobId);

  const id = newId('TASK');
  await db.insert(automationTasks).values({
    id, type: WEB_TASK.RUN, status: 'QUEUED', jobId: sample.jobId,
    payload: JSON.stringify({
      templateId: template.id, templateName: template.name, definition: def,
      vars: { job: sample.vars, input }, files, dryRun: true, requestedBy: user.id,
    }),
  });
  await logActivity(user.id, 'QUEUE_WEB_TEST', 'MASTER', template.id, { taskId: id, jobId: sample.jobId });
  revalidatePath(`${PATH}/${template.id}`);
}

/** คนกดปุ่มที่ Template สร้างไว้ในหน้างาน */
async function queueImpl(formData: FormData) {
  const user = await requireActiveSession();
  const jobId = required(formData.get('jobId'), 'งาน', 80);
  const template = await loadWebTemplate(required(formData.get('templateId'), 'Template', 80));
  const def = template?.definition;
  if (!template || !def || !template.isActive) throw new Error('Template นี้ปิดใช้งานอยู่');
  if (!roleAllows(user.role, def.button.roles)) throw new Error('คุณไม่มีสิทธิ์ใช้ปุ่มนี้');

  const [job] = await db.select({ shipline: jobs.shipline, doExchangedAt: jobs.doExchangedAt })
    .from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) throw new Error('ไม่พบงาน');
  if (!shiplineMatches(def, job.shipline)) throw new Error('สายเรือของงานนี้ไม่ตรงกับ Template');
  if (def.button.markDoExchanged && job.doExchangedAt) throw new Error('ส่งแลก DO ไปแล้ว');
  if (await openTemplateTask(WEB_TASK.RUN, template.id, jobId)) throw new Error('งานนี้อยู่ในคิวแล้ว');

  const vars = await jobVars(jobId);
  if (!vars) throw new Error('ไม่พบงาน');
  const input = readInputs(def, formData);
  const files = await checkJobFiles(def, jobId);

  const id = newId('TASK');
  await db.insert(automationTasks).values({
    id, type: WEB_TASK.RUN, status: 'QUEUED', jobId,
    // เก็บขั้นตอนชุดที่ใช้ตอนกดไว้ในงานเลย แก้ Template ระหว่างที่งานรอคิวจะได้ไม่กระทบ
    payload: JSON.stringify({
      templateId: template.id, templateName: template.name, definition: def,
      vars: { job: vars, input }, files, requestedBy: user.id,
    }),
  });
  await logActivity(user.id, 'QUEUE_WEB_TEMPLATE', 'JOB', jobId, { taskId: id, templateId: template.id });
  revalidatePath('/do-exchange');
}

/** ยกเลิกงานที่ยังรออยู่ — worker ยังไม่ได้หยิบไปทำ */
async function cancelImpl(formData: FormData) {
  const user = await requireActiveSession();
  const taskId = required(formData.get('taskId'), 'งาน', 80);
  const [task] = await db.select().from(automationTasks).where(eq(automationTasks.id, taskId)).limit(1);
  if (!task || (task.type !== WEB_TASK.RUN && task.type !== WEB_TASK.RECORD)) throw new Error('ไม่พบงานในคิว');
  let requestedBy = '';
  try { requestedBy = String(JSON.parse(task.payload ?? '{}').requestedBy ?? ''); } catch { /* ไม่มีเจ้าของ */ }
  if (requestedBy !== user.id && user.role !== 'ADMIN') throw new Error('ยกเลิกได้เฉพาะงานที่ตัวเองกด');
  // งานที่ worker กำลังกรอกเว็บอยู่ ยกเลิกกลางทางไม่ได้ เพราะอาจกดส่งไปแล้ว
  if (task.status !== 'QUEUED') throw new Error('worker เริ่มทำงานนี้แล้ว ยกเลิกไม่ได้');

  await db.update(automationTasks).set({
    status: 'ERROR', error: 'ยกเลิกโดยผู้ใช้', completedAt: new Date(), updatedAt: new Date(),
  }).where(eq(automationTasks.id, taskId));
  await logActivity(user.id, 'CANCEL_WEB_TASK', 'TASK', taskId, {});
  revalidatePath('/do-exchange');
  revalidatePath(PATH, 'layout');
}

export async function createWebTemplate(formData: FormData) { return runAction(() => createImpl(formData)); }
export async function saveWebTemplate(formData: FormData) { return runAction(() => saveImpl(formData)); }
export async function deleteWebTemplate(formData: FormData) { return runAction(() => deleteImpl(formData)); }
export async function importWebTemplateCode(formData: FormData) { return runAction(() => importCodeImpl(formData)); }
export async function recordWebTemplate(formData: FormData) { return runAction(() => recordImpl(formData)); }
export async function testWebTemplate(formData: FormData) { return runAction(() => testImpl(formData)); }
export async function queueWebTemplate(formData: FormData) { return runAction(() => queueImpl(formData)); }
export async function cancelWebTask(formData: FormData) { return runAction(() => cancelImpl(formData)); }
