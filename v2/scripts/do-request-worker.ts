/**
 * worker ขอ Delivery Order ผ่านเว็บ My Customer Service ของ CMA CGM (CMA CGM · APL · ANL · CNC)
 *
 * ANN กด "ส่งแลกเว็บ CMA" ที่หน้า /do-exchange → งานเข้าคิว DO_REQUEST_CMA
 * สคริปต์นี้รันบนเครื่องที่ล็อกอินเว็บสายเรือไว้ หยิบงานจากคิวแล้วกรอกเว็บตามขั้นตอนเดิมของ ANN
 *
 *   1. Delivery Order → Create new request
 *      Service Type = New Delivery Order · Agency Location = Thailand
 *      BL Reference = เลข BL ของงาน → Add → รอให้ขึ้นใน Approved BL Reference(s) → Next
 *   2. Upload your documents
 *      Payment Document(s) และ Supporting Document(s) = ชุดแลก DO ที่รวมแล้ว
 *      Payment reference number = หมายเลขอ้างอิงในสลิป
 *      Additional information = ที่อยู่ออกใบเสร็จ
 *      → Submit
 *
 * เสร็จแล้วส่งภาพหน้าจอกลับเป็นหลักฐาน ระบบย้ายงานไปแท็บ "ส่งแลก DO แล้ว" ให้เอง
 *
 * วิธีรัน (ในโฟลเดอร์ v2):
 *   npm run worker:do              กรอกทุกช่องแล้วรอให้คนตรวจและกด Submit เอง (ค่าตั้งต้น)
 *   npm run worker:do -- --auto    กด Submit ให้เองด้วย — ใช้เมื่อเห็นแล้วว่ากรอกถูกทุกรอบ
 *   npm run worker:do -- --once    ทำงานเดียวแล้วจบ
 *
 * ตัวแปรใน .env.local: WORKER_API_KEY (ตัวเดียวกับบน Vercel) และ ERP_URL (ค่าตั้งต้นเว็บจริง)
 * ครั้งแรกจะเปิด Chrome ให้ล็อกอินเว็บ CMA เอง ระบบจำการล็อกอินไว้ในโปรไฟล์แยกของ worker
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir, hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Locator, type Page } from 'playwright-core';
import { loadEnv } from '../src/lib/env';

loadEnv();

const ERP_URL = (process.env.ERP_URL ?? 'https://erp-kola.vercel.app').replace(/\/$/, '');
const KEY = process.env.WORKER_API_KEY ?? '';
// ทับได้เฉพาะตอนทดสอบกับหน้าจำลอง
const PORTAL = process.env.DO_PORTAL_URL ?? 'https://mycustomerservice.cma-cgm.com/s/importdorequest';
const PROFILE = process.env.DO_WORKER_PROFILE ?? join(homedir(), '.kola-do-worker', 'chrome-profile');
const TASK_TYPE = 'DO_REQUEST_CMA';
const WORKER = `do-cma@${hostname()}`;

const AUTO_SUBMIT = process.argv.includes('--auto');
const ONCE = process.argv.includes('--once');
const POLL_MS = 20_000;
const LOGIN_WAIT_MS = 10 * 60_000;
const REVIEW_WAIT_MS = 20 * 60_000;

type Task = {
  id: string;
  jobId: string;
  inputFileName: string | null;
  data: { jobNo?: string; blNo?: string; agencyLocation?: string; paymentRef?: string; note?: string };
};

const log = (...args: unknown[]) => console.log(new Date().toLocaleTimeString('th-TH'), ...args);
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

/* ---------------- ตัวช่วยกรอกเว็บ ---------------- */

/**
 * เลือกค่าในช่อง dropdown ตามชื่อช่อง
 * เว็บเป็น Salesforce — บางช่องเป็น <select> ธรรมดา บางช่องเป็น combobox ที่ต้องคลิกแล้วเลือก
 */
async function choose(page: Page, label: RegExp, value: string) {
  const field = page.getByLabel(label).first();
  await field.waitFor({ state: 'visible', timeout: 30_000 });
  const tag = await field.evaluate((el) => el.tagName.toLowerCase());
  if (tag === 'select') {
    await field.selectOption({ label: value });
    return;
  }
  const current = ((await field.inputValue().catch(() => '')) || (await field.innerText().catch(() => ''))).trim();
  if (current.toLowerCase() === value.toLowerCase()) return;
  await field.click();
  await page.getByRole('option', { name: value, exact: true }).first().click({ timeout: 15_000 });
}

/** ข้อความแจ้งเตือนที่เว็บแสดงอยู่ตอนนี้ — ใช้เป็นสาเหตุเวลาขั้นไหนไปต่อไม่ได้ */
async function visibleErrors(page: Page): Promise<string> {
  const texts = await page
    .locator('[role="alert"], .slds-has-error .slds-form-element__help, .slds-notify, .toastMessage')
    .allInnerTexts()
    .catch(() => []);
  return texts.map((t) => t.trim()).filter(Boolean).join(' · ').slice(0, 300);
}

/** รอให้เห็นภายในเวลาที่กำหนด — isVisible() ของ Playwright ตอบทันทีไม่รอ จึงใช้ waitFor แทน */
async function visibleWithin(target: Locator, timeout: number) {
  return target.waitFor({ state: 'visible', timeout }).then(() => true, () => false);
}

async function waitEnabled(button: Locator, timeout: number) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await button.isEnabled().catch(() => false)) return true;
    await sleep(500);
  }
  return false;
}

/** เปิดหน้าขอ D/O — ถ้าเด้งไปหน้าล็อกอิน ให้คนล็อกอินในหน้าต่างนี้ก่อนแล้วไปต่อเอง */
async function openRequestPage(page: Page) {
  await page.goto(PORTAL, { waitUntil: 'domcontentloaded' });
  const heading = page.getByText(/Create new request/i).first();
  if (await visibleWithin(heading, 20_000)) return;

  log('⚠️  ยังไม่ได้ล็อกอินเว็บ CMA — กรุณาล็อกอินในหน้าต่าง Chrome ที่เปิดขึ้นมา');
  const until = Date.now() + LOGIN_WAIT_MS;
  while (Date.now() < until) {
    await sleep(3_000);
    const url = page.url();
    if (url.startsWith(new URL(PORTAL).origin) && !/login/i.test(url)) {
      await page.goto(PORTAL, { waitUntil: 'domcontentloaded' });
      if (await visibleWithin(heading, 20_000)) {
        log('ล็อกอินแล้ว ทำงานต่อ');
        return;
      }
    }
  }
  throw new Error('รอล็อกอินเว็บ CMA เกิน 10 นาที');
}

/** แนบไฟล์ในช่องอัปโหลดลำดับที่ index แล้วรอให้ชื่อไฟล์ขึ้น (ปิดหน้าต่าง Upload ของ Salesforce ถ้ามี) */
async function attach(page: Page, index: number, path: string, fileName: string) {
  const inputs = page.locator('input[type="file"]');
  await inputs.nth(index).setInputFiles(path);

  const done = page.getByRole('button', { name: 'Done', exact: true });
  const shown = page.getByText(fileName, { exact: false });
  const until = Date.now() + 90_000;
  while (Date.now() < until) {
    if (await done.isVisible().catch(() => false)) {
      if (await done.isEnabled().catch(() => false)) await done.click();
    } else if ((await shown.count()) > index) {
      return;
    }
    await sleep(700);
  }
  throw new Error(`อัปโหลดไฟล์ช่องที่ ${index + 1} ไม่สำเร็จ ${await visibleErrors(page)}`.trim());
}

/** เลขคำขอจากหน้ายืนยัน ถ้ามี — ไม่เจอก็ไม่เป็นไร ภาพหน้าจอเป็นหลักฐานอยู่แล้ว */
function findRequestNo(text: string, exclude: string[]): string {
  const re = /(?:request|case|reference|ticket)\s*(?:number|no\.?|#|n°)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{5,})/gi;
  for (const m of text.matchAll(re)) {
    if (!exclude.some((x) => x && m[1].toUpperCase() === x.toUpperCase())) return m[1];
  }
  return '';
}

/* ---------------- งานหนึ่งรายการ ---------------- */

async function runTask(context: BrowserContext, task: Task) {
  const blNo = String(task.data.blNo ?? '').trim();
  const paymentRef = String(task.data.paymentRef ?? '').trim();
  const note = String(task.data.note ?? '');
  if (!blNo) throw new Error('งานไม่มีเลข BL');
  if (!paymentRef) throw new Error('งานไม่มีหมายเลขอ้างอิงในสลิป');

  // ไฟล์ชุดแลก DO ที่รวมแล้ว — ใช้ทั้งช่อง Payment และ Supporting
  const input = await api<{ fileName: string; base64: string }>('downloadInputFile', { taskId: task.id });
  const dir = join(tmpdir(), 'kola-do-worker', task.id);
  mkdirSync(dir, { recursive: true });
  const fileName = (input.fileName || `${blNo}_DO.pdf`).replace(/[\\/:*?"<>|]/g, '_');
  const filePath = join(dir, fileName);
  writeFileSync(filePath, Buffer.from(input.base64, 'base64'));

  const page = await context.newPage();
  try {
    // ---- หน้า 1: Create new request ----
    await openRequestPage(page);
    await choose(page, /Service Type/i, 'New Delivery Order');
    await choose(page, /Agency Location/i, task.data.agencyLocation || 'Thailand');

    await page.getByRole('textbox', { name: /BL Reference/i }).first().fill(blNo);
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    // เลข BL ต้องขึ้นในกล่อง Approved BL Reference(s) ก่อน — ไม่ขึ้นแปลว่าเว็บไม่รับเลขนี้
    const chip = page.getByText(blNo, { exact: true }).first();
    if (!(await visibleWithin(chip, 30_000))) {
      throw new Error(`เว็บไม่รับเลข BL ${blNo} ${await visibleErrors(page)}`.trim());
    }

    const next = page.getByRole('button', { name: 'Next', exact: true });
    if (!(await waitEnabled(next, 20_000))) throw new Error(`ปุ่ม Next ไม่เปิดให้กด ${await visibleErrors(page)}`.trim());
    await next.click();

    // ---- หน้า 2: Upload your documents ----
    await page.getByText(/Upload your documents/i).first().waitFor({ timeout: 30_000 });
    await page.locator('input[type="file"]').nth(1).waitFor({ state: 'attached', timeout: 30_000 });
    await attach(page, 0, filePath, fileName);   // Payment Document(s)
    await attach(page, 1, filePath, fileName);   // Supporting Document(s)

    await page.getByRole('textbox', { name: /Payment reference number/i }).first().fill(paymentRef);
    if (note.trim()) {
      const extra = page.getByRole('textbox', { name: /Additional information/i }).first();
      const box = (await extra.count()) ? extra : page.getByPlaceholder(/Write a comment/i).first();
      await box.fill(note);
    }

    const submit = page.getByRole('button', { name: 'Submit', exact: true });
    if (!(await waitEnabled(submit, 20_000))) throw new Error(`ปุ่ม Submit ไม่เปิดให้กด ${await visibleErrors(page)}`.trim());

    if (AUTO_SUBMIT) {
      await submit.click();
    } else {
      log(`👀 กรอกครบแล้ว — ตรวจในหน้าต่าง Chrome แล้วกด Submit เอง (BL ${blNo})`);
    }

    // หลัง Submit ปุ่มจะหายไปหรือเว็บพาไปหน้าอื่น — รอจนเห็น หรือจนหมดเวลารอคนตรวจ
    const until = Date.now() + (AUTO_SUBMIT ? 90_000 : REVIEW_WAIT_MS);
    while (Date.now() < until) {
      if (page.isClosed()) throw new Error('ปิดหน้าต่างก่อนกด Submit');
      if (!(await submit.isVisible().catch(() => false))) break;
      await sleep(1_000);
    }
    if (await submit.isVisible().catch(() => false)) {
      throw new Error(AUTO_SUBMIT ? `กด Submit แล้วเว็บไม่ไปต่อ ${await visibleErrors(page)}`.trim()
        : 'ไม่ได้กด Submit ภายใน 20 นาที');
    }
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
    await sleep(2_000);
    // ปุ่ม Submit หายเพราะกด Previous กลับไปหน้าแรก ไม่ใช่เพราะส่งแล้ว
    if (await page.getByText(/Create new request/i).first().isVisible().catch(() => false)) {
      throw new Error('กลับไปหน้าแรกโดยไม่ได้กด Submit');
    }

    const errors = await visibleErrors(page);
    if (/error|fail|invalid|ไม่สำเร็จ/i.test(errors)) throw new Error(`เว็บแจ้งหลัง Submit: ${errors}`);

    const shot = await page.screenshot({ fullPage: true });
    const bodyText = await page.locator('body').innerText().catch(() => '');
    const refNo = findRequestNo(bodyText, [blNo, paymentRef]);

    await api('completeTask', {
      taskId: task.id,
      refNo,
      file: { name: `DO-REQUEST_${blNo}.png`, mimeType: 'image/png', base64: shot.toString('base64') },
    });
    log(`✅ ยื่นขอ D/O แล้ว BL ${blNo}${refNo ? ` · เลขคำขอ ${refNo}` : ''}`);
  } catch (error) {
    // เก็บภาพตอนพังไว้ในเครื่อง ช่วยดูว่าเว็บเปลี่ยนหน้าตาตรงไหน
    if (!page.isClosed()) {
      const shotPath = join(dir, 'error.png');
      await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
      log(`ภาพหน้าจอตอนพัง: ${shotPath}`);
    }
    throw error;
  } finally {
    // โหมดรอคนตรวจ ปล่อยหน้าไว้ให้ดูต่อเมื่อพัง ส่วนโหมดอัตโนมัติปิดทิ้งไม่ให้แท็บกองกัน
    if (AUTO_SUBMIT && !page.isClosed()) await page.close().catch(() => {});
  }
}

/* ---------------- วนรับงาน ---------------- */

async function main() {
  if (!KEY) throw new Error('ยังไม่ได้ตั้ง WORKER_API_KEY ใน .env.local');
  await api('queueStatus');   // เช็กคีย์และที่อยู่ระบบก่อนเปิด Chrome

  mkdirSync(PROFILE, { recursive: true });
  const context = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome',
    headless: process.env.DO_WORKER_HEADLESS === '1',
    viewport: null,
    acceptDownloads: false,
  });
  log(`worker พร้อม · ${ERP_URL} · โหมด ${AUTO_SUBMIT ? 'กด Submit เอง' : 'รอคนตรวจแล้วกด Submit'}`);

  let stop = false;
  process.on('SIGINT', () => { stop = true; log('กำลังหยุดหลังจบงานที่ทำอยู่…'); });

  while (!stop) {
    let task: Task | null = null;
    try {
      ({ task } = await api<{ task: Task | null }>('claimNext', { type: TASK_TYPE, worker: WORKER }));
    } catch (error) {
      log('ติดต่อระบบไม่ได้:', error instanceof Error ? error.message : error);
    }

    if (task) {
      log(`รับงาน ${task.data.jobNo ?? task.jobId} · BL ${task.data.blNo}`);
      try {
        await runTask(context, task);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`❌ ${message}`);
        await api('failTask', { taskId: task.id, error: message }).catch((e) => log('บันทึกผลพังไม่ได้:', e));
      }
      if (ONCE) break;
      continue;
    }
    if (ONCE) { log('คิวว่าง'); break; }
    await sleep(POLL_MS);
  }

  await context.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
