import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import { type SQL } from 'drizzle-orm';
import { searchCondition } from '../src/lib/queries/jobs';

/**
 * ตรวจการค้นด้วยชื่อเรือต่อเที่ยวเรือ
 *
 * เรือลำเดียวกันวิ่งหลายเที่ยว งานคนละเที่ยวจึงคนละชุด การค้นด้วยชื่อเรืออย่างเดียว
 * ได้งานปนกันทุกเที่ยว ซึ่งไม่ตรงกับที่คนทำงานถามว่า "ของเที่ยวนี้มีอะไรบ้าง"
 *
 * จุดที่พลาดง่ายคือตัวคั่น — บนจอเป็น "BANGKOK BRIDGE / 0518W" ในไฟล์ตารางเป็น
 * "BANGKOK BRIDGE V.0518W" ส่วนคนพิมพ์มักเว้นวรรคเฉย ๆ ถ้าเทียบตรง ๆ จะพิมพ์
 * ตามที่เห็นบนจอแล้วไม่เจอ ซึ่งงงกว่าไม่มีช่องค้นหาเลย
 *
 * ดูที่ SQL ที่ประกอบออกมา ไม่ต้องต่อฐานข้อมูล
 */

const dialect = new PgDialect();
const build = (value: string) => {
  const condition = searchCondition('vessel', value);
  assert.ok(condition, 'ต้องสร้างเงื่อนไขได้');
  return dialect.sqlToQuery(condition as SQL);
};

function shapeTest() {
  const q = build('BANGKOK BRIDGE 0518W');

  // ต้องต่อชื่อเรือกับเที่ยวเรือก่อนเทียบ ไม่ใช่ค้นแค่ช่อง vessel
  assert.match(q.sql, /vessel/i);
  assert.match(q.sql, /voyage/i);
  // ตัดอักขระที่ไม่ใช่ตัวอักษรหรือตัวเลขทั้งสองฝั่ง ตัวคั่นจึงไม่มีผล
  assert.match(q.sql, /regexp_replace/i);
  // งานที่ไม่มีเที่ยวเรือต้องยังค้นเจอด้วยชื่อเรือ ไม่ใช่หายไปเพราะ null
  assert.match(q.sql, /coalesce/i);

  console.log('PASS: ค้นจากชื่อเรือต่อเที่ยวเรือ และงานที่ไม่มีเที่ยวยังเจอ');
}

function separatorTest() {
  /*
   * ตัวคั่นทุกแบบที่คนพิมพ์จริงต้องให้ค่าค้นเดียวกัน
   * เพราะฝั่ง SQL ตัดอักขระพวกนี้ทิ้งเหมือนกันทั้งสองฝั่ง
   */
  const expected = '%BANGKOKBRIDGE0518W%';
  for (const typed of [
    'BANGKOK BRIDGE 0518W',      // เว้นวรรคเฉย ๆ
    'BANGKOK BRIDGE / 0518W',    // ตามที่เห็นบนจอ
    'BANGKOK BRIDGE V.0518W',    // ตามไฟล์ตารางงาน
    'BANGKOK-BRIDGE-0518W',      // ขีดคั่น
    'BANGKOKBRIDGE0518W',        // ติดกันหมด
  ]) {
    assert.deepEqual(build(typed).params, [expected],
      `พิมพ์ "${typed}" ต้องได้ค่าค้นเดียวกัน`);
  }

  console.log('PASS: ตัวคั่นทุกแบบให้ผลเหมือนกัน — พิมพ์ตามที่เห็นบนจอก็เจอ');
}

/**
 * ตัว V ที่เป็นส่วนหนึ่งของชื่อจริง ต้องไม่ถูกตัดทิ้งไปกับตัวคั่น
 *
 * ตัดตัวคั่น "V." ออกเพื่อให้คัดลอกจากไฟล์ตารางมาวางแล้วค้นเจอ
 * แต่ถ้าตัดกว้างเกินไปจะไปโดนชื่อเรือที่มี V อยู่ด้วย แล้วค้นชื่อนั้นไม่เจอแทน
 * ซึ่งเป็นการแก้ปัญหาหนึ่งแล้วสร้างอีกปัญหาที่หายากกว่าเดิม
 */
function keepRealVTest() {
  // V ท้ายคำที่ตามด้วยตัวอักษร ไม่ใช่ตัวคั่น
  assert.deepEqual(build('VICTORY').params, ['%VICTORY%'], 'ชื่อที่ขึ้นต้นด้วย V ต้องอยู่ครบ');
  assert.deepEqual(build('EVER GIVEN').params, ['%EVERGIVEN%']);
  // V เดี่ยว ๆ ที่ตามด้วยตัวอักษร ไม่ใช่ตัวเลข ถือเป็นส่วนของชื่อ
  assert.deepEqual(build('MV HUSSEN').params, ['%MVHUSSEN%'], 'MV เป็นคำนำหน้าชื่อเรือ ไม่ใช่ตัวคั่น');

  console.log('PASS: ตัว V ที่เป็นส่วนของชื่อเรือไม่ถูกตัดทิ้ง');
}

function partialTest() {
  /* พิมพ์ชื่อเรืออย่างเดียวยังต้องเจอทุกเที่ยวเหมือนเดิม ไม่ใช่บังคับให้ใส่เที่ยวด้วย */
  assert.deepEqual(build('BANGKOK BRIDGE').params, ['%BANGKOKBRIDGE%']);
  /* พิมพ์เฉพาะเที่ยวก็ต้องเจอ เพราะเป็นการค้นแบบมีคำนั้นอยู่ข้างใน */
  assert.deepEqual(build('0518W').params, ['%0518W%']);

  console.log('PASS: ค้นชื่อเรืออย่างเดียว หรือเที่ยวอย่างเดียว ก็ยังเจอ');
}

function junkTest() {
  /*
   * พิมพ์มาแต่ตัวคั่น — ไม่เหลืออะไรให้ค้น
   *
   * ถ้าปล่อยผ่านจะกลายเป็นค้นด้วยค่าว่างซึ่ง match ทุกแถว
   * แล้วดูเหมือนตัวกรองไม่ทำงาน จึงต้องไม่คืนงานไหนเลย
   */
  for (const junk of ['/', 'V.', '  /  ', '---']) {
    const q = build(junk);
    assert.match(q.sql, /false/i, `"${junk}" ต้องไม่ match ทุกแถว`);
    assert.deepEqual(q.params, [], 'ไม่ควรมีค่าค้นติดไป');
  }

  console.log('PASS: พิมพ์แต่ตัวคั่น ไม่คืนงานทั้งตาราง');
}

shapeTest();
separatorTest();
keepRealVTest();
partialTest();
junkTest();
console.log('\nทั้งหมดผ่าน');
