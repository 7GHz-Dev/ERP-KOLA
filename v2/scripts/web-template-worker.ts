/**
 * worker ของ Template กรอกเว็บ — ทั้งบันทึกขั้นตอนใหม่และเล่นขั้นตอนกับงานจริง
 *
 *   WEB_RECORD    ผู้ดูแลกด "บันทึกขั้นตอน" ที่หน้า Template → เปิด Chrome พร้อมแถบบันทึก
 *                 คนทำตามขั้นตอนจริงบนเว็บ กด "จบและบันทึก" แล้วขั้นตอนถูกส่งกลับไปเป็นของ Template
 *   WEB_TEMPLATE  คนกดปุ่มที่ Template สร้างไว้ (หรือกดทดลองรัน) → เล่นทีละขั้นด้วย web-template-runner
 *
 * รันบนเครื่องที่ล็อกอินเว็บปลายทางไว้ เพราะเว็บพวกนี้ใช้บัญชีของพนักงาน
 * ไม่เก็บรหัสผ่านไว้บนเซิร์ฟเวอร์ — การล็อกอินจำไว้ในโปรไฟล์ Chrome แยกของ worker
 *
 * วิธีรัน (ในโฟลเดอร์ v2):
 *   npm run worker:web              กรอกครบแล้วรอคนตรวจและกดปุ่มส่งเอง (ค่าตั้งต้น)
 *   npm run worker:web -- --auto    กดปุ่มส่งให้เองด้วย
 *   npm run worker:web -- --once    ทำงานเดียวแล้วจบ
 *
 * ตัวแปรใน .env.local: WORKER_API_KEY และ ERP_URL (รันกับเครื่องตัวเองใช้ http://localhost:3000)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext } from 'playwright-core';
import { loadEnv } from '../src/lib/env';
import { WEB_TASK, type JobVars, type WebTemplateDefinition } from '../src/lib/web-template';
import { RecorderHub } from './web-recorder-session';
import { recordWithCodegen } from './codegen-recorder';
import { runTemplate } from './web-template-runner';
import { AGENT_VERSION } from '../src/lib/agent-version';

loadEnv();

const ERP_URL = (process.env.ERP_URL ?? 'https://erp-kola.vercel.app').replace(/\/$/, '');
const KEY = process.env.WORKER_API_KEY ?? '';
const PROFILE = process.env.WEB_WORKER_PROFILE ?? join(homedir(), '.kola-web-worker', 'chrome-profile');
const WORKER = `web@${hostname()}`;

const AUTO_SUBMIT = process.argv.includes('--auto');
const ONCE = process.argv.includes('--once');
const POLL_MS = 15_000;
// เกินนี้จบรอบบันทึกเอง — ต้องน้อยกว่าเวลาที่คิวถือว่า worker ตาย (30 นาที) ไม่งั้นอาจถูกคว้าซ้ำ
const RECORD_WAIT_MS = 25 * 60_000;

type RunTask = {
  id: string;
  jobId: string | null;
  data: {
    templateId: string; templateName?: string; definition: WebTemplateDefinition;
    vars: { job: JobVars; input: Record<string, string> };
    files: string[]; dryRun?: boolean;
  };
};
type RecordTask = {
  id: string;
  data: {
    templateId: string; templateName?: string; startUrl: string;
    /** codegen = ตัวบันทึกของ Playwright (ค่าตั้งต้น) · kola = แถบบันทึกของระบบเอง */
    recorder?: 'codegen' | 'kola'; loggedInText?: string;
  };
};

/** งานที่ทำอยู่ — ส่งไปกับสัญญาณสถานะ */
let busy: string | null = null;
/** ค่าตั้งจากหน้าแลก DO — ทำงานเบื้องหลัง (Chrome ไม่มีหน้าต่าง กดส่งเอง) */
let background = process.env.WEB_WORKER_HEADLESS === '1';
const startedAt = Date.now();

/** log ล่าสุด — ส่งขึ้นไปให้ดูบนหน้าแลก DO เพราะตอนทำงานเบื้องหลังไม่มีหน้าต่าง Terminal ให้ดู */
const recent: string[] = [];
const log = (...args: unknown[]) => {
  const time = new Date().toLocaleTimeString('th-TH');
  console.log(time, ...args);
  recent.push(`${time} ${args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')}`);
  if (recent.length > 80) recent.splice(0, recent.length - 80);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${ERP_URL}/api/worker`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: KEY, fn, args }),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: T; error?: string };
  if (!res.ok || !body.ok) throw new Error(`${fn}: ${body.error ?? res.status}`);
  return body.data as T;
}

/* ---------------- บันทึกขั้นตอน ---------------- */

const hub = new RecorderHub(log);

/** แถบบันทึกของระบบเอง — ทำงานใน Chrome ตัวหลักของ worker */
async function recordKola(context: BrowserContext, task: RecordTask) {
  const page = await context.newPage();
  const recording = hub.begin(task.data.startUrl);
  // ปิดแท็บแทนการกดจบ — เก็บเท่าที่บันทึกไว้
  page.on('close', () => hub.finish());

  try {
    await page.goto(task.data.startUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
    log('🎬 เปิดหน้าบันทึกแล้ว — ล็อกอิน/ไปหน้าที่จะเริ่ม แล้วกด "เริ่มบันทึก" ที่แถบมุมขวาล่าง');
    const timer = setTimeout(() => hub.finish(), RECORD_WAIT_MS);
    const { steps, startUrl } = await recording;
    clearTimeout(timer);
    if (!steps.length) throw new Error('ยังไม่ได้บันทึกขั้นตอนใดเลย');
    return { startUrl, steps };
  } finally {
    hub.finish();
    if (!page.isClosed()) await page.close().catch(() => {});
  }
}

/**
 * บันทึกงานหนึ่ง — ส่งผลกลับ ERP เป็นขั้นตอน (แถบของระบบ) หรือโค้ด codegen ให้ ERP แปลงเอง
 *
 * codegen ต้องเปิด Chrome ด้วยโปรไฟล์เดียวกัน (การล็อกอินจะได้ติดมา) แต่โปรไฟล์หนึ่งเปิดได้ทีละตัว
 * จึงปิด Chrome ตัวหลักก่อน แล้วเปิดใหม่หลังบันทึกเสร็จ
 */
async function record(task: RecordTask) {
  const name = task.data.templateName ?? task.data.templateId;
  let result: Record<string, unknown>;
  if (task.data.recorder === 'kola') {
    result = await recordKola(await mainContext(), task);
  } else {
    await closeMain();
    const code = await recordWithCodegen({
      profile: PROFILE, startUrl: task.data.startUrl, loggedInText: task.data.loggedInText,
      timeoutMs: RECORD_WAIT_MS, log,
    });
    if (!/\bawait\b/.test(code)) throw new Error('ยังไม่ได้บันทึกขั้นตอนใดเลย');
    result = { code };
  }
  const saved = await api<{ saved: number; dropped: number; skipped?: string[] }>('saveRecording', { taskId: task.id, ...result });
  log(`✅ ส่งขั้นตอน ${saved.saved} ขั้นเข้า Template "${name}" แล้ว`
    + (saved.dropped ? ` (ทิ้ง ${saved.dropped} ขั้นที่อ่านไม่ได้)` : ''));
  for (const line of saved.skipped ?? []) log(`   ข้าม: ${line}`);
}

/* ---------------- Chrome ตัวหลัก ---------------- */

let main_: BrowserContext | null = null;
/** Chrome ตัวหลักที่เปิดอยู่เป็นแบบไม่มีหน้าต่างไหม */
let headlessNow = background;

async function mainContext() {
  if (main_) return main_;
  mkdirSync(PROFILE, { recursive: true });
  headlessNow = background;
  const context = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome',
    headless: headlessNow,
    viewport: null,
    acceptDownloads: false,
  });
  await hub.install(context);
  context.on('close', () => { if (main_ === context) main_ = null; });
  main_ = context;
  return context;
}

async function closeMain() {
  const context = main_;
  main_ = null;
  await context?.close().catch(() => {});
}

/* ---------------- เล่นขั้นตอน ---------------- */

async function run(context: BrowserContext, task: RunTask) {
  const { definition, vars, dryRun } = task.data;
  const dir = join(tmpdir(), 'kola-web-worker', task.id);
  mkdirSync(dir, { recursive: true });

  // โหลดไฟล์ทุกหมวดที่ Template จะแนบไว้ก่อน ขาดใบไหนพังตั้งแต่ยังไม่เปิดเว็บ
  const files: Record<string, string> = {};
  for (const category of task.data.files ?? []) {
    const file = await api<{ fileName: string; base64: string }>('downloadTaskFile', { taskId: task.id, category });
    const name = (file.fileName || `${category}.pdf`).replace(/[\\/:*?"<>|]/g, '_');
    const path = join(dir, name);
    writeFileSync(path, Buffer.from(file.base64, 'base64'));
    files[category] = path;
  }

  // เบื้องหลังไม่มีใครตรวจหน้าจอ จึงกดปุ่มส่งให้เอง
  const mode = dryRun ? 'dry' : AUTO_SUBMIT || headlessNow ? 'auto' : 'review';
  let result;
  try {
    result = await runTemplate(context, definition, { mode, vars, files, log, headless: headlessNow });
  } catch (error) {
    // ภาพตอนพังส่งขึ้น ERP ด้วย จะได้ดูได้ว่าค้างที่หน้าไหนโดยไม่ต้องมาเปิดเครื่องนี้
    const pages = context.pages().filter((p) => !p.isClosed());
    const last = pages[pages.length - 1];
    const shot = last ? await last.screenshot({ fullPage: true }).catch(() => null) : null;
    if (shot) writeFileSync(join(dir, 'error.png'), shot);
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { shot });
  }

  await api('completeTask', {
    taskId: task.id,
    refNo: result.refNo,
    file: { name: `WEB_${vars.job.blNo || task.id}.png`, mimeType: 'image/png', base64: result.screenshot.toString('base64') },
  });
  log(dryRun
    ? '🧪 ทดลองรันผ่าน — หยุดก่อนปุ่มส่ง ปล่อยหน้าไว้ให้ตรวจ'
    : `✅ ส่งแล้ว${result.refNo ? ` · เลขอ้างอิง ${result.refNo}` : ''}`);
  // โหมดอัตโนมัติปิดแท็บทิ้ง ไม่ให้กองกัน · โหมดอื่นปล่อยไว้ให้คนดู
  if (mode === 'auto' && !result.page.isClosed()) await result.page.close().catch(() => {});
}

/* ---------------- วนรับงาน ---------------- */

async function main() {
  if (!KEY) throw new Error('ยังไม่ได้ตั้ง WORKER_API_KEY ใน .env.local');
  await api('queueStatus');

  /*
   * บอก ERP ว่ายังเปิดอยู่ พร้อม log ล่าสุด และภาพหน้าจอสดตอนกำลังทำงาน — หน้าแลก DO ใช้แสดงสถานะ
   * ส่งแยกจากรอบรับงาน เพราะงานหนึ่งอาจนานหลายนาที · ระหว่างทำงานส่งถี่ขึ้นให้ภาพขยับทัน
   * คำตอบคือค่าตั้งที่ ANN สั่งจากหน้าเว็บ (ทำงานเบื้องหลัง · ปิด worker)
   */
  let stop = false;
  const beat = async () => {
    let shot: string | undefined;
    if (busy && main_) {
      const page = main_.pages().filter((p) => !p.isClosed()).pop();
      const buf = page ? await page.screenshot({ type: 'jpeg', quality: 55 }).catch(() => null) : null;
      if (buf) shot = buf.toString('base64');
    }
    const res = await api<{ settings?: { background?: boolean; stopAt?: string | null } }>('heartbeat', {
      worker: WORKER, busy, mode: AUTO_SUBMIT || headlessNow ? 'auto' : 'review', platform: process.platform,
      headless: headlessNow, version: AGENT_VERSION, log: recent, shot,
    }).catch(() => null);
    const settings = res?.settings;
    if (!settings) return;
    if (Boolean(settings.background) !== background) {
      background = Boolean(settings.background);
      log(background ? '🌙 สลับเป็นทำงานเบื้องหลัง (ไม่มีหน้าต่าง · กดส่งเอง)' : '🪟 สลับเป็นแสดงหน้าต่าง');
    }
    // เปลี่ยนโหมดได้ตอนว่างเท่านั้น — ปิด Chrome ตัวหลักแล้วเปิดใหม่ในโหมดใหม่ตอนรับงานถัดไป
    if (!busy && main_ && headlessNow !== background) await closeMain();
    if (settings.stopAt && Date.parse(settings.stopAt) > startedAt && !stop) {
      stop = true;
      log('⏹  สั่งปิดจากหน้าเว็บ — ปิดหลังจบงานที่ทำอยู่');
    }
  };
  let beating = true;
  void (async () => {
    while (beating) {
      await beat();
      await sleep(busy ? 5_000 : 15_000);
    }
  })();

  await mainContext();
  log(`worker พร้อม · ${ERP_URL} · ${headlessNow ? 'ทำงานเบื้องหลัง (กดส่งเอง)' : AUTO_SUBMIT ? 'แสดงหน้าต่าง · กดส่งเอง' : 'แสดงหน้าต่าง · รอคนตรวจแล้วกดส่ง'}`);

  // error ที่หลุดจาก timer ภายใน Playwright (เช่นตัวบันทึกเขียนไฟล์ตามมาทีหลัง) ไม่ควรทำให้ worker ทั้งตัวตาย
  process.on('uncaughtException', (error) => log('⚠️  error ภายใน:', error instanceof Error ? error.message : error));

  process.on('SIGINT', () => { stop = true; log('กำลังหยุดหลังจบงานที่ทำอยู่…'); });

  while (!stop) {
    let task: (RunTask | RecordTask) & { type?: string } | null = null;
    try {
      // งานบันทึกมีคนนั่งรออยู่หน้าจอ จึงรับก่อนงานเล่น
      ({ task } = await api<{ task: RecordTask | null }>('claimNext', { type: WEB_TASK.RECORD, worker: WORKER }));
      if (task) task.type = WEB_TASK.RECORD;
      else ({ task } = await api<{ task: RunTask | null }>('claimNext', { type: WEB_TASK.RUN, worker: WORKER }));
    } catch (error) {
      log('ติดต่อระบบไม่ได้:', error instanceof Error ? error.message : error);
    }

    if (task) {
      busy = task.type === WEB_TASK.RECORD ? 'บันทึกขั้นตอน' : `BL ${(task as RunTask).data.vars?.job?.blNo ?? '-'}`;
      try {
        if (task.type === WEB_TASK.RECORD) {
          log(`รับงานบันทึก Template "${task.data.templateName ?? task.data.templateId}"`);
          await record(task as RecordTask);
        } else {
          const t = task as RunTask;
          log(`รับงาน "${t.data.templateName ?? t.data.templateId}"${t.data.dryRun ? ' (ทดลอง)' : ''} · BL ${t.data.vars?.job?.blNo ?? '-'}`);
          await run(await mainContext(), t);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const shot = (error as { shot?: Buffer | null }).shot;
        log(`❌ ${message}`);
        await api('failTask', {
          taskId: task.id, error: message,
          ...(shot ? { file: { name: 'error.png', mimeType: 'image/png', base64: shot.toString('base64') } } : {}),
        }).catch((e) => log('บันทึกผลพังไม่ได้:', e));
      }
      busy = null;
      if (ONCE) break;
      continue;
    }
    if (ONCE) { log('คิวว่าง'); break; }
    // รอรอบถัดไปทีละช่วงสั้น ๆ จะได้ปิดตัวทันทีเมื่อถูกสั่งปิด
    for (let waited = 0; waited < POLL_MS && !stop; waited += 1_000) await sleep(1_000);
  }

  beating = false;
  await closeMain();
  log('ปิด worker แล้ว');
  await api('heartbeat', { worker: WORKER, busy: null, log: recent, offline: true }).catch(() => {});
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
