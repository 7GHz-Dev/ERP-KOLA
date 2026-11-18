/**
 * Final Invoice รูปแบบ JAN TRADING — จัดหน้า invoice ของผู้ขายใหม่ให้พร้อมพิมพ์ (ตามไฟล์ตัวอย่าง "JAN TRADING Final Invoice")
 *
 *   B/L NO          ใส่เลข BL ของงาน (ผู้ขายมักเว้นว่าง) — ช่องที่ขึ้นต้นด้วย "B/L NO" ในหัวใบ
 *   รถแต่ละคัน      เหลือ 4 แถว: USED ยี่ห้อ / CHASSIS NO. / ENGINE NO. / REG YEAR
 *                   ตัดแถว COLOR และแถวเลขอ้างอิงใต้ COLOR ("3831023452100213 / 20-12-2026") ออก
 *                   ช่อง A B E F G (น้ำหนัก · รหัส · จำนวน · ราคา) ผสานแนวตั้งตามจำนวนแถวที่เหลือ
 *   ENGINE NO.      แทนด้วยเลขเครื่องที่ระบบออก เช่น LDA-1585235(GASOLINE/1330) (ดู engine-format.ts)
 *   ค่าใช้จ่ายอื่น   ตัดแถว Forwarding / Other Charges / (JPY … PER CONTAINER) / แถวว่างคั่น ก่อน TOTAL ออก
 *                   และข้อความ FREIGHT CHARGES กับยอดในแถว TOTAL
 *   ยอด TOTAL       ราคารถรวม (ค่าใช้จ่ายที่ตัดออกไม่อยู่ในยอดแล้ว) — น้ำหนักกับจำนวนคันคงตามเดิม
 *
 * แก้ XML ตรง ๆ แบบเดียวกับ write.ts — รูปแบบช่อง โลโก้ ความสูงแถว ชีตอื่น ไม่ถูกแตะ
 * ช่องทางขวาของคอลัมน์ G (สูตรช่วยของไฟล์ imp3_ เดิม) ลบทิ้ง เพราะอ้างแถวเดิมที่ถูกย้ายแล้ว
 * ตารางสรุป P:AG เขียนใหม่ทีหลังด้วย writeSummary() ตามปกติ
 */
import JSZip from 'jszip';
import { firstSheetPath } from '@/lib/draft/excel-patch';
import { colIndex, colLetters } from '@/lib/draft/sheet';
import { dropCalcChain } from './write';

/** คอลัมน์สุดท้ายของหน้า invoice (G) — ทางขวาเป็นตารางช่วย/ตารางสรุป */
const LAST_COL = 7;

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xmlUnescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
const CELL = /<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g;
const ROW = /<row\b[^>]*?(?:\/>|>[\s\S]*?<\/row>)/g;
const CONTAINER = /^[A-Z]{4}\d{7}$/;
/** ป้ายในคอลัมน์ C เทียบแบบไม่สนช่องว่าง จุด โคลอน */
const label = (s: string) => s.toUpperCase().replace(/[\s.:]/g, '');

type Cell = { col: number; xml: string };
type Row = { n: number; head: string; cells: Cell[] };

export type JanFinal = {
  /** เลข BL ของงาน */
  blNo: string;
  /** ข้อความช่อง ENGINE NO. ของรถแต่ละคัน ตามลำดับในใบ */
  engines: string[];
  /** ราคารถรวม — ยอดใหม่ของแถว TOTAL */
  total: number;
};

function sharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    xmlUnescape([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
}

function cellText(xml: string, strings: string[]): string {
  const open = /^<c\b[^>]*>/.exec(xml)?.[0] ?? xml;
  const t = attr(open, 't');
  if (t === 'inlineStr') return xmlUnescape([...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
  const v = /<v>([\s\S]*?)<\/v>/.exec(xml)?.[1];
  if (v === undefined) return '';
  return t === 's' ? strings[Number(v)] ?? '' : xmlUnescape(v);
}

/** ช่องเดิมเปลี่ยนค่า (ข้อความหรือตัวเลข) คงรูปแบบ (s) ไว้ */
function withText(xml: string, ref: string, value: string | number): string {
  const style = attr(/^<c\b[^>]*>/.exec(xml)?.[0] ?? xml, 's');
  const s = style ? ` s="${style}"` : '';
  if (typeof value === 'number') return `<c r="${ref}"${s}><v>${value}</v></c>`;
  return value ? `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>` : `<c r="${ref}"${s}/>`;
}

/** ย้ายช่องไปแถวใหม่ — ตัดสูตรทิ้งเหลือค่าที่คำนวณไว้ (สูตรอ้างแถวเดิมที่ไม่อยู่แล้ว) */
function moveCell(xml: string, col: number, row: number): string {
  const ref = `${colLetters(col)}${row}`;
  const out = xml.replace(/^<c\b[^>]*?\br="[A-Z]+\d+"/, (m) => m.replace(/\br="[A-Z]+\d+"/, `r="${ref}"`))
    .replace(/<f\b[^>]*\/>|<f\b[^>]*>[\s\S]*?<\/f>/g, '');
  // ช่องสูตรที่ไม่มีค่าค้างไว้ กลายเป็นช่องว่างที่มีแต่รูปแบบ
  return /<c\b[^>]*>\s*<\/c>$/.test(out) ? out.replace(/>\s*<\/c>$/, '/>') : out;
}

const splitRef = (ref: string) => {
  const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref);
  return m ? { col: colIndex(m[1]), row: Number(m[2]) } : null;
};

/** ตำแหน่งไฟล์ที่ rels ของชีตชี้ไป (Target แบบ "../drawings/drawing1.xml") */
function resolveFrom(base: string, target: string) {
  if (target.startsWith('/')) return target.slice(1);
  const out = base.split('/').slice(0, -1);
  for (const p of target.split('/')) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); }
  return out.join('/');
}

export async function finalizeJanTrading(data: Buffer | Uint8Array, final: JanFinal): Promise<Buffer> {
  const zip = await JSZip.loadAsync(data);
  const sheetPath = await firstSheetPath(zip);
  let xml = await zip.file(sheetPath)!.async('string');
  const strings = sharedStrings(await zip.file('xl/sharedStrings.xml')?.async('string') ?? null);

  const start = xml.indexOf('<sheetData>');
  const end = xml.indexOf('</sheetData>');
  if (start < 0 || end < 0) throw new Error('ไฟล์ Excel ไม่มีส่วนข้อมูลของชีต');
  const rows: Row[] = [...xml.slice(start + '<sheetData>'.length, end).matchAll(ROW)].map((m) => {
    const head = /^<row\b[^>]*?>|^<row\b[^>]*\/>/.exec(m[0])![0];
    const cells = head.endsWith('/>') ? [] : [...m[0].matchAll(CELL)].map((c) => ({
      col: splitRef(attr(c[0], 'r')!)!.col, xml: c[0],
    }));
    return { n: Number(attr(head, 'r')), head, cells };
  });
  const byN = new Map(rows.map((r) => [r.n, r]));
  const text = (n: number, col: number) => {
    const c = byN.get(n)?.cells.find((x) => x.col === col);
    return c ? cellText(c.xml, strings).trim() : '';
  };

  /* ---------- หาโครงของใบ ---------- */
  const header = rows.find((r) => label(text(r.n, 1)) === 'WEIGHT' && label(text(r.n, 2)) === 'ITEM')?.n;
  if (!header) throw new Error('ไม่พบหัวตาราง WEIGHT / ITEM ในชีตแรก — ไม่ใช่รูปแบบ JAN TRADING');
  const total = rows.find((r) => r.n > header && [1, 2].some((c) => label(text(r.n, c)) === 'TOTAL'))?.n;
  if (!total) throw new Error('ไม่พบแถว TOTAL ในใบ');
  const isBox = (n: number) => CONTAINER.test(text(n, 1).replace(/[\s-]/g, '').toUpperCase()) && !text(n, 3);
  // เหมือน parse.ts: แถวเริ่มรถต้องมีน้ำหนัก (A) หรือรหัสรายการ (B) — "NO MARK | USED CARS & TRUCKS" ใต้หัวตารางไม่ใช่รถ
  const isCarStart = (n: number) => /^USED\s/i.test(text(n, 3))
    && (/^\d[\d,.]*\s*(KGS?)?$/i.test(text(n, 1)) || Boolean(text(n, 2)));
  const firstBody = rows.find((r) => r.n > header && r.n < total && (isBox(r.n) || isCarStart(r.n)))?.n;
  if (!firstBody) throw new Error('ไม่พบรายการรถในใบ');

  /* ---------- เลือกแถวที่เก็บ ---------- */
  type Block = { from: number; rows: number[] };        // ก้อนรถ: แถวแรกเดิม + แถวเดิมที่เก็บ
  const keep: number[] = [];                             // แถวเดิมในส่วนรายการรถที่เก็บ ตามลำดับ
  const blocks: Block[] = [];
  const engineRows: number[] = [];
  let block: Block | null = null;
  for (let n = firstBody; n < total; n++) {
    if (isBox(n)) { block = null; keep.push(n); continue; }
    if (isCarStart(n)) { block = { from: n, rows: [n] }; blocks.push(block); keep.push(n); continue; }
    const lab = label(text(n, 3));
    if (block && /^(CHASSIS|ENGINE|REGYEAR|YEAR$)/.test(lab)) {
      block.rows.push(n);
      keep.push(n);
      if (lab.startsWith('ENGINE')) engineRows.push(n);
      continue;
    }
    // COLOR · เลขอ้างอิงใต้ COLOR · ค่าใช้จ่ายอื่น · แถวว่างคั่น — ไม่เก็บ
    // แถวที่ไม่ใช่รายละเอียดรถ (ว่าง/ค่าใช้จ่าย) ปิดก้อนรถ — แถวที่ตามมาไม่นับเป็นของคันนี้
    if (!/^COLOU?R/.test(lab) && !/^\d{6,}/.test(text(n, 3))) block = null;
  }
  if (blocks.length !== final.engines.length) {
    throw new Error(`จำนวนรถในหน้า invoice (${blocks.length}) ไม่ตรงกับที่อ่านได้ (${final.engines.length})`);
  }
  if (engineRows.length !== blocks.length) throw new Error('รถบางคันไม่มีแถว ENGINE NO.');

  /* ---------- เลขแถวใหม่ ---------- */
  const newRow = new Map<number, number>();
  for (const r of rows) if (r.n < firstBody) newRow.set(r.n, r.n);
  keep.forEach((n, i) => newRow.set(n, firstBody + i));
  const shift = total - (firstBody + keep.length);
  const lastRow = Math.max(...rows.map((r) => r.n));
  for (const r of rows) if (r.n >= total) newRow.set(r.n, r.n - shift);
  /** แถวเดิมใด ๆ (รวมแถวที่ถูกตัด) → แถวใหม่ — ใช้กับตำแหน่งรูปและขอบเขตการพิมพ์ */
  const mapAny = (n: number) => {
    if (n < firstBody) return n;
    if (n >= total) return n - shift;
    const before = keep.filter((k) => k <= n);
    return before.length ? newRow.get(before[before.length - 1])! : firstBody;
  };

  /* ---------- ค่าที่เปลี่ยน ---------- */
  const edits = new Map<number, Map<number, string | number>>();   // แถวเดิม → คอลัมน์ → ค่าใหม่
  const edit = (n: number, col: number, value: string | number) => {
    if (!edits.has(n)) edits.set(n, new Map());
    edits.get(n)!.set(col, value);
  };
  engineRows.forEach((n, i) => edit(n, 4, final.engines[i]));
  // B/L NO ในหัวใบ — ป้ายกับเลขอยู่ช่องเดียวกัน ("B/L NO EGLV022600105272")
  const blCell = rows.filter((r) => r.n < header).flatMap((r) => r.cells.filter((c) => c.col <= LAST_COL)
    .map((c) => ({ n: r.n, col: c.col, t: cellText(c.xml, strings) })))
    .find((c) => /^B\/L\s*NO/i.test(c.t.trim()));
  if (!blCell) throw new Error('ไม่พบช่อง B/L NO ในหัวใบ');
  edit(blCell.n, blCell.col, `B/L NO ${final.blNo}`);
  // แถว TOTAL: เหลือแค่คำว่า TOTAL — ตัดข้อความ FREIGHT CHARGES และยอดค่าเฟรท
  for (let col = 3; col <= LAST_COL; col++) edit(total, col, '');
  // ยอดเงินรวมอยู่แถวถัดไปคอลัมน์ G — เขียนแบบเดียวกับที่ใบเขียน: ข้อความ "¥4,150,500" หรือตัวเลข
  const amountText = text(total + 1, 7);
  const amount = final.total.toLocaleString('en-US');
  edit(total + 1, 7, /^[¥￥]/.test(amountText) ? `¥${amount}` : /^JPY/i.test(amountText) ? `JPY ${amount}` : final.total);

  /* ---------- เขียนแถวใหม่ ---------- */
  const out: string[] = [];
  for (const r of rows) {
    const to = newRow.get(r.n);
    if (to === undefined) continue;
    let head = r.head.replace(/\s+spans="[^"]*"/, '').replace(/\br="\d+"/, `r="${to}"`);
    const cells = r.cells.filter((c) => c.col <= LAST_COL).map((c) => {
      const moved = moveCell(c.xml, c.col, to);
      const value = edits.get(r.n)?.get(c.col);
      return value === undefined ? moved : withText(moved, `${colLetters(c.col)}${to}`, value);
    });
    // ช่องที่ต้องเขียนแต่ยังไม่มีในแถว (ไม่ค่อยเกิด — ใบผู้ขายมีช่องครบทุกคอลัมน์)
    for (const [col, value] of edits.get(r.n) ?? []) {
      if (value !== '' && !r.cells.some((c) => c.col === col)) cells.push(withText('<c/>', `${colLetters(col)}${to}`, value));
    }
    cells.sort((a, b) => splitRef(attr(a, 'r')!)!.col - splitRef(attr(b, 'r')!)!.col);
    if (head.endsWith('/>')) {
      if (!cells.length) { out.push(head); continue; }
      head = head.slice(0, -2) + '>';
    }
    out.push(`${head}${cells.join('')}</row>`);
  }
  xml = xml.slice(0, start) + '<sheetData>' + out.join('') + xml.slice(end);

  /* ---------- ช่องผสาน ---------- */
  const oldMerges = [...xml.matchAll(/<mergeCell\b[^>]*\bref="([^"]+)"[^>]*\/>/g)].map((m) => {
    const [a, b] = m[1].split(':').map(splitRef);
    return { a: a!, b: b ?? a! };
  }).filter((m) => m.a && m.b);
  const merges: string[] = [];
  for (const { a, b } of oldMerges) {
    if (a.col > LAST_COL) continue;
    const top = Math.min(a.row, b.row); const bottom = Math.max(a.row, b.row);
    const left = Math.min(a.col, b.col); const right = Math.max(a.col, b.col);
    const inBody = bottom >= firstBody && top < total;
    if (inBody) {
      // ผสานแนวนอนในแถวเดียวที่ยังอยู่ — คงไว้ที่แถวใหม่ ส่วนแนวตั้งของก้อนรถสร้างใหม่ด้านล่าง
      if (top === bottom && newRow.has(top)) merges.push(`${colLetters(left)}${newRow.get(top)}:${colLetters(right)}${newRow.get(top)}`);
      continue;
    }
    if (!newRow.has(top) || !newRow.has(bottom)) continue;
    merges.push(`${colLetters(left)}${newRow.get(top)}:${colLetters(right)}${newRow.get(bottom)}`);
  }
  // ก้อนรถ: คอลัมน์ที่ใบเดิมผสานแนวตั้งจากแถวแรกของคันนั้น ผสานใหม่ตามจำนวนแถวที่เหลือ
  for (const blk of blocks) {
    const first = newRow.get(blk.from)!;
    const last = first + blk.rows.length - 1;
    const cols = oldMerges.filter(({ a, b }) => Math.min(a.row, b.row) === blk.from && a.row !== b.row && a.col === b.col && a.col <= LAST_COL)
      .map(({ a }) => a.col);
    if (last > first) for (const col of new Set(cols)) merges.push(`${colLetters(col)}${first}:${colLetters(col)}${last}`);
  }
  xml = xml.replace(/<mergeCells\b[^>]*>[\s\S]*?<\/mergeCells>|<mergeCells\b[^>]*\/>/,
    merges.length ? `<mergeCells count="${merges.length}">${merges.map((r) => `<mergeCell ref="${r}"/>`).join('')}</mergeCells>` : '');

  /* ---------- ส่วนอื่นของชีต ---------- */
  const newLast = mapAny(lastRow);
  xml = xml.replace(/<dimension\b[^>]*\/>/, `<dimension ref="A1:${colLetters(LAST_COL)}${newLast}"/>`);
  // จุดแบ่งหน้าเดิมอ้างแถวที่ย้ายแล้ว — ตัดทิ้ง ตัวแปลง PDF แบ่งหน้าเองโดยไม่ตัดกลางก้อนรถ
  xml = xml.replace(/<rowBreaks\b[^>]*>[\s\S]*?<\/rowBreaks>|<rowBreaks\b[^>]*\/>/, '');
  // ช่องที่เลือกค้างไว้อาจอยู่ในแถวที่ถูกตัด — เลือก A1 แทน
  xml = xml.replace(/<selection\b[^>]*\/>/g, '<selection activeCell="A1" sqref="A1"/>');
  zip.file(sheetPath, xml);

  // ขอบเขตการพิมพ์ของชีตแรก
  const wbPath = 'xl/workbook.xml';
  const wb = await zip.file(wbPath)!.async('string');
  zip.file(wbPath, wb.replace(/(<definedName\b([^>]*)>)([^<]*)(<\/definedName>)/g, (all, open: string, attrs: string, value: string, close: string) => {
    if (attr(attrs, 'name') !== '_xlnm.Print_Area' || attr(attrs, 'localSheetId') !== '0') return all;
    // "buyers_invoice!$A$1:$G$137" — แก้เฉพาะเลขแถวหลังชื่อชีต
    const cut = value.lastIndexOf('!') + 1;
    const refs = value.slice(cut).replace(/(\$?[A-Z]{1,3}\$?)(\d+)/g, (_s, col: string, row: string) => `${col}${mapAny(Number(row))}`);
    return `${open}${value.slice(0, cut)}${refs}${close}`;
  }));

  // รูปที่ปักไว้ในแถวที่ย้าย (เช่นตราประทับท้ายใบ) — เลื่อนตามแถว
  const relsPath = sheetPath.replace(/([^/]+)$/, '_rels/$1.rels');
  const rels = await zip.file(relsPath)?.async('string');
  for (const m of rels?.matchAll(/<Relationship\b[^>]*>/g) ?? []) {
    if (!/\/drawing"?$/.test(attr(m[0], 'Type') ?? '')) continue;
    const path = resolveFrom(sheetPath, attr(m[0], 'Target') ?? '');
    const drawing = await zip.file(path)?.async('string');
    if (!drawing) continue;
    zip.file(path, drawing.replace(/(<xdr:(?:from|to)>[\s\S]*?<xdr:row>)(\d+)(<\/xdr:row>)/g,
      (_s, a: string, r: string, b: string) => `${a}${mapAny(Number(r) + 1) - 1}${b}`));
  }

  await dropCalcChain(zip);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
