import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * ใบขนสินค้าขาเข้าฉบับจำลอง
 *
 * ปุ่มจำลองบนหน้าคิว Automation ใช้ทดสอบทั้งเส้นก่อนโปรแกรม Python จะพร้อม
 * ต้องออกเป็น PDF ไม่ใช่ไฟล์ข้อความ เพราะไฟล์นี้ถูกเอาไปต่อในชุด E-Office
 * ซึ่งต่อได้เฉพาะ PDF กับรูปภาพ
 */

const A4 = { width: 595.28, height: 841.89 };
const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts');

export async function renderCustomsEntryPdf(data: {
  entryNo: string;
  refNo: string;
  jobNo: string;
  blNo: string;
}): Promise<Buffer> {
  const { PDFDocument, rgb } = await import('@cantoo/pdf-lib');
  const fontkit = (await import('@pdf-lib/fontkit')).default;

  const [regularBytes, boldBytes] = await Promise.all([
    readFile(path.join(FONT_DIR, 'Sarabun-Regular.ttf')),
    readFile(path.join(FONT_DIR, 'Sarabun-Bold.ttf'))
      .catch(() => readFile(path.join(FONT_DIR, 'Sarabun-Regular.ttf'))),
  ]);

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(regularBytes, { subset: false });
  const bold = await doc.embedFont(boldBytes, { subset: false });
  const page = doc.addPage([A4.width, A4.height]);

  const black = rgb(0, 0, 0);
  const grey = rgb(0.42, 0.46, 0.5);
  const red = rgb(0.7, 0.18, 0.22);
  const margin = 50;
  let y = A4.height - 70;

  const centre = (text: string, size: number, font = regular, color = black) => {
    page.drawText(text, {
      x: (A4.width - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color,
    });
  };

  centre('ใบขนสินค้าขาเข้าพร้อมแบบแสดงรายการภาษีสรรพสามิตและภาษีมูลค่าเพิ่ม', 16, bold);
  y -= 24;
  centre('MOCK UP — เอกสารจำลองสำหรับทดสอบระบบ', 12, regular, grey);
  y -= 34;

  const rows: Array<[string, string]> = [
    ['เลขที่ใบขนสินค้า', data.entryNo],
    ['เลขที่ใบขนบาน (Ref No.)', data.refNo || '-'],
    ['Job No.', data.jobNo || '-'],
    ['B/L No.', data.blNo || '-'],
    ['ผู้นำของเข้า', 'บริษัท แม่สอด ฟรีโซน จำกัด'],
    ['ประเภทใบขน', '610 ใบขนสินค้าขาเข้า เขตปลอดอากร'],
    ['วันที่ออกเอกสาร', new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok',
    }).format(new Date())],
  ];

  const labelW = 180;
  const tableW = A4.width - margin * 2;
  const rowH = 30;

  for (const [label, value] of rows) {
    page.drawRectangle({
      x: margin, y: y - rowH, width: labelW, height: rowH,
      borderColor: black, borderWidth: 0.7,
    });
    page.drawRectangle({
      x: margin + labelW, y: y - rowH, width: tableW - labelW, height: rowH,
      borderColor: black, borderWidth: 0.7,
    });
    page.drawText(label, { x: margin + 9, y: y - 20, size: 13, font: regular, color: black });

    let size = 13;
    const room = tableW - labelW - 18;
    while (size > 7 && regular.widthOfTextAtSize(value, size) > room) size -= 0.5;
    page.drawText(value, {
      x: margin + labelW + 9, y: y - 20, size, font: regular, color: black,
    });
    y -= rowH;
  }

  y -= 40;
  centre('เอกสารนี้สร้างโดยปุ่มจำลองบน คิว Automation', 12, regular, red);
  y -= 20;
  centre('เมื่อโปรแกรม Python ตัวจริงพร้อมใช้งาน ไฟล์นี้จะถูกแทนที่ด้วยใบขนจริง', 12, regular, red);

  return Buffer.from(await doc.save());
}
