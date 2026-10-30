import { NextResponse } from 'next/server';
import { and, asc, eq, inArray, lt, ne, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { automationTasks } from '@/db/schema';
import { downloadFile } from '@/lib/storage';
import { completeTask, CUSTOMS_TASK_TYPES, failTask, TASK_TYPES } from '@/lib/automation';
import { monitorTasks, recordCustomsCheck, takeMonitorLease } from '@/lib/customs-monitor';
import { downloadTaskFile, saveRecording } from '@/lib/web-template-store';
import { recordHeartbeat } from '@/lib/worker-status';
import { assignNetbayAccount } from '@/lib/netbay-accounts';
import { engineLookup, issueEngineNumbers } from '@/lib/engine-numbers';

/**
 * REST สำหรับโปรแกรม Python
 *
 * POST /api/worker  body: { key, fn, args }
 * ยืนยันตัวตนด้วย WORKER_API_KEY อย่างเดียว ไม่ใช้ session ของผู้ใช้
 * คำสั่งจำกัดไว้เท่าที่ worker ต้องใช้จริง ยัดงานเข้าคิวเองไม่ได้
 */

const CLAIM_TIMEOUT_MINUTES = 30;
const WORKER_ACTOR = 'WORKER';

function unauthorized() {
  return NextResponse.json({ ok: false, error: 'UNAUTHORIZED|API key ไม่ถูกต้อง' }, { status: 401 });
}

/** งานถัดไปในคิว — งานที่ค้าง PROCESSING เกินเวลาถือว่า worker ตาย ปล่อยให้ตัวอื่นรับต่อ */
async function claimNext(args: any) {
  const type = String(args?.type ?? '').trim();
  const worker = String(args?.worker ?? 'worker').slice(0, 80);
  const staleBefore = new Date(Date.now() - CLAIM_TIMEOUT_MINUTES * 60_000);

  const conditions = [
    or(
      eq(automationTasks.status, 'QUEUED'),
      and(eq(automationTasks.status, 'PROCESSING'), lt(automationTasks.claimedAt, staleBefore)),
    )!,
  ];
  // ไม่ระบุชนิด = worker ใบขนรุ่นเดิม ให้เห็นเฉพาะงานใบขน ไม่คว้างานขอ D/O ไปทำผิดตัว
  conditions.push(type ? eq(automationTasks.type, type) : inArray(automationTasks.type, CUSTOMS_TASK_TYPES));
  /*
   * งาน Draft ที่กดจากเครื่องไหน ให้เครื่องนั้นทำ (payload.local) — worker กลางไม่หยิบ
   * เครื่องที่กดเปิด worker เฉพาะงานนั้นผ่านลิงก์ kola-worker://draft?task=… แล้วหยิบด้วย claimTask
   */
  conditions.push(sql`coalesce(${automationTasks.payload}, '') not like '%"local":true%'`);
  /*
   * งานสร้างใบขนไม่มีใครหยิบไปทำ — ตัว monitor (worker:customs) เช็กสถานะใน NETBAY ทุกรายการที่ค้างเอง
   * ถ้า worker ตัวอื่นหยิบไป งานจะค้าง PROCESSING และไม่มีใครดึงเลขใบขนกลับมา
   */
  conditions.push(ne(automationTasks.type, TASK_TYPES.CUSTOMS));

  const [task] = await db.select().from(automationTasks)
    .where(and(...conditions)).orderBy(asc(automationTasks.createdAt)).limit(1);
  if (!task) return { task: null };

  await db.update(automationTasks).set({
    status: 'PROCESSING', claimedBy: worker, claimedAt: new Date(),
    attempts: task.attempts + 1, updatedAt: new Date(),
  }).where(eq(automationTasks.id, task.id));

  let payload: unknown = {};
  try { payload = JSON.parse(task.payload ?? '{}'); } catch { payload = {}; }

  return {
    task: {
      id: task.id, type: task.type, jobId: task.jobId, data: payload,
      hasInputFile: Boolean(task.inputStorageKey), inputFileName: task.inputFileName,
      attempts: task.attempts + 1,
    },
  };
}

/** หยิบงานที่ระบุ — worker ที่เครื่องผู้กดเปิดขึ้นมาเพื่องานนี้โดยเฉพาะ (ลิงก์ kola-worker://draft?task=…) */
async function claimTask(args: any) {
  const taskId = String(args?.taskId ?? '').trim();
  const worker = String(args?.worker ?? 'worker').slice(0, 80);
  const staleBefore = new Date(Date.now() - CLAIM_TIMEOUT_MINUTES * 60_000);
  const [task] = await db.select().from(automationTasks).where(eq(automationTasks.id, taskId)).limit(1);
  if (!task) throw new Error('ไม่พบงานในคิว');
  if (task.status === 'DONE') throw new Error('งานนี้ทำเสร็จไปแล้ว');
  if (task.status === 'ERROR') throw new Error('งานนี้ถูกยกเลิกหรือไม่สำเร็จไปแล้ว — กดสร้างใหม่ที่ ERP');
  if (task.status === 'PROCESSING' && task.claimedAt && task.claimedAt > staleBefore) {
    throw new Error(`งานนี้มี worker ${task.claimedBy ?? ''} ทำอยู่แล้ว`);
  }
  const [claimed] = await db.update(automationTasks).set({
    status: 'PROCESSING', claimedBy: worker, claimedAt: new Date(),
    attempts: task.attempts + 1, updatedAt: new Date(),
  }).where(and(eq(automationTasks.id, task.id), eq(automationTasks.status, task.status)))
    .returning({ id: automationTasks.id });
  if (!claimed) throw new Error('งานนี้ถูกหยิบไปพร้อมกันพอดี');

  let payload: unknown = {};
  try { payload = JSON.parse(task.payload ?? '{}'); } catch { payload = {}; }
  return {
    task: {
      id: task.id, type: task.type, jobId: task.jobId, data: payload,
      hasInputFile: Boolean(task.inputStorageKey), inputFileName: task.inputFileName,
      attempts: task.attempts + 1,
    },
  };
}

async function downloadInput(args: any) {
  const [task] = await db.select().from(automationTasks)
    .where(eq(automationTasks.id, String(args?.taskId ?? ''))).limit(1);
  if (!task?.inputStorageKey) throw new Error('งานนี้ไม่มีไฟล์แนบ');
  const { body, contentType } = await downloadFile(task.inputStorageKey);
  return {
    fileName: task.inputFileName,
    mimeType: contentType,
    base64: body.toString('base64'),
  };
}

/** ไฟล์ที่ worker ส่งกลับมา (ผลลัพธ์ หรือภาพหน้าจอ) */
function fileArg(args: any, key = 'file') {
  const f = args?.[key];
  return f?.base64
    ? {
        name: String(f.name ?? 'result'),
        mimeType: String(f.mimeType ?? 'application/octet-stream'),
        body: Buffer.from(String(f.base64), 'base64'),
      }
    : undefined;
}

/** รายการข้อความจาก worker — ตัดให้อยู่ในกรอบ กันส่งของแปลกเข้ามา */
const strings = (v: unknown, max = 500) =>
  (Array.isArray(v) ? v : []).map((s) => String(s ?? '').trim().slice(0, 80)).filter(Boolean).slice(0, max);

/** งานในคิวที่ worker ถืออยู่ — ออกเลขเครื่องได้เฉพาะงาน DRAFT_ENTRY ที่กำลังทำ */
async function draftTask(taskId: string) {
  const [task] = await db.select().from(automationTasks).where(eq(automationTasks.id, taskId)).limit(1);
  if (!task || task.type !== 'DRAFT_ENTRY') throw new Error('ไม่พบงาน Draft ใบขนนี้ในคิว');
  if (task.status !== 'PROCESSING') throw new Error(`งานนี้สถานะ ${task.status} ไม่ได้อยู่ระหว่างทำ`);
  return task;
}

const HANDLERS: Record<string, (args: any) => Promise<unknown>> = {
  claimNext,
  claimTask,
  downloadInputFile: downloadInput,

  // บัญชี NETBAY ของเครื่องนี้ — ตัวติดตั้งขอตอนติดตั้ง (เครื่องละบัญชี กัน login ชนกันแล้วหลุด)
  async netbayAccount(args: any) {
    return assignNetbayAccount(String(args?.machine ?? ''));
  },

  // Template กรอกเว็บ — ไฟล์ของงานตามหมวดที่ Template แนบ และขั้นตอนที่บันทึกมา
  async downloadTaskFile(args: any) {
    return downloadTaskFile(String(args?.taskId ?? ''), String(args?.category ?? ''));
  },
  // worker ยังเปิดอยู่ — หน้าแลก DO ใช้บอกสถานะ
  async heartbeat(args: any) {
    const settings = await recordHeartbeat(String(args?.worker ?? ''), {
      busy: args?.busy, mode: args?.mode, platform: args?.platform, headless: args?.headless,
      log: args?.log, shot: args?.shot, offline: Boolean(args?.offline),
    });
    // ตอบค่าตั้งที่ ANN สั่งจากหน้าเว็บกลับไป (ทำงานเบื้องหลัง · ปิด worker)
    return { settings };
  },
  // เลขเครื่องของงาน Draft ใบขน — ตรวจเลขซ้ำ/ใช้เลขเดิม แล้วออกเลขใหม่ใน transaction เดียว
  async engineLookup(args: any) {
    return { rows: await engineLookup(strings(args?.numbers), strings(args?.chassis)) };
  },
  async engineIssue(args: any) {
    const task = await draftTask(String(args?.taskId ?? ''));
    const s = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max);
    const issue = (Array.isArray(args?.issue) ? args.issue : []).slice(0, 500)
      .map((c: any) => ({ head: s(c?.head, 80), chassis: s(c?.chassis, 80) }));
    const add = (Array.isArray(args?.add) ? args.add : []).slice(0, 500)
      .map((c: any) => ({ number: s(c?.number, 20), full: s(c?.full, 80), chassis: s(c?.chassis, 80) }));
    if ([...issue, ...add].some((c) => !c.chassis) || issue.some((c: { head: string }) => !c.head)
      || add.some((c: { number: string }) => !/^\d{7}$/.test(c.number))) {
      throw new Error('ข้อมูลเลขเครื่องไม่ครบ');
    }
    const issued = await issueEngineNumbers({
      taskId: task.id, jobId: task.jobId, blNo: s(args?.blNo), invoiceNo: s(args?.invoiceNo),
      sourceFile: s(args?.sourceFile, 300), issue, add,
    });
    return { issued };
  },

  /*
   * ตัว monitor ใบขน (worker:customs) — เครื่องที่กด "สร้างใบขนแล้ว" ล่าสุดรับหน้าที่ต่อ
   * เริ่ม: รับ lease + บัญชี NETBAY ของตัว monitor · ทุกรอบ: ถามรายการที่ค้าง (ไม่ใช่เจ้าของ lease แล้ว = ปิดตัว)
   * ผลการเช็กรายรายการ: สถานะใน NETBAY · ACCEPT แล้วส่งเลข + PDF ผ่าน completeTask ตัวเดิม
   */
  async customsMonitorStart(args: any) {
    return takeMonitorLease(String(args?.worker ?? ''), String(args?.lease ?? ''));
  },
  async customsMonitorTasks(args: any) {
    return monitorTasks(String(args?.lease ?? ''));
  },
  async customsStatus(args: any) {
    return recordCustomsCheck({
      taskId: String(args?.taskId ?? ''), actorId: WORKER_ACTOR, status: args?.status, error: args?.error,
    });
  },

  async saveRecording(args: any) {
    return saveRecording(String(args?.taskId ?? ''), { startUrl: args?.startUrl, steps: args?.steps, code: args?.code });
  },

  async completeTask(args: any) {
    const file = fileArg(args);
    await completeTask({
      taskId: String(args?.taskId ?? ''),
      actorId: WORKER_ACTOR,
      refNo: args?.refNo,
      entryNo: args?.entryNo,
      file,
      csv: fileArg(args, 'csv'),
    });
    return { ok: true };
  },

  async failTask(args: any) {
    await failTask(String(args?.taskId ?? ''), WORKER_ACTOR, String(args?.error ?? 'ไม่ระบุสาเหตุ'), fileArg(args));
    return { ok: true };
  },

  async queueStatus() {
    const rows = await db
      .select({ type: automationTasks.type, status: automationTasks.status, count: sql<number>`count(*)::int` })
      .from(automationTasks)
      .groupBy(automationTasks.type, automationTasks.status);
    return { queue: rows };
  },
};

export async function POST(request: Request) {
  const expected = process.env.WORKER_API_KEY;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: 'NOT_CONFIGURED|ยังไม่ได้ตั้ง WORKER_API_KEY ใน .env.local' },
      { status: 503 },
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'VALIDATION|body ต้องเป็น JSON' }, { status: 400 });
  }

  const key = String(body?.key ?? '');
  // เทียบความยาวก่อน เพื่อไม่ให้ความยาวคีย์รั่วออกไปทางเวลาตอบกลับ
  if (key.length !== expected.length || key !== expected) return unauthorized();

  const handler = HANDLERS[String(body?.fn ?? '')];
  if (!handler) {
    return NextResponse.json(
      { ok: false, error: `FORBIDDEN|ไม่อนุญาตคำสั่ง ${body?.fn}` },
      { status: 403 },
    );
  }

  try {
    return NextResponse.json({ ok: true, data: await handler(body?.args ?? {}) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
