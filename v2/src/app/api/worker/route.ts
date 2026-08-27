import { NextResponse } from 'next/server';
import { and, asc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { automationTasks } from '@/db/schema';
import { downloadFile } from '@/lib/storage';
import { completeTask, failTask } from '@/lib/automation';

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
  if (type) conditions.push(eq(automationTasks.type, type));

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

const HANDLERS: Record<string, (args: any) => Promise<unknown>> = {
  claimNext,
  downloadInputFile: downloadInput,

  async completeTask(args: any) {
    const file = args?.file?.base64
      ? {
          name: String(args.file.name ?? 'result'),
          mimeType: String(args.file.mimeType ?? 'application/octet-stream'),
          body: Buffer.from(String(args.file.base64), 'base64'),
        }
      : undefined;
    await completeTask({
      taskId: String(args?.taskId ?? ''),
      actorId: WORKER_ACTOR,
      refNo: args?.refNo,
      entryNo: args?.entryNo,
      file,
    });
    return { ok: true };
  },

  async failTask(args: any) {
    await failTask(String(args?.taskId ?? ''), WORKER_ACTOR, String(args?.error ?? 'ไม่ระบุสาเหตุ'));
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
