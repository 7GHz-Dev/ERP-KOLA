import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * แปลง Final Invoice ที่เป็น Excel ให้เป็น PDF เฉพาะขอบเขตการพิมพ์
 *
 * ระบบเดิมทำได้เพราะยืม Google Sheets แปลงให้ ที่นี่ไม่มีตัวแปลง จึงอ่านชีตเอง
 * แล้ววาดใหม่ด้วย pdf-lib โดยยึด Print_Area ที่ตั้งไว้ในไฟล์ (Page Break Preview)
 * ไม่ใช่ทั้งชีต — ชีตจริงมีตารางข้อมูลอ้างอิงอีกหลายพันแถวที่ไม่ได้ตั้งใจให้พิมพ์
 *
 * ความเที่ยงตรงระดับ "อ่านรู้เรื่องและตรงตำแหน่ง" ไม่ใช่ระดับ pixel-perfect
 * เก็บเส้นตาราง สีพื้น ตัวหนา การจัดวาง และช่องที่ผสานไว้
 */

const A4 = { width: 595.28, height: 841.89 };
const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts');

/** ความกว้างคอลัมน์ของ Excel เป็นหน่วยตัวอักษร แปลงเป็นพอยต์ */
const colToPoints = (width: number | undefined) => ((width ?? 8.43) * 7 + 5) * 0.75;
/** ความสูงแถวเป็นพอยต์อยู่แล้ว */
const rowToPoints = (height: number | undefined) => height ?? 15;

function parseRef(ref: string) {
  const m = ref.replace(/\$/g, '').match(/^([A-Z]+)(\d+)$/i);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
}

/** "sheet1!$A$1:$M$34" หรือ "A1:M34" → ขอบเขตแถว/คอลัมน์ */
export function parsePrintArea(area: string) {
  const body = area.includes('!') ? area.slice(area.indexOf('!') + 1) : area;
  const [from, to] = body.split(':');
  const a = parseRef(from);
  const b = parseRef(to ?? from);
  if (!a || !b) return null;
  return {
    fromRow: Math.min(a.row, b.row), toRow: Math.max(a.row, b.row),
    fromCol: Math.min(a.col, b.col), toCol: Math.max(a.col, b.col),
  };
}

type Align = 'left' | 'center' | 'right';

/**
 * ค่าที่อยู่ในช่อง โดยดึงผลลัพธ์ออกมาให้แล้วถ้าช่องนั้นเป็นสูตร
 *
 * ช่องยอดรวมเป็น SUM() ซึ่ง ExcelJS คืนเป็นออบเจ็กต์ { formula, result }
 * ถ้าไม่แกะออกมา ตัวตรวจว่า "เป็นตัวเลขไหม" จะไม่ผ่าน แล้วยอดรวมจะชิดซ้าย
 * ทั้งที่ตัวเลขในคอลัมน์เดียวกันชิดขวา
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cellValue(cell: any): unknown {
  const value = cell.value;
  return value && typeof value === 'object' && !(value instanceof Date) && 'result' in value
    ? value.result
    : value;
}

/** ตัวเลขในช่อง หรือ null ถ้าช่องนั้นไม่ใช่ตัวเลข */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function numberIn(cell: any): number | null {
  const value = cellValue(cell);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * จัดรูปตัวเลขตามรูปแบบที่ตั้งไว้ในช่อง Excel
 *
 * ExcelJS อ่านรูปแบบมาให้ที่ cell.numFmt แต่ไม่ได้เอาไปใช้กับ cell.text ซึ่งคืนเลขดิบ
 * ใบ Final Invoice ตั้ง "¥"#,##0 ไว้กับคอลัมน์ราคา ถ้าไม่จัดรูปเองจะได้ 769215
 * แทนที่จะเป็น ¥769,215 ต่างจากที่ Excel พิมพ์ออกมา
 *
 * รองรับเท่าที่ใบงานจริงใช้ — ตัวคั่นหลักพัน จำนวนทศนิยม ข้อความคงที่อย่างสัญลักษณ์
 * สกุลเงิน และเปอร์เซ็นต์ รูปแบบที่ซับซ้อนกว่านี้ (วันที่ เศษส่วน เลขยกกำลัง)
 * ปล่อยผ่านเป็นเลขดิบเหมือนเดิม ดีกว่าเดาแล้วพิมพ์ผิด
 */
export function formatNumber(value: number, numFmt?: string): string {
  const picked = pickSection(numFmt, value);
  if (!picked) return String(value);
  const { pattern, absolute } = picked;

  let prefix = '';
  let suffix = '';
  let core = '';
  let percent = false;

  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    // [Red] และเงื่อนไขอื่นไม่มีผลกับข้อความที่พิมพ์
    if (ch === '[') { i = pattern.indexOf(']', i); if (i < 0) break; continue; }
    // _x เว้นที่เท่าความกว้างของ x ส่วน *x วาด x ซ้ำจนเต็มช่อง ทั้งคู่ไม่ใช่ตัวอักษรจริง
    if (ch === '_' || ch === '*') { i += 1; continue; }
    if (ch === '\\') { i += 1; addLiteral(pattern[i] ?? ''); continue; }
    if (ch === '"') {
      const end = pattern.indexOf('"', i + 1);
      addLiteral(pattern.slice(i + 1, end < 0 ? undefined : end));
      i = end < 0 ? pattern.length : end;
      continue;
    }
    if (ch === '#' || ch === '0' || ch === '?' || ch === '.' || (ch === ',' && core)) {
      core += ch;
      continue;
    }
    if (ch === '%') percent = true;
    addLiteral(ch);
  }

  function addLiteral(text: string) {
    if (!text) return;
    if (core) suffix += text; else prefix += text;
  }

  if (!core) return String(value);

  const dot = core.indexOf('.');
  const decimals = dot < 0 ? 0 : core.slice(dot + 1).replace(/[^0#?]/g, '').length;
  const grouped = core.slice(0, dot < 0 ? undefined : dot).includes(',');

  const base = absolute ? Math.abs(value) : value;
  const shown = (percent ? base * 100 : base).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: grouped,
  });
  return `${prefix}${shown}${suffix}`;
}

/**
 * รูปแบบหนึ่งช่องแบ่งเป็นหลายท่อนด้วย ; ตามลำดับ บวก ลบ ศูนย์ ข้อความ
 * เลือกท่อนให้ตรงกับค่า และถ้าท่อนของค่าลบมีเครื่องหมายลบเขียนไว้เองแล้ว
 * ต้องส่งค่าสัมบูรณ์เข้าไป ไม่งั้นจะได้เครื่องหมายลบสองตัว
 */
function pickSection(
  numFmt: string | undefined, value: number,
): { pattern: string; absolute: boolean } | null {
  const fmt = (numFmt ?? '').trim();
  if (!fmt || /^general$/i.test(fmt)) return null;

  const sections: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < fmt.length; i += 1) {
    const ch = fmt[i];
    if (ch === '"') quoted = !quoted;
    if (ch === '\\') { current += ch + (fmt[i + 1] ?? ''); i += 1; continue; }
    if (ch === ';' && !quoted) { sections.push(current); current = ''; continue; }
    current += ch;
  }
  sections.push(current);

  if (value < 0 && sections[1]) return { pattern: sections[1], absolute: true };
  if (value === 0 && sections[2]) return { pattern: sections[2], absolute: false };
  return { pattern: sections[0], absolute: false };
}

/**
 * ข้อความที่จะพิมพ์จริงของช่องหนึ่ง
 *
 * ช่องวันที่ ExcelJS คืนค่าเป็น Date ซึ่ง .text จะกลายเป็นสตริงยาวแบบ
 * "Fri Aug 14 2026 07:00:00 GMT+0700" จัดรูปเองให้เป็น dd/mm/yyyy ตามระบบ
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function displayText(cell: any): string {
  const value = cellValue(cell);
  if (value instanceof Date) {
    return new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
    }).format(value);
  }
  const n = numberIn(cell);
  if (n !== null) return formatNumber(n, cell.numFmt);
  return String(cell.text ?? '').trim();
}

/**
 * ขนาดตัวอักษรอย่างต่ำของข้อความที่ล้นออกนอกช่องตัวเอง หน่วยเดียวกับที่ตั้งใน Excel
 * เท่ากับขนาดของหัวข้ออื่นในใบ Final Invoice จะได้ไม่มีบรรทัดไหนเล็กกว่าที่เหลือ
 */
const MIN_SPILL_SIZE = 14;

/** ระยะขอบกระดาษที่ตั้งไว้ในไฟล์ Excel หน่วยเป็นนิ้ว แปลงเป็นพอยต์ */
function marginPt(inches: number | undefined, fallback: number) {
  if (typeof inches !== 'number' || !Number.isFinite(inches)) return fallback;
  // ขอบแคบกว่านี้เครื่องพิมพ์ส่วนใหญ่พิมพ์ไม่ถึงอยู่ดี
  return Math.max(inches * 72, 14);
}

/**
 * แปลงไฟล์ Excel เป็น PDF
 * คืน null เมื่อไม่มีชีตไหนตั้งขอบเขตการพิมพ์ไว้ — จะได้ไม่พิมพ์ทั้งชีตออกมามั่ว ๆ
 */
export async function xlsxToPdf(body: Buffer): Promise<Buffer | null> {
  const ExcelJS = (await import('exceljs')).default;
  const { PDFDocument, rgb } = await import('@cantoo/pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(body as unknown as ArrayBuffer);

  const sheet = workbook.worksheets.find((ws) => ws.pageSetup?.printArea);
  if (!sheet) return null;
  const area = parsePrintArea(String(sheet.pageSetup.printArea));
  if (!area) return null;

  // Final Invoice ใช้ Cambria ตามที่ต้นฉบับ Excel ตั้งไว้ ถ้าไม่มีค่อยถอยไปใช้ Sarabun
  const pick = async (first: string, fallback: string) =>
    readFile(path.join(FONT_DIR, first)).catch(() => readFile(path.join(FONT_DIR, fallback)));
  const [regularBytes, boldBytes] = await Promise.all([
    pick('Cambria-Regular.ttf', 'Sarabun-Regular.ttf'),
    pick('Cambria-Bold.ttf', 'Sarabun-Bold.ttf'),
  ]);

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  /*
   * ไฟล์ในโฟลเดอร์นี้ต้องเป็นฟอนต์เดี่ยวเท่านั้น
   * cambria.ttf ที่ Windows ให้มาเป็น font collection (Cambria กับ Cambria Math อยู่ไฟล์เดียว)
   * ยัดลง PDF ทั้งก้อนแล้วโปรแกรมอ่านจะหาฟอนต์ในนั้นไม่เจอ แล้วถอยไปใช้ฟอนต์อื่นแทน
   * ใบ Final Invoice ที่ออกมาจึงไม่ใช่ Cambria จริง ๆ แยกไฟล์ก่อนด้วย scripts/extract-ttc.ts
   */
  const regular = await doc.embedFont(regularBytes, { subset: false });
  const bold = await doc.embedFont(boldBytes, { subset: false });

  const landscape = sheet.pageSetup?.orientation === 'landscape';
  const pageW = landscape ? A4.height : A4.width;
  const pageH = landscape ? A4.width : A4.height;
  const page = doc.addPage([pageW, pageH]);

  /* ---------- ขนาดของแต่ละคอลัมน์และแถวในขอบเขตที่จะพิมพ์ ---------- */
  const colW: number[] = [];
  for (let c = area.fromCol; c <= area.toCol; c += 1) {
    const col = sheet.getColumn(c);
    colW.push(col.hidden ? 0 : colToPoints(col.width));
  }
  const rowH: number[] = [];
  for (let r = area.fromRow; r <= area.toRow; r += 1) {
    const row = sheet.getRow(r);
    rowH.push(row.hidden ? 0 : rowToPoints(row.height));
  }

  const contentW = colW.reduce((a, b) => a + b, 0);
  const contentH = rowH.reduce((a, b) => a + b, 0);

  /*
   * ใช้ระยะขอบที่ตั้งไว้ในไฟล์ ไม่ใช่ค่าคงที่ของเราเอง
   * ใบ Final Invoice ตั้งขอบไว้แคบเพื่อให้ตารางลงพอดีหนึ่งหน้า ถ้าบังคับขอบกว้างกว่านั้น
   * อัตราย่อจะลดตามแล้วตัวอักษรทั้งใบเล็กกว่าที่ Excel พิมพ์ออกมาโดยไม่จำเป็น
   */
  const margins = sheet.pageSetup?.margins;
  const marginL = marginPt(margins?.left, 28);
  const marginR = marginPt(margins?.right, 28);
  const marginT = marginPt(margins?.top, 28);
  const marginB = marginPt(margins?.bottom, 28);

  const scale = Math.min(
    (pageW - marginL - marginR) / contentW,
    (pageH - marginT - marginB) / contentH,
    1,
  );

  const originX = marginL + (pageW - marginL - marginR - contentW * scale) / 2;
  const originY = pageH - marginT;

  const xAt = (index: number) =>
    originX + colW.slice(0, index).reduce((a, b) => a + b, 0) * scale;
  const yAt = (index: number) =>
    originY - rowH.slice(0, index).reduce((a, b) => a + b, 0) * scale;

  const black = rgb(0, 0, 0);

  /** ช่องที่ถูกผสาน ให้วาดเฉพาะช่องบนซ้าย แล้วกินพื้นที่ทั้งกลุ่ม */
  const merges: Array<{ top: number; left: number; bottom: number; right: number }> =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ((sheet as any).model?.merges ?? [])
      .map((ref: string) => {
        const [a, b] = ref.split(':').map(parseRef);
        return a && b
          ? {
            top: Math.min(a.row, b.row), bottom: Math.max(a.row, b.row),
            left: Math.min(a.col, b.col), right: Math.max(a.col, b.col),
          }
          : null;
      })
      .filter(Boolean);

  const mergeOf = (r: number, c: number) =>
    merges.find((m) => r >= m.top && r <= m.bottom && c >= m.left && c <= m.right);

  /*
   * ช่องไหนมีข้อความอยู่แล้วบ้าง — ต้องรู้ก่อนเริ่มวาด
   * ช่องที่อยู่ในกลุ่มผสาน ExcelJS คืนข้อความของช่องบนซ้ายให้ทุกช่อง จึงนับว่าไม่ว่างทั้งกลุ่ม
   */
  const filled: boolean[][] = [];
  for (let r = area.fromRow; r <= area.toRow; r += 1) {
    const row: boolean[] = [];
    for (let c = area.fromCol; c <= area.toCol; c += 1) {
      row.push(displayText(sheet.getCell(r, c)) !== '');
    }
    filled.push(row);
  }

  /**
   * ความกว้างที่ข้อความใช้ได้จริง
   *
   * Excel ปล่อยให้ข้อความยาวล้นไปทับช่องข้าง ๆ ที่ยังว่างอยู่ ถ้าบังคับให้อยู่ในช่องตัวเอง
   * ตัวอักษรจะถูกย่อจนอ่านไม่ออก — ที่อยู่ผู้ส่ง 30 ตัวอักษรในคอลัมน์กว้าง 50 pt
   * เคยหดเหลือราว 4 pt ทั้งที่ทั้งแถวว่างเปล่า
   *
   * ชิดซ้ายล้นไปทางขวา ชิดขวาล้นไปทางซ้าย จัดกลางล้นได้ทั้งสองทาง ตามที่ Excel ทำ
   */
  const roomFor = (ri: number, ci: number, spanCols: number, align: Align) => {
    let room = colW.slice(ci, ci + spanCols).reduce((a, b) => a + b, 0);
    if (align !== 'right') {
      for (let k = ci + spanCols; k < colW.length && !filled[ri][k]; k += 1) room += colW[k];
    }
    if (align !== 'left') {
      for (let k = ci - 1; k >= 0 && !filled[ri][k]; k -= 1) room += colW[k];
    }
    return room * scale;
  };

  for (let r = area.fromRow; r <= area.toRow; r += 1) {
    const ri = r - area.fromRow;
    if (!rowH[ri]) continue;

    for (let c = area.fromCol; c <= area.toCol; c += 1) {
      const ci = c - area.fromCol;
      if (!colW[ci]) continue;

      const merge = mergeOf(r, c);
      if (merge && (merge.top !== r || merge.left !== c)) continue;

      const spanCols = merge ? Math.min(merge.right, area.toCol) - c + 1 : 1;
      const spanRows = merge ? Math.min(merge.bottom, area.toRow) - r + 1 : 1;
      const w = colW.slice(ci, ci + spanCols).reduce((a, b) => a + b, 0) * scale;
      const h = rowH.slice(ri, ri + spanRows).reduce((a, b) => a + b, 0) * scale;
      const x = xAt(ci);
      const yTop = yAt(ri);

      const cell = sheet.getCell(r, c);

      // สีพื้นของช่อง
      const fill = cell.fill;
      if (fill?.type === 'pattern' && fill.pattern === 'solid' && fill.fgColor?.argb) {
        const argb = fill.fgColor.argb;
        if (argb.length === 8 && argb.slice(0, 2) !== '00') {
          page.drawRectangle({
            x, y: yTop - h, width: w, height: h,
            color: rgb(
              parseInt(argb.slice(2, 4), 16) / 255,
              parseInt(argb.slice(4, 6), 16) / 255,
              parseInt(argb.slice(6, 8), 16) / 255,
            ),
          });
        }
      }

      // เส้นขอบตามที่ตั้งไว้ในไฟล์
      const b = cell.border;
      const edge = (
        on: unknown, x1: number, y1: number, x2: number, y2: number,
      ) => {
        if (!on) return;
        page.drawLine({
          start: { x: x1, y: y1 }, end: { x: x2, y: y2 },
          thickness: 0.6, color: black,
        });
      };
      edge(b?.top, x, yTop, x + w, yTop);
      edge(b?.bottom, x, yTop - h, x + w, yTop - h);
      edge(b?.left, x, yTop, x, yTop - h);
      edge(b?.right, x + w, yTop, x + w, yTop - h);

      const text = displayText(cell);
      if (!text) continue;

      const isBold = Boolean(cell.font?.bold);
      const font = isBold ? bold : regular;
      const align: Align = (cell.alignment?.horizontal as Align)
        ?? (numberIn(cell) !== null ? 'right' : 'left');

      /*
       * ข้อความที่ล้นออกนอกช่องตัวเอง คือข้อความอิสระที่คนทำไฟล์ไม่ได้จัดให้พอดีคอลัมน์
       * เช่นที่อยู่ผู้ส่งกับที่อยู่ผู้รับ ซึ่งในไฟล์ตั้งไว้ 12 pt เล็กกว่าหัวข้ออื่นในใบเดียวกัน
       * พอย่อทั้งใบเหลือสองในสามแล้วเล็กจนอ่านยาก จึงยกขึ้นให้ไม่เล็กกว่าหัวข้ออื่น
       *
       * ช่องในตารางข้อมูลไม่โดน เพราะแต่ละช่องพอดีคอลัมน์อยู่แล้วไม่ได้ล้น
       * และต้องเล็กกว่าหัวตารางไว้ ไม่งั้นหัวกับข้อมูลจะกลืนกัน
       */
      const natural = (cell.font?.size ?? 11) * scale;
      const ownWidth = colW.slice(ci, ci + spanCols).reduce((a, b) => a + b, 0) * scale;
      const spills = font.widthOfTextAtSize(text, natural) > ownWidth - 4;

      const room = roomFor(ri, ci, spanCols, align) - 4;
      let size = natural;

      // ยกขึ้นเฉพาะเมื่อที่ว่างข้าง ๆ รับขนาดใหม่ไหว ไม่งั้นจะไปโดนย่อกลับจนเล็กกว่าเดิม
      if (spills) {
        const raised = Math.max(natural, MIN_SPILL_SIZE * scale);
        if (font.widthOfTextAtSize(text, raised) <= room) size = raised;
      }

      // ย่อขนาดต่อเมื่อยาวเกินที่ล้นไปช่องว่างข้าง ๆ ได้แล้วจริง ๆ
      while (size > 4 && font.widthOfTextAtSize(text, size) > room) size -= 0.25;

      const textW = font.widthOfTextAtSize(text, size);
      const tx = align === 'center' ? x + (w - textW) / 2
        : align === 'right' ? x + w - textW - 2
          : x + 2;

      page.drawText(text, {
        x: tx,
        y: yTop - h + (h - size * 0.72) / 2,
        size,
        font,
        color: black,
      });
    }
  }

  return Buffer.from(await doc.save());
}
