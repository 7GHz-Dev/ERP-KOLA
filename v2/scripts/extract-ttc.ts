import { readFile, writeFile } from 'node:fs/promises';

/**
 * แยกฟอนต์เดี่ยวออกจากไฟล์ font collection (.ttc)
 *
 * ฟอนต์ที่ Windows ให้มาหลายตัวเป็น collection คือมีหลายฟอนต์อยู่ไฟล์เดียว
 * (angsana.ttc มี Angsana New กับ AngsanaUPC อย่างละ 4 น้ำหนัก)
 * แต่ /FontFile2 ใน PDF ต้องเป็นฟอนต์เดี่ยวเท่านั้น ถ้ายัด collection เข้าไปทั้งก้อน
 * โปรแกรมอ่าน PDF จะหาฟอนต์ในนั้นไม่เจอแล้วถอยไปใช้ฟอนต์แทน ตัวอักษรไทยจึงเพี้ยน
 *
 * สคริปต์นี้รันครั้งเดียวตอนเตรียมไฟล์ ผลลัพธ์เก็บไว้ที่ assets/fonts/
 *
 *   npx tsx scripts/extract-ttc.ts C:/Windows/Fonts/angsana.ttc AngsanaNew assets/fonts/AngsanaNew-Regular.ttf
 */

type TableRecord = { tag: string; checksum: number; offset: number; length: number };

function readDirectory(ttc: Buffer, at: number) {
  const numTables = ttc.readUInt16BE(at + 4);
  const tables: TableRecord[] = [];
  for (let i = 0; i < numTables; i += 1) {
    const p = at + 12 + i * 16;
    tables.push({
      tag: ttc.toString('latin1', p, p + 4),
      checksum: ttc.readUInt32BE(p + 4),
      offset: ttc.readUInt32BE(p + 8),
      length: ttc.readUInt32BE(p + 12),
    });
  }
  return { sfntVersion: ttc.readUInt32BE(at), tables };
}

/** ผลรวมตรวจสอบของ OpenType คิดทีละ 4 ไบต์ ส่วนที่ขาดนับเป็นศูนย์ */
function checksum(buf: Buffer, from = 0, to = buf.length) {
  let sum = 0;
  for (let i = from; i < to; i += 4) {
    const b0 = buf[i] ?? 0;
    const b1 = buf[i + 1] ?? 0;
    const b2 = buf[i + 2] ?? 0;
    const b3 = buf[i + 3] ?? 0;
    sum = (sum + ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3)) >>> 0;
  }
  return sum >>> 0;
}

function extractFromCollection(ttc: Buffer, fontIndex: number): Buffer {
  if (ttc.toString('latin1', 0, 4) !== 'ttcf') {
    // ไฟล์ฟอนต์เดี่ยวอยู่แล้ว ใช้ได้เลย
    return ttc;
  }
  const numFonts = ttc.readUInt32BE(8);
  if (fontIndex < 0 || fontIndex >= numFonts) {
    throw new Error(`ไฟล์นี้มี ${numFonts} ฟอนต์ ไม่มีลำดับที่ ${fontIndex}`);
  }

  const { sfntVersion, tables } = readDirectory(ttc, ttc.readUInt32BE(12 + fontIndex * 4));
  const sorted = [...tables].sort((a, b) => (a.tag < b.tag ? -1 : 1));

  const headerSize = 12 + sorted.length * 16;
  const align4 = (n: number) => (n + 3) & ~3;
  let cursor = align4(headerSize);
  const placed = sorted.map((t) => {
    const at = cursor;
    cursor = align4(cursor + t.length);
    return { ...t, newOffset: at };
  });

  const out = Buffer.alloc(cursor);
  out.writeUInt32BE(sfntVersion, 0);
  out.writeUInt16BE(sorted.length, 4);
  // searchRange / entrySelector / rangeShift ตามสูตรของ OpenType
  const power = 2 ** Math.floor(Math.log2(sorted.length));
  out.writeUInt16BE(power * 16, 6);
  out.writeUInt16BE(Math.log2(power), 8);
  out.writeUInt16BE(sorted.length * 16 - power * 16, 10);

  placed.forEach((t, i) => {
    const p = 12 + i * 16;
    out.write(t.tag, p, 4, 'latin1');
    out.writeUInt32BE(t.checksum, p + 4);
    out.writeUInt32BE(t.newOffset, p + 8);
    out.writeUInt32BE(t.length, p + 12);
    ttc.copy(out, t.newOffset, t.offset, t.offset + t.length);
  });

  /*
   * head.checkSumAdjustment คิดจากทั้งไฟล์ ย้ายตารางแล้วค่าเดิมใช้ไม่ได้
   * ต้องล้างเป็นศูนย์ก่อนแล้วค่อยคิดใหม่ ไม่งั้นตัวตรวจฟอนต์บางตัวจะตีว่าไฟล์เสีย
   */
  const head = placed.find((t) => t.tag === 'head');
  if (head) {
    out.writeUInt32BE(0, head.newOffset + 8);
    out.writeUInt32BE((0xb1b0afba - checksum(out)) >>> 0, head.newOffset + 8);
  }
  return out;
}

async function main() {
  const [input, wanted, output] = process.argv.slice(2);
  if (!input || !wanted || !output) {
    console.error('ใช้: npx tsx scripts/extract-ttc.ts <ไฟล์.ttc> <PostScriptName> <ไฟล์ออก.ttf>');
    process.exit(1);
  }

  const bytes = await readFile(input);
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collection = fontkit.create(bytes) as any;
  const fonts: string[] = collection.fonts
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? collection.fonts.map((f: any) => f.postscriptName)
    : [collection.postscriptName];

  const index = fonts.indexOf(wanted);
  if (index < 0) throw new Error(`ไม่มี "${wanted}" ในไฟล์ — มีแต่ ${fonts.join(', ')}`);

  const ttf = extractFromCollection(bytes, index);
  await writeFile(output, ttf);

  // อ่านกลับด้วย fontkit เพื่อยืนยันว่าไฟล์ที่เขียนออกไปใช้งานได้จริง
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const check = fontkit.create(await readFile(output)) as any;
  if (check.postscriptName !== wanted) {
    throw new Error(`ไฟล์ที่เขียนออกมาเป็น "${check.postscriptName}" ไม่ใช่ "${wanted}"`);
  }
  console.log(`${output} — ${wanted} (${ttf.length} ไบต์, ${check.numGlyphs} glyph)`);
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
