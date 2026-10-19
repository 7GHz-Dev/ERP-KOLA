/**
 * ทดสอบ Template กรอกเว็บกับหน้าจำลอง (tests/fixtures/web-template-mock.html) — ไม่ต่อฐานข้อมูล ไม่ออกเน็ต
 *
 *   1. ตัวตรวจ JSON และการแทนตัวแปร
 *   2. เล่นตัวอย่าง CMA ครบจนกดส่ง (โหมดอัตโนมัติ) แล้วค่าที่หน้าเว็บได้รับต้องตรง
 *   3. โหมดทดลองต้องหยุดก่อนปุ่มส่ง
 *   4. บันทึกขั้นตอนจากการกดจริงด้วยตัวบันทึก แล้วเอาขั้นที่ได้ไปเล่นซ้ำต้องได้ผลเหมือนกัน
 *   5. แปลงโค้ด Playwright codegen เป็นขั้นตอนแล้วเล่นได้ · บันทึกผ่านตัวบันทึกของ Playwright จริง
 *
 * ต้องมี Google Chrome ในเครื่อง (ใช้ channel เดียวกับ worker)
 *   npm run test:web-template
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import {
  CMA_EXAMPLE, definitionSchema, fillVars, stepSchema, templatize, type WebTemplateDefinition,
} from '../src/lib/web-template';
import { runTemplate } from '../scripts/web-template-runner';
import { RecorderHub } from '../scripts/web-recorder-session';
import { recordWithCodegen } from '../scripts/codegen-recorder';
import { hasVolatileId, isBlankLocator, parseCodegen, parseLocator } from '../src/lib/playwright-code';

const MOCK = readFileSync(join(__dirname, 'fixtures', 'web-template-mock.html'));

const vars = {
  job: { blNo: 'AMP0558885', jobNo: 'KL-001' },
  input: { slipno: 'TXN-77881', billing: 'KOLA SHIPPING CO.,LTD.\n123 Bangkok' },
};

type MockState = { svc: string; agency: string; bl: string[]; files: string[][]; payref: string; extra: string; submitted: boolean };
const state = (page: Page) => page.evaluate(() => (window as unknown as { __state: MockState }).__state);

async function main() {
  /* ---- 1. ตัวตรวจและตัวแปร ---- */
  assert.ok(definitionSchema.safeParse(CMA_EXAMPLE).success, 'ตัวอย่าง CMA ต้องผ่านตัวตรวจ');
  assert.ok(!definitionSchema.safeParse({ ...CMA_EXAMPLE, inputs: [{ key: 'slipno', label: 'x' }] }).success,
    'slipno เป็นตัวแปรของระบบ ประกาศซ้ำไม่ได้');
  assert.equal(fillVars('BL {{job.blNo}} / {{ input.slipno }} / {{job.none}}', vars), 'BL AMP0558885 / TXN-77881 / ');
  assert.equal(templatize('ref AMP0558885 x', { job: { blNo: 'AMP0558885' }, input: {} }), 'ref {{job.blNo}} x');
  assert.equal(templatize('ab', { job: { blNo: 'ab' }, input: {} }), 'ab', 'ค่าสั้นเกินไปไม่แทน');
  assert.ok(!stepSchema.safeParse({ type: 'click', target: {} }).success, 'ขั้นที่ไม่บอกว่าช่องไหนต้องไม่ผ่าน');
  assert.ok(!stepSchema.safeParse({ type: 'eval', code: 'alert(1)' }).success, 'ชนิดขั้นที่ไม่รู้จักต้องไม่ผ่าน');
  assert.ok(!definitionSchema.safeParse({ ...CMA_EXAMPLE, startUrl: 'file:///etc/passwd' }).success, 'ลิงก์ต้องเป็น http(s)');
  assert.ok(!definitionSchema.safeParse({
    ...CMA_EXAMPLE, steps: [...CMA_EXAMPLE.steps, CMA_EXAMPLE.steps[CMA_EXAMPLE.steps.length - 1]],
  }).success, 'ปุ่มส่งมีได้ขั้นเดียว');

  /* ---- อ่านโค้ด codegen ---- */
  {
    const code = `const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://portal.example.com/login');
  await page.getByLabel('Username').fill('ann');
  await page.getByLabel('Password').fill('s3cret!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('combobox', { name: 'Service Type' }).click();
  await page.getByRole('option', { name: 'New Delivery Order' }).click();
  await page.getByLabel('Agency Location').selectOption('Thailand');
  await page.locator('bl-field').getByRole('textbox', { name: 'BL Reference' }).fill('AMP0558885');
  await page.getByRole('textbox', { name: 'BL Reference' }).press('Enter');
  await expect(page.getByText('AMP0558885')).toBeVisible();
  await page.getByRole('button', { name: 'Upload Files' }).nth(1).setInputFiles('DO "set".pdf');
  await page.getByText(/request number/i).click();
  const page1Promise = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Open' }).click();
  const page1 = await page1Promise;
  await page1.locator('iframe[name="pay"]').contentFrame().getByPlaceholder('Ref').fill('X1');
  await page.selectOption('#a', 'b');
  await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible();

  // ---------------------
  await context.close();
  await browser.close();
})();`;
    const parsed = parseCodegen(code);
    assert.equal(parsed.startUrl, 'https://portal.example.com/login');
    assert.deepEqual(parsed.steps.map((x) => x.type), [
      'fill', 'click', 'click', 'click', 'select', 'fill', 'press', 'waitText', 'upload', 'click', 'click', 'fill', 'submit',
    ]);
    assert.ok(parsed.skipped.some((l) => l.includes('Password') && l.includes('รหัสผ่าน')), 'ช่องรหัสผ่านต้องถูกข้าม');
    assert.ok(parsed.skipped.some((l) => l.includes("page.selectOption('#a'")), 'รูปแบบเก่าที่ไม่มี locator ต้องถูกแจ้งว่าข้าม');
    assert.ok(!JSON.stringify(parsed.steps).includes('s3cret'), 'รหัสผ่านต้องไม่หลุดเข้าขั้นตอน');
    const byType = (i: number) => parsed.steps[i] as any;
    assert.equal(byType(5).target.locator, "locator('bl-field').getByRole('textbox', { name: 'BL Reference' })");
    assert.equal(byType(6).key, 'Enter');
    assert.equal(byType(8).target.locator, "getByRole('button', { name: 'Upload Files' }).nth(1)");
    assert.match(byType(8).note, /DO "set"\.pdf/);
    assert.equal(byType(9).target.locator, 'getByText(/request number/i)');
    assert.equal(byType(11).target.locator, `locator('iframe[name="pay"]').contentFrame().getByPlaceholder('Ref')`);
    assert.equal(byType(12).target.locator, "getByRole('button', { name: 'Submit' })", 'ตรวจปุ่มเป็นขั้นสุดท้าย = ปุ่มส่ง');
    for (const step of parsed.steps) assert.ok(stepSchema.safeParse(step).success, JSON.stringify(step));
    assert.throws(() => parseLocator("getByRole('button').evaluate('alert(1)')"), /ไม่รองรับ/);
    assert.throws(() => parseLocator('getByText(window.secret)'), /ค่าคงที่/);
    assert.throws(() => parseLocator('getByText(`${x}`)'), /template string/);
    // โครงไฟล์ของ codegen หลายบรรทัดต้องไม่ขึ้นเป็น "ข้าม" · locator ว่างต้องถูกเตือน
    const real = parseCodegen(`const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://mycustomerservice.cma-cgm.com/s/importdorequest');
  await page.getByLabel('', { exact: true }).click();
  await page.getByRole('combobox', { name: '' }).click();
  await page.getByText('New Delivery Order').click();

  // ---------------------
  await context.close();
  await browser.close();
})();`);
    assert.deepEqual(real.skipped, [], real.skipped.join('\n'));
    assert.equal(real.steps.length, 3);
    assert.deepEqual(real.warnings.map((w) => w.slice(0, 9)), ['ขั้นที่ 1', 'ขั้นที่ 2']);
    assert.ok(isBlankLocator("getByLabel('', { exact: true })"));
    assert.ok(!isBlankLocator("getByLabel('Service Type')"));
    assert.ok(!isBlankLocator("getByRole('button')"), 'role ไม่มีชื่อไม่ใช่ locator ว่าง');
    assert.ok(hasVolatileId("locator('#input-38')"));
    assert.ok(hasVolatileId("locator('#file-selector-label-55').getByText('Or drop files')"));
    assert.ok(!hasVolatileId("locator('#agency')") && !hasVolatileId("locator('input[type=\"file\"]').nth(1)"));
    const sf = parseCodegen(`
  await page.locator('#input-38').fill('AMP1');
  await page.locator('#input-file-55').setInputFiles('a.pdf');
  await page.locator('#input-file-55').setInputFiles('a.pdf');
  await page.getByRole('button', { name: 'Done' }).click();`);
    assert.deepEqual(sf.steps.map((x) => x.type), ['fill', 'upload', 'click'], 'แนบไฟล์ซ้ำติดกันเก็บครั้งเดียว');
    assert.deepEqual(sf.warnings.map((w) => w.slice(0, 9)), ['ขั้นที่ 1', 'ขั้นที่ 2']);
    console.log('✓ อ่านโค้ด codegen');
  }

  const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(MOCK); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const url = `http://127.0.0.1:${port}/s/importdorequest`;

  const dir = mkdtempSync(join(tmpdir(), 'kola-wt-'));
  const pdf = join(dir, 'AMP0558885_DO.pdf');
  writeFileSync(pdf, '%PDF-1.4\n%mock\n');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const def: WebTemplateDefinition = {
      ...CMA_EXAMPLE, startUrl: url, refPattern: 'Request number:\\s*([A-Z0-9-]+)',
    };

    /* ---- 2. เล่นครบจนส่ง ---- */
    {
      const context = await browser.newContext();
      const result = await runTemplate(context, def, { mode: 'auto', vars, files: { DO_MERGED: pdf } });
      const s = await state(result.page);
      assert.equal(s.svc, 'New Delivery Order');
      assert.equal(s.agency, 'Thailand');
      assert.deepEqual(s.bl, ['AMP0558885']);
      assert.deepEqual(s.files, [['AMP0558885_DO.pdf'], ['AMP0558885_DO.pdf']]);
      assert.equal(s.payref, 'TXN-77881');
      assert.equal(s.extra, vars.input.billing);
      assert.equal(s.submitted, true);
      assert.equal(result.refNo, 'DO-2026-0042');
      assert.equal(result.stoppedBeforeSubmit, false);
      assert.ok(result.screenshot.length > 1000);
      await context.close();
      console.log('✓ เล่นตัวอย่าง CMA ครบจนส่ง');
    }

    /* ---- XPath ที่คัดลอกจาก DevTools ทั้งแบบสั้นและแบบเต็ม ---- */
    {
      const context = await browser.newContext();
      const xpathDef: WebTemplateDefinition = {
        ...def,
        steps: def.steps.map((step) => {
          if (step.type === 'click' && step.target.name === 'Next') return { ...step, target: { css: '//*[@id="next"]' } };
          if (step.type === 'fill' && step.target.name === 'Payment reference number') {
            return { ...step, target: { css: '/html/body/section[2]/input[3]' } };
          }
          return step;
        }),
      };
      const result = await runTemplate(context, xpathDef, { mode: 'auto', vars, files: { DO_MERGED: pdf } });
      const s = await state(result.page);
      assert.equal(s.payref, 'TXN-77881');
      assert.equal(s.submitted, true);
      await context.close();
      console.log('✓ ช่องหาด้วย XPath ได้');
    }

    /* ---- locator ว่างต้องพังทันทีพร้อมบอกวิธีแก้ ไม่รอจนหมดเวลา ---- */
    {
      const context = await browser.newContext();
      const started = Date.now();
      await assert.rejects(
        runTemplate(context, { ...def, steps: [{ type: 'click', target: { locator: "getByLabel('', { exact: true })" } }] },
          { mode: 'auto', vars, files: {} }),
        /ขั้นที่ 1 .*locator ว่าง/,
      );
      assert.ok(Date.now() - started < 15_000, 'ต้องไม่รอจนหมดเวลา 30 วินาที');
      await context.close();
      console.log('✓ locator ว่างแจ้งทันที');
    }

    /* ---- หยุดให้คนทำ แล้วคนเปลี่ยนหน้า (เช่นล็อกอิน) ระหว่างรอ ---- */
    {
      const context = await browser.newContext();
      const run = runTemplate(context, {
        ...def,
        steps: [
          { type: 'pause', message: 'login' },
          { type: 'click', target: { role: 'button', name: 'Add' } },
        ],
      }, { mode: 'auto', vars, files: {} });
      const page = await (async () => {
        for (;;) {
          const p = context.pages()[0];
          if (p && await p.locator('#__kola_banner').count().catch(() => 0)) return p;
          await new Promise((r) => setTimeout(r, 200));
        }
      })();
      await page.reload();
      // แถบต้องกลับมาบนหน้าใหม่ แล้วกดทำต่อได้
      await page.locator('#__kola_banner').getByRole('button', { name: 'ทำต่อ' }).click({ timeout: 10_000 });
      await run;
      await context.close();
      console.log('✓ หยุดให้คนทำ ทนการเปลี่ยนหน้า');
    }

    /* ---- 3. ทดลองรัน — หยุดก่อนส่ง ---- */
    {
      const context = await browser.newContext();
      const result = await runTemplate(context, def, { mode: 'dry', vars, files: { DO_MERGED: pdf } });
      const s = await state(result.page);
      assert.equal(result.stoppedBeforeSubmit, true);
      assert.equal(s.submitted, false);
      assert.equal(s.payref, '', 'ช่องที่กรอกยังไม่ถูกส่ง');
      await context.close();
      console.log('✓ ทดลองรันหยุดก่อนปุ่มส่ง');
    }

    /* ---- พังแล้วบอกขั้นที่พัง ---- */
    {
      const context = await browser.newContext();
      const broken: WebTemplateDefinition = {
        ...def, steps: [def.steps[0], { type: 'click', target: { role: 'button', name: 'ไม่มีปุ่มนี้' }, timeout: 2 }],
      };
      await assert.rejects(
        runTemplate(context, broken, { mode: 'auto', vars, files: {} }),
        /ขั้นที่ 2 \(คลิก button "ไม่มีปุ่มนี้"\): หาช่องบนหน้าเว็บไม่เจอ/,
      );
      await context.close();
      console.log('✓ พังแล้วบอกว่าขั้นไหน');
    }

    /* ---- 4. บันทึกจากการกดจริง แล้วเล่นซ้ำ ---- */
    {
      const context = await browser.newContext();
      const hub = new RecorderHub();
      await hub.install(context);
      const recording = hub.begin(url);
      const page = await context.newPage();
      await page.goto(url);
      // กด "เริ่มบันทึก" — แถบเครื่องมืออยู่ใน shadow root แบบปิด จึงส่งข้อความเดียวกับที่ปุ่มส่ง
      await page.waitForFunction(() => typeof (window as any).__kolaRec === 'function');
      await page.evaluate((u) => (window as any).__kolaRec({ kind: 'start', url: u }), url);

      await page.getByRole('combobox', { name: 'Service Type' }).click();
      await page.getByRole('option', { name: 'New Delivery Order' }).click();
      await page.getByLabel('Agency Location').selectOption({ label: 'Thailand' });
      await page.getByRole('textbox', { name: 'BL Reference' }).fill('AMP0558885');
      await page.getByRole('button', { name: 'Add' }).click();
      await page.getByText('AMP0558885', { exact: true }).waitFor();
      // ชี้ข้อความที่ต้องรอ — แบบเดียวกับกด "+ รอข้อความ" แล้วคลิกข้อความ
      await page.evaluate(() => { (window as any).__kolaMode = 'wait'; });
      await page.getByText('AMP0558885', { exact: true }).click();
      await page.getByRole('button', { name: 'Next' }).click();

      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Upload Files' }).first().click();
      await (await chooser).setFiles(pdf);
      await page.getByRole('button', { name: 'Done' }).click();
      const chooser2 = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Upload Files' }).nth(1).click();
      await (await chooser2).setFiles(pdf);
      await page.getByRole('button', { name: 'Done' }).click();

      await page.getByLabel('Payment reference number').fill('TXN-REC-1');
      await page.getByLabel('Additional information').fill('KOLA');
      // ชี้ปุ่มส่ง — ต้องไม่ส่งจริงตอนบันทึก
      await page.evaluate(() => { (window as any).__kolaMode = 'submit'; });
      await page.getByRole('button', { name: 'Submit' }).click();
      assert.equal((await state(page)).submitted, false, 'ชี้ปุ่มส่งตอนบันทึกต้องไม่ส่งจริง');

      await page.waitForTimeout(300);
      hub.finish();
      const { steps, startUrl } = await recording;
      await context.close();

      console.log('  ขั้นที่บันทึกได้:');
      for (const s of steps) console.log('   ', JSON.stringify(s));
      assert.equal(startUrl, url);
      const types = steps.map((s) => s.type);
      assert.deepEqual(types, [
        'click', 'click', 'select', 'fill', 'click', 'waitText', 'click',
        'click', 'upload', 'click', 'click', 'upload', 'click',
        'fill', 'fill', 'submit',
      ]);
      for (const s of steps) assert.ok(stepSchema.safeParse(s).success, `ขั้นที่บันทึกต้องผ่านตัวตรวจ: ${JSON.stringify(s)}`);

      // แทนค่าของงานตัวอย่างเป็นตัวแปร แบบเดียวกับฝั่งเซิร์ฟเวอร์ แล้วผูกช่องที่ถามเอง
      const sample = { job: { blNo: 'AMP0558885' }, input: { paymentRef: 'TXN-REC-1' } };
      const replay = steps.map((s) => {
        const step = stepSchema.parse(s);
        if (step.type === 'fill') step.value = templatize(step.value, sample);
        if (step.type === 'waitText') step.text = templatize(step.text, sample);
        return step;
      });
      assert.ok(replay.some((s) => s.type === 'fill' && s.value === '{{job.blNo}}'), 'เลข BL ต้องกลายเป็นตัวแปร');
      assert.ok(replay.some((s) => s.type === 'waitText' && s.text === '{{job.blNo}}'));

      const recorded = definitionSchema.parse({
        startUrl: url,
        button: { label: 'ทดสอบ', page: 'do-exchange', roles: ['ANN'], markDoExchanged: false },
        inputs: [{ key: 'paymentRef', label: 'Ref' }],
        steps: replay,
      });
      const context2 = await browser.newContext();
      const other = { job: { blNo: 'AMP9999999' }, input: { paymentRef: 'TXN-NEW-2' } };
      const result = await runTemplate(context2, recorded, { mode: 'auto', vars: other, files: { DO_MERGED: pdf } });
      const s = await state(result.page);
      assert.deepEqual(s.bl, ['AMP9999999'], 'เล่นซ้ำกับงานอื่นต้องได้ BL ของงานนั้น');
      assert.equal(s.payref, 'TXN-NEW-2');
      assert.equal(s.svc, 'New Delivery Order');
      assert.deepEqual(s.files, [['AMP0558885_DO.pdf'], ['AMP0558885_DO.pdf']]);
      assert.equal(s.submitted, true);
      await context2.close();
      console.log('✓ บันทึกจากการกดจริงแล้วเล่นซ้ำกับงานอื่นได้');
    }

    /* ---- 5. เล่นขั้นที่แปลงจากโค้ด codegen ---- */
    {
      const code = `
  await page.goto('${url}');
  await page.getByRole('combobox', { name: 'Service Type' }).click();
  await page.getByRole('option', { name: 'New Delivery Order' }).click();
  await page.getByLabel('Agency Location').selectOption('Thailand');
  await page.locator('bl-field').getByRole('textbox', { name: 'BL Reference' }).fill('AMP0558885');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('AMP0558885')).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Upload Files' }).first().setInputFiles('x.pdf');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Upload Files' }).nth(1).click();
  await page.getByRole('button', { name: 'Upload Files' }).nth(1).setInputFiles('x.pdf');
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByLabel('Payment reference number').fill('TXN-OLD');
  await page.getByLabel('Payment reference number').press('Tab');
  await expect(page.getByRole('button', { name: 'Submit' })).toBeVisible();`;
      const parsed = parseCodegen(code);
      assert.equal(parsed.skipped.length, 0, parsed.skipped.join('\n'));
      const sample = { job: { blNo: 'AMP0558885' }, input: { paymentRef: 'TXN-OLD' } };
      const steps = parsed.steps.map((step) => {
        const st = stepSchema.parse(step) as any;
        if (st.type === 'fill') st.value = templatize(st.value, sample);
        if (st.type === 'waitText') st.text = templatize(st.text, sample);
        return st;
      });
      const fromCode = definitionSchema.parse({
        startUrl: parsed.startUrl,
        button: { label: 'codegen', page: 'do-exchange', roles: ['ANN'], markDoExchanged: false },
        inputs: [{ key: 'paymentRef', label: 'Ref' }],
        steps,
      });
      assert.equal(fromCode.steps[fromCode.steps.length - 1].type, 'submit');
      const context = await browser.newContext();
      const other = { job: { blNo: 'AMP7777777' }, input: { paymentRef: 'TXN-CG-3' } };
      const result = await runTemplate(context, fromCode, { mode: 'auto', vars: other, files: { DO_MERGED: pdf } });
      const st = await state(result.page);
      assert.deepEqual(st.bl, ['AMP7777777']);
      assert.equal(st.svc, 'New Delivery Order');
      assert.equal(st.agency, 'Thailand');
      assert.deepEqual(st.files, [['AMP0558885_DO.pdf'], ['AMP0558885_DO.pdf']], 'แนบไฟล์ผ่านปุ่มได้ทั้งสองช่อง');
      assert.equal(st.payref, 'TXN-CG-3');
      assert.equal(st.submitted, true);
      await context.close();
      console.log('✓ เล่นขั้นที่แปลงจากโค้ด codegen ได้');
    }

    /* ---- 6. บันทึกผ่านตัวบันทึกของ Playwright จริง (หน้าต่าง Inspector ไม่แสดงตอนทดสอบ) ---- */
    {
      process.env.PWTEST_CLI_HEADLESS = '1';
      const profile = mkdtempSync(join(tmpdir(), 'kola-wt-profile-'));
      const code = await recordWithCodegen({
        profile, startUrl: url, loggedInText: 'Create new request', timeoutMs: 30_000, headless: true,
        drive: async (context) => {
          const page = context.pages()[context.pages().length - 1];
          await page.getByRole('button', { name: 'Add' }).waitFor();
          // ตัวบันทึกของ Playwright จับการกดแบบคน — คลิกจริงทีละครั้ง เว้นจังหวะให้มันเขียนทัน
          await page.getByRole('combobox', { name: 'Service Type' }).click();
          await page.waitForTimeout(400);
          await page.getByRole('option', { name: 'New Delivery Order' }).click();
          await page.waitForTimeout(1_000);
        },
      });
      delete process.env.PWTEST_CLI_HEADLESS;
      const parsed = parseCodegen(code);
      assert.ok(parsed.steps.length >= 1, `ตัวบันทึกต้องได้ขั้นตอน\n${code}`);
      assert.ok(parsed.steps.some((x) => x.type === 'click' && /New Delivery Order/.test(x.target.locator ?? '')),
        `ต้องมีขั้นคลิกตัวเลือก\n${code}`);
      assert.ok(!parsed.steps.some((x) => x.type === 'goto'), 'การเปิดแท็บใหม่ตอนเริ่มบันทึกต้องไม่กลายเป็นขั้น');
      console.log(`✓ บันทึกผ่าน Playwright codegen ได้ ${parsed.steps.length} ขั้น`);
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log('web-template: ผ่านทั้งหมด');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
