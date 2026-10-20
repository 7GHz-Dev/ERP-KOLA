/**
 * เขียนเลขเครื่องลงสำเนาไฟล์ Final Invoice — แก้ XML เฉพาะช่องที่เปลี่ยน
 *
 * ส่วนอื่นของไฟล์ (รูปแบบ รูปภาพ สูตร ชีตอื่น) ไม่ถูกแตะเลย ต่างจากการเปิดแล้ว save ใหม่ด้วยไลบรารี
 * และตั้งให้ Excel คำนวณสูตรใหม่ทั้งไฟล์ตอนเปิด (fullCalcOnLoad)
 *   values = ช่องเลขเครื่อง เขียนเป็นข้อความ
 *   cached = ค่าที่คำนวณไว้ของสูตร use_desc_good2 (คงสูตรเดิม) — อัปโหลดไฟล์นี้ซ้ำได้โดยไม่ต้องเปิด Excel ก่อน
 */
import JSZip from 'jszip';
import type { CellUpdate } from './analyze';
import { colLetters } from './sheet';

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

function resolveTarget(target: string) {
  if (target.startsWith('/')) return target.slice(1);
  const out: string[] = [];
  for (const p of `xl/${target}`.split('/')) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); }
  return out.join('/');
}

/** ตำแหน่งไฟล์ XML ของชีตแรกที่เป็น worksheet */
async function firstSheetPath(zip: JSZip) {
  const wbXml = await zip.file('xl/workbook.xml')!.async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
  const rels: Record<string, { target: string; type: string }> = {};
  for (const m of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    rels[attr(m[0], 'Id') ?? ''] = { target: attr(m[0], 'Target') ?? '', type: attr(m[0], 'Type') ?? '' };
  }
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const rel = rels[attr(m[0], 'r:id') ?? ''];
    if (rel && rel.type.endsWith('/worksheet')) return resolveTarget(rel.target);
  }
  throw new Error('ไม่พบชีตข้อมูลในไฟล์ Excel');
}

function findCell(xml: string, ref: string) {
  const m = new RegExp(`<c\\b([^>]*?)\\br="${ref}"([^>]*?)(/>|>([\\s\\S]*?)</c>)`).exec(xml);
  if (!m) throw new Error(`หาเซลล์ ${ref} ในไฟล์ Excel ไม่เจอ`);
  const attrs = `${m[1]}r="${ref}"${m[2]}`.replace(/\s+$/, '');
  return { start: m.index, end: m.index + m[0].length, attrs: /^\s/.test(attrs) ? attrs : ` ${attrs}`, body: m[4] ?? '' };
}

export async function patchWorkbook(data: Buffer | Uint8Array, values: CellUpdate[], cached: CellUpdate[]): Promise<Buffer> {
  const zip = await JSZip.loadAsync(data);
  const sheetPath = await firstSheetPath(zip);
  let xml = await zip.file(sheetPath)!.async('string');
  let formulaRemoved = false;

  const edit = (u: CellUpdate, make: (c: ReturnType<typeof findCell>, ref: string) => string | null) => {
    const ref = colLetters(u.col) + u.row;
    const c = findCell(xml, ref);
    const out = make(c, ref);
    if (out !== null) xml = xml.slice(0, c.start) + out + xml.slice(c.end);
  };
  const withoutT = (attrs: string) => attrs.replace(/\s+t="[^"]*"/, '');

  for (const u of values) {
    edit(u, (c, ref) => {
      const f = /<f\b[^>]*>/.exec(c.body);
      if (f && attr(f[0], 't') === 'shared' && attr(f[0], 'ref')) {
        throw new Error(`ช่องเลขเครื่อง ${ref} เป็นสูตรที่ช่องอื่นใช้ร่วม — แก้ช่องนี้ให้เป็นข้อความก่อน`);
      }
      if (f) formulaRemoved = true;
      return `<c${withoutT(c.attrs)} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(u.value)}</t></is></c>`;
    });
  }
  for (const u of cached) {
    edit(u, (c) => {
      const f = /<f\b[^>]*\/>|<f\b[^>]*>[\s\S]*?<\/f>/.exec(c.body);
      if (!f) return null;                                   // ไม่ใช่สูตร ไม่ต้องแก้
      return `<c${withoutT(c.attrs)} t="str">${f[0]}<v>${xmlEscape(u.value)}</v></c>`;
    });
  }
  zip.file(sheetPath, xml);

  // ให้ Excel คำนวณสูตรใหม่ทั้งไฟล์ตอนเปิด
  let wbXml = await zip.file('xl/workbook.xml')!.async('string');
  if (/<calcPr\b/.test(wbXml)) {
    wbXml = wbXml.replace(/<calcPr\b([^>]*?)(\/?)>/, (_m, a: string, slash: string) =>
      `<calcPr${a.replace(/\s+fullCalcOnLoad="[^"]*"/, '')} fullCalcOnLoad="1"${slash}>`);
  } else {
    const before = /<(oleSize|customWorkbookViews|pivotCaches|smartTagPr|smartTagTypes|webPublishing|fileRecoveryPr|webPublishObjects|extLst)\b|<\/workbook>/.exec(wbXml)!;
    wbXml = wbXml.slice(0, before.index) + '<calcPr fullCalcOnLoad="1"/>' + wbXml.slice(before.index);
  }
  zip.file('xl/workbook.xml', wbXml);

  if (formulaRemoved && zip.file('xl/calcChain.xml')) {     // calcChain ที่อ้างสูตรที่ลบไป ทำให้ Excel ฟ้องว่าไฟล์เสีย
    zip.remove('xl/calcChain.xml');
    const relsPath = 'xl/_rels/workbook.xml.rels';
    zip.file(relsPath, (await zip.file(relsPath)!.async('string')).replace(/<Relationship\b[^>]*calcChain[^>]*\/>/g, ''));
    const ct = '[Content_Types].xml';
    zip.file(ct, (await zip.file(ct)!.async('string')).replace(/<Override\b[^>]*\/xl\/calcChain\.xml[^>]*\/>/g, ''));
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
