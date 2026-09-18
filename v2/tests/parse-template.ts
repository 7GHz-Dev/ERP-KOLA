/**
 * ตรวจว่าการอ่านตามกรอบทำงานจริงกับเอกสารจริง และไม่ทำให้ตัวอ่านอัตโนมัติแย่ลง
 *
 * รัน: npx tsx --tsconfig tsconfig.json tests/parse-template.ts
 */
import fs from 'node:fs';
import { parseArrivalText } from '../src/lib/parse-arrival';
import {
  EVERY_PAGE, LAST_PAGE, combineRead, matchTemplate, piecesInArea, readByTemplate,
  textInArea, valueFromText, type ParseTemplate, type TextPiece,
} from '../src/lib/parse-template';

async function piecesOf(path: string) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(path)), useSystemFonts: true, isEvalSupported: false,
  }).promise;
  const pieces: TextPiece[] = [];
  const texts: string[] = [];
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
    texts.push((content.items as Array<Record<string, any>>).map((i) => ('str' in i ? i.str : '')).join(' '));
  }
  return { pieces, text: texts.join('\n') };
}

let pass = 0; let fail = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass += 1; else { fail += 1; console.log(`  ✗ ${label}\n      ได้ ${JSON.stringify(got)}\n      ควรได้ ${JSON.stringify(want)}`); }
}

/* แบบร่างของ Arrival Notice ของ MAERSK — พิกัดลากจากเอกสารจริง */
const maerskTemplate: ParseTemplate = {
  id: 'T-MAERSK', name: 'MAERSK Arrival Notice', isActive: true,
  match: ['ARRIVAL', 'MAEU'],
  areas: [
    { field: 'blNo',        page: 1, x: 0.67, y: 0.042, w: 0.22, h: 0.020 },
    { field: 'vessel',      page: 1, x: 0.46, y: 0.090, w: 0.20, h: 0.018 },
    { field: 'voyage',      page: 1, x: 0.67, y: 0.090, w: 0.10, h: 0.018 },
    { field: 'shipperName', page: 1, x: 0.04, y: 0.090, w: 0.30, h: 0.016 },
  ],
};

async function main() {
  console.log('\n— อ่านค่าตามกรอบจากเอกสารจริง (MAERSK) —');
  const maersk = await piecesOf('test/BL/maersk.pdf');

  check('blNo', textInArea(maersk.pieces, maerskTemplate.areas[0]).replace(/\s+/g, ''), 'MAEU270801589');
  check('vessel', textInArea(maersk.pieces, maerskTemplate.areas[1]), 'MAERSK NAMSOS');
  check('voyage', textInArea(maersk.pieces, maerskTemplate.areas[2]), '620S');
  // pdf.js หั่น "CO.,LTD." เป็นสองชิ้นที่เหลื่อมกัน ต้องต่อกลับโดยไม่แทรกช่องว่าง
  check('shipperName ต่อคำที่ถูกหั่นกลับถูก', textInArea(maersk.pieces, maerskTemplate.areas[3]), 'KOLA SHIPPING CO.,LTD.');

  console.log('\n— จับแบบจากข้อความในไฟล์ —');
  check('ไฟล์ MAERSK จับแบบได้', matchTemplate([maerskTemplate], maersk.text)?.name, 'MAERSK Arrival Notice');
  const other = await piecesOf('test/BL/oocl.pdf');
  check('ไฟล์ OOCL ไม่เข้าแบบของ MAERSK', matchTemplate([maerskTemplate], other.text), null);

  console.log('\n— แบบร่างต้องไม่ทำให้อ่านได้น้อยลงกว่าเดิม —');
  const auto = parseArrivalText(maersk.text);
  const combined = combineRead(auto, maerskTemplate, maersk.pieces);
  for (const key of ['blNo', 'vessel', 'voyage', 'eta', 'grossWeight', 'unitAmount', 'portOfLoading'] as const) {
    if (auto[key] && !combined[key]) { fail += 1; console.log(`  ✗ ${key} หายไปหลังใช้แบบร่าง`); } else pass += 1;
  }
  check('ตู้ไม่หายไป', combined.containers.length >= auto.containers.length, true);
  check('รู้ว่าใช้แบบไหน', combined.templateName, 'MAERSK Arrival Notice');

  console.log('\n— ไม่มีแบบตรง ต้องได้ผลเท่าตัวอ่านอัตโนมัติเป๊ะ ๆ —');
  const none = combineRead(auto, null, maersk.pieces);
  check('ผลเหมือนเดิมทุกช่อง', { ...none, templateName: undefined, fromTemplate: undefined },
    { ...auto, templateName: undefined, fromTemplate: undefined });

  console.log('\n— ล้างค่าในกรอบตามชนิดช่อง —');
  check('ตัดป้ายที่คนลากคลุมมาด้วย', valueFromText('blNo', 'B/L No. : MAEU270801589'), 'MAEU270801589');
  check('ตัดป้าย Vessel', valueFromText('vessel', 'Vessel MAERSK NAMSOS'), 'MAERSK NAMSOS');
  check('วันที่ dd/mm/yyyy', valueFromText('eta', 'ETA: 01/08/2026'), '2026-08-01');
  check('วันที่เดือนนำหน้า', valueFromText('eta', 'AUG 01 2026'), '2026-08-01');
  check('น้ำหนักตัดหน่วยและลูกน้ำ', valueFromText('grossWeight', 'Gross Weight 16,350.00 KGS'), '16350');
  check('เลขตู้หลายตู้ในกรอบเดียว', valueFromText('containers', 'MSKU1234567 TCNU7654321'), ['MSKU1234567', 'TCNU7654321']);
  check('เลขตู้ซ้ำตัดออก', valueFromText('containers', 'MSKU1234567 MSKU1234567'), ['MSKU1234567']);
  check('ซีลไม่เอาเลขตู้มาด้วย', valueFromText('seals', 'MSKU1234567 SEAL123456'), ['SEAL123456']);
  check('กรอบว่างคืนค่าว่าง', valueFromText('vessel', '   '), '');
  check('กรอบที่มีแต่ป้ายคืนค่าว่าง', valueFromText('blNo', 'B/L No.'), '');

  console.log('\n— เรียงข้อความในกรอบตามที่คนอ่าน —');
  // pdf.js คืนชิ้นตามลำดับในไฟล์ ซึ่งบางใบสลับคอลัมน์ขวามาก่อนซ้าย
  const scrambled: TextPiece[] = [
    { page: 1, left: .5, right: .6, top: .1, bottom: .11, str: 'ขวา' },
    { page: 1, left: .1, right: .2, top: .1, bottom: .11, str: 'ซ้าย' },
    { page: 1, left: .1, right: .2, top: .05, bottom: .06, str: 'บน' },
  ];
  const all = { field: 'vessel' as const, page: 1, x: 0, y: 0, w: 1, h: 1 };
  check('บนก่อน แล้วซ้ายไปขวา', piecesInArea(scrambled, all).map((p) => p.str), ['บน', 'ซ้าย', 'ขวา']);

  console.log('\n— เลขตู้ลากได้หลายกรอบ ต้องสะสมครบทุกกรอบ —');
  /*
   * ใบที่ไล่ตู้เป็นหลายแถวคนละที่ ผู้ดูแลลากกรอบแถวละกรอบ
   * ถ้าเก็บแบบทับกันจะเหลือแต่กรอบสุดท้าย ตู้ที่เหลือหายไปเงียบ ๆ
   */
  const rows: TextPiece[] = [
    { page: 1, left: .1, right: .3, top: .10, bottom: .11, str: 'MSKU1234567' },
    { page: 1, left: .1, right: .3, top: .20, bottom: .21, str: 'TCNU7654321' },
  ];
  const twoBoxes = readByTemplate({
    id: 't', name: 't', match: [], isActive: true,
    areas: [
      { field: 'containers', page: 1, x: 0, y: .08, w: 1, h: .05 },
      { field: 'containers', page: 1, x: 0, y: .18, w: 1, h: .05 },
    ],
  }, rows);
  check('ตู้จากสองกรอบครบ', twoBoxes.containers, ['MSKU1234567', 'TCNU7654321']);
  // กรอบที่คาบเกี่ยวกันไม่ควรทำให้ได้ตู้ซ้ำ
  const overlapping = readByTemplate({
    id: 't', name: 't', match: [], isActive: true,
    areas: [
      { field: 'containers', page: 1, x: 0, y: 0, w: 1, h: 1 },
      { field: 'containers', page: 1, x: 0, y: .08, w: 1, h: .05 },
    ],
  }, rows);
  check('กรอบคาบกันไม่ได้ตู้ซ้ำ', overlapping.containers, ['MSKU1234567', 'TCNU7654321']);

  console.log('\n— กรอบคนละหน้าไม่ปนกัน —');
  const twoPages: TextPiece[] = [
    { page: 1, left: .1, right: .2, top: .1, bottom: .11, str: 'หน้าหนึ่ง' },
    { page: 2, left: .1, right: .2, top: .1, bottom: .11, str: 'หน้าสอง' },
  ];
  check('เอาแต่หน้าที่ระบุ', textInArea(twoPages, { ...all, page: 2 }), 'หน้าสอง');

  console.log('\n— โหมดหน้า: หน้าสุดท้าย และ ทุกหน้า —');
  /*
   * เอกสารสายเรือใบเดียวกันมีจำนวนหน้าไม่เท่ากันตามจำนวนสินค้า
   * ค่าท้ายใบ (ยอดรวม) กับค่าที่ไล่ข้ามหน้า (เลขตู้) จึงผูกกับเลขหน้าตายตัวไม่ได้
   */
  const threePages: TextPiece[] = [
    { page: 1, left: .1, right: .3, top: .10, bottom: .11, str: 'MSKU1234567' },
    { page: 2, left: .1, right: .3, top: .10, bottom: .11, str: 'TCNU7654321' },
    { page: 3, left: .1, right: .3, top: .10, bottom: .11, str: 'APHU7044624' },
    { page: 3, left: .5, right: .7, top: .50, bottom: .51, str: '28340.000' },
  ];
  const wide = { x: 0, y: 0, w: 1, h: .3 } as const;
  check('ทุกหน้าเก็บตู้ครบทุกหน้า',
    readByTemplate({ id: 't', name: 't', match: [], isActive: true,
      areas: [{ field: 'containers', page: EVERY_PAGE, ...wide }] }, threePages).containers,
    ['MSKU1234567', 'TCNU7654321', 'APHU7044624']);
  check('หน้าสุดท้ายหาเจอเองว่าคือหน้า 3',
    readByTemplate({ id: 't', name: 't', match: [], isActive: true,
      areas: [{ field: 'grossWeight', page: LAST_PAGE, x: .4, y: .4, w: .5, h: .2 }] }, threePages).values.grossWeight,
    '28340');
  // ใบที่สั้นกว่า หน้าสุดท้ายต้องเลื่อนตาม ไม่ใช่ค้างที่หน้า 3
  const twoOnly = threePages.filter((p) => p.page <= 2)
    .concat([{ page: 2, left: .5, right: .7, top: .50, bottom: .51, str: '11660.000' }]);
  check('ใบสั้นกว่า หน้าสุดท้ายเลื่อนตาม',
    readByTemplate({ id: 't', name: 't', match: [], isActive: true,
      areas: [{ field: 'grossWeight', page: LAST_PAGE, x: .4, y: .4, w: .5, h: .2 }] }, twoOnly).values.grossWeight,
    '11660');

  console.log('\n— กรอบเลขตู้ที่คาบบรรทัด SEAL ต้องไม่ได้ตู้ปลอม —');
  /*
   * กรอบเลขตู้มักคาบบรรทัด "SEAL M5003182" ที่อยู่ใต้กัน
   * ถ้ายุบช่องว่างทั้งก้อนก่อนจับ จะกลายเป็น "SEALM5003182" ซึ่งเข้ารูปแบบเลขตู้พอดี
   */
  check('ไม่เอา SEAL มาต่อเป็นเลขตู้',
    valueFromText('containers', 'CMAU7455074 SEAL M5003182'), ['CMAU7455074']);
  check('ซีลยังอ่านได้ตามเดิม',
    valueFromText('seals', 'CMAU7455074 SEAL M5003182'), ['M5003182']);

  console.log(`\nสรุป: ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  if (fail) process.exitCode = 1;
}
void main();
