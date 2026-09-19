/**
 * ตรวจกติกาการรวมผลจากหลายชั้น
 *
 * รัน: npx tsx --tsconfig tsconfig.json tests/read-layers.ts
 *
 * ชั้นหลังห้ามทับค่าของชั้นก่อน — นี่คือกติกาที่สำคัญที่สุดของทั้งระบบ
 * ชั้นแรกคือกรอบที่คนลากเองว่าค่าอยู่ตรงไหน ซึ่งแม่นกว่าการเดาของ OCR หรือ AI เสมอ
 * ถ้าชั้นหลังทับได้ ของที่เคยอ่านถูกจะกลายเป็นผิดโดยไม่มีใครรู้
 */
import {
  KEY_FIELDS, emptyRead, mergeLayer, missingFields,
  type LayerResult, type LayeredRead,
} from '../src/lib/read-layers';

let pass = 0; let fail = 0;
function check(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass += 1; return; }
  fail += 1;
  console.log(`  ✗ ${label}\n      ได้    ${JSON.stringify(got)}\n      ควรได้ ${JSON.stringify(want)}`);
}

const layer = (l: LayerResult['layer'], values: LayerResult['values'], baht = 0): LayerResult =>
  ({ layer: l, values, baht });

function main() {
  console.log('\n— ชั้นหลังห้ามทับค่าของชั้นก่อน —');
  {
    let r: LayeredRead = emptyRead();
    r = mergeLayer(r, layer('template', { blNo: 'ถูกต้อง', vessel: 'เรือจากกรอบ' }));
    r = mergeLayer(r, layer('ai', { blNo: 'AI เดามา', vessel: 'เรือที่ AI เดา', voyage: '001W' }));
    check('เลข BL ยังเป็นของกรอบ', r.values.blNo, 'ถูกต้อง');
    check('ชื่อเรือยังเป็นของกรอบ', r.values.vessel, 'เรือจากกรอบ');
    check('ช่องที่กรอบไม่มี ให้ชั้นหลังเติมได้', r.values.voyage, '001W');
    check('บอกได้ว่าช่องไหนมาจากชั้นไหน', r.source.voyage, 'ai');
    check('ช่องที่มาจากกรอบยังบอกว่าเป็นกรอบ', r.source.blNo, 'template');
  }

  console.log('\n— ค่าว่างไม่นับว่า "มีค่าแล้ว" —');
  {
    let r: LayeredRead = emptyRead();
    // ชั้นแรกอ่านได้แต่เป็นค่าว่าง ชั้นหลังต้องเติมทับได้
    r = mergeLayer(r, layer('template', { blNo: '', vessel: '   ' }));
    r = mergeLayer(r, layer('ocr', { blNo: 'AMP123', vessel: 'SHUN LONG' }));
    check('ค่าว่างถูกเติมทับได้', r.values.blNo, 'AMP123');
    check('ค่าที่มีแต่ช่องว่างก็ถือว่าว่าง', r.values.vessel, 'SHUN LONG');
  }

  console.log('\n— เลขตู้กับเลขซีลต้องมาคู่กัน —');
  {
    let r: LayeredRead = emptyRead();
    r = mergeLayer(r, layer('ocr', { containers: ['AAAA1111111'], seals: ['S1'] }));
    r = mergeLayer(r, layer('ai', { containers: ['BBBB2222222', 'CCCC3333333'], seals: ['S2', 'S3'] }));
    check('ตู้ชั้นแรกไม่ถูกทับ', r.values.containers, ['AAAA1111111']);
    check('ซีลก็ไม่ถูกทับ', r.values.seals, ['S1']);
  }
  {
    /*
     * ชั้นที่ให้ตู้มาแต่ไม่มีซีล — ต้องไม่เอาซีลจากชั้นอื่นมาจับคู่
     * เพราะซีลจับคู่กับตู้ด้วย "ลำดับ" ซีลจากคนละชุดจะไปโผล่ผิดคัน
     */
    let r: LayeredRead = emptyRead();
    r = mergeLayer(r, layer('ai', { containers: ['DDDD4444444', 'EEEE5555555'] }));
    check('ได้ตู้มา', r.values.containers, ['DDDD4444444', 'EEEE5555555']);
    check('ไม่มีซีลก็ปล่อยว่าง ไม่ไปหยิบของใครมา', r.values.seals, undefined);
  }
  {
    // ลิสต์เปล่าไม่นับว่ามีค่า ชั้นหลังยังเติมได้
    let r: LayeredRead = emptyRead();
    r = mergeLayer(r, layer('ocr', { containers: [] }));
    r = mergeLayer(r, layer('ai', { containers: ['FFFF6666666'], seals: ['S9'] }));
    check('ลิสต์เปล่าถูกเติมทับได้', r.values.containers, ['FFFF6666666']);
    check('ซีลของชั้นเดียวกันมาด้วย', r.values.seals, ['S9']);
  }

  console.log('\n— รวมค่าใช้จ่ายจากทุกชั้น —');
  {
    let r: LayeredRead = emptyRead();
    r = mergeLayer(r, layer('ocr', {}, 0));
    r = mergeLayer(r, layer('ai', { blNo: 'X12345' }, 1.25));
    check('บวกค่าใช้จ่ายถูก', r.baht, 1.25);
    check('นับจำนวนชั้นที่ทำงานไป', r.layers.length, 2);
  }

  console.log('\n— บอกได้ว่ายังขาดช่องไหน —');
  {
    const missing = missingFields({ blNo: 'A1234', vessel: 'SHIP' }, KEY_FIELDS);
    check('ช่องที่มีแล้วไม่อยู่ในรายการขาด', missing.includes('blNo'), false);
    check('ช่องที่ยังไม่มีอยู่ในรายการขาด', missing.includes('voyage'), true);
    check('ลิสต์ที่ยังไม่มีก็นับว่าขาด', missing.includes('containers'), true);
  }
  {
    // ครบแล้วต้องไม่เหลืออะไร — ใช้ตัดสินว่าไม่ต้องเรียกชั้นที่เสียเงิน
    const full = {
      blNo: 'A1', vessel: 'B', voyage: 'C', eta: '2026-01-01',
      grossWeight: '100', containers: ['AAAA1111111'],
    };
    check('ครบแล้วไม่เหลือช่องขาด', missingFields(full, KEY_FIELDS), []);
  }

  console.log(`\nสรุป ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  if (fail) process.exit(1);
}

main();
