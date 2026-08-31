import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DETAIL_LABELS, blockCode, loadDoLetterForm, type DoLetterForm } from '@/lib/do-letter';
import { downloadFile } from '@/lib/storage';

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

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

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

function thaiToday() {
  const d = new Date();
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
}

export type DoLetterData = {
  shippingLine: string;
  blNo: string | null;
  vessel: string | null;
  voyage: string | null;
  eta: string | null;
  /** ท่าปลายทาง */
  portName: string | null;
  /** เมืองต้นทาง — ยังไม่มีในฐานข้อมูล ปล่อยว่างให้กรอกด้วยมือบนกระดาษได้ */
  originName: string | null;
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

export async function renderDoLetterPdf(
  data: DoLetterData,
  form?: DoLetterForm,
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

  /*
   * มีแบบฟอร์มพื้นหลังก็ใช้ไฟล์นั้นเป็นกระดาษ แล้วเติมเฉพาะค่าลงไป
   * เหมือนคำร้องปะหน้า E-Office — หัวจดหมายและเส้นทั้งหมดมาจากไฟล์ จึงตรงต้นฉบับ
   * อ่านไฟล์ไม่ได้ก็วาดเองทั้งใบต่อ ดีกว่าออกจดหมายไม่ได้เลย
   */
  let page;
  if (f.hasTemplate && f.templateKey) {
    try {
      const { body } = await downloadFile(f.templateKey);
      const tpl = await PDFDocument.load(body, { password: '' });
      const [copied] = await doc.copyPages(tpl, [0]);
      page = doc.addPage(copied);
    } catch {
      page = undefined;
    }
  }
  const PAGE_W = page ? page.getWidth() : 595.28;
  const PAGE_H = page ? page.getHeight() : 841.89;
  if (!page) page = doc.addPage([595.28, 841.89]);
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

  // ---------- หัวจดหมาย ----------
  // มีพื้นหลังแล้วหัวจดหมายอยู่ในไฟล์ ไม่ต้องวาดซ้ำให้ทับกัน
  if (!f.hasTemplate) {
    const head = b('header');
    draw(f.value('companyName', line), { x: head.x, y: head.y }, { bold: true, pt: 20 });
    let hy = head.y + head.gap + 6;
    for (const key of ['companyAddress', 'companyContact']) {
      const v = f.value(key, line);
      if (!v) continue;
      draw(v, { x: head.x, y: hy }, { pt: 14 });
      hy += head.gap;
    }
  }

  // ---------- วันที่ (ชิดขวาจากจุดที่ตั้งไว้) ----------
  const dateAt = b('date');
  const today = `วันที่ ${thaiToday()}`;
  draw(today, { x: dateAt.x - widthOf(today, size(16)), y: dateAt.y });

  // ---------- เรื่อง · เรียน ----------
  const subjectAt = b('subject');
  draw(`เรื่อง  ${f.value('subject', line)}`, subjectAt, { bold: true });

  const attnAt = b('attention');
  draw(`เรียน  ${f.value('attention', line)} บริษัท ${line}`, attnAt);

  // ---------- รายละเอียดงาน ----------
  const detailAt = b('details');
  const details: Array<[string, string | null]> = [
    [DETAIL_LABELS.blNo, data.blNo],
    [DETAIL_LABELS.origin, data.originName],
    [DETAIL_LABELS.destination, data.portName],
    [DETAIL_LABELS.vessel, [data.vessel, data.voyage].filter(Boolean).join(' V. ') || null],
    [DETAIL_LABELS.eta, data.eta],
  ];
  // ป้ายทุกบรรทัดกว้างเท่ากัน ค่าจึงเริ่มที่คอลัมน์เดียวกันทั้งหมด
  const tagWidth = Math.max(...details.map(([t]) => widthOf(t, size(16)))) + size(14);
  let dy = detailAt.y;
  for (const [label, value] of details) {
    draw(label, { x: detailAt.x, y: dy });
    // ค่าเป็นภาษาอังกฤษ วาดแยกจากป้ายไทยเพื่อไม่ให้สำเนาฟอนต์เดียวรับสองสคริปต์
    draw(value ?? '', { x: detailAt.x + tagWidth, y: dy });
    dy += detailAt.gap;
  }

  // ---------- ข้อความขออนุมัติ ----------
  const bodyAt = b('body');
  const bodyWidth = PAGE_W - bodyAt.x - 70;
  // ย่อหน้าแรกของแต่ละย่อหน้าตามแบบจดหมายราชการไทย บรรทัดถัดไปชิดซ้ายตามปกติ
  const INDENT = size(36);
  let by = bodyAt.y;
  for (const key of ['request', 'liability']) {
    const lines = wrapBy(
      (t) => widthOf(t, size(16)),
      f.value(key, line),
      bodyWidth,
      INDENT,
    );
    lines.forEach((text, i) => {
      if (text) draw(text, { x: bodyAt.x + (i === 0 ? INDENT : 0), y: by });
      by += bodyAt.gap;
    });
  }

  // ---------- ผู้ลงนาม ----------
  const closeAt = b('closing');
  draw('ขอแสดงความนับถือ', closeAt);

  const signAt = b('signer');
  const signer = f.value('signerName', line);
  const title = f.value('signerTitle', line);
  let sy = signAt.y;
  if (signer) { draw(signer, { x: signAt.x, y: sy }, { bold: true }); sy += signAt.gap; }
  if (title) draw(title, { x: signAt.x, y: sy }, { pt: 14 });

  return Buffer.from(await doc.save());
}
