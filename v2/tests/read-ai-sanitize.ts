/**
 * ตรวจว่าค่าที่ AI ตอบมาถูกกรองก่อนใช้จริง
 *
 * รัน: npx tsx --tsconfig tsconfig.json tests/read-ai-sanitize.ts
 *
 * ชั้น AI ต่างจากชั้นอื่นตรงที่ "อ่านไม่ออกแล้วเดา" ได้ ซึ่งอันตรายกว่าคืนค่าว่าง
 * เพราะค่าที่ดูสมเหตุสมผลจะผ่านตาคนไปถึงจดหมายที่ยื่นสายเรือ
 *
 * เทสต์นี้ยิงค่าที่ AI เคยตอบผิดแบบต่าง ๆ เข้าไป แล้วดูว่าถูกทิ้งจริงไหม
 * ไม่ต้องมี API key — เรียกตัวกรองของจริงตรง ๆ ไม่ได้เรียก AI
 */
import { jsonFromReply, sanitize } from '../src/lib/read-ai';

let pass = 0; let fail = 0;
function check(label: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass += 1; return; }
  fail += 1;
  console.log(`  ✗ ${label}\n      ได้    ${JSON.stringify(got)}\n      ควรได้ ${JSON.stringify(want)}`);
}

function main() {
  console.log('\n— ค่าว่างต้องไม่กลายเป็นค่าจริง —');
  check('ทุกช่องว่าง', sanitize({
    blNo: '', vessel: '', voyage: '', eta: '', portOfLoading: '',
    grossWeight: '', containers: [], seals: [],
  }), {});
  check('ค่า null', sanitize({ blNo: null, vessel: undefined }), {});
  check('ข้อความว่าไม่พบ ไม่ใช่ค่าจริง', sanitize({ grossWeight: 'ไม่พบ' }), {});

  console.log('\n— เลขตู้ต้องเข้ารูป ISO 6346 เท่านั้น —');
  check('เลขตู้ถูกรูป', sanitize({ containers: ['ABCD1234567'] }).containers, ['ABCD1234567']);
  check('ตัวเลขไม่ครบ 7 หลักถูกทิ้ง', sanitize({ containers: ['ABCD12345'] }).containers, undefined);
  check('ตัวอักษรไม่ครบ 4 ถูกทิ้ง', sanitize({ containers: ['ABC1234567'] }).containers, undefined);
  check('ข้อความมั่วถูกทิ้ง', sanitize({ containers: ['ไม่พบเลขตู้'] }).containers, undefined);
  check('คัดเฉพาะตัวที่ถูกรูป', sanitize({
    containers: ['ABCD1234567', 'ขยะ', 'EFGH7654321'],
  }).containers, ['ABCD1234567', 'EFGH7654321']);
  check('ตู้ซ้ำถูกตัดออก', sanitize({
    containers: ['ABCD1234567', 'ABCD1234567'],
  }).containers, ['ABCD1234567']);

  console.log('\n— ซีลต้องจับคู่กับตู้ได้พอดี —');
  check('จำนวนตรงกัน รับได้', sanitize({
    containers: ['ABCD1234567', 'EFGH7654321'], seals: ['S1', 'S2'],
  }).seals, ['S1', 'S2']);
  check('ซีลน้อยกว่าตู้ ทิ้งทั้งชุด', sanitize({
    containers: ['ABCD1234567', 'EFGH7654321'], seals: ['S1'],
  }).seals, undefined);
  check('ซีลมากกว่าตู้ ทิ้งทั้งชุด', sanitize({
    containers: ['ABCD1234567'], seals: ['S1', 'S2'],
  }).seals, undefined);
  check('ไม่มีตู้ ก็ไม่รับซีล', sanitize({ containers: [], seals: ['S1'] }).seals, undefined);

  console.log('\n— ตัวเลขต้องเป็นตัวเลขจริงและมากกว่าศูนย์ —');
  check('ตัดลูกน้ำออก', sanitize({ grossWeight: '16,900' }).grossWeight, '16900');
  check('ตัดศูนย์ท้ายทศนิยม', sanitize({ grossWeight: '16900.00' }).grossWeight, '16900');
  check('ศูนย์ไม่ใช่น้ำหนักที่ใช้ได้', sanitize({ grossWeight: '0' }).grossWeight, undefined);
  check('ติดลบไม่ใช่น้ำหนัก', sanitize({ grossWeight: '-5' }).grossWeight, undefined);
  check('ข้อความไม่ใช่ตัวเลข', sanitize({ grossWeight: 'หนักมาก' }).grossWeight, undefined);
  /*
   * เจอจริงกับใบ Namsung — สั่งให้ตอบตัวเลขล้วนแล้ว แต่เอกสารเขียนติดกัน
   * โมเดลจึงคัดลอกมาทั้ง "26,000.0000KGS" ต้องดึงตัวเลขออกมาให้ได้
   * ไม่ใช่ทิ้งน้ำหนักที่ถูกต้องไปเปล่า ๆ
   */
  check('หน่วยติดมาท้ายเลข', sanitize({ grossWeight: '26,000.0000KGS' }).grossWeight, '26000');
  check('หน่วยเว้นวรรค', sanitize({ grossWeight: '16,900.000 KGS' }).grossWeight, '16900');
  check('จำนวนหน่วยติดคำ', sanitize({ unitAmount: '13 UNITS' }).unitAmount, '13');

  console.log('\n— ค่าที่สั้นผิดปกติถูกทิ้ง (แปลว่าอ่านผิดช่อง) —');
  check('เลข BL สั้นเกินไป', sanitize({ blNo: 'A1' }).blNo, undefined);
  check('เลข BL ยาวพอ ผ่าน', sanitize({ blNo: 'AMP0559733' }).blNo, 'AMP0559733');
  check('ชื่อเรือสั้นเกินไป', sanitize({ vessel: 'A' }).vessel, undefined);
  check('เที่ยวเรือตัวเดียว', sanitize({ voyage: 'S' }).voyage, undefined);

  console.log('\n— วันที่แปลงเป็นรูปแบบเดียวกันเสมอ —');
  check('รูปแบบไทย/สากล', sanitize({ eta: '07/09/2026' }).eta, '2026-09-07');
  check('เดือนนำหน้า', sanitize({ eta: 'SEP 07 2026' }).eta, '2026-09-07');
  check('ISO อยู่แล้ว', sanitize({ eta: '2026-09-07' }).eta, '2026-09-07');
  check('วันที่มั่วถูกทิ้ง', sanitize({ eta: 'เร็ว ๆ นี้' }).eta, undefined);

  /*
   * เจอจริงตอนต่อ API ครั้งแรก — ล้มทุกใบเพราะหยิบบล็อกแรกไปตรง ๆ
   * ซึ่งเป็นบล็อก "thinking" ไม่มีช่อง text
   */
  console.log('\n— ดึง JSON จากคำตอบที่มีหลายบล็อก —');
  check('ข้ามบล็อก thinking ไปหาบล็อกข้อความ', jsonFromReply([
    { type: 'thinking', thinking: 'คิดอยู่...' },
    { type: 'text', text: '{"blNo":"AMP1234567"}' },
  ]), { blNo: 'AMP1234567' });
  check('มีรั้ว ```json ครอบก็ยังอ่านได้', jsonFromReply([
    { type: 'text', text: '```json\n{"blNo":"Y"}\n```' },
  ]), { blNo: 'Y' });
  check('มีคำอธิบายนำหน้าก็ยังอ่านได้', jsonFromReply([
    { type: 'text', text: 'นี่คือผลลัพธ์: {"blNo":"Z"} ครับ' },
  ]), { blNo: 'Z' });

  const throws = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };
  check('ไม่มีบล็อกข้อความ ต้องโยน error', throws(() => jsonFromReply([
    { type: 'thinking', thinking: 'คิดอย่างเดียว' },
  ])), true);
  check('ตอบมาไม่มี JSON ต้องโยน error', throws(() => jsonFromReply([
    { type: 'text', text: 'ขอโทษครับ อ่านไม่ออก' },
  ])), true);
  check('JSON พังต้องโยน error', throws(() => jsonFromReply([
    { type: 'text', text: '{"blNo": }' },
  ])), true);
  check('content ไม่ใช่ลิสต์ ต้องโยน error', throws(() => jsonFromReply(null)), true);

  console.log(`\nสรุป ผ่าน ${pass} · ไม่ผ่าน ${fail}`);
  if (fail) process.exit(1);
}

main();
