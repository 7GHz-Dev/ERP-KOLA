import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePassword } from '../src/lib/password';

/**
 * กติกาบัญชีผู้ใช้หลังปลดการล็อกและปลดข้อบังคับรหัสผ่าน
 *
 * สองอย่างนี้ถอยกลับได้ง่ายโดยไม่ตั้งใจ เพราะโค้ดเดิมดูเหมือน "ของที่ควรมี"
 * ใครมาอ่านทีหลังอาจเติมกลับเข้าไปด้วยความหวังดี test นี้จึงเป็นตัวบันทึกว่า
 * เจ้าของระบบเลือกแบบนี้ ไม่ใช่โค้ดหล่นหาย
 */

function passwordTest() {
  // ตั้งอะไรก็ได้ รวมถึงรหัสสั้นและตัวเลขล้วน
  for (const value of ['1234', 'a', 'abc', '        x', 'รหัสไทย', '0']) {
    assert.equal(validatePassword(value), value, `ต้องตั้ง "${value}" ได้`);
  }

  /*
   * ค่าว่างและช่องว่างล้วนยังต้องไม่ผ่าน
   * ไม่ใช่ "รหัสที่ตั้งใจตั้ง" แต่เป็นการกดข้ามช่อง ซึ่งจะได้บัญชีที่ใครก็เข้าได้
   */
  for (const bad of ['', '   ', '\t', '\n']) {
    assert.throws(() => validatePassword(bad), /กรุณากรอกรหัสผ่าน/,
      `"${JSON.stringify(bad)}" ต้องไม่ผ่าน`);
  }

  console.log('PASS: ตั้งรหัสผ่านได้อิสระ แต่เว้นว่างไม่ได้');
}

function noLockTest() {
  const auth = readFileSync(new URL('../src/lib/auth.ts', import.meta.url), 'utf8');

  /*
   * อ่านจากไฟล์ตรง ๆ เพราะการล็อกอินต้องต่อฐานข้อมูล จำลองยาก
   * สิ่งที่ต้องรับประกันคือ "ไม่มีโค้ดที่เขียนค่า locked_until หรือปฏิเสธเพราะถูกล็อก"
   * ซึ่งดูจากตัวไฟล์ได้ชัดกว่าและไม่ต้องพึ่งฐานข้อมูล
   */
  assert.doesNotMatch(auth, /ACCOUNT_LOCKED/,
    'ต้องไม่มีการปฏิเสธเพราะบัญชีถูกล็อก');
  assert.doesNotMatch(auth, /LOCK_MINUTES|MAX_FAILED/,
    'ต้องไม่มีเกณฑ์จำนวนครั้งหรือระยะเวลาล็อกเหลืออยู่');
  assert.doesNotMatch(auth, /lockedUntil:\s*new Date/,
    'ต้องไม่มีการตั้งเวลาล็อกบัญชี');

  // ยังต้องนับจำนวนครั้งที่ผิดและบันทึกไว้ เพื่อให้ย้อนดูได้ว่ามีใครเดารหัส
  assert.match(auth, /failedAttempts: failed/, 'ยังต้องนับจำนวนครั้งที่กรอกผิด');
  assert.match(auth, /LOGIN_FAILED/, 'ยังต้องบันทึกการล็อกอินที่ไม่ผ่าน');

  // บัญชีที่ถูกระงับต้องยังเข้าไม่ได้ — คนละเรื่องกับการล็อกเพราะกรอกรหัสผิด
  assert.match(auth, /ACCOUNT_DISABLED/, 'บัญชีที่ถูกระงับต้องยังเข้าไม่ได้');

  console.log('PASS: ไม่มีการล็อกบัญชีเมื่อกรอกรหัสผิด แต่ยังบันทึกร่องรอยไว้');
}

function formsTest() {
  /*
   * ฝั่งหน้าจอต้องไม่บังคับซ้ำ ไม่งั้นเบราว์เซอร์จะไม่ให้กดส่งตั้งแต่แรก
   * แล้วผู้ใช้จะเจอ "ตั้งรหัสสั้นไม่ได้" ทั้งที่ฝั่งเซิร์ฟเวอร์ยอมแล้ว
   */
  const files = [
    '../src/app/(app)/account/password/page.tsx',
    '../src/components/UserForms.tsx',
  ];
  for (const file of files) {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /minLength=\{10\}/,
      `${file} ต้องไม่บังคับความยาวรหัสผ่านที่ฝั่งหน้าจอ`);
  }

  console.log('PASS: ฝั่งหน้าจอไม่บังคับกติการหัสผ่านซ้ำ');
}

function mustChangeTest() {
  /*
   * การบังคับเปลี่ยนรหัสครั้งแรกยังอยู่ — เจ้าของระบบเลือกให้คงไว้
   * กันไม่ให้ผู้ใช้ทำงานด้วยรหัสที่คนอื่น (ADMIN) เป็นคนตั้งและรู้ค่าอยู่
   */
  const users = readFileSync(new URL('../src/lib/actions/users.ts', import.meta.url), 'utf8');
  const count = (users.match(/mustChangePassword: true/g) ?? []).length;
  assert.equal(count, 2, 'ทั้งตอนเพิ่มผู้ใช้และตอนรีเซ็ตรหัส ต้องบังคับเปลี่ยนครั้งแรก');

  const auth = readFileSync(new URL('../src/lib/auth.ts', import.meta.url), 'utf8');
  assert.match(auth, /mustChangePassword\) redirect\('\/account\/password'\)/,
    'ต้องยังพาไปหน้าเปลี่ยนรหัสก่อนใช้งาน');

  console.log('PASS: ยังบังคับเปลี่ยนรหัสครั้งแรก');
}

passwordTest();
noLockTest();
formsTest();
mustChangeTest();
console.log('\nทั้งหมดผ่าน');
