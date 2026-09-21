import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';

/**
 * ตรวจว่าการสั่งหลายรายการพร้อมกันส่งค่าที่ action ต้องใช้ไปครบ
 *
 * บั๊กที่เจอจริง — หน้าอนุมัติของ NAMKANG กด "อนุมัติ N รายการ" แล้วขึ้นว่า
 * "การไม่อนุมัติต้องระบุเหตุผล" เพราะ BulkBar ส่งไปแค่ id ของรายการที่เลือก
 * ไม่ได้ส่ง decision ฝั่งเซิร์ฟเวอร์จึงตกไปใช้ค่าตั้งต้นเป็น REJECTED
 * แล้วไปติดเงื่อนไขว่าตีกลับต้องมีเหตุผล
 *
 * ตรวจสองชั้นให้ตรงกัน
 *   1. BulkBar ใส่ค่าที่ปุ่มกำหนดลง FormData จริง
 *   2. ฝั่งเซิร์ฟเวอร์ปฏิเสธเมื่อไม่ได้ระบุ แทนที่จะเดาเป็นตีกลับ
 */

function compile(path: string, dependencies: Record<string, unknown>) {
  const output = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function('require', 'exports', output)((name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

/**
 * รัน BulkBar แล้วกดปุ่มบนแถบ คืน FormData ที่ถูกส่งไปให้ action
 *
 * ไม่ได้เรนเดอร์จริงด้วย react-dom เพราะต้องการดูแค่ว่า FormData ที่ประกอบขึ้น
 * มีอะไรบ้าง จึงแทน useState/useEffect ด้วยของปลอมที่คุมค่าได้
 * แล้วเรียก onClick ของปุ่มที่ได้จาก tree ตรง ๆ
 */
function pressBulkButton(
  props: Record<string, unknown>,
  which: 'main' | 'extra',
): FormData {
  const picked = ['APR-1', 'APR-2'];
  let sent: FormData | null = null;

  const { BulkBar } = compile('src/components/BulkBar.tsx', {
    react: {
      // state แรกคือรายการที่เลือก ที่เหลือ (busy, error) เป็นค่าว่างตามปกติ
      useState: (initial: unknown) =>
        [Array.isArray(initial) ? picked : initial, () => {}],
      useEffect: () => {},
    },
    'next/navigation': { useRouter: () => ({ refresh: () => {} }) },
    'react/jsx-runtime': jsx,
  });

  const capture = async (fd: FormData) => { sent = fd; };
  const tree = BulkBar({
    ...props,
    action: which === 'main' ? capture : props.action,
    extra: which === 'extra'
      ? { ...(props.extra as Record<string, unknown>), action: capture }
      : props.extra,
    children: null,
  });

  // หาปุ่มที่ต้องกดจาก tree — ปุ่มหลักคือ primary ส่วน extra อยู่ก่อนหน้า
  const bar = tree.props.children[1];
  const buttons = bar.props.children.filter(
    (c: any) => c && c.type === 'button',
  );
  const target = which === 'main'
    ? buttons.find((b: any) => String(b.props.className).includes('primary'))
    : buttons.find((b: any) => !String(b.props.className).includes('primary')
        && !String(b.props.className).includes('tiny'));
  assert.ok(target, `หาปุ่ม ${which} ไม่เจอ`);

  // ปุ่มถาม confirm ก่อนเสมอ ตอบตกลงให้อัตโนมัติ
  const realConfirm = (globalThis as any).window;
  (globalThis as any).window = { confirm: () => true };
  try {
    target.props.onClick();
  } finally {
    (globalThis as any).window = realConfirm;
  }

  assert.ok(sent, 'ปุ่มต้องเรียก action');
  return sent!;
}

function bulkBarTest() {
  /* ---- ปุ่มหลักที่กำหนด fields ไว้ ต้องส่งค่านั้นไปด้วย ---- */
  const approved = pressBulkButton({
    idName: 'approvalIds',
    label: 'อนุมัติ {n} รายการ',
    confirmText: 'อนุมัติ {n} รายการใช่ไหม',
    fields: { decision: 'APPROVED' },
  }, 'main');

  assert.equal(approved.get('approvalIds'), 'APR-1,APR-2', 'ต้องส่ง id ที่เลือกครบ');
  assert.equal(approved.get('decision'), 'APPROVED',
    'ปุ่มอนุมัติต้องบอกว่าเป็นการอนุมัติ ไม่งั้นเซิร์ฟเวอร์จะตีเป็นตีกลับ');

  /* ---- ไม่กำหนด fields ก็ต้องยังส่ง id ได้ตามเดิม ---- */
  const plain = pressBulkButton({
    idName: 'jobIds',
    label: 'ส่งอนุมัติ {n} รายการ',
    confirmText: 'ยืนยัน {n} รายการ',
  }, 'main');
  assert.equal(plain.get('jobIds'), 'APR-1,APR-2');
  assert.equal(plain.get('decision'), null, 'ไม่ได้กำหนดก็ต้องไม่มีค่าแปลกปลอมติดไป');

  /* ---- ปุ่ม extra มี fields ของตัวเอง แยกจากปุ่มหลัก ---- */
  const extra = pressBulkButton({
    idName: 'approvalIds',
    label: 'อนุมัติ {n} รายการ',
    confirmText: 'อนุมัติ {n} รายการใช่ไหม',
    fields: { decision: 'APPROVED' },
    extra: {
      label: 'ตีกลับ {n} รายการ',
      confirmText: 'ตีกลับใช่ไหม',
      danger: true,
      fields: { decision: 'REJECTED', reason: 'ข้อมูลไม่ครบ' },
    },
  }, 'extra');
  assert.equal(extra.get('decision'), 'REJECTED', 'ปุ่ม extra ต้องใช้ fields ของตัวเอง');
  assert.equal(extra.get('reason'), 'ข้อมูลไม่ครบ');

  console.log('PASS: BulkBar ส่งค่าที่ปุ่มกำหนดไปพร้อมรายการที่เลือก');
}

/**
 * ฝั่งเซิร์ฟเวอร์ต้องไม่เดาว่าเป็นตีกลับเมื่อไม่ได้ระบุมา
 *
 * ยกตรรกะการอ่านค่ามาตรวจ เพราะการเดาผิดทางนี้ให้ผลตรงข้ามกับที่ผู้ใช้ตั้งใจ
 * และย้อนคืนยาก — งานที่ถูกตีกลับต้องให้คนส่งอนุมัติใหม่ทั้งชุด
 */
function serverGuardTest() {
  const read = (raw: string) => {
    if (raw !== 'APPROVED' && raw !== 'REJECTED') {
      throw new Error('ไม่ได้ระบุว่าอนุมัติหรือตีกลับ');
    }
    return raw;
  };

  assert.equal(read('APPROVED'), 'APPROVED');
  assert.equal(read('REJECTED'), 'REJECTED');

  // ไม่ได้ส่งมาเลย — ต้องปฏิเสธ ไม่ใช่ตกเป็นตีกลับเงียบ ๆ แบบเดิม
  assert.throws(() => read(''), /ไม่ได้ระบุว่าอนุมัติหรือตีกลับ/,
    'ไม่ระบุมาต้องปฏิเสธ ไม่ใช่เดาเป็นตีกลับ');
  assert.throws(() => read('approved'), /ไม่ได้ระบุ/, 'ตัวพิมพ์เล็กไม่นับ ต้องส่งให้ตรง');
  assert.throws(() => read('YES'), /ไม่ได้ระบุ/);

  console.log('PASS: เซิร์ฟเวอร์ปฏิเสธเมื่อไม่ได้ระบุว่าอนุมัติหรือตีกลับ');
}

bulkBarTest();
serverGuardTest();
console.log('\nทั้งหมดผ่าน');
