import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  loadEofficeForm, OVERLAY_SLOTS, TEMPLATE_KEY, type EofficeForm,
} from '@/lib/eoffice-form';
import { downloadFile } from '@/lib/storage';
import { clustersOf } from '@/lib/thai-text';

/**
 * ออกไฟล์ PDF ของคำร้องขอนำของเข้าเขตปลอดอากร (ปะหน้าชุด E-Office)
 *
 * เดิมต้องให้ผู้ใช้เปิดหน้าเว็บ กด Ctrl+P เป็น PDF แล้วอัปโหลดกลับเข้ามา
 * ชุดรวม E-Office ถึงจะมีคำร้องอยู่ด้วย ตรงนี้วาดเองที่เซิร์ฟเวอร์เลย
 *
 * ทำงานสองโหมด เลือกจากว่ามีแบบฟอร์มพื้นหลังอัปโหลดไว้หรือยัง
 *   1. มีแบบฟอร์มพื้นหลัง — ใช้ไฟล์ PDF ที่ผู้ดูแลอัปโหลด แล้วเติมเฉพาะค่าลงตามพิกัดที่ตั้งไว้
 *   2. ไม่มี — วาดทั้งใบเองตามข้อความและระยะที่ตั้งไว้
 *
 * ทั้งสองโหมดอ่านค่าจากหน้า /master/eoffice ดู src/lib/eoffice-form.ts
 *
 * ต้องมีฟอนต์ไทยจริง ๆ ฟอนต์มาตรฐานของ PDF ไม่มีตัวอักษรไทยเลย
 */

const A4 = { width: 595.28, height: 841.89 };
const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts');

/**
 * แบบฟอร์มของด่านใช้ Angsana New
 *
 * ไฟล์ที่ Windows ให้มา (angsana.ttc) เป็น font collection คือมีหลายฟอนต์อยู่ไฟล์เดียว
 * ยัดทั้งก้อนลง /FontFile2 ไม่ได้ โปรแกรมอ่าน PDF จะหาฟอนต์ในนั้นไม่เจอแล้วถอยไปใช้
 * ฟอนต์แทน ตัวอักษรไทยจึงเพี้ยน ไฟล์ในโฟลเดอร์นี้จึงแยกออกมาเป็นฟอนต์เดี่ยวแล้ว
 * ด้วย scripts/extract-ttc.ts
 */
const ANGSANA = { regular: 'AngsanaNew-Regular.ttf', bold: 'AngsanaNew-Bold.ttf' };

/**
 * Sarabun กว้างกว่า Angsana New ราว 1.5 เท่าที่พอยต์เท่ากัน
 * ขนาดในหน้าตั้งค่าเป็นพอยต์ของ Angsana New ตอนถอยไปใช้ Sarabun จึงต้องหดตามอัตรานี้
 * ไม่งั้นทุกบรรทัดจะใหญ่จนล้นออกนอกหน้ากระดาษ
 */
const SARABUN_SIZE_RATIO = 1 / 1.5;

/** ตัวอักษรไทยหนึ่งตัวขึ้นไป ใช้เลือกว่าจะวาดด้วยฟอนต์สำเนาไหน */
const HAS_THAI = /[\u0E00-\u0E7F]/;

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/** เอกสารราชการใช้ พ.ศ. และเดือนภาษาไทย ต่างจากที่อื่นในระบบที่ใช้ ค.ศ. */
function thaiDate(value: string | null) {
  if (!value) return { day: '', month: '', year: '' };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { day: '', month: '', year: '' };
  return {
    day: String(d.getUTCDate()),
    month: THAI_MONTHS[d.getUTCMonth()],
    year: String(d.getUTCFullYear() + 543),
  };
}

export type EofficeRequestData = {
  requestNo: string | null;
  bookNo: string | null;
  runningNo: string | null;
  requestDate: string | null;
  entryNo: string | null;
  packageCount: string | null;
  netWeight: string | null;
  goodsValue: string | null;
  goodsType: string | null;
  attentionName?: string | null;
};

export class MissingThaiFontError extends Error {
  constructor() {
    super(
      'ยังไม่มีฟอนต์ไทยสำหรับออกคำร้อง — วางไฟล์ AngsanaNew-Regular.ttf '
      + '(หรือ Sarabun-Regular.ttf) ไว้ที่ v2/assets/fonts/',
    );
  }
}

type LoadedFonts = { regular: Buffer; bold: Buffer; sizeRatio: number };

/** คู่ regular/bold ของฟอนต์หนึ่งชุด ไม่มีตัวหนาก็ใช้ตัวธรรมดาแทน */
async function loadPair(regular: string, bold: string) {
  const regularBytes = await readFile(path.join(FONT_DIR, regular));
  const boldBytes = await readFile(path.join(FONT_DIR, bold)).catch(() => regularBytes);
  return { regular: regularBytes, bold: boldBytes };
}

async function loadFonts(): Promise<LoadedFonts> {
  try {
    return { ...await loadPair(ANGSANA.regular, ANGSANA.bold), sizeRatio: 1 };
  } catch {
    // ไม่มี Angsana New ในเครื่องที่รันอยู่ ใช้ Sarabun แทนเพื่อให้ยังออกคำร้องได้
  }

  try {
    return {
      ...await loadPair('Sarabun-Regular.ttf', 'Sarabun-Bold.ttf'),
      sizeRatio: SARABUN_SIZE_RATIO,
    };
  } catch {
    throw new MissingThaiFontError();
  }
}

export function thaiFontAvailable() {
  return loadFonts().then(() => true, () => false);
}

export type RenderOptions = {
  /** วาดเส้นตารางพิกัดทับลงไปด้วย ใช้ตอนตั้งตำแหน่งค่าบนแบบฟอร์มพื้นหลัง */
  grid?: boolean;
};

export async function renderEofficeRequestPdf(
  req: EofficeRequestData,
  form?: EofficeForm,
  options: RenderOptions = {},
): Promise<Buffer> {
  const f = form ?? await loadEofficeForm();
  return f.hasTemplate ? renderOnTemplate(req, f, options) : renderDrawn(req, f);
}

/** ค่าที่ต้องเติมลงกระดาษ ใช้ร่วมกันทั้งสองโหมด */
function overlayValues(req: EofficeRequestData) {
  const [book, running] = (req.requestNo ?? '/').split('/');
  const date = thaiDate(req.requestDate);
  return {
    requestNo: `${book} / ${running}`,
    day: date.day,
    month: date.month,
    year: date.year,
    entryNo: req.entryNo ?? '',
    packageCount: req.packageCount ?? '',
    netWeight: req.netWeight ?? '',
    goodsValue: req.goodsValue ?? '',
    goodsType: req.goodsType ?? '',
    attentionName: req.attentionName ?? '',
  } as Record<string, string>;
}

/**
 * โหมดใช้แบบฟอร์มพื้นหลัง — เปิดไฟล์ที่อัปโหลดไว้แล้วเขียนเฉพาะค่าทับลงไป
 *
 * ตัวกระดาษจึงเหมือนไฟล์ Word ต้นฉบับทุกเส้นทุกตัวอักษร เพราะไม่ได้วาดใหม่
 * เหลือแค่ต้องบอกพิกัดว่าค่าแต่ละตัวไปลงตรงไหน ซึ่งตั้งได้ที่หน้า /master/eoffice
 */
async function renderOnTemplate(
  req: EofficeRequestData,
  f: EofficeForm,
  options: RenderOptions,
): Promise<Buffer> {
  const { PDFDocument, rgb } = await import('@cantoo/pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  const fonts = await loadFonts();

  const { body } = await downloadFile(f.raw(TEMPLATE_KEY));
  // ไฟล์ที่ export จาก Word บางตัวใส่รหัสผ่านผู้อ่านเป็นค่าว่างไว้ ต้องถอดจริง ไม่ใช่ข้าม
  const doc = await PDFDocument.load(body, { password: '' });
  if (doc.getPageCount() === 0) throw new Error('ไฟล์แบบฟอร์มพื้นหลังไม่มีหน้าเลย');
  doc.registerFontkit(fontkit);

  // เหตุผลที่ต้องแยกสำเนาไทย/ละติน ดูที่ renderDrawn
  const embed = (bytes: Buffer) => doc.embedFont(bytes, { subset: false });
  const thai = await embed(fonts.regular);
  const latin = await embed(fonts.regular);
  const fontFor = (text: string) => (HAS_THAI.test(text) ? thai : latin);

  const page = doc.getPage(0);
  const { width: pageW, height: pageH } = page.getSize();
  const black = rgb(0, 0, 0);
  const baseSize = f.n('overlaySize') * fonts.sizeRatio;
  const values = overlayValues(req);

  for (const base of OVERLAY_SLOTS) {
    const text = values[base.key] ?? '';
    if (!text) continue;

    const slot = f.slot(base.key);
    const font = fontFor(text);
    let size = baseSize;
    // ความกว้าง 0 คือไม่จำกัด ปล่อยให้ล้นได้เหมือนพิมพ์ทับด้วยเครื่องพิมพ์ดีด
    if (slot.w > 0) {
      const floor = baseSize * 0.5;
      while (size > floor && font.widthOfTextAtSize(text, size) > slot.w) size -= 0.5;
    }
    const textW = font.widthOfTextAtSize(text, size);
    const x = slot.align === 'center' && slot.w > 0 ? slot.x + (slot.w - textW) / 2 : slot.x;
    // พิกัดที่ตั้งไว้นับจากขอบบน ส่วน PDF นับจากขอบล่าง
    page.drawText(text, { x, y: pageH - slot.y, size, font, color: black });
  }

  if (options.grid) drawCoordinateGrid(page, latin, pageW, pageH, rgb);

  return Buffer.from(await doc.save());
}

/**
 * เส้นตารางพิกัดสำหรับหน้าดูตัวอย่าง
 *
 * ตั้งตำแหน่งด้วยการเดาตัวเลขแล้วกดดูใหม่ไปเรื่อย ๆ ช้ามาก
 * มีเส้นกับตัวเลขกำกับให้อ่านพิกัดจากกระดาษได้ตรง ๆ จะจบในรอบสองรอบ
 */
function drawCoordinateGrid(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any, font: any, pageW: number, pageH: number, rgb: (r: number, g: number, b: number) => any,
) {
  const faint = rgb(0.62, 0.78, 0.9);
  const strong = rgb(0.15, 0.45, 0.72);

  for (let x = 0; x <= pageW; x += 20) {
    const major = x % 100 === 0;
    page.drawLine({
      start: { x, y: 0 }, end: { x, y: pageH },
      thickness: major ? 0.5 : 0.25, color: major ? strong : faint, opacity: major ? 0.55 : 0.3,
    });
    if (major && x > 0) {
      page.drawText(String(x), { x: x + 2, y: pageH - 10, size: 7, font, color: strong });
    }
  }
  for (let y = 0; y <= pageH; y += 20) {
    const major = y % 100 === 0;
    page.drawLine({
      start: { x: 0, y: pageH - y }, end: { x: pageW, y: pageH - y },
      thickness: major ? 0.5 : 0.25, color: major ? strong : faint, opacity: major ? 0.55 : 0.3,
    });
    if (major && y > 0) {
      page.drawText(String(y), { x: 2, y: pageH - y + 2, size: 7, font, color: strong });
    }
  }
}

/** โหมดวาดเองทั้งใบ ใช้เมื่อยังไม่ได้อัปโหลดแบบฟอร์มพื้นหลัง */
async function renderDrawn(
  req: EofficeRequestData,
  f: EofficeForm,
): Promise<Buffer> {
  const { PDFDocument, rgb } = await import('@cantoo/pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  const fonts = await loadFonts();

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // ไม่ตัด subset — ตัวตัดของ fontkit พังกับตาราง glyph ของฟอนต์ไทย ฝังทั้งไฟล์แทน
  const embed = (bytes: Buffer) => doc.embedFont(bytes, { subset: false });

  /*
   * ฝังฟอนต์ชุดละสองสำเนา สำเนาหนึ่งไว้ใช้กับข้อความไทย อีกสำเนาไว้ใช้กับตัวเลขและอักษรละติน
   *
   * fontkit จำสคริปต์ของข้อความแรกที่จัดวางให้ฟอนต์แต่ละตัว พอจัดข้อความไทยไปแล้ว
   * ตัวเลขในข้อความถัด ๆ มาจะถูกสลับเป็นเลขอีกรูปแบบหนึ่งของ Angsana New (glyph 344 ขึ้นไป)
   * ซึ่งหน้าตาไม่เหมือนเลขปกติ แถมยังไม่มีในตารางแปลงกลับเป็นตัวอักษร
   * ทำให้เลขใบขนกับปี พ.ศ. ในคำร้องค้นหาและคัดลอกออกมาไม่ได้
   *
   * แยกสำเนากันแบบนี้ สำเนาละตินจึงไม่เคยเห็นอักษรไทยเลย ตัวเลขจึงออกมาเป็นเลขปกติเสมอ
   */
  const thai = { regular: await embed(fonts.regular), bold: await embed(fonts.bold) };
  const latin = { regular: await embed(fonts.regular), bold: await embed(fonts.bold) };
  const fontFor = (text: string, useBold = false) =>
    (HAS_THAI.test(text) ? thai : latin)[useBold ? 'bold' : 'regular'];

  // ฟอนต์ดิบไว้ให้ fontkit จัดวางเอง ใช้แก้สระซ้อนที่ drawText วางผิดที่
  const rawFor = (useBold: boolean) =>
    fontkit.create(useBold ? fonts.bold : fonts.regular) as any;
  const rawRegular = rawFor(false);
  const rawBold = rawFor(true);

  /** วาดทีละก้อน สระซ้อนจะได้ไม่หลุดออกจากพยัญชนะ (ดู src/lib/thai-text.ts) */
  const put = (text: string, x: number, yy: number, size: number, useBold = false) => {
    if (!text) return;
    const font = fontFor(text, useBold);
    let cx = x;
    for (const c of clustersOf(useBold ? rawBold : rawRegular, text, size)) {
      page.drawText(c.text, { x: cx, y: yy, size, font, color: black });
      cx += c.advance;
    }
  };

  const page = doc.addPage([A4.width, A4.height]);

  const black = rgb(0, 0, 0);

  /* ---------- ค่าจากหน้าตั้งค่า ---------- */
  const marginX = f.n('marginX');
  const indent = f.n('indent');
  const lineGap = f.n('lineGap');
  /** ขนาดที่ตั้งไว้เป็นพอยต์ของ Angsana New แปลงเป็นพอยต์ของฟอนต์ที่ใช้จริง */
  const pt = (size: number) => size * fonts.sizeRatio;
  const bodySize = pt(f.n('bodySize'));
  const tableSize = pt(f.n('tableSize'));

  let y = A4.height - f.n('topY');

  const width = (text: string, size: number, useBold = false) =>
    fontFor(text, useBold).widthOfTextAtSize(text, size);

  /**
   * ขนาดอักษรที่ใส่ในความกว้างที่มีได้พอดี
   * ภาษาไทยไม่มีช่องว่างระหว่างคำ ตัดขึ้นบรรทัดใหม่เองไม่ได้ จึงย่อขนาดแทน
   * ดีกว่าปล่อยให้ล้นออกนอกกระดาษหรือตัดข้อความทิ้งจนอ่านไม่รู้เรื่อง
   */
  const fitBy = (measure: (size: number) => number, room: number, size: number) => {
    const floor = size * 0.5;
    let s = size;
    while (s > floor && measure(s) > room) s -= 0.5;
    return s;
  };
  const fit = (text: string, room: number, size: number, useBold = false) =>
    fitBy((s) => width(text, s, useBold), room, size);

  const draw = (
    text: string,
    opts: { x?: number; size?: number; bold?: boolean; center?: boolean } = {},
  ) => {
    let x = opts.x ?? marginX;
    const size = fit(text, A4.width - marginX - x, opts.size ?? bodySize, opts.bold);
    if (opts.center) x = (A4.width - width(text, size, opts.bold)) / 2;
    put(text, x, y, size, opts.bold);
  };

  /** ข้อความที่มีขีดเส้นใต้เฉพาะค่าที่กรอก ไล่วาดทีละท่อนบนบรรทัดเดียว */
  const line = (
    parts: Array<{ text: string; underline?: boolean; bold?: boolean }>,
    opts: { size?: number; indent?: number; startX?: number } = {},
  ) => {
    const start = opts.startX ?? marginX + (opts.indent ?? 0);
    // วัดทีละท่อนแบบเดียวกับตอนวาด เพราะแต่ละท่อนอาจใช้คนละสำเนาฟอนต์
    const measure = (size: number) =>
      parts.reduce((sum, p) => sum + width(p.text, size, p.bold), 0);
    const size = fitBy(measure, A4.width - marginX - start, opts.size ?? bodySize);
    let x = start;
    for (const part of parts) {
      put(part.text, x, y, size, part.bold);
      const w = width(part.text, size, part.bold);
      if (part.underline) {
        page.drawLine({
          start: { x, y: y - 2.5 },
          end: { x: x + w, y: y - 2.5 },
          thickness: 0.6,
          color: black,
        });
      }
      x += w;
    }
  };

  const gap = (n: number) => { y -= n; };

  /* ---------- หัวเอกสาร ---------- */
  draw(f.t('title'), { size: pt(f.n('titleSize')), bold: true, center: true });
  gap(lineGap * 1.25);

  const [book, running] = (req.requestNo ?? '/').split('/');
  const date = thaiDate(req.requestDate);

  const noText = 'เลขที่ ';
  const noValue = `${book}  /  ${running}`;
  const noWidth = width(noText, bodySize) + width(noValue, bodySize);
  put(noText, A4.width - marginX - noWidth, y, bodySize);
  put(noValue, A4.width - marginX - width(noValue, bodySize), y, bodySize);
  gap(lineGap * 0.92);

  const dateParts = [
    { text: 'วันที่ ' }, { text: ` ${date.day} `, underline: true },
    { text: ' เดือน ' }, { text: ` ${date.month} `, underline: true },
    { text: ' พ.ศ. ' }, { text: ` ${date.year} `, underline: true },
  ];
  const dateWidth = dateParts.reduce((sum, p) => sum + width(p.text, bodySize), 0);
  line(dateParts, { startX: A4.width - marginX - dateWidth });
  gap(lineGap * 1.25);

  /* ---------- เรื่อง / เรียน ---------- */
  // คอลัมน์ค่าเริ่มหลังคำว่า เรื่อง / เรียน ที่ยาวที่สุด ขยับตามขนาดตัวอักษรเอง
  const labelX = marginX
    + Math.max(width('เรื่อง', bodySize, true), width('เรียน', bodySize, true)) + lineGap;
  draw('เรื่อง', { bold: true });
  draw(f.t('subject'), { x: labelX });
  gap(lineGap * 0.92);
  draw('เรียน', { bold: true });
  draw(f.t('attention'), { x: labelX });
  gap(lineGap * 1.25);

  /* ---------- เนื้อความ ---------- */
  line([
    { text: 'ด้วยข้าพเจ้า บริษัท ' },
    { text: ` ${f.t('companyName')} `, underline: true },
  ], { indent });
  gap(lineGap);

  line([
    { text: 'ถือใบรับรองเป็นผู้ประกอบกิจการในเขตปลอดอากร ' },
    { text: ` ${f.t('licenseNo')} `, underline: true },
    { text: ' ตั้งอยู่เลขที่ ' },
    { text: ` ${f.t('addressNo')} `, underline: true },
    { text: ' หมู่ที่ ' },
    { text: ` ${f.t('moo')} `, underline: true },
  ]);
  gap(lineGap);

  line([
    { text: 'ตำบล' },
    { text: ` ${f.t('tambon')} `, underline: true },
    { text: ' อำเภอ ' },
    { text: ` ${f.t('amphoe')} `, underline: true },
    { text: ' จังหวัด' },
    { text: ` ${f.t('province')} `, underline: true },
    { text: ' รหัสไปรษณีย์ ' },
    { text: ` ${f.t('postcode')} `, underline: true },
  ]);
  gap(lineGap);

  draw(
    `มีความประสงค์จะนำของที่เข้ามาในราชอาณาจักรเข้าเขตปลอดอากร ${f.t('zoneName')} ตามใบขน`,
    { x: marginX + indent },
  );
  gap(lineGap);

  line([
    { text: 'สินค้าขาเข้า เลขที่ ' },
    { text: ` ${req.entryNo ?? ''} `, underline: true },
    { text: ` ${f.t('purpose')} รายละเอียด ดังนี้` },
  ]);
  gap(lineGap * 1.17);

  /* ---------- ตารางรายละเอียดของ ---------- */
  const colW = f.n('tableColWidth');
  const goodsLabel = f.t('colGoods');
  const cols = [
    { label: f.t('colPackage'), value: req.packageCount ?? '', w: colW },
    { label: f.t('colWeight'), value: req.netWeight ?? '', w: colW },
    { label: f.t('colValue'), value: req.goodsValue ?? '', w: colW },
    { label: goodsLabel, value: req.goodsType ?? '', w: A4.width - marginX * 2 - colW * 3 },
  ];
  const headH = f.n('tableHeadHeight');
  const bodyH = f.n('tableBodyHeight');
  const tableTop = y;

  let x = marginX;
  for (const c of cols) {
    page.drawRectangle({
      x, y: tableTop - headH, width: c.w, height: headH,
      borderColor: black, borderWidth: 0.8,
    });
    const lSize = fit(c.label, c.w - 10, tableSize);
    put(c.label, x + (c.w - width(c.label, lSize)) / 2, tableTop - headH + headH * 0.31, lSize);
    x += c.w;
  }

  x = marginX;
  for (const c of cols) {
    page.drawRectangle({
      x, y: tableTop - headH - bodyH, width: c.w, height: bodyH,
      borderColor: black, borderWidth: 0.8,
    });
    // ชนิดของเป็นข้อความยาว ชิดซ้าย ส่วนตัวเลขวางกลางช่อง
    const isText = c.label === goodsLabel;
    const vSize = fit(c.value, c.w - 14, tableSize);
    put(
      c.value,
      isText ? x + 7 : x + (c.w - width(c.value, vSize)) / 2,
      tableTop - headH - bodyH + bodyH * 0.33,
      vSize,
    );
    x += c.w;
  }
  y = tableTop - headH - bodyH;
  gap(lineGap * 1.42);

  draw(f.t('closing'), { x: marginX + indent });
  gap(lineGap * 1.42);

  /* ---------- ลงชื่อ ---------- */
  const rightX = A4.width / 2 + 20;
  const signTop = y;
  // ชื่อที่จ่าหน้าถึงกรอกใหม่ได้ทุกใบ ต่อท้ายข้อความคงที่ที่ตั้งไว้
  draw([f.t('routeTo'), req.attentionName].filter(Boolean).join(' '));
  draw(f.t('regards'), { x: rightX + 60 });
  gap(lineGap * 0.92);
  draw(f.t('routeNote'), { x: marginX + 25 });

  y = signTop - f.n('signGap');
  draw(f.t('signLine'), { x: rightX });
  gap(lineGap);
  draw(f.t('signName'), { x: rightX + 20 });
  gap(lineGap * 1.67);

  /* ---------- ช่องบันทึกของเจ้าหน้าที่ ---------- */
  const half = (A4.width - marginX * 2) / 2;
  const officerH = f.n('officerHeight');
  const officerSize = pt(f.n('officerSize'));
  const officerTop = y;
  const headRow = officerSize * 1.35;
  for (const [i, label] of [f.t('officerLeft'), f.t('officerRight')].entries()) {
    const bx = marginX + half * i;
    page.drawRectangle({
      x: bx, y: officerTop - officerH, width: half, height: officerH,
      borderColor: black, borderWidth: 0.8,
    });
    page.drawLine({
      start: { x: bx, y: officerTop - headRow }, end: { x: bx + half, y: officerTop - headRow },
      thickness: 0.8, color: black,
    });
    const size = fit(label, half - 10, officerSize);
    put(label, bx + (half - width(label, size)) / 2, officerTop - headRow + officerSize * 0.38, size);
  }

  return Buffer.from(await doc.save());
}
