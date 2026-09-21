/**
 * นำเข้า Shipment Detail จากไฟล์ตารางงานที่ทีมใช้กันอยู่
 *
 * เป็นทางเลือกแทนการอัปไฟล์ AN/BL ทีละใบ — งานเก่าที่คีย์ไว้ในตาราง Excel แล้ว
 * ยกเข้าระบบได้ทั้งแผ่นโดยไม่ต้องหาไฟล์ PDF มาอัปย้อนหลังทีละงาน
 * ไฟล์ AN/BL ตามมาทีหลังได้ที่หน้า "แนบไฟล์ AN/BL เข้างาน" ซึ่งจับคู่ด้วยเลข BL ให้เอง
 *
 * หัวคอลัมน์ใช้ชุดเดียวกับไฟล์ที่ระบบ export ออกไป (TEMPLATE_COLUMNS)
 * เพราะไฟล์ที่ผู้ใช้เอามานำเข้าคือไฟล์เดียวกับที่ดึงออกไปทำงานต่อ
 * วนกลับเข้ามาได้โดยไม่ต้องจัดคอลัมน์ใหม่
 *
 * ทั้งไฟล์นี้เป็นฟังก์ชันล้วน ไม่แตะฐานข้อมูลและไม่แตะ DOM
 * เพื่อให้ทดสอบการอ่านไฟล์ได้โดยไม่ต้องมีฐานข้อมูล และเรียกได้ทั้งสองฝั่ง
 */

import { TEMPLATE_COLUMNS } from './template-columns';

/* ---------------- อ่านไฟล์ให้เป็นตาราง ---------------- */

/**
 * ถอดรหัสไฟล์ CSV ให้ได้ภาษาไทยที่ถูกต้อง ไม่ว่าจะบันทึกมาแบบไหน
 *
 * Excel บน Windows ภาษาไทยบันทึก CSV เป็น Windows-874 ไม่ใช่ UTF-8
 * ถ้าอ่านเป็น UTF-8 ตรง ๆ ภาษาไทยจะกลายเป็นตัวยึกยือแล้วเข้าฐานข้อมูลไปทั้งอย่างนั้น
 * ซึ่งกู้คืนทีหลังยากกว่าดักตั้งแต่ตอนอ่าน — วิธีเดียวกับ scripts/import-jobs.ts
 *
 * ดูจากไบต์จริงว่าเป็น UTF-8 ที่ถูกต้องไหม ไม่เดาจากนามสกุลเพราะใช้ .csv เหมือนกันทั้งคู่
 */
export function decodeCsv(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  const utf8 = new TextDecoder('utf-8').decode(bytes);
  // U+FFFD คือตัวแทนไบต์ที่ถอดเป็น UTF-8 ไม่ได้ มีแปลว่าไฟล์ไม่ใช่ UTF-8
  if (!utf8.includes('�')) return utf8;
  return new TextDecoder('windows-874').decode(bytes);
}

/** แยกบรรทัด CSV หนึ่งบรรทัดเป็นช่อง โดยนับเครื่องหมายคำพูดตามมาตรฐาน */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * ตัดข้อความ CSV เป็นแถว โดยยอมให้ค่าที่อยู่ในเครื่องหมายคำพูดมีการขึ้นบรรทัดใหม่ได้
 *
 * ช่อง REMARK ของไฟล์จริงมีข้อความหลายบรรทัดอยู่บ่อย ถ้าตัดด้วย split('\n') ตรง ๆ
 * แถวนั้นจะขาดครึ่งแล้วคอลัมน์หลังจากนั้นเลื่อนหมด ซึ่งดูจากผลลัพธ์ไม่ออกว่าเพี้ยนตรงไหน
 */
function csvLines(content: string): string[] {
  const lines: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < content.length; i += 1) {
    const c = content[i];
    if (c === '"') { quoted = !quoted; cur += c; continue; }
    if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && content[i + 1] === '\n') i += 1;
      lines.push(cur);
      cur = '';
      continue;
    }
    cur += c;
  }
  lines.push(cur);
  return lines.filter((l) => l.trim());
}

const COLUMNS = TEMPLATE_COLUMNS as readonly string[];

/** ชื่อคอลัมน์ให้เทียบกันแบบไม่สนช่องว่าง จุด หรือตัวพิมพ์ */
const normHeader = (v: string) => v.trim().toUpperCase().replace(/[\s.]/g, '');

/**
 * แถวของไฟล์ ปรับให้เป็นรูปเดียวกันแล้ว
 *
 * `lineNo` คือเลขบรรทัดในไฟล์จริง ใช้บอกผู้ใช้ว่าแถวไหนมีปัญหา
 * ไม่ใช่ลำดับหลังกรองแล้ว ซึ่งจะนับไม่ตรงกับที่เห็นใน Excel
 */
export type SheetRow = { lineNo: number; cell: Record<string, string> };

/**
 * จัดตารางดิบให้เป็นแถวตามหัวคอลัมน์มาตรฐาน
 *
 * `grid` คือช่องทั้งหมดเรียงตามแถวและคอลัมน์ ซึ่งได้มาจากทั้ง CSV และ Excel
 * กฎการจับคอลัมน์จึงเป็นชุดเดียวกัน ไม่ว่าผู้ใช้จะส่งไฟล์แบบไหนมา
 * ถ้าแยกกันเขียนสองที่ จะมีวันที่แก้กฎที่หนึ่งแล้วลืมอีกที่ แล้วผลต่างกันเงียบ ๆ
 *
 * รับสองแบบที่ผู้ใช้ส่งมาจริง
 *   1. มีหัวคอลัมน์ — จับคู่ตามชื่อ สลับลำดับคอลัมน์ได้
 *   2. ไม่มีหัวคอลัมน์ — เรียงตามตำแหน่งของ TEMPLATE_COLUMNS
 *
 * แบบที่สองมีคอลัมน์ลำดับแถวนำหน้าอยู่ด้วย (1834, 1835, …) ซึ่งเป็นเลขที่ Excel
 * ใส่ไว้เอง ไม่ใช่ข้อมูลของงาน ตรวจจากจำนวนช่องว่าเกินมาหนึ่งแล้วตัดทิ้ง
 * ไม่ได้ดูว่าเป็นตัวเลขไหม เพราะช่อง CUSTOMER ก็เป็นตัวเลขได้เหมือนกัน
 *
 * `lineAt` แปลงลำดับแถวในตารางเป็นเลขบรรทัดที่ผู้ใช้เห็นในโปรแกรมของตัวเอง
 * CSV กับ Excel นับไม่เหมือนกันเมื่อมีแถวว่างคั่น จึงให้ผู้เรียกบอกมา
 */
export function rowsFromGrid(
  grid: string[][],
  lineAt: (index: number) => number = (i) => i + 1,
): { rows: SheetRow[]; hasHeader: boolean } {
  if (!grid.length) return { rows: [], hasHeader: false };

  const wanted = COLUMNS.map(normHeader);
  const firstCells = grid[0].map(normHeader);
  // ถือว่ามีหัวคอลัมน์เมื่อบรรทัดแรกมีชื่อที่รู้จักอย่างน้อยครึ่งหนึ่ง
  const known = firstCells.filter((c) => wanted.includes(c)).length;
  const hasHeader = known >= Math.ceil(wanted.length / 2);

  if (hasHeader) {
    const head = grid[0].map((h) => h.trim());
    // หาตำแหน่งของแต่ละคอลัมน์ครั้งเดียว ไม่ต้องค้นซ้ำทุกแถว
    const at = new Map(COLUMNS.map((col) => [
      col, head.findIndex((h) => normHeader(h) === normHeader(col)),
    ]));
    const rows = grid.slice(1).map((cells, i) => {
      const cell: Record<string, string> = {};
      for (const col of COLUMNS) {
        const n = at.get(col)!;
        cell[col] = n >= 0 ? (cells[n] ?? '').trim() : '';
      }
      return { lineNo: lineAt(i + 1), cell };
    });
    return { rows, hasHeader };
  }

  const rows = grid.map((cells, i) => {
    // เลขลำดับแถวที่ Excel ใส่ไว้หน้าสุด ตัดออกก่อนจับคู่คอลัมน์
    const body = cells.length > COLUMNS.length ? cells.slice(1) : cells;
    const cell: Record<string, string> = {};
    COLUMNS.forEach((col, n) => { cell[col] = (body[n] ?? '').trim(); });
    return { lineNo: lineAt(i), cell };
  });
  return { rows, hasHeader };
}

/** อ่านไฟล์ CSV เป็นแถว — ตัดข้อความเป็นตารางแล้วส่งต่อให้ rowsFromGrid() */
export function readSheet(content: string): { rows: SheetRow[]; hasHeader: boolean } {
  const grid = csvLines(content).map(splitCsvLine);
  return rowsFromGrid(grid);
}

/* ---------------- แปลงค่าในช่อง ---------------- */

/**
 * วันที่ในไฟล์เขียนแบบ d/m/yy ตามที่ทีมใช้ — คืน YYYY-MM-DD
 *
 * ยึด d/m/y ตามที่คนไทยเขียน ไม่ใช่ m/d/y แบบอเมริกัน
 * ปีสองหลักตีเป็น 20xx เพราะงานนำเข้าไม่มีย้อนไปศตวรรษก่อน
 * ปี พ.ศ. ที่หลุดมาแปลงกลับเป็น ค.ศ. ให้
 */
export function sheetDate(raw: string): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  if (year > 2400) year -= 543;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** ตัวเลขในไฟล์มีลูกน้ำคั่นหลักพัน เช่น 17,145 */
export function sheetNumber(raw: string): string | null {
  const s = (raw ?? '').trim();
  if (!s || s === '-') return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? String(n) : null;
}

const int = (raw: string, fallback = 0): number => {
  const n = Number((raw ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

/**
 * แยกชื่อเรือกับเที่ยวเรือออกจากช่อง VESSEL
 *
 * ไฟล์เขียนรวมกันเป็น "BANGKOK BRIDGE V.0518W" ตามแบบฟอร์มที่ export ออกไป
 * ตัวคั่นคือ " V." ซึ่งตรงกับที่ templateRows() ประกอบเข้าด้วยกัน
 * ไม่มีตัวคั่นก็ถือว่าทั้งช่องเป็นชื่อเรือ ไม่เดาว่าคำท้ายคือเที่ยวเรือ
 */
export function splitVessel(raw: string): { vessel: string; voyage: string } {
  const s = (raw ?? '').trim();
  const m = /^(.*?)\s+V\.\s*(\S+)$/i.exec(s);
  if (m) return { vessel: m[1].trim(), voyage: m[2].trim() };
  return { vessel: s, voyage: '' };
}

/**
 * เลขตู้ในช่องเดียวคั่นด้วยลูกน้ำ — ไฟล์เป็นหนึ่งแถวต่อหนึ่งงาน ไม่ใช่ต่อหนึ่งตู้
 *
 * ตัดช่องว่างที่แทรกกลางเลขตู้ออกด้วย เพราะเลขตู้ไม่มีช่องว่างในตัวเอง
 * แต่ไฟล์ที่ผ่านการแก้มือมักมี "ONEU 5972378" ปนมา
 */
export function splitContainers(raw: string): string[] {
  return (raw ?? '')
    .split(/[,;\n]/)
    .map((v) => v.replace(/\s+/g, '').toUpperCase())
    .filter(Boolean);
}

/**
 * เลข BL ในไฟล์มีได้สองเลข เช่น "KG1222026-70107(ONEYTYOGF5133300)"
 *
 * เลขหน้าเป็นเลข BL ของตัวแทน ส่วนในวงเล็บเป็นเลข Waybill ของสายเรือ
 * ซึ่งเป็นเลขที่พิมพ์อยู่บนไฟล์ AN/BL จริง เก็บทั้งก้อนเป็น BL No. ตามที่ทีมใช้
 * แต่แยกเลขในวงเล็บไว้ต่างหากเพื่อใช้จับคู่ตอนอัปไฟล์ AN/BL เข้ามาทีหลัง
 * ไม่งั้นไฟล์ของ ONE ที่มีแต่เลข Waybill จะจับคู่กับงานไม่ได้เลย
 */
export function splitBlNo(raw: string): { blNo: string; waybillNo: string } {
  const blNo = (raw ?? '').trim();
  const m = /\(([^)]+)\)/.exec(blNo);
  return { blNo, waybillNo: m ? m[1].replace(/\s+/g, '').toUpperCase() : '' };
}

/* ---------------- แถวที่แปลงแล้ว ---------------- */

/** ค่าที่จะเขียนลงระบบ พร้อมชื่อ Master ที่ยังไม่ได้แปลงเป็น id */
export type ShipmentDraft = {
  lineNo: number;
  blNo: string;
  waybillNo: string;
  vessel: string;
  voyage: string;
  eta: string | null;
  transportDate: string | null;
  shipline: string;
  containers: string[];
  unitAmount: string | null;
  grossWeight: string | null;
  demDays: number;
  detDays: number;
  draftRefNo: string;
  customerNote: string;
  /** ชื่อจากไฟล์ รอจับกับ Master Data ฝั่งเซิร์ฟเวอร์ */
  names: {
    shipper: string; consignee: string; notify: string;
    person: string; terminal: string; jobType: string;
  };
};

/**
 * แปลงแถวในไฟล์เป็นค่าที่ระบบใช้ พร้อมรายการที่อ่านไม่ออก
 *
 * แถวที่ไม่มีทั้งเลข BL และชื่อเรือถือว่าเป็นบรรทัดว่างหรือบรรทัดรวมยอดท้ายตาราง
 * ข้ามไปเงียบ ๆ ไม่นับเป็นปัญหา เพราะไฟล์จริงมักมีบรรทัดพวกนี้ติดมาด้วย
 */
export function toDrafts(rows: SheetRow[]): { drafts: ShipmentDraft[]; skipped: number } {
  const drafts: ShipmentDraft[] = [];
  let skipped = 0;

  for (const { lineNo, cell } of rows) {
    const { blNo, waybillNo } = splitBlNo(cell['BILL OF LADING']);
    const { vessel, voyage } = splitVessel(cell.VESSEL);
    if (!blNo && !vessel) { skipped += 1; continue; }

    drafts.push({
      lineNo,
      blNo,
      waybillNo,
      vessel,
      voyage,
      eta: sheetDate(cell.ETA),
      transportDate: sheetDate(cell.TRANSPORT),
      shipline: cell.SHIPLINE ?? '',
      containers: splitContainers(cell['CONTAINER NO.']),
      unitAmount: sheetNumber(cell.UNIT),
      grossWeight: sheetNumber(cell.WEIGHT),
      demDays: int(cell.DEM),
      detDays: int(cell.DET),
      draftRefNo: cell.REF ?? '',
      customerNote: cell.REMARK ?? '',
      names: {
        shipper: cell.SHIPPER ?? '',
        consignee: cell.CONSIGNEE ?? '',
        notify: cell.NOTIFY ?? '',
        person: cell.CUSTOMER ?? '',
        terminal: cell.PORT ?? '',
        jobType: cell['ประเภท'] ?? '',
      },
    });
  }

  return { drafts, skipped };
}

/**
 * เลข BL ที่เอาไว้เทียบกัน — ตัดอักขระที่ไม่ใช่ตัวอักษรหรือตัวเลขออก
 *
 * เลขเดียวกันเขียนไม่เหมือนกันในแต่ละที่ เช่น "KG1222026-70107" กับ "KG1222026 70107"
 * และไฟล์ PDF ที่อ่านด้วย pdf.js มักมีช่องว่างแทรกกลางเลข
 */
export const blKey = (v: string) => (v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
