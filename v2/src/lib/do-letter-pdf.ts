import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DETAIL_LABELS, LETTER_COMPANIES, letterDate, loadDoLetterForm,
  type CompanyNo, type DoLetterForm,
} from '@/lib/do-letter';
import { drawCoordinateGrid } from '@/lib/pdf-grid';

/**
 * ออกไฟล์ PDF จดหมายขอแลก D/O
 *
 * วาดทั้งใบเองเหมือนโหมด "ไม่มีแบบฟอร์มพื้นหลัง" ของคำร้อง E-Office
 * ข้อความทุกบรรทัดมาจาก /master/do-letter จึงแก้ถ้อยคำได้โดยไม่ต้องแก้โค้ด
 *
 * ต้องมีฟอนต์ไทยจริง — ฟอนต์มาตรฐานของ PDF ไม่มีตัวอักษรไทย
 */

const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts');
const SARABUN_SIZE_RATIO = 1 / 1.5;

/** ตัวอักษรไทยหนึ่งตัวขึ้นไป ใช้เลือกว่าจะวาดด้วยฟอนต์สำเนาไหน */
const HAS_THAI = /[\u0E00-\u0E7F]/;

export class MissingThaiFontError extends Error {
  constructor() {
    super(
      'ยังไม่มีฟอนต์ไทยสำหรับออกจดหมาย — วางไฟล์ AngsanaNew-Regular.ttf '
      + '(หรือ Sarabun-Regular.ttf) ไว้ที่ v2/assets/fonts/',
    );
  }
}

async function loadPair(regular: string, bold: string) {
  const regularBytes = await readFile(path.join(FONT_DIR, regular));
  const boldBytes = await readFile(path.join(FONT_DIR, bold)).catch(() => regularBytes);
  return { regular: regularBytes, bold: boldBytes };
}

/*
 * ใช้ Angsana New เป็นตัวหลัก เหมือนคำร้องปะหน้า E-Office
 *
 * เอกสารราชการและจดหมายบริษัทฝั่งนี้ใช้ Angsana New กันมาตลอด
 * เคยลองสลับไป Sarabun เพราะคิดว่าวางสระได้ดีกว่า แต่ทดสอบเรนเดอร์เทียบกันแล้ว
 * ทั้งสองฟอนต์วางสระซ้อนอย่าง "เรื่อง" เหมือนกันเป๊ะ — เป็นข้อจำกัดของ fontkit
 * ไม่ใช่ของฟอนต์ จึงกลับมาใช้ Angsana New ให้ตรงกับของเดิม
 */
async function loadFonts() {
  try {
    return { ...await loadPair('AngsanaNew-Regular.ttf', 'AngsanaNew-Bold.ttf'), sizeRatio: 1 };
  } catch { /* ไม่มี Angsana New ถอยไป Sarabun เพื่อให้ยังออกจดหมายได้ */ }
  try {
    return {
      ...await loadPair('Sarabun-Regular.ttf', 'Sarabun-Bold.ttf'),
      sizeRatio: SARABUN_SIZE_RATIO,
    };
  } catch {
    throw new MissingThaiFontError();
  }
}

export type DoLetterData = {
  shippingLine: string;
  blNo: string | null;
  vessel: string | null;
  voyage: string | null;
  eta: string | Date | null;
  /** ท่าปลายทาง */
  portName: string | null;
  /** เมืองต้นทาง — ยังไม่มีในฐานข้อมูล ปล่อยว่างให้กรอกด้วยมือบนกระดาษได้ */
  originName: string | null;
  /** วันที่บนหัวจดหมาย — ไม่ส่งมาก็ใช้วันที่ออกจดหมาย */
  letterDate?: Date | string | null;
};

/**
 * ตัดข้อความยาวให้พอดีความกว้าง — pdf-lib ไม่ตัดบรรทัดให้เอง
 *
 * วัดด้วยฟังก์ชันที่ส่งเข้ามา เพราะบรรทัดที่ปนไทยกับละตินต้องวัดทีละท่อนเหมือนตอนวาด
 * ภาษาไทยไม่มีช่องว่างระหว่างคำ ท่อนที่ยาวเกินจึงยอมให้ล้นดีกว่าตัดกลางคำจนอ่านไม่ออก
 */
function wrapBy(
  measure: (text: string) => number,
  text: string,
  maxWidth: number,
  /** บรรทัดแรกถูกย่อหน้า จึงเหลือที่น้อยกว่าบรรทัดอื่นเท่านี้ */
  firstIndent = 0,
): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) { out.push(''); continue; }
    let line = '';
    let firstLine = true;
    for (const word of paragraph.split(/(\s+)/)) {
      const next = line + word;
      const room = firstLine ? maxWidth - firstIndent : maxWidth;
      if (measure(next) > room && line) {
        out.push(line.trimEnd());
        firstLine = false;
        line = word.trimStart();
      } else {
        line = next;
      }
    }
    if (line.trim()) out.push(line.trimEnd());
  }
  return out;
}

export type RenderOptions = {
  /** วาดเส้นตารางพิกัดทับให้ด้วย ใช้ตอนตั้งตำแหน่งบล็อกบนกระดาษ */
  grid?: boolean;
};

export async function renderDoLetterPdf(
  data: DoLetterData,
  form?: DoLetterForm,
  options: RenderOptions = {},
): Promise<Buffer> {
  const f = form ?? await loadDoLetterForm();
  const line = data.shippingLine;
  const { PDFDocument, rgb } = await import('@cantoo/pdf-lib');
  const fontkitModule = await import('@pdf-lib/fontkit');
  const fontkit = fontkitModule.default;
  const fonts = await loadFonts();

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // ไม่ตัด subset — ตัวตัดของ fontkit พังกับตาราง glyph ของฟอนต์ไทย
  const embed = (bytes: Buffer) => doc.embedFont(bytes, { subset: false });

  /*
   * ฝังฟอนต์สองสำเนา เหมือนที่คำร้อง E-Office ทำ
   *
   * fontkit จำสคริปต์ของข้อความแรกที่จัดวางให้ฟอนต์แต่ละตัว พอจัดข้อความไทยไปแล้ว
   * ตัวเลขในข้อความถัด ๆ มาจะเพี้ยนเป็นเลขอีกรูปแบบของ Angsana New และมีช่องว่างแทรก
   * แยกสำเนากันแบบนี้ สำเนาละตินจึงไม่เคยเห็นอักษรไทย ตัวเลขจึงออกมาปกติเสมอ
   */
  const thai = { regular: await embed(fonts.regular), bold: await embed(fonts.bold) };
  const latin = { regular: await embed(fonts.regular), bold: await embed(fonts.bold) };
  const pick = (text: string, useBold = false) =>
    (HAS_THAI.test(text) ? thai : latin)[useBold ? 'bold' : 'regular'];

  const size = (pt: number) => pt * fonts.sizeRatio;
  const b = (key: string) => f.block(key, line);

  const widthOf = (text: string, pt: number, useBold = false) =>
    pick(text, useBold).widthOfTextAtSize(text, pt);

  /*
   * วาดทีละ cluster แทนการโยนทั้งบรรทัดให้ drawText
   *
   * สระบนกับวรรณยุกต์ของไทยมี xAdvance = 0 คือไม่กินที่ ต้องซ้อนบนพยัญชนะตัวก่อน
   * แต่ drawText วางมันเป็นตัวแยกจนคำอย่าง "เรื่อง" กลายเป็น "เรื่ อง"
   * ตรงนี้ให้ fontkit จัดวางก่อน แล้วรวมตัวที่ไม่กินที่เข้ากับตัวก่อนหน้าเป็นก้อนเดียว
   * จากนั้นวาดทีละก้อนแล้วเลื่อน x ตามระยะจริงที่ fontkit บอก
   */
  const rawFonts = {
    regular: fontkit.create(fonts.regular),
    bold: fontkit.create(fonts.bold),
  } as { regular: any; bold: any };

  const clustersOf = (text: string, pt: number, useBold: boolean) => {
    const raw = useBold ? rawFonts.bold : rawFonts.regular;
    const run = raw.layout(text);
    const upem = raw.unitsPerEm;
    const out: Array<{ text: string; advance: number }> = [];
    run.glyphs.forEach((g: any, i: number) => {
      const advance = (run.positions[i].xAdvance / upem) * pt;
      const chars = String.fromCodePoint(...(g.codePoints ?? []));
      // ตัวที่ไม่กินที่ = สระ/วรรณยุกต์ที่ต้องซ้อน รวมกับก้อนก่อนหน้า
      if (advance === 0 && out.length) out[out.length - 1].text += chars;
      else out.push({ text: chars, advance });
    });
    return out;
  };

  const PAGE_W = 595.28;
  const PAGE_H = 841.89;

  // รายละเอียดงานเหมือนกันทั้งสองใบ คิดครั้งเดียวแล้วใช้ซ้ำ
  const details: Array<[string, string | null]> = [
    [DETAIL_LABELS.blNo, data.blNo],
    [DETAIL_LABELS.origin, data.originName],
    [DETAIL_LABELS.destination, data.portName],
    [DETAIL_LABELS.vessel, [data.vessel, data.voyage].filter(Boolean).join('  V. ') || null],
    [DETAIL_LABELS.eta, letterDate(data.eta ?? null) || null],
  ];

  /**
   * วาดจดหมายหนึ่งใบของบริษัทหนึ่ง
   *
   * ทุกใบใช้เนื้อความและพิกัดชุดเดียวกัน ต่างแค่หัวจดหมาย ที่อยู่ และผู้ลงนาม
   * จึงแยกเป็นฟังก์ชันแล้ววนเรียกตามจำนวนบริษัท ไม่ต้องเขียนโครงจดหมายซ้ำ
   */
  const drawLetter = (co: CompanyNo) => {
    const page = doc.addPage([PAGE_W, PAGE_H]);

    /** y ที่ส่งเข้ามานับจากขอบบน แต่ pdf-lib นับจากขอบล่าง จึงกลับด้านให้ที่นี่ */
    const draw = (
      text: string,
      at: { x: number; y: number },
      opts: { bold?: boolean; pt?: number } = {},
    ) => {
      if (!text) return;
      const pt = size(opts.pt ?? 16);
      const font = pick(text, opts.bold);
      let x = at.x;
      for (const c of clustersOf(text, pt, Boolean(opts.bold))) {
        page.drawText(c.text, { x, y: PAGE_H - at.y, size: pt, font, color: rgb(0, 0, 0) });
        x += c.advance;
      }
    };

    /** วาดกึ่งกลางรอบ x ที่ตั้งไว้ ใช้กับหัวจดหมายที่ต้องอยู่กลางหน้า */
    const drawCentered = (
      text: string,
      at: { x: number; y: number },
      opts: { bold?: boolean; pt?: number } = {},
    ) => {
      if (!text) return;
      const pt = size(opts.pt ?? 16);
      draw(text, { x: at.x - widthOf(text, pt, opts.bold) / 2, y: at.y }, opts);
    };

    // วาดเส้นตารางก่อน ข้อความจะได้อยู่ทับเส้น ไม่ถูกเส้นบัง
    if (options.grid) drawCoordinateGrid(page, latin.regular, PAGE_W, PAGE_H, rgb);

    const companyName = f.coValue(co, 'companyName', line);

    // ---------- หัวจดหมาย ----------
    const head = b('header');
    drawCentered(companyName, { x: head.x, y: head.y }, { bold: true, pt: 26 });
    drawCentered(
      f.coValue(co, 'companyAddress', line),
      { x: head.x, y: head.y + head.gap },
      { bold: true, pt: 13 },
    );

    // เส้นคาดใต้หัวจดหมาย — x ที่ตั้งไว้คือขอบซ้าย อีกฝั่งสะท้อนให้เท่ากัน
    const rule = b('rule');
    page.drawLine({
      start: { x: rule.x, y: PAGE_H - rule.y },
      end: { x: PAGE_W - rule.x, y: PAGE_H - rule.y },
      thickness: 2.5,
      color: rgb(0, 0, 0),
    });

    // ---------- วันที่ (ชิดขวาจากจุดที่ตั้งไว้) ----------
    const dateAt = b('date');
    const dateValue = letterDate(data.letterDate ?? new Date());
    const dateLabel = 'วันที่ ';
    // ค่าเป็นตัวหนา ป้ายเป็นตัวธรรมดา วัดรวมกันก่อนเพื่อให้ท้ายบรรทัดชิดขวาพอดี
    const dateWidth = widthOf(dateLabel, size(16)) + widthOf(dateValue, size(16), true);
    const dateX = dateAt.x - dateWidth;
    draw(dateLabel, { x: dateX, y: dateAt.y });
    draw(dateValue, { x: dateX + widthOf(dateLabel, size(16)), y: dateAt.y }, { bold: true });

    // ---------- เรื่อง · เรียน ----------
    // ป้ายสองบรรทัดนี้กว้างเท่ากัน ค่าจึงเริ่มที่คอลัมน์เดียวกัน
    const headTag = Math.max(widthOf('เรื่อง', size(16)), widthOf('เรียน', size(16))) + size(24);

    const subjectAt = b('subject');
    draw('เรื่อง', subjectAt);
    draw(f.value('subject', line), { x: subjectAt.x + headTag, y: subjectAt.y });

    const attnAt = b('attention');
    draw('เรียน', attnAt);
    const attnLabel = `${f.value('attention', line)} `;
    draw(attnLabel, { x: attnAt.x + headTag, y: attnAt.y });
    // ชื่อสายเรือเป็นค่าที่เปลี่ยนทุกงาน ทำตัวหนาให้เห็นชัดเหมือนต้นฉบับ
    draw(
      line,
      { x: attnAt.x + headTag + widthOf(attnLabel, size(16)), y: attnAt.y },
      { bold: true },
    );

    // ---------- รายละเอียดงาน ----------
    const detailAt = b('details');
    // ป้ายทุกบรรทัดกว้างเท่ากัน ค่าจึงเริ่มที่คอลัมน์เดียวกันทั้งหมด
    const tagWidth = Math.max(...details.map(([t]) => widthOf(t, size(16)))) + size(24);
    let dy = detailAt.y;
    for (const [label, value] of details) {
      draw(label, { x: detailAt.x, y: dy });
      // ค่าเป็นภาษาอังกฤษ วาดแยกจากป้ายไทยเพื่อไม่ให้สำเนาฟอนต์เดียวรับสองสคริปต์
      draw(value ?? '', { x: detailAt.x + tagWidth, y: dy }, { bold: true });
      dy += detailAt.gap;
    }

    // ย่อหน้าแรกของแต่ละย่อหน้าตามแบบจดหมายราชการไทย บรรทัดถัดไปชิดซ้ายตามปกติ
    const INDENT = size(36);
    const bodyRight = 70;

    // ---------- ข้อความแจ้งจากผู้ส่งออก ----------
    const noticeAt = b('notice');
    const noticeLines = wrapBy(
      (t) => widthOf(t, size(16), true),
      f.value('notice', line).replaceAll('{company}', companyName),
      PAGE_W - noticeAt.x - bodyRight,
      INDENT,
    );
    let ny = noticeAt.y;
    noticeLines.forEach((text, i) => {
      if (text) draw(text, { x: noticeAt.x + (i === 0 ? INDENT : 0), y: ny }, { bold: true });
      ny += noticeAt.gap;
    });

    // ---------- ตัวเลือกลักษณะ B/L ----------
    const optionsAt = b('options');
    const mark = '(  )';
    const markWidth = widthOf(mark, size(16), true) + size(18);
    let oy = optionsAt.y;
    for (const option of f.value('options', line).split('\n')) {
      if (!option.trim()) continue;
      draw(mark, { x: optionsAt.x, y: oy }, { bold: true });
      draw(option.trim(), { x: optionsAt.x + markWidth, y: oy }, { bold: true });
      oy += optionsAt.gap;
    }

    // ---------- ข้อความขออนุมัติ ----------
    const requestAt = b('request');
    const requestLines = wrapBy(
      (t) => widthOf(t, size(16), true),
      f.value('request', line),
      PAGE_W - requestAt.x - bodyRight,
      INDENT,
    );
    let ry = requestAt.y;
    requestLines.forEach((text, i) => {
      if (text) draw(text, { x: requestAt.x + (i === 0 ? INDENT : 0), y: ry }, { bold: true });
      ry += requestAt.gap;
    });

    // ---------- บรรทัดปิดท้าย ----------
    const closingLineAt = b('closingLine');
    draw(
      f.value('closingLine', line),
      { x: closingLineAt.x + INDENT, y: closingLineAt.y },
      { bold: true },
    );

    // ---------- ผู้ลงนาม ----------
    const closeAt = b('closing');
    draw(f.value('closing', line), closeAt, { bold: true });

    const signAt = b('signer');
    const signer = f.coValue(co, 'signerName', line);
    const title = f.value('signerTitle', line);
    let sy = signAt.y;
    // ชื่อผู้ลงนามอยู่ในวงเล็บตามต้นฉบับ ผู้ดูแลจึงกรอกแค่ชื่อ
    if (signer) { draw(`(${signer})`, { x: signAt.x, y: sy }, { bold: true }); sy += signAt.gap; }
    if (title) draw(title, { x: signAt.x, y: sy }, { bold: true });
  };

  for (const co of LETTER_COMPANIES) drawLetter(co);

  return Buffer.from(await doc.save());
}
