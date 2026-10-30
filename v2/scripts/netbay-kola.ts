/**
 * คุมหน้าเว็บ NETBAY (KOLA) ด้วย Playwright — ยกมาจาก core/netbay.py ของโปรแกรม imp
 *
 *   createDraft()      worker สร้าง Draft ใบขน: login -> New (610) -> กรอกหัวใบขน -> Add Invoice -> Import CSV
 *                      จบทันทีที่ NETBAY ขึ้น "success please check your invoice" — ไม่กด Save / Send to Customs
 *   openDeclaration()  ลิงก์ Ref No. บน ERP: login -> Import -> ค้นหา Reference No. -> เปิดใบขนนั้นค้างไว้ให้ตรวจ
 *   readDeclaration()  ตัว monitor ใบขน: ค้นหา Reference No. -> อ่านสถานะ (รูปป้าย) + DECLARATION NO
 *   downloadDeclarationPdf()  ติ๊กแถว -> ชื่อไฟล์ = เลขที่ใบขน -> Save PDF -> แตก zip เอา <เลขใบขน>.pdf
 *
 * XPath ยกมาจากโปรแกรมเดิม (Selenium) และตรวจกับหน้าจริงแล้ว
 * ค่าตั้งอยู่ใน .env.local: NETBAY_USER, NETBAY_PASSWORD (และค่าหัวใบขนถ้าต่างจากค่าตั้งต้นด้านล่าง)
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { chromium, type Browser, type Download, type Frame, type FrameLocator, type Locator, type Page } from 'playwright-core';
import type { Totals } from '../src/lib/draft/csv';
import { DECLARATION_NO, parseStatusImage, statusFromImageHash, type NetbayStatusCode } from '../src/lib/customs-status';

export type NetbaySettings = {
  url: string; username: string; password: string; declarationType: string;
  importerSearch: string; importerName: string; vessel: string; voyage: string;
  originCountry: string; releasePort: string; headless: boolean;
  /** ย่อการแสดงผลของหน้าต่าง NETBAY ให้เห็นทั้งหน้าโดยไม่ต้องเลื่อน (1 = ขนาดปกติ) */
  zoom: number;
};

/** ค่าจาก .env.local  ค่าหัวใบขนตั้งต้นเป็นค่าเดิมจากโปรแกรมเก่า */
export function netbaySettings(env: Record<string, string | undefined> = process.env): NetbaySettings {
  return {
    url: (env.NETBAY_URL ?? 'http://192.168.1.123/kola/spn').replace(/\/$/, ''),
    username: env.NETBAY_USER ?? '',
    password: env.NETBAY_PASSWORD ?? '',
    declarationType: env.NETBAY_DECLARATION_TYPE ?? '610',
    importerSearch: env.NETBAY_IMPORTER_SEARCH ?? 'MAESOT FREE ZONE',
    importerName: env.NETBAY_IMPORTER_NAME ?? 'บริษัท เเม่สอด ฟรีโซน จำกัด',
    vessel: env.NETBAY_VESSEL ?? 'OOCL BANGKOK',
    voyage: env.NETBAY_VOYAGE ?? 'XXXX',
    originCountry: env.NETBAY_ORIGIN_COUNTRY ?? 'JP',
    releasePort: env.NETBAY_RELEASE_PORT ?? '2836',     // ช่องแถว 9 ด้านขวาของหัวใบขน
    headless: env.NETBAY_HEADLESS === '1',
    zoom: Math.min(1.5, Math.max(0.5, Number(env.NETBAY_ZOOM ?? '0.8') || 0.8)),
  };
}

export class NetbayError extends Error {}

const D = 'xpath=//*[@id="declarationDIV"]/table/tbody/tr';
const TREE_ROOT = 'xpath=//*[@id="outLineTree"]/font/div/table/tbody/tr[1]/td/div/font/b/span';
const IMPORT_LINK = 'xpath=//*[@id="smoothmenu1"]/ul/li[3]/ul/li[5]/a';
const LOGIN_AREA = 'xpath=/html/body/map/area';
const UPLOAD_BTN = 'xpath=/html/body/table/tbody/tr[4]/td[2]/div/form/table/tbody/tr/td/table/tbody/tr[5]/td[2]/input[2]';
const REF_NO = '#referenceNo';              // Reference No. ของใบขน เช่น QENX000000019 (มีตั้งแต่กด New)
const SEARCH_REF = 'input[name="sREF"]';    // หน้ารายการใบขน: ช่อง Reference No.
const SEARCH_BTN = '#refreshBTN';           // หน้ารายการใบขน: ปุ่ม Search
export const IMPORT_OK = /success\W*(?:\w+\W+){0,3}?please\s+check\s+your\s+invoice/i;
export let IMPORT_TIMEOUT_MS = 180_000;     // invoice ใหญ่ใช้เวลา Import นาน
export const setImportTimeout = (ms: number) => { IMPORT_TIMEOUT_MS = ms; };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const squash = (s: string) => s.split(/\s+/).filter(Boolean).join(' ');
const today = () => { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`; };

export function check(s: NetbaySettings) {
  if (!s.url || !s.username || !s.password) {
    throw new NetbayError('ยังไม่ได้ตั้ง NETBAY_USER / NETBAY_PASSWORD ใน .env.local');
  }
}

/* ---------------- เบราว์เซอร์ ---------------- */

/** Chromium ที่ Playwright โหลดไว้ (ใช้เมื่อเครื่องไม่มี Google Chrome) */
function bundledChromium(): string | undefined {
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), 'Library', 'Caches', 'ms-playwright'),
    join(homedir(), 'AppData', 'Local', 'ms-playwright'), join(homedir(), '.cache', 'ms-playwright')];
  const exes = ['chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe', 'chrome-linux/chrome'];
  for (const root of roots) {
    if (!root || !existsSync(root)) continue;
    const dirs = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const d of dirs) for (const e of exes) if (existsSync(join(root, d, e))) return join(root, d, e);
  }
  return undefined;
}

/** Google Chrome ที่ติดตั้งในเครื่อง ไม่มีก็ใช้ Chromium ของ Playwright */
export function chromePath(): string {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    '/usr/bin/google-chrome',
  ];
  const found = candidates.find((p) => p && existsSync(p)) ?? bundledChromium();
  if (!found) throw new NetbayError('ไม่พบ Google Chrome ในเครื่อง — ติดตั้ง Chrome ก่อน');
  return found;
}

/**
 * ย่อการแสดงผลตาม NETBAY_ZOOM — หน้าของ NETBAY กว้างและยาว ไม่ย่อต้องเลื่อนไปมาเยอะ
 * ขยายหน้าต่างเต็มจอหลังเปิดด้วย maximize()
 */
const windowArgs = (s: NetbaySettings) => (s.headless ? [] : [`--force-device-scale-factor=${s.zoom}`]);

export async function launch(s: NetbaySettings): Promise<Browser> {
  const args = [`--unsafely-treat-insecure-origin-as-secure=${s.url}`, ...windowArgs(s)];
  try {
    return await chromium.launch({ channel: 'chrome', headless: s.headless, args });
  } catch {
    return chromium.launch({ executablePath: chromePath(), headless: s.headless, args });
  }
}

/* ---------------- ขั้นตอนบนหน้าเว็บ ---------------- */

/**
 * ล้างช่อง แล้วพิมพ์ทีละตัว (ให้ event ของหน้าเว็บทำงานเหมือนคนพิมพ์) จนค่าในช่องตรง
 * click=true ใช้กับช่องที่มี input mask (วันที่ __-__-____): คลิกแล้วกด Home ให้ cursor อยู่ต้นช่อง
 * ไม่งั้นตัวเลขไปลงตรงจุดที่คลิก (กลางช่อง) ได้ __-__-2010
 */
async function typeInto(loc: Locator, value: string | number, click = false) {
  const text = String(value);
  for (let i = 0; i < 5; i++) {
    await loc.fill('');
    if (click) { await loc.click(); await loc.press('Home'); }
    await loc.pressSequentially(text);
    if ((await loc.inputValue()) === text) return;
  }
  throw new NetbayError(`กรอกค่า '${text}' ไม่สำเร็จ (ในช่องเป็น '${await loc.inputValue()}')`);
}

/** login แล้วคืนลิงก์หน้ารายการใบขนขาเข้า */
export async function login(page: Page, s: NetbaySettings): Promise<string> {
  await page.goto(`${s.url}/`);
  await page.locator('#user').fill(s.username);
  await page.locator('#passwd').fill(s.password);
  await page.locator(LOGIN_AREA).first().dispatchEvent('click');     // ปุ่ม login เป็น <area> ของ image map
  const link = page.locator(IMPORT_LINK);
  try {
    await link.waitFor({ state: 'attached', timeout: 15_000 });
  } catch {
    await page.locator('#passwd').press('Enter');
    await link.waitFor({ state: 'attached' }).catch(() => {
      throw new NetbayError('login ไม่สำเร็จ หรือไม่พบเมนูหน้า import — ตรวจ NETBAY_USER / NETBAY_PASSWORD');
    });
  }
  const href = await link.evaluate((a) => (a as HTMLAnchorElement).href);
  if (!href) throw new NetbayError('ไม่พบลิงก์หน้า import — หน้าเว็บ NETBAY อาจเปลี่ยน');
  return href;
}

/** พิมพ์ชื่อบริษัท กดลูกศรลง ดับเบิลคลิกรายการแรก จนช่องผู้นำเข้าขึ้นชื่อที่ถูกต้อง */
async function pickImporter(f: FrameLocator, s: NetbaySettings) {
  const box = f.locator(`${D}[2]/td[2]/input`);
  const name = f.locator('xpath=//*[@id="importerDetail"]/font/input[1]');
  for (let i = 0; i < 10; i++) {
    await typeInto(box, s.importerSearch);
    await box.press('ArrowDown');
    await f.locator('xpath=//*[@id="tr1"]/td[3]').dblclick();
    if ((await name.inputValue()) === s.importerName) return;
  }
  throw new NetbayError(`เลือกบริษัทผู้นำเข้าไม่สำเร็จ (คาดว่า '${s.importerName}')`);
}

export type DraftInfo = { refNo?: string; declId?: string; dialogs: string[] };

/** กด New (NETBAY สร้างใบขนทันที) แล้วกรอกหัวใบขน */
async function newDeclaration(page: Page, importUrl: string, s: NetbaySettings, blNo: string, t: Totals, info: DraftInfo) {
  await page.goto(importUrl);
  await page.locator('#newBTN').click();
  await page.locator(TREE_ROOT).waitFor({ state: 'attached' });
  const f = page.frameLocator('#detailfrm');
  info.refNo = await f.locator(REF_NO).inputValue();         // จำไว้ก่อน เผื่อขั้นต่อไปล้ม
  info.declId = /ImDclCtrl=(\d+)/.exec(page.frame({ name: 'detailfrm' })?.url() ?? '')?.[1] ?? '';
  if (!info.refNo) throw new NetbayError('ไม่พบ Reference No. ของใบขนที่สร้าง — หน้าเว็บ NETBAY อาจเปลี่ยน');

  await f.locator('xpath=//*[@id="declTypeID"]/font/select').selectOption(s.declarationType);
  await pickImporter(f, s);
  await f.locator(`${D}[5]/td[2]/select`).selectOption('1');
  await f.locator(`${D}[5]/td[4]/select`).selectOption('9');
  await typeInto(f.locator(`${D}[6]/td[2]/input`), s.vessel);
  await typeInto(f.locator('#ins_voyage'), s.voyage);
  await typeInto(f.locator('#ins_arrivalDate'), today(), true);
  await typeInto(f.locator(`${D}[7]/td[4]/input`), blNo);
  await typeInto(f.locator(`${D}[8]/td[2]/input`), s.originCountry);
  await typeInto(f.locator(`${D}[8]/td[4]/input`), s.originCountry);
  await typeInto(f.locator(`${D}[9]/td[4]/input`), s.releasePort);
  await typeInto(f.locator(`${D}[10]/td[2]/font[1]/input[1]`), t.package_amount);
  await typeInto(f.locator(`${D}[10]/td[2]/font[1]/input[2]`), t.package_unit);
  await typeInto(f.locator(`${D}[12]/td[2]/font/input[1]`), t.gross_weight);
  await typeInto(f.locator(`${D}[13]/td[2]/font/input[1]`), t.gross_weight);
  await typeInto(f.locator(`${D}[19]/td[2]/font/input[1]`), t.price);
  await typeInto(f.locator(`${D}[19]/td[2]/font/input[2]`), t.currency);
}

/** ข้อความบนหน้าจอทุก frame — frame ที่กำลังโหลดใหม่หรือถูกถอดออกให้ข้ามไป */
async function frameTexts(page: Page) {
  const out: string[] = [];
  for (const fr of page.frames() as Frame[]) {
    out.push(await fr.evaluate(() => document.body?.innerText ?? '').catch(() => ''));
  }
  return out;
}

/** Add Invoice -> File for import (เลือก CSV) -> Import  แล้วรอจน NETBAY ขึ้น success please check your invoice */
async function importCsv(page: Page, csvPath: string, dialogs: string[]) {
  const f = page.frameLocator('#detailfrm');
  await f.locator('#addInvoice').click();
  await f.locator('xpath=//*[@id="maptypeDiv2"]/input').setInputFiles(csvPath);
  // NETBAY เปลี่ยน iframe ทั้งอันหลังกด — ไม่รอ navigation ดูผลจากข้อความแทน
  await f.locator(UPLOAD_BTN).click({ noWaitAfter: true }).catch((e: Error) => {
    if (!/detached/.test(e.message)) throw e;
  });
  const until = Date.now() + IMPORT_TIMEOUT_MS;
  while (Date.now() < until) {
    for (const text of [...dialogs, ...(await frameTexts(page))]) {
      const m = IMPORT_OK.exec(text);
      if (m) return squash(m[0]);
    }
    await sleep(1_000);
  }
  const seen = squash((await frameTexts(page)).filter((t) => t.trim()).join(' | '));
  throw new NetbayError(`ไม่เห็นข้อความ "success please check your invoice" หลังกด Import ภายใน ${Math.round(IMPORT_TIMEOUT_MS / 1000)} วินาที` +
    ` — หน้าจอขึ้นว่า: ${seen.slice(0, 300) || '-'}`);
}

/**
 * สร้าง Draft ใบขนใน NETBAY แล้วนำเข้า CSV  คืน Reference No.
 * info ได้ refNo ตั้งแต่กด New — ถ้าล้มกลางทาง ผู้เรียกบอกได้ว่าใบไหนค้างไว้
 */
export async function createDraft(opts: {
  csvPath: string; blNo: string; totals: Totals; settings: NetbaySettings; info: DraftInfo;
  log: (msg: string) => void; onStep?: (page: Page) => Promise<void>;
}): Promise<string> {
  const { settings: s, info, log } = opts;
  check(s);
  const step = opts.onStep ?? (async () => {});
  const browser = await launch(s);
  try {
    const context = await browser.newContext({ viewport: s.headless ? undefined : null });
    context.setDefaultTimeout(30_000);
    context.on('dialog', (d) => {                       // alert ทุกอันกด OK เหมือนโปรแกรมเดิม
      const msg = squash(d.message());
      info.dialogs.push(msg);
      log(`  NETBAY แจ้ง: ${msg.slice(0, 300)}`);
      d.accept().catch(() => {});
    });
    const page = await context.newPage();
    // หน้าต่างเต็มจอ — เห็นการทำงานตั้งแต่ login
    if (!s.headless) await maximize(page);
    log('login NETBAY ...');
    const importUrl = await login(page, s);
    log(`สร้างใบขนใหม่ ${s.declarationType} และกรอกหัวใบขน BL ${opts.blNo} ...`);
    await newDeclaration(page, importUrl, s, opts.blNo, opts.totals, info);
    log(`  ใบขน Reference No. ${info.refNo}`);
    await step(page);
    log('แนบไฟล์ CSV (Add Invoice → Import) ...');
    log(`  NETBAY: ${await importCsv(page, opts.csvPath, info.dialogs)}`);
    await step(page);
    return info.refNo!;
  } finally {
    await browser.close().catch(() => {});
  }
}

/* ---------------- เปิดใบขนจาก Reference No. ---------------- */

/** หน้ารายการใบขน: ค้นหาตาม Reference No.  คืนเลขภายในของใบขน (ImDclCtrl) หรือ null */
export async function findDeclaration(page: Page, listUrl: string, ref: string) {
  await page.goto(listUrl);
  await page.locator(SEARCH_REF).fill(ref);
  await Promise.all([
    page.waitForNavigation({ timeout: 30_000 }).catch(() => {}),
    page.locator(SEARCH_BTN).click(),
  ]);
  const hit = page.locator(`img[id^="statusPic"][value="${ref}"]`);
  if (!(await hit.count())) return null;
  return ((await hit.first().getAttribute('id')) ?? '').slice('statusPic'.length) || null;
}

/* ---------------- ตัว monitor ใบขน: สถานะ · เลขใบขน · PDF ---------------- */

export type DeclarationRow = {
  found: boolean;
  /** รหัสสถานะ (ACCEPT, REJECT, …) — null = อ่านจากรูปป้ายไม่ออก */
  status: NetbayStatusCode | null;
  /** ชื่อไฟล์รูปป้ายสถานะ (หรือ title) ไว้แสดงเมื่ออ่านไม่ออก จะได้รู้ว่า NETBAY มีสถานะใหม่ */
  image: string;
  /** คอลัมน์ DECLARATION NO — มีเฉพาะใบที่กรมศุลฯ รับแล้ว */
  declarationNo: string | null;
};

/** ค้นหา Ref No. แล้วอ่านแถวนั้น: รูปป้ายในคอลัมน์ STATUS กับคอลัมน์ DECLARATION NO */
export async function readDeclaration(page: Page, listUrl: string, ref: string): Promise<DeclarationRow> {
  const id = await findDeclaration(page, listUrl, ref);
  if (!id) return { found: false, status: null, image: '', declarationNo: null };
  // ห้ามประกาศฟังก์ชันที่มีชื่อในนี้ — tsx ใส่ตัวช่วย __name ให้ ซึ่งไม่มีในหน้าเว็บ
  const info = await page.locator(`img[id="statusPic${id}"]`).first().evaluate((img) => {
    const el = img as HTMLImageElement;
    const cells = Array.from(el.closest('tr')?.cells ?? []).map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim());
    // หัวตารางอาจอยู่คนละ <table> กับแถวข้อมูล — ไล่หาจากทุกแถวในหน้า
    let col = -1;
    for (const tr of Array.from(document.querySelectorAll('tr'))) {
      const i = Array.from(tr.cells)
        .findIndex((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim().toUpperCase() === 'DECLARATION NO');
      if (i >= 0) { col = i; break; }
    }
    return { src: el.getAttribute('src'), title: el.getAttribute('title'), alt: el.getAttribute('alt'), cells, col };
  });
  // ป้ายเป็นรูป — โหลดไฟล์รูปด้วย session เดียวกันแล้วเทียบกับรูปต้นฉบับ (ตรงทุกไบต์ = รู้แน่) ก่อนเดาจากชื่อไฟล์
  let byImage: NetbayStatusCode | null = null;
  if (info.src) {
    const res = await page.request.get(new URL(info.src, page.url()).href).catch(() => null);
    if (res?.ok()) byImage = statusFromImageHash(createHash('sha256').update(await res.body()).digest('hex'));
  }
  const atHeader = info.col >= 0 ? info.cells[info.col] ?? '' : '';
  // หัวตารางกับแถวข้อมูลนับคอลัมน์ไม่ตรงกันได้ (colspan) — ถอยไปหาช่องที่หน้าตาเหมือนเลขใบขน
  const declarationNo = DECLARATION_NO.test(atHeader) ? atHeader : info.cells.find((c) => DECLARATION_NO.test(c)) ?? null;
  const image = (info.src ?? '').split(/[?#]/)[0].split('/').pop() || info.title || info.alt || '';
  return { found: true, status: byImage ?? parseStatusImage(info), image, declarationNo };
}

/**
 * ทางสำรองเมื่ออ่านรูปป้ายไม่ออก: ค้น Ref No. พร้อมเลือกช่อง Status = ACCEPT
 * เจอแถว = ใบนี้ Accept แล้ว · null = หน้านี้ไม่มีช่อง Status ให้เลือก
 */
export async function acceptedByFilter(page: Page, listUrl: string, ref: string): Promise<boolean | null> {
  await page.goto(listUrl);
  const status = page.locator('select:has(option[value="ACCEPT"])').first();
  if (!(await status.count())) return null;
  await page.locator(SEARCH_REF).fill(ref);
  await status.selectOption('ACCEPT');
  await Promise.all([
    page.waitForNavigation({ timeout: 30_000 }).catch(() => {}),
    page.locator(SEARCH_BTN).click(),
  ]);
  return (await page.locator(`img[id^="statusPic"][value="${ref}"]`).count()) > 0;
}

/** รอไฟล์ที่ได้จากการกดปุ่ม — NETBAY อาจส่งไฟล์มาที่หน้าเดิม หรือเปิดหน้าต่างใหม่แล้วส่งจากหน้านั้น */
async function catchDownload(page: Page, press: () => Promise<void>, timeout = 120_000): Promise<Download> {
  const direct = page.waitForEvent('download', { timeout });
  const popup = page.context().waitForEvent('page', { timeout }).then((p) => p.waitForEvent('download', { timeout }));
  await press();
  return new Promise<Download>((resolve, reject) => {
    let failed = 0;
    const fail = () => { if (++failed === 2) reject(new NetbayError(`กด Save PDF แล้วไม่ได้ไฟล์ภายใน ${timeout / 1000} วินาที`)); };
    direct.then(resolve, fail);
    popup.then(resolve, fail);
  });
}

/**
 * ไฟล์จากปุ่ม Save PDF เป็น zip (เช่น _runtime_temp_20261030034633.zip) ที่มี <เลขใบขน>.pdf อยู่ข้างใน
 * เลือกไฟล์ที่ชื่อตรงเลขใบขน ถ้าในชุดมี PDF ไฟล์เดียวก็ใช้ไฟล์นั้น · ได้ PDF มาตรง ๆ ก็ใช้ได้เลย
 */
export async function pdfFromDownload(body: Buffer, declarationNo: string): Promise<{ name: string; body: Buffer }> {
  const name = `${declarationNo}.pdf`;
  if (body.subarray(0, 5).toString('latin1') === '%PDF-') return { name, body };
  if (body.subarray(0, 2).toString('latin1') !== 'PK') {
    throw new NetbayError('ไฟล์ที่ได้จาก Save PDF ไม่ใช่ zip และไม่ใช่ PDF');
  }
  const zip = await JSZip.loadAsync(body);
  const pdfs = Object.values(zip.files).filter((f) => !f.dir && /\.pdf$/i.test(f.name));
  const stem = (p: string) => p.split('/').pop()!.replace(/\.pdf$/i, '').trim().toUpperCase();
  const pick = pdfs.find((f) => stem(f.name) === declarationNo.toUpperCase()) ?? (pdfs.length === 1 ? pdfs[0] : undefined);
  if (!pick) {
    throw new NetbayError(`ใน zip ไม่มี ${name} (มี ${pdfs.map((f) => f.name).join(', ') || 'ไม่มีไฟล์ PDF'})`);
  }
  return { name, body: await pick.async('nodebuffer') };
}

/**
 * ดาวน์โหลด PDF ใบขนแบบที่คนทำ: ติ๊กแถวนั้น → ช่อง "ชื่อไฟล์" = เลขที่ใบขน → Save PDF → แตก zip
 * ค้นหา Ref No. ใหม่ก่อน ตารางจึงเหลือแถวเดียว ไม่เผลอติ๊กใบอื่นติดไปด้วย
 */
export async function downloadDeclarationPdf(page: Page, listUrl: string, ref: string, declarationNo: string, dir: string) {
  const id = await findDeclaration(page, listUrl, ref);
  if (!id) throw new NetbayError(`ค้นหา ${ref} อีกครั้งเพื่อดาวน์โหลด PDF แล้วไม่พบ`);
  const row = page.locator(`img[id="statusPic${id}"]`).first().locator('xpath=ancestor::tr[1]');
  await row.locator('input[type="checkbox"]').first().check();

  // ช่องค้นหาด้านบนมีตัวเลือก "เลขที่ใบขนฯ" (มี ฯ) — เทียบแบบตรงตัว และเลือกช่องที่มี default ด้วยก่อน
  const value = await page.evaluate(() => {
    const want = 'เลขที่ใบขน';
    const hits = Array.from(document.querySelectorAll('select')).flatMap((sel) => {
      const opt = Array.from(sel.options).find((o) => o.text.trim() === want);
      return opt ? [{ sel, opt, hasDefault: Array.from(sel.options).some((o) => o.text.trim().toLowerCase() === 'default') }] : [];
    });
    const hit = hits.find((h) => h.hasDefault) ?? hits[0];
    if (!hit) return null;
    hit.sel.setAttribute('data-kola-file-name', '1');
    return hit.opt.value;
  });
  if (value === null) throw new NetbayError('ไม่พบช่อง "ชื่อไฟล์" ที่มีตัวเลือก เลขที่ใบขน');
  await page.locator('select[data-kola-file-name="1"]').selectOption(value);

  const save = page.locator('input[value="Save PDF"], button:has-text("Save PDF")').first();
  const download = await catchDownload(page, () => save.click());
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${ref}-${Date.now()}-${download.suggestedFilename() || 'download'}`);
  await download.saveAs(path);
  try {
    return await pdfFromDownload(readFileSync(path), declarationNo);
  } finally {
    rmSync(path, { force: true });
  }
}

/** แถบแจ้งด้านบนหน้าเว็บ NETBAY (alert ใช้ไม่ได้ เพราะ Playwright ปิด dialog เอง) */
async function banner(page: Page, message: string) {
  await page.evaluate((m) => {
    const d = document.createElement('div');
    d.textContent = m;
    d.style.cssText = 'position:sticky;top:0;z-index:9999;padding:12px;background:#b0402b;color:#fff;font:16px sans-serif';
    (document.body ?? document.documentElement).prepend(d);
  }, message.slice(0, 500)).catch(() => {});
}

/** ขยายหน้าต่าง Chrome เต็มจอผ่าน CDP และดึงขึ้นหน้าสุด (--start-maximized ไม่มีผลทุกระบบ เช่น macOS) */
async function maximize(page: Page) {
  try {
    const cdp = await page.context().newCDPSession(page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget') as { windowId: number };
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'maximized' } });
  } catch {
    // ควบคุมหน้าต่างไม่ได้ — ทำงานต่อได้ แค่หน้าต่างไม่ขยายเอง
  }
  await page.bringToFront().catch(() => {});
}

/**
 * โปรไฟล์ Chrome ประจำบัญชี NETBAY ของเครื่อง — ใช้ซ้ำทุกครั้งที่กดเลข Ref No. session จึงอยู่ข้ามครั้ง
 * แยกตามบัญชี เปลี่ยนบัญชีแล้วไม่ไปหยิบ session ของบัญชีเก่ามาใช้
 */
export const netbayProfileDir = (profilesDir: string, username: string) =>
  join(profilesDir, `netbay-${username.replace(/[^A-Za-z0-9_-]/g, '_') || 'default'}`);

/** Chrome ที่เปิดค้างไว้ด้วยโปรไฟล์นี้ (Chrome เขียนเลข port ไว้ที่ DevToolsActivePort) — ไม่มี = null */
async function runningChrome(profile: string): Promise<Browser | null> {
  const file = join(profile, 'DevToolsActivePort');
  if (!existsSync(file)) return null;
  const port = Number(readFileSync(file, 'utf8').split(/\r?\n/)[0]);
  if (!port) return null;
  return chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 3_000 }).catch(() => null);
}

/** ปิด Chrome ของโปรไฟล์นี้จริง ๆ (close() ของการต่อแบบ CDP แค่ปล่อยการควบคุม) — ใช้ในเทสต์ */
export async function closeNetbayChrome(profile: string) {
  const browser = await runningChrome(profile);
  if (!browser) return;
  const cdp = await browser.newBrowserCDPSession();
  await cdp.send('Browser.close').catch(() => {});
}

/** ลิงก์หน้ารายการใบขนจาก login ครั้งล่าสุดของโปรไฟล์นี้ — ใช้เข้าด้วย session เดิมโดยไม่ login */
const LIST_URL_FILE = 'kola-list-url.txt';

/**
 * เข้าหน้ารายการใบขนด้วย session เดิม — เห็นช่องค้นหา Reference No. = ยังใช้ได้ ไม่ต้อง login
 * เห็นช่อง user (หน้า login) หรือรอแล้วไม่ขึ้นอะไร = session หลุด (เช่นบัญชีนี้ถูก login จากที่อื่น) คืน null
 */
async function resumeSession(page: Page, profile: string): Promise<string | null> {
  const file = join(profile, LIST_URL_FILE);
  const listUrl = existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
  if (!listUrl) return null;
  try {
    await page.goto(listUrl);
    await page.locator(`${SEARCH_REF}, #user`).first().waitFor({ state: 'visible', timeout: 10_000 });
    return (await page.locator(SEARCH_REF).count()) ? listUrl : null;
  } catch {
    return null;
  }
}

/**
 * Chrome ของโปรไฟล์ประจำบัญชี — เปิดค้างอยู่แล้วต่อเข้าไปแล้วเปิดหน้าต่างใหม่ (session เดียวกัน)
 * ยังไม่เปิดก็เปิดใหม่ด้วยโปรไฟล์เดิม (port 0 = ให้ Chrome เลือกเอง แล้วอ่านจาก DevToolsActivePort)
 */
async function netbayChrome(s: NetbaySettings, profile: string, keep: boolean) {
  const running = await runningChrome(profile);
  if (running) {
    const context = running.contexts()[0];
    const opened = context.waitForEvent('page', { timeout: 15_000 });
    const cdp = await running.newBrowserCDPSession();
    await cdp.send('Target.createTarget', { url: 'about:blank', newWindow: true });
    return { browser: running, page: await opened, proc: null };
  }

  rmSync(join(profile, 'DevToolsActivePort'), { force: true });     // ของรอบก่อนที่ Chrome ปิดไปแล้ว
  // หน้าต่างเต็มจอ ไม่มีแถบ tab/ช่อง URL (--app) — เห็นการทำงานตั้งแต่ login ค้นหา จนเปิดใบขน
  const args = ['--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    `--unsafely-treat-insecure-origin-as-secure=${s.url}`,
    ...(s.headless ? ['--headless=new', 'about:blank']
      : ['--start-maximized', `--force-device-scale-factor=${s.zoom}`, '--app=about:blank'])];
  const proc = spawn(chromePath(), args, { stdio: 'ignore', detached: keep });    // ค้างหน้าต่างไว้หลังสคริปต์จบ
  if (keep) proc.unref();
  let browser: Browser | null = null;
  for (let i = 0; i < 60 && !browser; i++) {
    browser = await runningChrome(profile);
    if (!browser) await sleep(250);
  }
  if (!browser) {
    if (!keep) proc.kill();
    throw new NetbayError('เปิด Chrome ไม่สำเร็จ');
  }
  const context = browser.contexts()[0];
  return { browser, page: context.pages()[0] ?? await context.newPage(), proc };
}

/**
 * ลิงก์ Ref No. บน ERP-KOLA: เปิด Chrome -> (login) -> Import -> ค้นหา Reference No. -> เปิดใบขนนั้น
 *
 * กดครั้งแรก login แล้วจำ session ไว้ในโปรไฟล์ Chrome ประจำบัญชี (netbayProfileDir)
 * กดครั้งต่อไปเปิดหน้าต่างใหม่ใน Chrome ตัวเดิม แล้วเข้าหน้ารายการด้วย session เดิม ข้ามการ login
 * เดิมเปิดโปรไฟล์ใหม่แล้ว login ทุกครั้ง — NETBAY ให้บัญชีเดียว login ได้ทีละที่ หน้าต่างที่เปิดอยู่ก่อนจึงหลุดทุกครั้งที่กดใบถัดไป
 * session หลุด (บัญชีนี้ถูก login จากที่อื่น เช่น worker สร้าง Draft) ก็ login ใหม่ให้เอง
 *
 * หน้าต่างเป็น Chrome ปกติ คนตรวจใช้ต่อได้ทุกอย่าง (dialog ยืนยันของ NETBAY ขึ้นตามปกติ)
 * ลิงก์ตรงไปหน้าใบขนใช้ไม่ได้ เพราะ NETBAY ผูก session ไว้กับเบราว์เซอร์ที่ login (UCODE ใน localStorage)
 * คืนเลขภายในของใบขน หรือ null ถ้าไม่พบ (หน้ารายการขึ้นแถบแจ้งให้เห็น)
 */
export async function openDeclaration(ref: string, s: NetbaySettings, opts: { log?: (m: string) => void; keepOpen?: boolean; profilesDir?: string } = {}) {
  check(s);
  const log = opts.log ?? (() => {});
  const profiles = opts.profilesDir ?? join(tmpdir(), 'kola-netbay');
  mkdirSync(profiles, { recursive: true });
  for (const name of readdirSync(profiles)) {          // โปรไฟล์ชั่วคราวของรุ่นก่อน (p-…) ที่เกิน 1 วัน
    if (!name.startsWith('p-')) continue;
    const p = join(profiles, name);
    try { if (statSync(p).mtimeMs < Date.now() - 86_400_000) rmSync(p, { recursive: true, force: true }); } catch { /* ใช้อยู่ */ }
  }
  const profile = netbayProfileDir(profiles, s.username);
  mkdirSync(profile, { recursive: true });
  const keep = opts.keepOpen !== false;

  let browser: Browser | null = null;
  let page: Page | null = null;
  let proc: ReturnType<typeof spawn> | null = null;
  try {
    ({ browser, page, proc } = await netbayChrome(s, profile, keep));
    page.context().setDefaultTimeout(30_000);
    if (!s.headless) await maximize(page);
    let listUrl = await resumeSession(page, profile);
    if (listUrl) {
      log('ใช้ session เดิม (ไม่ต้อง login)');
    } else {
      log('login NETBAY ...');
      listUrl = await login(page, s);
      writeFileSync(join(profile, LIST_URL_FILE), listUrl);
    }
    log(`ค้นหา Reference No. ${ref} ...`);
    const id = await findDeclaration(page, listUrl, ref);
    if (id) {
      await page.evaluate((x) => (window as unknown as { editID(id: string): void }).editID(x), id);
      await page.locator('#detailfrm').waitFor({ state: 'attached' });
      log(`เปิดใบขน ${ref} แล้ว`);
    } else {
      await banner(page, `ไม่พบใบขน Reference No. ${ref} ใน NETBAY — ค้นหาเองอีกครั้งในหน้านี้`);
      log(`ไม่พบใบขน ${ref}`);
    }
    return id;
  } catch (e) {            // เปิดจากลิงก์ไม่มีหน้าต่าง Terminal — บอกเหตุผลบนหน้าจอ Chrome
    if (page) await banner(page, `เปิดใบขน ${ref} ไม่สำเร็จ: ${e instanceof Error ? e.message : e}`);
    throw e;
  } finally {
    // ต่อแบบ CDP: close() แค่ปล่อยการควบคุม หน้าต่าง Chrome ยังเปิดอยู่
    if (browser) await browser.close().catch(() => {});
    if (!keep) proc?.kill();
  }
}
