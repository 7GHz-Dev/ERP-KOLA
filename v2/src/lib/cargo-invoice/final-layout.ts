/**
 * จัดหน้า Final Invoice ให้พร้อมพิมพ์ — JAN TRADING และ AICHI (ตามไฟล์ตัวอย่าง "… Final Invoice" ใน test/INVOICE)
 *
 *   ทั้งสองรูปแบบ
 *     B/L NO        ใส่เลข BL ของงานต่อท้ายป้าย ("B/L NO EGLV…" · "B/L NO. OOLU…")
 *     เลขเครื่อง     แทนด้วยเลขที่ระบบออก เช่น LDA-1585235(GASOLINE/1330) (ดู engine-format.ts)
 *     แถวรถ         WEIGHT · ITEM · QUANTITY · UNIT PRICE · AMOUNT อยู่บรรทัดแรกของคัน (เลิกผสานแนวตั้ง)
 *     เส้นตาราง      เส้นบาง (thin) เหนือแต่ละคัน · เส้นหนา (medium) เหนือแต่ละตู้
 *     ยอดรวม        แถวใต้ TOTAL: น้ำหนักรวม · จำนวนคัน · ราคารวม ของทั้ง BL
 *
 *   JAN TRADING (ชีตเดียว)
 *     รถคันละ 4 แถว: USED ยี่ห้อ / CHASSIS NO. / ENGINE NO. / REG YEAR — ตัดแถว COLOR และเลขอ้างอิงใต้ COLOR
 *     ตัดแถว Forwarding / Other Charges / (JPY … PER CONTAINER) / แถวว่างคั่น และ FREIGHT CHARGES ในแถว TOTAL
 *
 *   AICHI (ตู้ละชีต)
 *     ต่อรายการของทุกชีตเป็นชีตเดียว ตามลำดับชีต — หัวใบกับแถว TOTAL ใช้ของชีตแรก ชีตตู้อื่นลบออกจากไฟล์
 *     INVOICE NO. ใช้เลขรันของระบบ "AICHI 351" (คนแก้เลขได้ก่อนสร้าง)
 *     รถคันละ 6 แถวตามใบ (ENGINE NO. ว่าง · ENGINE TYPE. มีเลขเครื่อง · แถวคั่น) — คงไว้ตามเดิม
 *
 * แก้ XML ตรง ๆ แบบเดียวกับ write.ts — รูปแบบช่อง โลโก้ ความสูงแถว ไม่ถูกแตะ
 * ช่องทางขวาของคอลัมน์ G (สูตรช่วยของไฟล์ imp3_ เดิม) ลบทิ้ง เพราะอ้างแถวเดิมที่ถูกย้ายแล้ว
 * ตารางสรุป P:AG เขียนใหม่ทีหลังด้วย writeSummary() ตามปกติ
 */
import JSZip from 'jszip';
import { sheetPaths } from '@/lib/draft/excel-patch';
import { colIndex, colLetters } from '@/lib/draft/sheet';
import { dropCalcChain } from './write';
import { StyleBook } from './xlsx-styles';

/** รูปแบบที่ระบบจัดหน้า Final Invoice ให้ */
export const FINAL_LAYOUT_PATTERNS = new Set(['JAN TRADING', 'AICHI']);

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
type Merge = { top: number; bottom: number; left: number; right: number };

export type FinalLayout = {
  pattern: string;
  /** เลข BL ของงาน */
  blNo: string;
  /** ข้อความช่องเลขเครื่องของรถแต่ละคัน ตามลำดับในใบ (ทุกชีตต่อกัน) */
  engines: string[];
  /** ราคารวม · น้ำหนักรวม (KG) · จำนวนคัน ของทั้ง BL */
  total: number;
  weight: number;
  units: number;
  /** เลข Invoice ใหม่ เช่น "AICHI 351" — ไม่ส่ง = คงตามใบ */
  invoiceNo?: string;
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

const styleOf = (xml: string) => attr(/^<c\b[^>]*>/.exec(xml)?.[0] ?? xml, 's');

/** ช่องเดิมเปลี่ยนค่า (ข้อความหรือตัวเลข) คงรูปแบบ (s) ไว้ */
function withValue(xml: string, ref: string, value: string | number): string {
  const style = styleOf(xml);
  const s = style ? ` s="${style}"` : '';
  if (typeof value === 'number') return `<c r="${ref}"${s}><v>${value}</v></c>`;
  return value ? `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>` : `<c r="${ref}"${s}/>`;
}

/** ย้ายช่องไปแถวใหม่ — ตัดสูตรทิ้งเหลือค่าที่คำนวณไว้ (สูตรอ้างแถวเดิมที่ไม่อยู่แล้ว) */
function moveCell(xml: string, col: number, row: number): string {
  const ref = `${colLetters(col)}${row}`;
  const out = xml.replace(/^<c\b[^>]*?\br="[A-Z]+\d+"/, (m) => m.replace(/\br="[A-Z]+\d+"/, `r="${ref}"`))
    .replace(/<f\b[^>]*\/>|<f\b[^>]*>[\s\S]*?<\/f>/g, '');
  return /<c\b[^>]*>\s*<\/c>$/.test(out) ? out.replace(/>\s*<\/c>$/, '/>') : out;
}

const setStyle = (xml: string, style: string) => (/^<c\b[^>]*\bs="/.test(xml)
  ? xml.replace(/^(<c\b[^>]*?\bs=")\d+"/, `$1${style}"`)
  : xml.replace(/^<c\b/, `<c s="${style}"`));

const splitRef = (ref: string) => {
  const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref);
  return m ? { col: colIndex(m[1]), row: Number(m[2]) } : null;
};

/** ตำแหน่งไฟล์ที่ rels ชี้ไป (Target แบบ "../drawings/drawing1.xml") เทียบกับไฟล์ base */
function resolveFrom(base: string, target: string) {
  if (target.startsWith('/')) return target.slice(1);
  const out = base.split('/').slice(0, -1);
  for (const p of target.split('/')) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); }
  return out.join('/');
}

/* ---------------- อ่านโครงชีต ---------------- */

type Sheet = {
  name: string; path: string; xml: string; rows: Row[];
  text: (n: number, col: number) => string;
  merges: Merge[];
  header: number; total: number; firstBody: number;
};

function readSheet(name: string, path: string, xml: string, strings: string[]): Sheet | null {
  const start = xml.indexOf('<sheetData>');
  const end = xml.indexOf('</sheetData>');
  if (start < 0 || end < 0) return null;
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
  const merges = [...xml.matchAll(/<mergeCell\b[^>]*\bref="([^"]+)"[^>]*\/>/g)].flatMap((m) => {
    const [a, b0] = m[1].split(':').map(splitRef);
    const b = b0 ?? a;
    return a && b ? [{ top: Math.min(a.row, b.row), bottom: Math.max(a.row, b.row), left: Math.min(a.col, b.col), right: Math.max(a.col, b.col) }] : [];
  });
  const header = rows.find((r) => label(text(r.n, 1)) === 'WEIGHT' && label(text(r.n, 2)) === 'ITEM')?.n;
  if (!header) return null;
  const total = rows.find((r) => r.n > header && [1, 2].some((c) => label(text(r.n, c)) === 'TOTAL'))?.n ?? 0;
  const sheet: Sheet = { name, path, xml, rows, text, merges, header, total, firstBody: 0 };
  sheet.firstBody = rows.find((r) => r.n > header && (!total || r.n < total)
    && (isContainerLabel(sheet, r.n) || isBox(sheet, r.n) || isCarStart(sheet, r.n)))?.n ?? 0;
  return sheet;
}

const isBox = (s: Sheet, n: number) => CONTAINER.test(s.text(n, 1).replace(/[\s-]/g, '').toUpperCase()) && !s.text(n, 3);
/** แถวป้าย "CONTAINER NO" เหนือเลขตู้ (AICHI) */
const isContainerLabel = (s: Sheet, n: number) => label(s.text(n, 1)) === 'CONTAINERNO' && !s.text(n, 3);
// เหมือน parse.ts: แถวเริ่มรถต้องมีน้ำหนัก (A) หรือรหัสรายการ (B) — "NO MARK | USED CARS & TRUCKS" ใต้หัวตารางไม่ใช่รถ
const isCarStart = (s: Sheet, n: number) => /^USED\s/i.test(s.text(n, 3))
  && (/^\d[\d,.]*\s*(KGS?)?$/i.test(s.text(n, 1)) || Boolean(s.text(n, 2)));

/* ---------------- เลือกแถว ---------------- */

type Pick = { sheet: Sheet; n: number; kind: 'box' | 'car' | 'line' };
type Block = { sheet: Sheet; from: number; rows: number[] };

/**
 * แถวในส่วนรายการรถของชีตหนึ่งที่เก็บ
 *   JAN TRADING  แถวตู้ + แถวรถเฉพาะ USED / CHASSIS / ENGINE / REG YEAR
 *   AICHI        แถวป้ายตู้ + แถวตู้ + ทุกแถวของคัน (ถึงขอบล่างของช่องที่ผสานไว้) · last = เก็บแถวท้ายก่อน TOTAL ด้วย
 */
function pickRows(s: Sheet, pattern: string, last: boolean): { picks: Pick[]; blocks: Block[]; engineRows: number[] } {
  const picks: Pick[] = [];
  const blocks: Block[] = [];
  const engineRows: number[] = [];
  const end = s.total || Math.max(...s.rows.map((r) => r.n)) + 1;
  const starts = (n: number) => isContainerLabel(s, n) || isBox(s, n) || isCarStart(s, n);
  let block: Block | null = null;
  let blockEnd = 0;
  let lastKept = 0;
  for (let n = s.firstBody; n < end; n++) {
    if (isContainerLabel(s, n) || isBox(s, n)) { block = null; picks.push({ sheet: s, n, kind: 'box' }); lastKept = n; continue; }
    if (isCarStart(s, n)) {
      block = { sheet: s, from: n, rows: [n] };
      blocks.push(block);
      picks.push({ sheet: s, n, kind: 'car' });
      lastKept = n;
      // ขอบล่างของคัน = แถวล่างสุดของช่องที่ผสานแนวตั้งจากแถวแรกของคันนี้ (AICHI รวมแถวคั่นไว้ในช่องผสาน)
      blockEnd = Math.max(n, ...s.merges.filter((m) => m.top === n && m.bottom > n && m.left <= LAST_COL).map((m) => m.bottom));
      continue;
    }
    const lab = label(s.text(n, 3));
    const isEngine = lab.startsWith('ENGINE') && Boolean(s.text(n, 4));
    if (pattern === 'AICHI') {
      if (block && (n <= blockEnd || (lab && !starts(n)))) {
        block.rows.push(n); picks.push({ sheet: s, n, kind: 'line' }); lastKept = n;
        if (isEngine) engineRows.push(n);
        continue;
      }
      block = null;
      continue;
    }
    if (block && /^(CHASSIS|ENGINE|REGYEAR|YEAR$)/.test(lab)) {
      block.rows.push(n); picks.push({ sheet: s, n, kind: 'line' }); lastKept = n;
      if (isEngine) engineRows.push(n);
      continue;
    }
    // COLOR · เลขอ้างอิงใต้ COLOR ไม่เก็บแต่ยังอยู่ในคันเดิม · ค่าใช้จ่ายอื่น / แถวว่าง ปิดคัน
    if (!/^COLOU?R/.test(lab) && !/^\d{6,}/.test(s.text(n, 3))) block = null;
  }
  // AICHI ชีตสุดท้าย: แถวคั่นก่อน TOTAL คงไว้ (ชีตอื่นตัดทิ้ง — ตู้ถัดไปต่อท้ายเลย)
  if (pattern === 'AICHI' && last) for (let n = lastKept + 1; n < end; n++) picks.push({ sheet: s, n, kind: 'line' });
  return { picks, blocks, engineRows };
}

/* ---------------- จัดหน้า ---------------- */

export async function finalizeLayout(data: Buffer | Uint8Array, final: FinalLayout): Promise<Buffer> {
  const zip = await JSZip.loadAsync(data);
  const strings = sharedStrings(await zip.file('xl/sharedStrings.xml')?.async('string') ?? null);
  const all = await sheetPaths(zip);
  if (!all.length) throw new Error('ไม่พบชีตข้อมูลในไฟล์ Excel');
  const sheets: Sheet[] = [];
  for (const p of all) {
    const s = readSheet(p.name, p.path, await zip.file(p.path)!.async('string'), strings);
    if (s && s.firstBody) sheets.push(s);
  }
  const first = sheets[0];
  if (!first || first.path !== all[0].path) throw new Error('ไม่พบหัวตาราง WEIGHT / ITEM ในชีตแรก');
  if (!first.total) throw new Error('ไม่พบแถว TOTAL ในใบ');
  // JAN TRADING มีชีตเดียว · AICHI ต่อทุกชีตที่เป็นหน้า invoice
  const pages = final.pattern === 'AICHI' ? sheets : [first];

  const picked = pages.map((s, i) => pickRows(s, final.pattern, i === pages.length - 1));
  const picks = picked.flatMap((p) => p.picks);
  const blocks = picked.flatMap((p) => p.blocks);
  const engineRows = picked.flatMap((p) => p.engineRows.map((n) => ({ sheet: p.picks[0]?.sheet ?? first, n })));
  if (blocks.length !== final.engines.length) {
    throw new Error(`จำนวนรถในหน้า invoice (${blocks.length}) ไม่ตรงกับที่อ่านได้ (${final.engines.length})`);
  }
  if (engineRows.length !== blocks.length) throw new Error('รถบางคันไม่มีช่องเลขเครื่อง (ENGINE)');

  /* ---------- เลขแถวใหม่ ---------- */
  const key = (s: Sheet, n: number) => `${s.path}#${n}`;
  const newRow = new Map<string, number>();
  for (const r of first.rows) if (r.n < first.firstBody) newRow.set(key(first, r.n), r.n);
  picks.forEach((p, i) => newRow.set(key(p.sheet, p.n), first.firstBody + i));
  const footerStart = first.firstBody + picks.length;
  const shift = first.total - footerStart;
  for (const r of first.rows) if (r.n >= first.total) newRow.set(key(first, r.n), r.n - shift);
  /** แถวเดิมใด ๆ ของชีตแรก (รวมแถวที่ถูกตัด) → แถวใหม่ — ใช้กับตำแหน่งรูปและขอบเขตการพิมพ์ */
  const mapFirst = (n: number) => {
    if (n < first.firstBody) return n;
    if (n >= first.total) return n - shift;
    const before = picks.filter((p) => p.sheet === first && p.n <= n);
    return before.length ? newRow.get(key(first, before[before.length - 1].n))! : first.firstBody;
  };

  /* ---------- ค่าที่เปลี่ยน ---------- */
  const edits = new Map<string, Map<number, string | number>>();   // แถวเดิม → คอลัมน์ → ค่าใหม่
  const edit = (s: Sheet, n: number, col: number, value: string | number) => {
    const k = key(s, n);
    if (!edits.has(k)) edits.set(k, new Map());
    edits.get(k)!.set(col, value);
  };
  engineRows.forEach(({ sheet, n }, i) => edit(sheet, n, 4, final.engines[i]));
  const headCells = first.rows.filter((r) => r.n < first.header).flatMap((r) => r.cells.filter((c) => c.col <= LAST_COL)
    .map((c) => ({ n: r.n, col: c.col, t: cellText(c.xml, strings).trim() })));
  // B/L NO ในหัวใบ — ป้ายกับเลขอยู่ช่องเดียวกัน ("B/L NO. OOLU2342184670")
  const blCell = headCells.find((c) => /^B\/L\s*NO/i.test(c.t));
  if (!blCell) throw new Error('ไม่พบช่อง B/L NO ในหัวใบ');
  edit(first, blCell.n, blCell.col, `${/^B\/L\s*NO\.?/i.exec(blCell.t)![0]} ${final.blNo}`);
  if (final.invoiceNo) {
    const no = headCells.find((c) => /INVOICE\s*NO/i.test(c.t));
    if (!no) throw new Error('ไม่พบช่อง INVOICE NO. ในหัวใบ');
    edit(first, no.n, no.col, no.t.replace(/(INVOICE\s*NO\.?\s*:?\s*).*$/i, `$1${final.invoiceNo}`));
  }
  // แถว TOTAL: เหลือแค่คำว่า TOTAL — ตัดข้อความค่าเฟรท (JAN TRADING) และยอดในแถวนี้
  for (let col = 3; col <= LAST_COL; col++) edit(first, first.total, col, '');
  // แถวยอดรวมของทั้ง BL — เขียนแบบเดียวกับที่ใบเขียน: "¥4,150,500" / ตัวเลข · "23,550 KGS" · "17 UNITS"
  const sum = first.total + 1;
  const fmt = (v: number) => v.toLocaleString('en-US');
  const amountText = first.text(sum, 7);
  edit(first, sum, 7, /^[¥￥]/.test(amountText) ? `¥${fmt(final.total)}` : /^JPY/i.test(amountText) ? `JPY ${fmt(final.total)}` : final.total);
  edit(first, sum, 1, /KG/i.test(first.text(sum, 1)) || !first.text(sum, 1) ? `${fmt(final.weight)} KGS` : final.weight);
  for (let col = 2; col <= 6; col++) {
    const t = first.text(sum, col);
    if (/\d+\s*UNITS?/i.test(t)) edit(first, sum, col, t.replace(/\d+(\s*UNITS?)/i, `${final.units}$1`));
  }

  /*
   * ช่องที่เคยผสานแนวตั้งในคันรถ — เลิกผสานแล้ว ช่องใต้แถวแรกต้องว่าง
   * AICHI บางชีตเก็บราคาซ้ำไว้ทุกช่องในช่วงที่ผสาน พอเลิกผสานจะเห็นราคาซ้ำทุกบรรทัด
   */
  const carStarts = new Set(blocks.map((b) => key(b.sheet, b.from)));
  const cleared = new Set<string>();
  for (const s of pages) {
    for (const m of s.merges) {
      if (m.bottom === m.top || m.left > LAST_COL || !carStarts.has(key(s, m.top))) continue;
      for (let n = m.top + 1; n <= m.bottom; n++) for (let col = m.left; col <= Math.min(m.right, LAST_COL); col++) cleared.add(`${key(s, n)}@${col}`);
    }
  }

  /* ---------- เส้นแบ่งตู้ / คัน ---------- */
  const styles = new StyleBook(await zip.file('xl/styles.xml')!.async('string'));
  const lineAt = new Map<string, 'thin' | 'medium'>();
  for (const p of picks) {
    if (p.kind === 'car') lineAt.set(key(p.sheet, p.n), 'thin');
    // แถวแรกของตู้ (ป้าย CONTAINER NO หรือเลขตู้ ถ้าไม่มีป้าย)
    if (p.kind === 'box' && !(isBox(p.sheet, p.n) && isContainerLabel(p.sheet, p.n - 1))) lineAt.set(key(p.sheet, p.n), 'medium');
  }

  /* ---------- เขียนแถวใหม่ ---------- */
  const source: Array<{ sheet: Sheet; row: Row }> = [
    ...first.rows.filter((r) => r.n < first.firstBody).map((row) => ({ sheet: first, row })),
    ...picks.map((p) => ({ sheet: p.sheet, row: p.sheet.rows.find((r) => r.n === p.n) ?? { n: p.n, head: `<row r="${p.n}"/>`, cells: [] } })),
    ...first.rows.filter((r) => r.n >= first.total).map((row) => ({ sheet: first, row })),
  ];
  const out: string[] = [];
  const x14ac = /xmlns:x14ac=/.test(first.xml);
  for (const { sheet, row: r } of source) {
    const k = key(sheet, r.n);
    const to = newRow.get(k)!;
    let head = r.head.replace(/\s+spans="[^"]*"/, '').replace(/\br="\d+"/, `r="${to}"`);
    // แถวจากชีตอื่นอาจมีแอตทริบิวต์ x14ac ที่ชีตแรกไม่ได้ประกาศ namespace ไว้
    if (!x14ac) head = head.replace(/\s+x14ac:[A-Za-z]+="[^"]*"/g, '');
    const line = lineAt.get(k);
    const rowEdits = edits.get(k);
    const cells = new Map<number, string>();
    for (const c of r.cells) {
      if (c.col > LAST_COL) continue;
      const moved = moveCell(c.xml, c.col, to);
      cells.set(c.col, cleared.has(`${k}@${c.col}`) ? withValue(moved, `${colLetters(c.col)}${to}`, '') : moved);
    }
    for (const [col, value] of rowEdits ?? []) {
      const ref = `${colLetters(col)}${to}`;
      cells.set(col, withValue(cells.get(col) ?? `<c r="${ref}"/>`, ref, value));
    }
    // เส้นบนทั้งแถว A:G — ช่องที่ยังไม่มีในแถวสร้างใหม่ (มีแต่รูปแบบ)
    if (line) {
      for (let col = 1; col <= LAST_COL; col++) {
        const ref = `${colLetters(col)}${to}`;
        const xml = cells.get(col) ?? `<c r="${ref}"/>`;
        cells.set(col, setStyle(xml, styles.withTop(styleOf(xml), line)));
      }
    }
    const list = [...cells.entries()].sort((a, b) => a[0] - b[0]).map(([, x]) => x);
    if (head.endsWith('/>')) {
      if (!list.length) { out.push(head); continue; }
      head = head.slice(0, -2) + '>';
    }
    out.push(`${head}${list.join('')}</row>`);
  }
  let xml = first.xml;
  const start = xml.indexOf('<sheetData>');
  const end = xml.indexOf('</sheetData>');
  xml = xml.slice(0, start) + '<sheetData>' + out.join('') + xml.slice(end);

  /* ---------- ช่องผสาน ---------- */
  const merges: string[] = [];
  for (const s of pages) {
    for (const m of s.merges) {
      if (m.left > LAST_COL) continue;
      // หัวใบกับท้ายใบใช้ของชีตแรกเท่านั้น
      if (s !== first && (m.top < s.firstBody || (s.total && m.bottom >= s.total))) continue;
      // ช่องผสานแนวตั้งของคันรถ — เลิกผสาน ค่าอยู่บรรทัดแรกของคัน
      if (m.bottom > m.top && carStarts.has(key(s, m.top))) continue;
      const a = newRow.get(key(s, m.top));
      const b = newRow.get(key(s, m.bottom));
      if (a === undefined || b === undefined || b - a !== m.bottom - m.top) continue;
      merges.push(`${colLetters(m.left)}${a}:${colLetters(m.right)}${b}`);
    }
  }
  xml = xml.replace(/<mergeCells\b[^>]*>[\s\S]*?<\/mergeCells>|<mergeCells\b[^>]*\/>/,
    merges.length ? `<mergeCells count="${merges.length}">${merges.map((r) => `<mergeCell ref="${r}"/>`).join('')}</mergeCells>` : '');

  /* ---------- ส่วนอื่นของชีต ---------- */
  const lastRow = Math.max(...first.rows.map((r) => r.n));
  const newLast = mapFirst(lastRow);
  // แถวสุดท้ายที่มีข้อความในท้ายใบ — ขอบเขตการพิมพ์ (ชีต AICHI มีแถวว่างถึงแถว 1000)
  const lastText = Math.max(first.total + 1, ...first.rows.filter((r) => r.n >= first.total
    && r.cells.some((c) => c.col <= LAST_COL && cellText(c.xml, strings).trim())).map((r) => r.n));
  xml = xml.replace(/<dimension\b[^>]*\/>/, `<dimension ref="A1:${colLetters(LAST_COL)}${newLast}"/>`);
  // จุดแบ่งหน้าเดิมอ้างแถวที่ย้ายแล้ว — ตัดทิ้ง ตัวแปลง PDF แบ่งหน้าเองโดยเลือกตัดก่อนต้นคัน/ต้นตู้
  xml = xml.replace(/<rowBreaks\b[^>]*>[\s\S]*?<\/rowBreaks>|<rowBreaks\b[^>]*\/>/, '');
  xml = xml.replace(/<selection\b[^>]*\/>/g, '<selection activeCell="A1" sqref="A1"/>');
  zip.file(first.path, xml);
  zip.file('xl/styles.xml', styles.toXml());

  // ขอบเขตการพิมพ์ของชีตแรก: ของเดิมเลื่อนตามแถว · ไม่มี (AICHI) ตั้ง A1:G แถวสุดท้ายที่มีข้อความ
  const wbPath = 'xl/workbook.xml';
  let wb = await zip.file(wbPath)!.async('string');
  let hasArea = false;
  wb = wb.replace(/(<definedName\b([^>]*)>)([^<]*)(<\/definedName>)/g, (whole, open: string, attrs: string, value: string, close: string) => {
    if (attr(attrs, 'name') !== '_xlnm.Print_Area' || attr(attrs, 'localSheetId') !== '0') return whole;
    hasArea = true;
    const cut = value.lastIndexOf('!') + 1;
    const refs = value.slice(cut).replace(/(\$?[A-Z]{1,3}\$?)(\d+)/g, (_s, col: string, row: string) => `${col}${mapFirst(Number(row))}`);
    return `${open}${value.slice(0, cut)}${refs}${close}`;
  });
  if (!hasArea) {
    const name = `'${first.name.replace(/'/g, "''")}'!$A$1:$G$${mapFirst(lastText)}`;
    const def = `<definedName name="_xlnm.Print_Area" localSheetId="0">${xmlEscape(name)}</definedName>`;
    wb = /<definedNames>/.test(wb) ? wb.replace('<definedNames>', `<definedNames>${def}`)
      : wb.replace('</sheets>', `</sheets><definedNames>${def}</definedNames>`);
  }
  zip.file(wbPath, wb);

  // รูปที่ปักไว้ในแถวที่ย้าย (เช่นตราประทับท้ายใบ) — เลื่อนตามแถว
  const relsPath = first.path.replace(/([^/]+)$/, '_rels/$1.rels');
  const rels = await zip.file(relsPath)?.async('string');
  for (const m of rels?.matchAll(/<Relationship\b[^>]*>/g) ?? []) {
    if (!/\/drawing"?$/.test(attr(m[0], 'Type') ?? '')) continue;
    const path = resolveFrom(first.path, attr(m[0], 'Target') ?? '');
    const drawing = await zip.file(path)?.async('string');
    if (!drawing) continue;
    zip.file(path, drawing.replace(/(<xdr:(?:from|to)>[\s\S]*?<xdr:row>)(\d+)(<\/xdr:row>)/g,
      (_s, a: string, r: string, b: string) => `${a}${mapFirst(Number(r) + 1) - 1}${b}`));
  }

  // ชีตตู้อื่นต่อเข้าชีตแรกแล้ว — ลบออก ไม่งั้นอ่านไฟล์ซ้ำจะได้รถซ้ำสองรอบ
  await removeSheets(zip, pages.slice(1).map((s) => s.path));
  await dropCalcChain(zip);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/** ลบชีตออกจากไฟล์ — รายชื่อชีต · rels · content types · ชื่อที่ผูกกับชีต (เลื่อน localSheetId ของชีตที่เหลือ) · รูปของชีตนั้น */
async function removeSheets(zip: JSZip, paths: string[]) {
  if (!paths.length) return;
  const wbRelsPath = 'xl/_rels/workbook.xml.rels';
  let wbRels = await zip.file(wbRelsPath)!.async('string');
  let wb = await zip.file('xl/workbook.xml')!.async('string');
  const relOf = new Map<string, string>();       // r:id → path
  for (const m of wbRels.matchAll(/<Relationship\b[^>]*>/g)) relOf.set(attr(m[0], 'Id') ?? '', resolveFrom('xl/workbook.xml', attr(m[0], 'Target') ?? ''));
  const order = [...wb.matchAll(/<sheet\b[^>]*\/>/g)].map((m) => ({ tag: m[0], rid: attr(m[0], 'r:id') ?? '' }));
  const removedIdx = new Set<number>();
  order.forEach((s, i) => { if (paths.includes(relOf.get(s.rid) ?? '')) removedIdx.add(i); });
  const newIndex = (i: number) => i - [...removedIdx].filter((k) => k < i).length;

  for (const i of removedIdx) {
    wb = wb.replace(order[i].tag, '');
    wbRels = wbRels.replace(new RegExp(`<Relationship\\b[^>]*\\bId="${order[i].rid}"[^>]*/>`), '');
  }
  wb = wb.replace(/<definedName\b([^>]*)>([^<]*)<\/definedName>/g, (whole, attrs: string) => {
    const local = attr(attrs, 'localSheetId');
    if (local === null) return whole;
    if (removedIdx.has(Number(local))) return '';
    return whole.replace(/localSheetId="\d+"/, `localSheetId="${newIndex(Number(local))}"`);
  }).replace(/<definedNames>\s*<\/definedNames>/, '')
    .replace(/\bactiveTab="\d+"/, 'activeTab="0"').replace(/\bfirstSheet="\d+"/, 'firstSheet="0"');
  zip.file('xl/workbook.xml', wb);
  zip.file(wbRelsPath, wbRels);

  const ctPath = '[Content_Types].xml';
  let ct = await zip.file(ctPath)!.async('string');
  for (const path of paths) {
    // รูป (drawing) ของชีตนั้นลบไปด้วย — ตัวรูปใน xl/media อาจใช้ร่วมกับชีตแรก จึงไม่ลบ
    const relsPath = path.replace(/([^/]+)$/, '_rels/$1.rels');
    const rels = await zip.file(relsPath)?.async('string');
    for (const m of rels?.matchAll(/<Relationship\b[^>]*>/g) ?? []) {
      if (!/\/drawing"?$/.test(attr(m[0], 'Type') ?? '')) continue;
      const d = resolveFrom(path, attr(m[0], 'Target') ?? '');
      zip.remove(d);
      zip.remove(d.replace(/([^/]+)$/, '_rels/$1.rels'));
      ct = ct.replace(new RegExp(`<Override\\b[^>]*PartName="/${d.replace(/[.]/g, '\\.')}"[^>]*/>`), '');
    }
    zip.remove(path);
    zip.remove(relsPath);
    ct = ct.replace(new RegExp(`<Override\\b[^>]*PartName="/${path.replace(/[.]/g, '\\.')}"[^>]*/>`), '');
  }
  zip.file(ctPath, ct);

  // รายชื่อชีตใน docProps/app.xml — ไม่ตรงกับไฟล์ Excel บางรุ่นถามซ่อมไฟล์ ลบส่วนรายชื่อออกให้ Excel สร้างใหม่
  const app = await zip.file('docProps/app.xml')?.async('string');
  if (app) {
    zip.file('docProps/app.xml', app.replace(/<HeadingPairs>[\s\S]*?<\/HeadingPairs>/, '').replace(/<TitlesOfParts>[\s\S]*?<\/TitlesOfParts>/, ''));
  }
}
