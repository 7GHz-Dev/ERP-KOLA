import ExcelJS from 'exceljs';
import { rowsFromGrid, type SheetRow } from './shipment-import';

/**
 * อ่านไฟล์ตารางงานที่เป็น Excel (.xlsx / .xlsm)
 *
 * ผู้ใช้ทำงานกับไฟล์นี้ใน Excel อยู่แล้ว การบังคับให้ Save As เป็น CSV ก่อนทุกครั้ง
 * เป็นขั้นที่ลืมง่ายและพลาดง่าย — บันทึกผิดแผ่น หรือได้ไฟล์ที่ภาษาไทยเพี้ยนเพราะ
 * Excel ภาษาไทยบันทึกเป็น Windows-874 ตรงนี้รับไฟล์ต้นฉบับไปเลย
 *
 * แยกจาก shipment-import.ts เพราะ exceljs ทำงานได้เฉพาะฝั่งเซิร์ฟเวอร์
 * ถ้าอยู่รวมกัน ไฟล์ที่เบราว์เซอร์ import ไปใช้จะลาก exceljs เข้าไปทั้งก้อน
 *
 * ใช้ rowsFromGrid() ตัวเดียวกับ CSV กฎการจับคอลัมน์จึงเหมือนกันทุกประการ
 * ต่างแค่วิธีแกะช่องออกมาจากไฟล์
 */

/**
 * ค่าในช่องหนึ่งของ Excel ให้เป็นข้อความ
 *
 * ค่าที่ได้จาก exceljs มาได้หลายรูป ไม่ใช่ string เสมอ
 *   - สูตร        เอาผลลัพธ์ ไม่ใช่ตัวสูตร ไม่งั้นได้ "=SUM(A1:A9)" มาเป็นน้ำหนัก
 *   - วันที่       Excel แปลงเป็น Date object ให้แล้ว คืนเป็น ISO ให้ sheetDate() อ่านต่อ
 *   - rich text   ข้อความที่จัดรูปแบบคนละสีในช่องเดียว ต่อกลับเป็นข้อความเดียว
 *   - hyperlink   เอาข้อความที่แสดง ไม่ใช่ URL เบื้องหลัง
 */
function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  /*
   * วันที่จาก Excel เป็น UTC midnight ของวันนั้น ตัดเอาเฉพาะส่วนวันที่
   * ไม่แปลงเขตเวลา เพราะ Excel เก็บ "วันที่" ไม่ได้เก็บ "เวลาชี้จุดหนึ่งบนโลก"
   * ถ้าแปลงเป็นเวลาไทยจะเลื่อนไปหนึ่งวันในไฟล์ที่ Excel เขียนมาแบบ UTC
   */
  if (v instanceof Date) return v.toISOString().slice(0, 10);

  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    // สูตร — ผลลัพธ์อาจเป็น Date หรือ rich text ซ้อนอีกชั้น จึงวนอ่านซ้ำ
    if ('result' in o) return cellText(o.result as ExcelJS.CellValue);
    if ('richText' in o) {
      return (o.richText as Array<{ text: string }>).map((t) => t.text).join('');
    }
    if ('text' in o) return String(o.text ?? '');
    // ช่องที่มีข้อผิดพลาดอย่าง #N/A ถือว่าว่าง ดีกว่าเอาคำว่า error ไปเป็นค่าจริง
    if ('error' in o) return '';
  }
  return String(v);
}

/**
 * แกะชีตแรกออกมาเป็นตาราง
 *
 * ใช้ชีตแรกเสมอ ไม่ไล่หาชีตที่ "ดูใช่" เพราะไฟล์จริงมีชีตอ้างอิงพ่วงมาหลายแผ่น
 * การเดาเองแล้วหยิบผิดแผ่นจะเงียบกว่าการบอกให้ผู้ใช้เลื่อนแผ่นที่ต้องการมาไว้หน้าสุด
 *
 * คืน `lineNumbers` มาด้วย เพราะ Excel ข้ามแถวว่างระหว่างกลางได้
 * เลขแถวที่ผู้ใช้เห็นในโปรแกรมจึงไม่เท่ากับลำดับในตารางที่เราอ่านมา
 */
function sheetGrid(ws: ExcelJS.Worksheet): { grid: string[][]; lineNumbers: number[] } {
  const grid: string[][] = [];
  const lineNumbers: number[] = [];

  ws.eachRow({ includeEmpty: false }, (row, rowNo) => {
    const cells: string[] = [];
    // includeEmpty เพื่อไม่ให้ช่องว่างกลางแถวทำให้คอลัมน์หลังจากนั้นเลื่อน
    row.eachCell({ includeEmpty: true }, (cell, colNo) => {
      cells[colNo - 1] = cellText(cell.value).trim();
    });
    for (let i = 0; i < cells.length; i += 1) if (cells[i] === undefined) cells[i] = '';

    // แถวที่ไม่มีค่าอะไรเลยข้ามไป ไม่งั้นจะกลายเป็นแถวเปล่าให้ต้องกรองทีหลังอีกรอบ
    if (!cells.some((c) => c)) return;
    grid.push(cells);
    lineNumbers.push(rowNo);
  });

  return { grid, lineNumbers };
}

/**
 * อ่านไฟล์ Excel เป็นแถวตามหัวคอลัมน์มาตรฐาน
 *
 * รับ bytes เพราะไฟล์มาจาก FormData ของหน้าเว็บ ไม่ได้อยู่บนดิสก์
 */
export async function readXlsx(
  bytes: ArrayBuffer,
): Promise<{ rows: SheetRow[]; hasHeader: boolean }> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(bytes);
  } catch {
    throw new Error('เปิดไฟล์ Excel ไม่ได้ — ไฟล์อาจเสียหรือมีรหัสผ่าน');
  }

  const ws = wb.worksheets[0];
  if (!ws) throw new Error('ไม่พบชีตในไฟล์ Excel');

  const { grid, lineNumbers } = sheetGrid(ws);
  // เลขแถวจริงใน Excel ให้ตรงกับที่ผู้ใช้เห็น จะได้ไล่หาแถวที่มีปัญหาถูก
  return rowsFromGrid(grid, (i) => lineNumbers[i] ?? i + 1);
}
