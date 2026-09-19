/**
 * ตรวจว่ากลไกสร้างกรอบอัตโนมัติวางกรอบถูกตำแหน่งจริง
 *
 * รัน: npx tsx --tsconfig tsconfig.json tests/auto-frame.ts
 *
 * วิธีตรวจ — ให้มันหาพิกัดของค่าที่เรารู้อยู่แล้วว่าถูกต้อง สร้างกรอบ
 * แล้วอ่านกลับด้วยกรอบนั้น ถ้าได้ค่าเดิมเป๊ะ แปลว่ากรอบวางตรงและไม่กินช่องข้าง ๆ
 *
 * ส่วนที่สำคัญที่สุดคือ "ไม่ดูดป้ายของช่องเข้ามา" — เอกสารเดินเรือวางบรรทัดชิดกัน
 * เผื่อกรอบแนวตั้งมากไปนิดเดียว ชื่อ Shipper จะกลายเป็น
 * "NOTIFY PARTY (COMPLETE NAME AND ADDRESS) KOLA SHIPPING CO.,LTD."
 * ซึ่งเอาไปจับกับ Master Data ไม่ได้เลย เทสต์นี้กันไม่ให้ค่าเผื่อถูกขยับกลับ
 *
 * ต้องมีไฟล์ตัวอย่างในเครื่อง (ดูที่ v2/docs/PARSER-ACCURACY.md)
 * ถ้าไม่มี เทสต์จะข้ามไปเฉย ๆ ไม่ถือว่าไม่ผ่าน เพราะ repo นี้ไม่เก็บเอกสารลูกค้า
 */
import fs from 'node:fs';
import path from 'node:path';
import { findValue, frameFor, stretchForDrift } from '../src/lib/auto-frame';
import {
  fieldLabel, readByTemplate, valueFromText,
  type ParseTemplate, type TemplateArea, type TemplateFieldKey, type TextPiece,
} from '../src/lib/parse-template';

/**
 * ที่เก็บไฟล์ตัวอย่างในเครื่อง — เปลี่ยนได้ด้วย SAMPLE_DIR
 * ค่าตั้งต้นชี้ไปที่ kola-erp/test/BL ซึ่งอยู่สูงขึ้นไปสองชั้นจาก v2
 */
const DIR = process.env.SAMPLE_DIR
  ?? path.join(process.cwd(), '..', '..', 'test', 'BL');

async function piecesOf(file: string): Promise<TextPiece[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true, isEvalSupported: false,
  }).promise;
  const pieces: TextPiece[] = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    for (const it of content.items as Array<Record<string, any>>) {
      if (!('str' in it) || !String(it.str).trim()) continue;
      const [, , , , x, yBottom] = it.transform as number[];
      const h = it.height || 8;
      pieces.push({
        page: i,
        left: x / vp.width,
        right: (x + it.width) / vp.width,
        top: (vp.height - (yBottom + h)) / vp.height,
        bottom: (vp.height - yBottom) / vp.height,
        str: String(it.str),
      });
    }
  }
  return pieces;
}

let pass = 0; let fail = 0; let skipped = 0;

function check(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass += 1; return; }
  fail += 1;
  console.log(`  ✗ ${label}\n      ได้    ${JSON.stringify(got)}\n      ควรได้ ${JSON.stringify(want)}`);
}

/**
 * ค่าจริงของไฟล์ตัวอย่างในเครื่อง — อ่านด้วยตาจากเอกสาร
 * กรอบที่สร้างจากค่าพวกนี้ ต้องอ่านกลับได้ค่าเดิมเป๊ะ
 */
const CASES: Array<{
  file: string;
  name: string;
  values: Partial<Record<TemplateFieldKey, string>>;
}> = [
  {
    file: 'maersk.pdf',
    name: 'MAERSK',
    values: {
      blNo: 'MAEU270801589',
      vessel: 'MAERSK NAMSOS',
      voyage: '620S',
      // ค่านี้คือตัวที่พังเมื่อเผื่อกรอบแนวตั้งมากไป — ป้ายอยู่เหนือชื่อแค่บรรทัดเดียว
      shipperName: 'KOLA SHIPPING CO.,LTD.',
    },
  },
  {
    file: 'oocl.pdf',
    name: 'OOCL',
    values: { vessel: 'BRIGHT TSUBAKI', voyage: '031S' },
  },
];

async function main() {
  console.log(`\nไฟล์ตัวอย่างจาก ${DIR}`);

  for (const c of CASES) {
    const file = path.join(DIR, c.file);
    if (!fs.existsSync(file)) {
      console.log(`\n— ${c.name} — ข้าม (ไม่มี ${c.file} ในเครื่อง)`);
      skipped += 1;
      continue;
    }

    console.log(`\n— ${c.name} (${c.file}) —`);
    const pieces = await piecesOf(file);

    const areas: TemplateArea[] = [];
    for (const [key, want] of Object.entries(c.values) as Array<[TemplateFieldKey, string]>) {
      const area = frameFor(pieces, key, want);
      if (!area) {
        console.log(`  ✗ หาพิกัดไม่เจอ: ${fieldLabel(key)} ("${want}")`);
        fail += 1;
        continue;
      }
      areas.push(area);
    }

    // อ่านกลับด้วยกรอบที่เพิ่งสร้าง ต้องได้ค่าเดิมทุกช่อง
    const tpl: ParseTemplate = { id: 't', name: c.name, match: ['x'], areas, isActive: true };
    const back = readByTemplate(tpl, pieces);

    for (const [key, want] of Object.entries(c.values) as Array<[TemplateFieldKey, string]>) {
      // ตัวอ่านคืนค่าเป็นตัวพิมพ์ใหญ่ทั้งหมด (ยกเว้นช่องที่ยุบช่องว่าง)
      const expected = key === 'blNo' || key === 'voyage'
        ? want.replace(/\s+/g, '').toUpperCase()
        : want.toUpperCase();
      check(`${c.name} · ${fieldLabel(key)}`, back.values[key], expected);
    }
  }

  // กันเผลอขยับค่าเผื่อแนวตั้งกลับไปจนดูดป้ายเข้ามา
  const maersk = path.join(DIR, 'maersk.pdf');
  if (fs.existsSync(maersk)) {
    console.log('\n— กรอบต้องไม่ดูดป้ายของช่องเข้ามา —');
    const pieces = await piecesOf(maersk);
    const area = frameFor(pieces, 'shipperName', 'KOLA SHIPPING CO.,LTD.');
    const tpl: ParseTemplate = {
      id: 't', name: 'x', match: ['x'], areas: area ? [area] : [], isActive: true,
    };
    const got = String(readByTemplate(tpl, pieces).values.shipperName ?? '');
    check('ไม่มีคำว่า NOTIFY PARTY ติดมา', /NOTIFY|ADDRESS/.test(got), false);
  }

  // ค่าที่ไม่มีอยู่ในไฟล์ต้องหาไม่เจอ ไม่ใช่ไปคว้าอะไรมามั่ว ๆ
  if (fs.existsSync(maersk)) {
    console.log('\n— ค่าที่ไม่มีในไฟล์ ต้องคืนว่าหาไม่เจอ —');
    const pieces = await piecesOf(maersk);
    check('ค่าที่ไม่มีจริง', findValue(pieces, 'ZZZZ999999999') === null, true);

    /*
     * ค่าสั้น ๆ ต้องไม่ถูกใช้หาพิกัด
     *
     * จำนวนหน่วย "33" เป็นเลขสองหลักที่โผล่ได้ทั่วหน้ากระดาษ — เลขหน้า ปีรถ
     * ลำดับรายการ ล้วนตรงได้หมด ตัวแรกที่เจอจึงมักไม่ใช่ช่องที่ต้องการ
     * เคยทำให้ใบที่ไม่ใช่ใบตัวอย่างได้กรอบ "จำนวนหน่วย" ที่วางผิดที่อย่างมั่นใจ
     *
     * กรอบผิดอันตรายกว่าไม่มีกรอบ เพราะค่าจากกรอบมาก่อนตัวอ่านอัตโนมัติ
     * ของที่เคยอ่านถูกจึงถูกทับด้วยค่าผิด
     */
    console.log('\n— ค่าสั้นเกินไป ต้องไม่เอามาสร้างกรอบ —');
    check('เลขสองหลักโดด ๆ', findValue(pieces, '33') === null, true);
    check('ตัวเลขหลักเดียว', findValue(pieces, '3') === null, true);
    check('ค่าว่าง', findValue(pieces, '') === null, true);
    // แต่ค่าที่ยาวพอต้องยังหาเจอตามปกติ
    check('ค่าที่ยาวพอยังหาเจอ', findValue(pieces, 'MAEU270801589') !== null, true);
  }

  /*
   * ตารางตู้เลื่อนขึ้นลงตามความยาวเนื้อหาข้างบน กรอบต้องยืดคลุมทั้งช่วง
   *
   * วัดจาก EVERGREEN Arrival Notice จริง 4 ใบ แถวตู้อยู่ที่
   * top = 0.656 · 0.684 · 0.741 · 0.884 — ห่างกันถึง 0.23 ของความสูงหน้า
   * กรอบที่ครอบพอดีใบเดียวจะพลาดใบอื่นเกือบหมด
   */
  console.log('\n— กรอบของช่องที่ตารางเลื่อนได้ ต้องยืดคลุมทั้งช่วง —');
  const tight = { x: 0.1, y: 0.68, w: 0.3, h: 0.02 };
  const wide = stretchForDrift(tight, 'containers');
  check('ยืดคลุม top ต่ำสุดที่เคยเจอ (0.656)', wide.y <= 0.656, true);
  check('ยืดคลุม top สูงสุดที่เคยเจอ (0.884)', wide.y + wide.h >= 0.884 + 0.02, true);
  check('ไม่ล้นออกนอกหน้ากระดาษ', wide.y >= 0 && wide.y + wide.h <= 1, true);
  // ช่องหัวกระดาษอยู่ที่เดิมทุกใบ ยืดแล้วจะไปกินป้ายหรือค่าช่องอื่น
  check('ช่องที่ไม่เลื่อน ต้องไม่ถูกยืด', stretchForDrift(tight, 'blNo'), tight);
  check('ชื่อเรือก็ไม่ถูกยืด', stretchForDrift(tight, 'vessel'), tight);

  /*
   * กรอบที่กว้างพอจะรับตารางที่เลื่อน ย่อมกวาดข้อความรอบ ๆ มาด้วย
   * ตัวคัดเลขซีลจึงต้องเข้มพอจะทิ้งของที่ไม่ใช่ซีล
   */
  console.log('\n— เลขซีลต้องไม่เอาตัวเลขในตารางมาปน —');
  check('ตัวเลขล้วนไม่ใช่ซีล', valueFromText('seals', '1.0000 33.9161000'), []);
  check('รหัสขนาดตู้ไม่ใช่ซีล', valueFromText('seals', '40SD96'), []);
  check('เลขตู้ไม่ใช่ซีล', valueFromText('seals', 'WHSU6587864'), []);
  check('ซีลจริงยังผ่าน', valueFromText('seals', 'WHA3946538'), ['WHA3946538']);
  check('ซีลที่มีขีดกลางยังผ่าน', valueFromText('seals', 'ML-JP0354196'), ['ML-JP0354196']);

  console.log(`\nสรุป ผ่าน ${pass} · ไม่ผ่าน ${fail}${skipped ? ` · ข้าม ${skipped} ใบ` : ''}`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
