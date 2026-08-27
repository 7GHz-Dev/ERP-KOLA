import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * ออกไฟล์ PDF ของคำร้องขอนำของเข้าเขตปลอดอากร
 *
 * เดิมต้องให้ผู้ใช้เปิดหน้าเว็บ กด Ctrl+P เป็น PDF แล้วอัปโหลดกลับเข้ามา
 * ชุดรวม E-Office ถึงจะมีคำร้องอยู่ด้วย ตรงนี้วาดเองที่เซิร์ฟเวอร์เลย
 * ทั้งข้อความและตำแหน่งยกมาจากหน้า /eoffice/[jobId] ให้ตรงกันทุกบรรทัด
 *
 * ต้องมีฟอนต์ไทยจริง ๆ ฟอนต์มาตรฐานของ PDF ไม่มีตัวอักษรไทยเลย
 */

const A4 = { width: 595.28, height: 841.89 };
const MARGIN_X = 45;
const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts');

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
};

export class MissingThaiFontError extends Error {
  constructor() {
    super(
      'ยังไม่มีฟอนต์ไทยสำหรับออกคำร้อง — วางไฟล์ Sarabun-Regular.ttf ไว้ที่ v2/assets/fonts/',
    );
  }
}

async function loadFonts() {
  try {
    const [regular, bold] = await Promise.all([
      readFile(path.join(FONT_DIR, 'Sarabun-Regular.ttf')),
      readFile(path.join(FONT_DIR, 'Sarabun-Bold.ttf')).catch(() =>
        readFile(path.join(FONT_DIR, 'Sarabun-Regular.ttf'))),
    ]);
    return { regular, bold };
  } catch {
    throw new MissingThaiFontError();
  }
}

export function thaiFontAvailable() {
  return readFile(path.join(FONT_DIR, 'Sarabun-Regular.ttf')).then(() => true, () => false);
}

export async function renderEofficeRequestPdf(
  req: EofficeRequestData,
): Promise<Buffer> {
  const { PDFDocument, rgb } = await import('@cantoo/pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  const fonts = await loadFonts();

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // ไม่ตัด subset — ตัวตัดของ fontkit พังกับตาราง glyph ของฟอนต์ไทยตัวนี้
  // ฝังทั้งไฟล์แทน ใหญ่ขึ้นราว 160 KB ต่อฉบับ ซึ่งรับได้
  const regular = await doc.embedFont(fonts.regular, { subset: false });
  const bold = await doc.embedFont(fonts.bold, { subset: false });
  const page = doc.addPage([A4.width, A4.height]);

  const black = rgb(0, 0, 0);
  let y = A4.height - 55;

  const width = (text: string, size: number, useBold = false) =>
    (useBold ? bold : regular).widthOfTextAtSize(text, size);

  /**
   * ขนาดอักษรที่ใส่ในความกว้างที่มีได้พอดี
   * ภาษาไทยไม่มีช่องว่างระหว่างคำ ตัดขึ้นบรรทัดใหม่เองไม่ได้ จึงย่อขนาดแทน
   * ดีกว่าปล่อยให้ล้นออกนอกกระดาษหรือตัดข้อความทิ้งจนอ่านไม่รู้เรื่อง
   */
  const fit = (text: string, room: number, size: number, useBold = false) => {
    let s = size;
    while (s > 7 && width(text, s, useBold) > room) s -= 0.5;
    return s;
  };

  const draw = (
    text: string,
    opts: { x?: number; size?: number; bold?: boolean; center?: boolean; right?: boolean } = {},
  ) => {
    const font = opts.bold ? bold : regular;
    let x = opts.x ?? MARGIN_X;
    const size = fit(text, A4.width - MARGIN_X - x, opts.size ?? 15, opts.bold);
    if (opts.center) x = (A4.width - width(text, size, opts.bold)) / 2;
    if (opts.right) x = A4.width - MARGIN_X - width(text, size, opts.bold);
    page.drawText(text, { x, y, size, font, color: black });
  };

  /** ข้อความที่มีขีดเส้นใต้เฉพาะค่าที่กรอก ไล่วาดทีละท่อนบนบรรทัดเดียว */
  const line = (
    parts: Array<{ text: string; underline?: boolean; bold?: boolean }>,
    opts: { size?: number; indent?: number } = {},
  ) => {
    const start = MARGIN_X + (opts.indent ?? 0);
    const whole = parts.map((p) => p.text).join('');
    const size = fit(whole, A4.width - MARGIN_X - start, opts.size ?? 15);
    let x = start;
    for (const part of parts) {
      const font = part.bold ? bold : regular;
      page.drawText(part.text, { x, y, size, font, color: black });
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
  draw('คำร้องขอนำของที่นำเข้ามาในราชอาณาจักรเข้าไปในเขตปลอดอากร', {
    size: 18, bold: true, center: true,
  });
  gap(30);

  const [book, running] = (req.requestNo ?? '/').split('/');
  const date = thaiDate(req.requestDate);

  const noText = 'เลขที่ ';
  const noValue = `${book}  /  ${running}`;
  const noWidth = width(noText, 15) + width(noValue, 15);
  page.drawText(noText, { x: A4.width - MARGIN_X - noWidth, y, size: 15, font: regular });
  page.drawText(noValue, {
    x: A4.width - MARGIN_X - width(noValue, 15), y, size: 15, font: regular,
  });
  gap(22);

  const dateParts = [
    { text: 'วันที่ ' }, { text: ` ${date.day} `, underline: true },
    { text: ' เดือน ' }, { text: ` ${date.month} `, underline: true },
    { text: ' พ.ศ. ' }, { text: ` ${date.year} `, underline: true },
  ];
  const dateWidth = dateParts.reduce((sum, p) => sum + width(p.text, 15), 0);
  {
    let x = A4.width - MARGIN_X - dateWidth;
    for (const p of dateParts) {
      page.drawText(p.text, { x, y, size: 15, font: regular });
      const w = width(p.text, 15);
      if (p.underline) {
        page.drawLine({
          start: { x, y: y - 2.5 }, end: { x: x + w, y: y - 2.5 },
          thickness: 0.6, color: black,
        });
      }
      x += w;
    }
  }
  gap(30);

  /* ---------- เรื่อง / เรียน ---------- */
  draw('เรื่อง', { bold: true });
  draw('ขอนำของที่นำเข้ามาในราชอาณาจักรเข้าเขตปลอดอากร', { x: MARGIN_X + 55 });
  gap(22);
  draw('เรียน', { bold: true });
  draw('นายด่านศุลกากรแม่สอด', { x: MARGIN_X + 55 });
  gap(30);

  /* ---------- เนื้อความ ---------- */
  line([
    { text: 'ด้วยข้าพเจ้า บริษัท ' },
    { text: ' แม่สอดฟรีโซน จำกัด ', underline: true },
  ], { indent: 45 });
  gap(24);

  line([
    { text: 'ถือใบรับรองเป็นผู้ประกอบกิจการในเขตปลอดอากร ' },
    { text: ' 97-2567 ', underline: true },
    { text: ' ตั้งอยู่เลขที่ ' },
    { text: ' 888/2 ', underline: true },
    { text: ' หมู่ที่ ' },
    { text: ' 7 ', underline: true },
  ]);
  gap(24);

  line([
    { text: 'ตำบล' },
    { text: ' ท่าสายลวด ', underline: true },
    { text: ' อำเภอ ' },
    { text: ' แม่สอด ', underline: true },
    { text: ' จังหวัด' },
    { text: ' ตาก ', underline: true },
    { text: ' รหัสไปรษณีย์ ' },
    { text: ' 63110 ', underline: true },
  ]);
  gap(24);

  draw('มีความประสงค์จะนำของที่เข้ามาในราชอาณาจักรเข้าเขตปลอดอากร แม่สอดฟรีโซน ตามใบขน', {
    x: MARGIN_X + 45,
  });
  gap(24);


  line([
    { text: 'สินค้าขาเข้า เลขที่ ' },
    { text: ` ${req.entryNo ?? ''} `, underline: true },
    { text: ' เพื่อปรับสภาพก่อนส่งออกไปต่างประเทศ รายละเอียด ดังนี้' },
  ]);
  gap(28);

  /* ---------- ตารางรายละเอียดของ ---------- */
  const cols = [
    { label: 'จำนวนหีบห่อ', value: req.packageCount ?? '', w: 110 },
    { label: 'น้ำหนักสุทธิ', value: req.netWeight ?? '', w: 110 },
    { label: 'ราคาของ', value: req.goodsValue ?? '', w: 110 },
    { label: 'ชนิดของ', value: req.goodsType ?? '', w: A4.width - MARGIN_X * 2 - 330 },
  ];
  const headH = 26;
  const bodyH = 30;
  const tableTop = y;

  let x = MARGIN_X;
  for (const c of cols) {
    page.drawRectangle({
      x, y: tableTop - headH, width: c.w, height: headH,
      borderColor: black, borderWidth: 0.8,
    });
    const lSize = fit(c.label, c.w - 10, 14);
    page.drawText(c.label, {
      x: x + (c.w - width(c.label, lSize)) / 2, y: tableTop - headH + 8,
      size: lSize, font: regular, color: black,
    });
    x += c.w;
  }

  x = MARGIN_X;
  for (const c of cols) {
    page.drawRectangle({
      x, y: tableTop - headH - bodyH, width: c.w, height: bodyH,
      borderColor: black, borderWidth: 0.8,
    });
    // ชนิดของเป็นข้อความยาว ชิดซ้าย ส่วนตัวเลขวางกลางช่อง
    const isText = c.label === 'ชนิดของ';
    const vSize = fit(c.value, c.w - 14, 14);
    page.drawText(c.value, {
      x: isText ? x + 7 : x + (c.w - width(c.value, vSize)) / 2,
      y: tableTop - headH - bodyH + 10,
      size: vSize, font: regular, color: black,
    });
    x += c.w;
  }
  y = tableTop - headH - bodyH;
  gap(34);

  draw('จึงเรียนมาเพื่อโปรดพิจารณา', { x: MARGIN_X + 45 });
  gap(34);

  /* ---------- ลงชื่อ ---------- */
  const rightX = A4.width / 2 + 20;
  const signTop = y;
  draw('เรียน เรือตรี ชุมพล');
  draw('ขอแสดงความนับถือ', { x: rightX + 60 });
  gap(22);
  draw('เพื่อดำเนินการตามระเบียบ', { x: MARGIN_X + 25 });

  y = signTop - 70;
  draw('( ลงชื่อ ) ..................................... ตัวแทน/ผู้จัดการ', { x: rightX });
  gap(24);
  draw('( นายอัครเดช ตาสะหลี )  ประทับตรา', { x: rightX + 20 });
  gap(40);

  /* ---------- ช่องบันทึกของเจ้าหน้าที่ ---------- */
  const half = (A4.width - MARGIN_X * 2) / 2;
  const officerH = 120;
  const officerTop = y;
  for (const [i, label] of [
    'บันทึกการอนุญาตของพนักงานศุลกากร',
    'บันทึกการตรวจสอบพนักงานศุลกากร',
  ].entries()) {
    const bx = MARGIN_X + half * i;
    page.drawRectangle({
      x: bx, y: officerTop - officerH, width: half, height: officerH,
      borderColor: black, borderWidth: 0.8,
    });
    page.drawLine({
      start: { x: bx, y: officerTop - 26 }, end: { x: bx + half, y: officerTop - 26 },
      thickness: 0.8, color: black,
    });
    page.drawText(label, {
      x: bx + (half - width(label, 13)) / 2, y: officerTop - 19,
      size: 13, font: regular, color: black,
    });
  }

  return Buffer.from(await doc.save());
}
