/**
 * บันทึกขั้นตอนด้วยตัวบันทึกของ Playwright เอง — แบบเดียวกับ npx playwright codegen
 *
 * เปิด Chrome ด้วยโปรไฟล์ของ worker (จึงล็อกอินค้างไว้เหมือนตอนเล่นจริง) พร้อมหน้าต่าง Playwright Inspector
 * คนทำตามขั้นตอนจริง ใช้เครื่องมือของ Inspector ได้ครบ (Record · Pick locator · Assert visibility/text)
 * ปิดหน้าต่าง Chrome เมื่อเสร็จ แล้วได้โค้ด JavaScript ที่ codegen เขียนกลับมา
 * ERP เป็นคนแปลงโค้ดเป็นขั้นตอน (src/lib/playwright-code.ts) — ฝั่งนี้ไม่ได้รันโค้ดนั้น
 *
 * ใช้ _enableRecorder ซึ่งเป็นคำสั่งเดียวกับที่ npx playwright codegen เรียกข้างใน
 * เป็น API ภายในของ Playwright ถ้าอัปรุ่น playwright-core แล้วพัง ให้ดูที่ lib/cli/program.js ฟังก์ชัน codegen
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext } from 'playwright-core';

export type CodegenOptions = {
  profile: string;
  startUrl: string;
  /** เห็นข้อความนี้แล้วจึงเริ่มบันทึก — ขั้นตอนล็อกอินจะได้ไม่ถูกเก็บ (ไม่ระบุ = บันทึกตั้งแต่เปิด) */
  loggedInText?: string;
  timeoutMs: number;
  headless?: boolean;
  log?: (...args: unknown[]) => void;
  /** ใช้ตอนทดสอบ — ทำแทนคนหลังเริ่มบันทึก */
  drive?: (context: BrowserContext) => Promise<void>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function recordWithCodegen(opts: CodegenOptions): Promise<string> {
  const dir = join(tmpdir(), 'kola-codegen', String(Date.now()));
  mkdirSync(dir, { recursive: true });
  const outputFile = join(dir, 'recording.js');

  const context = await chromium.launchPersistentContext(opts.profile, {
    channel: 'chrome',
    headless: Boolean(opts.headless),
    viewport: null,
  });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(opts.startUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});

    if (opts.loggedInText) {
      const marker = page.getByText(opts.loggedInText).first();
      if (!(await marker.isVisible().catch(() => false))) {
        opts.log?.(`🔑 ล็อกอินให้เรียบร้อยก่อน — เห็น "${opts.loggedInText}" เมื่อไหร่จะเริ่มบันทึกเอง`);
        await marker.waitFor({ state: 'visible', timeout: opts.timeoutMs });
      }
    }

    await (context as unknown as { _enableRecorder(p: Record<string, unknown>): Promise<void> })._enableRecorder({
      language: 'javascript',
      mode: 'recording',
      codegenMode: 'actions',
      outputFile,
      handleSIGINT: false,
      launchOptions: { channel: 'chrome' },
      contextOptions: {},
    });
    // ตัวบันทึกจับได้เฉพาะแท็บที่เปิดหลังเริ่มบันทึก — เปิดหน้าเดิมในแท็บใหม่แล้วปิดแท็บล็อกอิน (ล็อกอินยังอยู่)
    const current = page.url();
    const recording = await context.newPage();
    await page.close().catch(() => {});
    await recording.goto(current, { waitUntil: 'domcontentloaded' }).catch(() => {});
    if (opts.loggedInText) await recording.getByText(opts.loggedInText).first().waitFor({ timeout: 30_000 }).catch(() => {});
    // ตัวบันทึกใช้เวลาเข้าไปอยู่ในแท็บใหม่ครู่หนึ่ง — กดเร็วกว่านี้ขั้นแรกจะหลุด
    await sleep(1_500);
    opts.log?.('🎬 กำลังบันทึก (Playwright Inspector) — ทำตามขั้นตอนจริง'
      + ' · ปุ่มส่งสุดท้ายให้ใช้ Assert visibility (รูปตา) คลิกแทนการกดจริง · เสร็จแล้วปิดหน้าต่าง Chrome');

    if (opts.drive) {
      await opts.drive(context);
    } else {
      // จบเมื่อคนปิดหน้าต่าง Chrome (ไม่เหลือแท็บ) หรือหมดเวลา
      const until = Date.now() + opts.timeoutMs;
      let closed = false;
      context.on('close', () => { closed = true; });
      while (!closed && Date.now() < until && context.pages().length > 0) await sleep(1_000);
    }
  } finally {
    await context.close().catch(() => {});
  }

  /*
   * ตัวบันทึกเขียนไฟล์แบบหน่วงเวลา และเขียนรอบสุดท้ายหลังปิด Chrome ไปแล้ว
   * รอจนไฟล์นิ่ง 1 วินาทีก่อนอ่าน · ห้ามลบโฟลเดอร์นี้ทิ้ง — ถ้ามันเขียนตามมาทีหลังแล้วไม่เจอโฟลเดอร์
   * Playwright จะโยน error นอก try แล้วทั้ง worker ตาย (โฟลเดอร์อยู่ใน tmp ระบบเก็บกวาดเอง)
   */
  let last = '';
  let stableSince = Date.now();
  const until = Date.now() + 8_000;
  while (Date.now() < until) {
    await sleep(250);
    const now = existsSync(outputFile) ? readFileSync(outputFile, 'utf8') : '';
    if (now !== last) { last = now; stableSince = Date.now(); }
    else if (now && Date.now() - stableSince >= 1_000) break;
  }
  const code = last;
  return code;
}
