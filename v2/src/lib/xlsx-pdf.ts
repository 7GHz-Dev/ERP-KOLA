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
   * cambria.ttf ที่ Windows ให้มาเป็น "font collection" คือมีหลายฟอนต์ในไฟล์เดียว
   * (Cambria กับ Cambria Math) ฝังตรง ๆ ไม่ได้ ต้องระบุชื่อฟอนต์ที่จะเอา
   * ลองแบบธรรมดาก่อน ถ้าเจอกรณีนี้ค่อยระบุชื่อ จะได้ใช้ได้ทั้งไฟล์เดี่ยวและไฟล์รวม
   */
  const embed = async (bytes: Buffer, name: string) => {
    try {
      return await doc.embedFont(bytes, { subset: false });
    } catch (error) {
      if (!/collection/i.test(error instanceof Error ? error.message : '')) throw error;
      return doc.embedFont(bytes, { subset: false, postscriptName: name });
    }
  };

  const regular = await embed(regularBytes, 'Cambria');
  const bold = await embed(boldBytes, 'Cambria-Bold');

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
  const margin = 28;
  const scale = Math.min(
    (pageW - margin * 2) / contentW,
    (pageH - margin * 2) / contentH,
    1,
  );

  const originX = (pageW - contentW * scale) / 2;
  const originY = pageH - margin;

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

      // ช่องวันที่ ExcelJS คืนค่าเป็น Date ซึ่ง .text จะกลายเป็นสตริงยาวแบบ
      // "Fri Aug 14 2026 07:00:00 GMT+0700" จัดรูปเองให้เป็น dd/mm/yyyy ตามระบบ
      const text = cell.value instanceof Date
        ? new Intl.DateTimeFormat('en-GB', {
          day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
        }).format(cell.value)
        : String(cell.text ?? '').trim();
      if (!text) continue;

      const isBold = Boolean(cell.font?.bold);
      const font = isBold ? bold : regular;
      const base = (cell.font?.size ?? 11) * scale;
      let size = base;
      while (size > 4 && font.widthOfTextAtSize(text, size) > w - 4) size -= 0.25;

      const align: Align = (cell.alignment?.horizontal as Align)
        ?? (typeof cell.value === 'number' ? 'right' : 'left');
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
