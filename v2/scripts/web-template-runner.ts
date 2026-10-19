/**
 * ตัวเล่นขั้นตอนของ Template กรอกเว็บ — ใช้ Playwright คุมหน้าเว็บตามขั้นที่บันทึกไว้
 *
 * แยกจากตัว worker เพื่อทดสอบกับหน้าจำลองได้โดยไม่ต้องต่อระบบ (tests/web-template.ts)
 *
 * ช่องบนหน้าหาจากหลายทางตามลำดับ role+name → label → placeholder → text → css
 * ทางไหนเจอก่อนใช้ทางนั้น เว็บเปลี่ยนหน้าตาเล็กน้อยจึงยังหาเจอจากทางอื่น
 * คลิกและกรอกผ่าน Playwright ซึ่งรอให้ปุ่มกดได้เองอยู่แล้ว (เช่นปุ่ม Next ที่เปิดหลังเพิ่ม BL)
 */
import type { BrowserContext, FileChooser, Frame, Locator, Page } from 'playwright-core';
import {
  describeStep, fillVars, type JobVars, type Step, type Target, type WebTemplateDefinition,
} from '../src/lib/web-template';
import {
  isBlankLocator, isRegex, mapLocatorStrings, parseLocator, type Call, type JsValue,
} from '../src/lib/playwright-code';

export type RunMode = 'review' | 'auto' | 'dry';

export type RunOptions = {
  mode: RunMode;
  vars: { job: JobVars; input: Record<string, string> };
  /** หมวดไฟล์ → ที่อยู่ไฟล์ในเครื่อง */
  files: Record<string, string>;
  log?: (...args: unknown[]) => void;
  /** เวลารอคนตรวจแล้วกดส่งเอง / รอคนล็อกอิน / รอคนกดทำต่อ */
  reviewWaitMs?: number;
  loginWaitMs?: number;
};

export type RunResult = {
  page: Page;
  screenshot: Buffer;
  refNo: string;
  /** โหมดทดลองหยุดก่อนปุ่มส่ง */
  stoppedBeforeSubmit: boolean;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DEFAULT_TIMEOUT = 30;

/** ที่ค้นหาช่อง — หน้าเว็บ หรือ iframe ที่ระบุไว้ */
function scope(page: Page, target: Target): Page | Frame {
  if (!target.frame) return page;
  return page.frames().find((f) => f.url().startsWith(target.frame!)) ?? page;
}

/**
 * ช่อง CSS รับ XPath ที่คัดลอกจาก DevTools ได้ด้วย
 * Playwright รู้เองเฉพาะที่ขึ้นต้น // หรือ .. — แบบ "Copy full XPath" (/html/...) กับ (//a)[2] ต้องบอกเอง
 */
function selector(raw: string) {
  const s = raw.trim();
  return /^(\/|\(\s*\/|\.\.)/.test(s) && !s.startsWith('xpath=') ? `xpath=${s}` : s;
}

/** ค่าจากตัวอ่าน locator → ค่าที่ Playwright รับ (regex กลับเป็น RegExp จริง) */
function toPw(v: JsValue): unknown {
  if (isRegex(v)) return new RegExp(v.regex, v.flags);
  if (Array.isArray(v)) return v.map(toPw);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toPw(x)]));
  return v;
}

/**
 * สร้าง locator จากข้อความแบบ codegen — เรียกได้เฉพาะ method ที่ตัวอ่านยอมรับ ไม่ได้รันโค้ด
 * contentFrame()/frameLocator() พาเข้า iframe แล้วเรียกต่อได้เหมือนเดิม
 */
function buildLocator(root: Page | Frame, calls: Call[]): Locator {
  let cur: unknown = root;
  for (const c of calls) {
    const args = c.args.map(toPw) as never[];
    const fn = (cur as unknown as Record<string, (...a: never[]) => unknown>)[c.method];
    if (typeof fn !== 'function') throw new Error(`.${c.method}() ใช้ต่อจากตรงนี้ไม่ได้`);
    cur = fn.apply(cur, args);
  }
  if (cur === root || typeof (cur as Locator).count !== 'function') throw new Error('locator ต้องจบที่ช่องบนหน้า ไม่ใช่ iframe');
  return cur as Locator;
}

/**
 * ทางหาช่องทั้งหมดของเป้าหนึ่ง เรียงจากแม่นไปหาสำรอง
 * locator จาก codegen มาก่อน เพราะ Playwright เลือกให้แล้วว่าชี้ได้ตัวเดียว
 * css ที่ระบุลำดับไว้ (เช่นช่องแนบไฟล์ช่องที่สอง) ชี้ตัวเดียวแน่นอน
 */
function candidates(root: Page | Frame, t: Target, v: (s: string) => string): Locator[] {
  const out: Locator[] = [];
  type Role = Parameters<Page['getByRole']>[0];
  if (t.locator && !isBlankLocator(t.locator)) {
    // ใส่ค่าตัวแปรหลังแยกส่วนแล้ว ค่าที่มีเครื่องหมายคำพูดจึงไม่ทำให้ locator พัง
    try { out.push(buildLocator(root, mapLocatorStrings(parseLocator(t.locator), v))); } catch { /* ใช้ทางสำรอง */ }
  }
  if (t.role && t.name) out.push(root.getByRole(t.role as Role, { name: t.name, exact: true }));
  if (t.label) out.push(root.getByLabel(t.label, { exact: true }));
  if (t.placeholder) out.push(root.getByPlaceholder(t.placeholder, { exact: true }));
  if (t.css) {
    const css = selector(t.css);
    out.push(t.nth !== undefined ? root.locator(css).nth(t.nth) : root.locator(css));
  }
  if (t.role && t.name) out.push(root.getByRole(t.role as Role, { name: t.name }));
  if (t.label) out.push(root.getByLabel(t.label));
  if (t.text) out.push(root.getByText(t.text, { exact: true }));
  if (t.role && !t.name) out.push(root.getByRole(t.role as Role));
  return out;
}

/**
 * หาช่องให้เจอภายในเวลาที่กำหนด
 *
 * เลือกทางที่ชี้ได้ตัวเดียวก่อน — หน้าเว็บมีปุ่มชื่อซ้ำกันบ่อย (เช่น "Upload Files" สองปุ่ม)
 * ถ้าใช้ชื่อแล้วเอาตัวแรกจะกดผิดปุ่ม ทางที่ชี้ได้ตัวเดียว (มักเป็น css) จึงแม่นกว่า
 * ไม่มีทางไหนชี้ได้ตัวเดียวค่อยใช้ตัวแรกของทางแรกที่เจอ
 *
 * ช่องแนบไฟล์มักซ่อนไว้ จึงนับแค่ว่ามีอยู่ ไม่ต้องมองเห็น
 * isVisible() ตอบทันทีไม่รอ จึงวนถามเองจนหมดเวลา
 */
async function resolve(
  page: Page, target: Target, timeoutMs: number, attachedOnly = false, v: (s: string) => string = (s) => s,
): Promise<Locator | null> {
  const until = Date.now() + timeoutMs;
  const usable = (loc: Locator) => (attachedOnly ? loc.count().then((n) => n > 0) : loc.isVisible()).catch(() => false);
  do {
    let fallback: Locator | null = null;
    for (const loc of candidates(scope(page, target), target, v)) {
      const n = await loc.count().catch(() => 0);
      if (!n) continue;
      if (n === 1 && (await usable(loc))) return loc;
      if (!fallback) {
        for (let i = 0; i < Math.min(n, 10); i++) {
          if (await usable(loc.nth(i))) { fallback = loc.nth(i); break; }
        }
      }
    }
    if (fallback) return fallback;
    await sleep(400);
  } while (Date.now() < until);
  return null;
}

async function mustResolve(
  page: Page, target: Target, timeoutMs: number, attachedOnly = false, v?: (s: string) => string,
) {
  const onlyBlank = isBlankLocator(target.locator)
    && !target.role && !target.label && !target.placeholder && !target.text && !target.css;
  // locator ว่างไม่มีทางหาเจอ — บอกทันที ไม่ต้องรอจนหมดเวลา
  if (onlyBlank) throw new Error('locator ว่าง (codegen อ่านชื่อช่องไม่ได้) — แก้ขั้นนี้ในหน้า Template');
  const found = await resolve(page, target, timeoutMs, attachedOnly, v);
  if (!found) throw new Error('หาช่องบนหน้าเว็บไม่เจอ');
  return found;
}

/** ข้อความแจ้งเตือนที่เว็บแสดงอยู่ — แนบไปกับสาเหตุเวลาขั้นไหนไปต่อไม่ได้ */
async function visibleErrors(page: Page): Promise<string> {
  const texts = await page
    .locator('[role="alert"], .slds-has-error .slds-form-element__help, .slds-notify, .toastMessage, .error')
    .allInnerTexts()
    .catch(() => []);
  return texts.map((t) => t.trim()).filter(Boolean).join(' · ').slice(0, 300);
}

/** แถบข้อความบนสุดของหน้า — บอกคนที่นั่งดูว่ารออะไรอยู่ มีปุ่มทำต่อเมื่อขอให้คนทำ */
async function banner(page: Page, message: string, withContinue: boolean) {
  await page.evaluate(([msg, cont]) => {
    const w = window as unknown as { __kolaContinue?: boolean };
    w.__kolaContinue = false;
    document.getElementById('__kola_banner')?.remove();
    const bar = document.createElement('div');
    bar.id = '__kola_banner';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#7b3fe4;color:#fff;'
      + 'font:600 14px system-ui,sans-serif;padding:10px 16px;display:flex;gap:12px;align-items:center';
    bar.textContent = `KOLA · ${msg}`;
    if (cont) {
      const b = document.createElement('button');
      b.textContent = 'ทำต่อ';
      b.style.cssText = 'margin-left:auto;padding:6px 14px;border:0;border-radius:6px;font:inherit;cursor:pointer';
      b.onclick = () => { w.__kolaContinue = true; bar.remove(); };
      bar.appendChild(b);
    }
    document.documentElement.appendChild(bar);
  }, [message, withContinue] as const).catch(() => {});
}

async function clearBanner(page: Page) {
  await page.evaluate(() => document.getElementById('__kola_banner')?.remove()).catch(() => {});
}

/** เปิดหน้าแรก — ถ้าไม่เห็นข้อความที่บอกว่าล็อกอินอยู่ ให้คนล็อกอินเองก่อนแล้วไปต่อ */
async function openStart(page: Page, def: WebTemplateDefinition, opts: RunOptions) {
  await page.goto(def.startUrl, { waitUntil: 'domcontentloaded' });
  if (!def.loggedInText) return;
  const marker = page.getByText(def.loggedInText).first();
  if (await marker.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true, () => false)) return;

  opts.log?.('⚠️  ยังไม่ได้ล็อกอิน — กรุณาล็อกอินในหน้าต่าง Chrome ที่เปิดขึ้นมา');
  const origin = new URL(def.startUrl).origin;
  const until = Date.now() + (opts.loginWaitMs ?? 10 * 60_000);
  while (Date.now() < until) {
    await sleep(3_000);
    if (page.isClosed()) throw new Error('ปิดหน้าต่างระหว่างรอล็อกอิน');
    if (page.url().startsWith(origin) && !/login/i.test(page.url())) {
      await page.goto(def.startUrl, { waitUntil: 'domcontentloaded' });
      if (await marker.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true, () => false)) {
        opts.log?.('ล็อกอินแล้ว ทำงานต่อ');
        return;
      }
    }
  }
  throw new Error('รอล็อกอินเกิน 10 นาที');
}

/** เลือกค่า — <select> ธรรมดาเลือกตามชื่อตัวเลือก ส่วน combobox แบบ Salesforce คลิกแล้วเลือก */
async function choose(page: Page, field: Locator, value: string, timeoutMs: number) {
  const tag = await field.evaluate((el) => el.tagName.toLowerCase());
  if (tag === 'select') {
    await field.selectOption({ label: value }, { timeout: timeoutMs });
    return;
  }
  const current = ((await field.inputValue().catch(() => '')) || (await field.innerText().catch(() => ''))).trim();
  if (current.toLowerCase() === value.toLowerCase()) return;
  await field.click({ timeout: timeoutMs });
  await page.getByRole('option', { name: value, exact: true }).first().click({ timeout: timeoutMs });
}

/**
 * เล่นทุกขั้นของ Template
 *
 * หน้าเว็บที่เปิดแท็บใหม่ (popup) ระหว่างทาง ขั้นถัดไปทำบนแท็บใหม่นั้น
 * กล่องเลือกไฟล์ของเบราว์เซอร์ถูกดักไว้ไม่ให้เด้ง ขั้นแนบไฟล์ใช้กล่องนั้นแทน
 */
export async function runTemplate(context: BrowserContext, def: WebTemplateDefinition, opts: RunOptions): Promise<RunResult> {
  let page = await context.newPage();
  // กล่องเลือกไฟล์ที่เปิดจากขั้นคลิกล่าสุด — ล้างทุกครั้งที่เริ่มขั้นใหม่ กันใช้กล่องเก่าผิดช่อง
  let chooser: FileChooser | null = null;
  const watch = (p: Page) => p.on('filechooser', (fc) => { chooser = fc; });
  watch(page);
  const onPage = (p: Page) => { page = p; watch(p); };
  context.on('page', onPage);

  const v = (s: string) => fillVars(s, opts.vars);
  // locator แทนค่าทีหลังตอนสร้าง (ดู candidates) ช่องอื่นแทนตรงนี้เลย
  const t = (target: Target): Target => Object.fromEntries(
    Object.entries(target).map(([k, val]) => [k, typeof val === 'string' && k !== 'locator' ? v(val) : val]),
  ) as Target;

  let stoppedBeforeSubmit = false;
  try {
    await openStart(page, def, opts);

    for (const [i, step] of def.steps.entries()) {
      const timeoutMs = (step.timeout ?? DEFAULT_TIMEOUT) * 1000;
      opts.log?.(`  ${i + 1}. ${describeStep(step)}`);
      try {
        if (step.type === 'submit' && opts.mode === 'dry') {
          // ยังหาปุ่มให้เจอ เพื่อยืนยันว่ากรอกมาถึงจุดส่งได้จริง แต่ไม่กด
          await mustResolve(page, t(step.target), timeoutMs, false, v);
          stoppedBeforeSubmit = true;
          await banner(page, 'ทดลองรันจบแล้ว — หยุดก่อนกดปุ่มส่ง ไม่ได้ส่งจริง', false);
          break;
        }
        if (step.type !== 'upload') chooser = null;
        const afterClick = def.steps[i - 1]?.type === 'click';
        await runStep(page, step, timeoutMs, opts, t, v, async () => {
          // เหตุการณ์กล่องเลือกไฟล์มาช้ากว่าการคลิกเล็กน้อย — ขั้นก่อนหน้าเป็นคลิกให้รอดูก่อน
          const until = Date.now() + (afterClick ? 3_000 : 0);
          while (!chooser && Date.now() < until) await sleep(100);
          const fc = chooser;
          chooser = null;
          return fc;
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message.split('\n')[0] : String(error);
        const hint = page.isClosed() ? '' : await visibleErrors(page);
        throw new Error(`ขั้นที่ ${i + 1} (${describeStep(step)}): ${msg}${hint ? ` · เว็บแจ้ง: ${hint}` : ''}`.slice(0, 900));
      }
      // ให้หน้าที่เพิ่งเปลี่ยนตั้งตัวก่อนขั้นถัดไป ไม่ต้องรอ network ทั้งหมด
      await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
    }

    if (!stoppedBeforeSubmit) {
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
      await sleep(1_500);
      const errors = await visibleErrors(page);
      if (/error|fail|invalid|ไม่สำเร็จ/i.test(errors)) throw new Error(`เว็บแจ้งหลังส่ง: ${errors}`);
    }

    const screenshot = await page.screenshot({ fullPage: true });
    let refNo = '';
    if (def.refPattern && !stoppedBeforeSubmit) {
      const body = await page.locator('body').innerText().catch(() => '');
      refNo = (new RegExp(def.refPattern, 'i').exec(body)?.[1] ?? '').trim().slice(0, 80);
    }
    return { page, screenshot, refNo, stoppedBeforeSubmit };
  } finally {
    context.off('page', onPage);
  }
}

async function runStep(
  page: Page, step: Step, timeoutMs: number, opts: RunOptions,
  t: (x: Target) => Target, v: (s: string) => string,
  takeChooser: () => Promise<FileChooser | null>,
) {
  switch (step.type) {
    case 'goto':
      await page.goto(v(step.url), { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      return;

    case 'click': {
      if (step.optional) {
        // ของที่ขึ้นบ้างไม่ขึ้นบ้าง — รอดูสั้น ๆ ไม่เจอก็ข้าม เจอแล้วค่อยให้เวลาเต็มรอจนกดได้
        const found = await resolve(page, t(step.target), Math.min(timeoutMs, 8_000), false, v);
        if (found) await found.click({ timeout: timeoutMs });
        return;
      }
      await (await mustResolve(page, t(step.target), timeoutMs, false, v)).click({ timeout: timeoutMs });
      return;
    }

    case 'fill':
      await (await mustResolve(page, t(step.target), timeoutMs, false, v)).fill(v(step.value), { timeout: timeoutMs });
      return;

    case 'select':
      await choose(page, await mustResolve(page, t(step.target), timeoutMs, false, v), v(step.value), timeoutMs);
      return;

    case 'upload': {
      const path = opts.files[step.file];
      if (!path) throw new Error(`ไม่มีไฟล์หมวด ${step.file}`);
      // ขั้นก่อนหน้าเพิ่งคลิกปุ่มที่เปิดกล่องเลือกไฟล์ — ใช้กล่องนั้นเลย
      const fc = await takeChooser();
      if (fc) { await fc.setFiles(path, { timeout: timeoutMs }); return; }
      const el = await mustResolve(page, t(step.target), timeoutMs, true, v);
      const isFileInput = await el.evaluate((e) => e instanceof HTMLInputElement && e.type === 'file').catch(() => false);
      if (isFileInput) { await el.setInputFiles(path, { timeout: timeoutMs }); return; }
      // codegen เขียน setInputFiles บนปุ่มที่เปิดกล่องเลือกไฟล์ — กดปุ่มแล้วรับกล่องแทน
      const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: timeoutMs }), el.click({ timeout: timeoutMs })]);
      await chooser.setFiles(path, { timeout: timeoutMs });
      return;
    }

    case 'press':
      await (await mustResolve(page, t(step.target), timeoutMs, false, v)).press(step.key, { timeout: timeoutMs });
      return;

    case 'waitFor':
      await mustResolve(page, t(step.target), timeoutMs, false, v);
      return;

    case 'waitText': {
      const text = v(step.text);
      const ok = await page.getByText(text).first()
        .waitFor({ state: 'visible', timeout: timeoutMs }).then(() => true, () => false);
      if (!ok) throw new Error(`ไม่เห็นข้อความ "${text}" ภายใน ${timeoutMs / 1000} วินาที`);
      return;
    }

    case 'pause': {
      opts.log?.(`⏸  ${step.message} — กด "ทำต่อ" บนแถบด้านบนของหน้าเมื่อเสร็จ`);
      /*
       * ระหว่างรอ คนมักล็อกอินหรือกดไปหน้าอื่น — หน้าใหม่ไม่มีแถบและตัวแปรเดิม
       * จึงถามทีละครั้ง ถ้าแถบหายก็แสดงใหม่บนหน้าปัจจุบัน และจับแท็บใหม่ที่เว็บเปิดด้วย
       */
      const until = Date.now() + (opts.reviewWaitMs ?? 20 * 60_000);
      while (Date.now() < until) {
        const current = page.context().pages().filter((p) => !p.isClosed()).pop() ?? page;
        if (current.isClosed()) throw new Error('ปิดหน้าต่างระหว่างรอ');
        const state = await current.evaluate(() => {
          const w = window as unknown as { __kolaContinue?: boolean };
          return w.__kolaContinue === true ? 'done' : document.getElementById('__kola_banner') ? 'wait' : 'missing';
        }).catch(() => 'loading');
        if (state === 'done') return;
        if (state === 'missing') await banner(current, step.message, true);
        await sleep(700);
      }
      throw new Error('ไม่ได้กดทำต่อภายในเวลาที่กำหนด');
    }

    case 'submit': {
      const button = await mustResolve(page, t(step.target), timeoutMs, false, v);
      if (opts.mode === 'auto') {
        await button.click({ timeout: timeoutMs });
      } else {
        opts.log?.('👀 กรอกครบแล้ว — ตรวจในหน้าต่าง Chrome แล้วกดปุ่มส่งเอง');
        await banner(page, 'กรอกครบแล้ว — ตรวจข้อมูลแล้วกดปุ่มส่งของเว็บเอง', false);
      }
      // หลังส่ง ปุ่มหายไปหรือเว็บพาไปหน้าอื่น — รอจนเห็น หรือจนหมดเวลารอคนตรวจ
      const until = Date.now() + (opts.mode === 'auto' ? 90_000 : (opts.reviewWaitMs ?? 20 * 60_000));
      while (Date.now() < until) {
        if (page.isClosed()) throw new Error('ปิดหน้าต่างก่อนกดส่ง');
        if (!(await button.isVisible().catch(() => false))) break;
        await sleep(1_000);
      }
      if (await button.isVisible().catch(() => false)) {
        throw new Error(opts.mode === 'auto' ? 'กดส่งแล้วเว็บไม่ไปต่อ' : 'ไม่ได้กดส่งภายในเวลาที่กำหนด');
      }
      await clearBanner(page);
      return;
    }
  }
}
