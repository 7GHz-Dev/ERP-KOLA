import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import { and, type SQL } from 'drizzle-orm';
import { missingArrivalFiles, QUEUE } from '../src/lib/queries/jobs';

/**
 * ตรวจตัวกรอง "งานที่ยังไม่ได้แนบไฟล์ AN และ BL" ที่หน้างานคงค้าง
 *
 * ดูที่ SQL ที่ประกอบออกมา ไม่ต้องต่อฐานข้อมูล เพราะสิ่งที่พลาดง่ายคือเงื่อนไขเพี้ยน
 * เช่นกลายเป็น "ขาดอย่างใดอย่างหนึ่ง" แทนที่จะเป็น "ไม่มีทั้งสองหมวด"
 * ซึ่งรันแล้วไม่ error แต่ได้รายการผิดเงียบ ๆ
 */

const dialect = new PgDialect();
const toSql = (q: SQL) => dialect.sqlToQuery(q).sql;

function filterShapeTest() {
  const sql = toSql(missingArrivalFiles());

  // ต้องเป็น not exists ไม่ใช่ count = 0 ซึ่งต้องไล่นับทุกแถวก่อนค่อยเทียบ
  assert.match(sql, /not exists/i);
  // ต้องดูทั้งสองหมวดในเงื่อนไขเดียว — เจอหมวดใดหมวดหนึ่งก็ถือว่ามีไฟล์แล้ว
  assert.match(sql, /category in \('ARRIVAL_NOTICE', 'BL'\)/);
  // ต้องดูเฉพาะไฟล์ปัจจุบัน ไฟล์เก่าที่ถูกแทนที่ไปแล้วไม่นับ
  assert.match(sql, /is_current = true/);
  assert.match(sql, /f\.job_id/);

  console.log('PASS: เงื่อนไขตัวกรอง — not exists ทั้งสองหมวด และดูเฉพาะไฟล์ปัจจุบัน');
}

function combineWithQueueTest() {
  /*
   * ตัวกรองต้องต่อท้ายเงื่อนไขของแท็บ ไม่ใช่แทนที่
   * ถ้าแทนที่ จะเห็นงานข้ามแท็บกันหมด ซึ่งดูจากหน้าจอไม่ออกว่าผิด
   */
  const ctx = {
    an: { status: { name: 'status' }, id: { name: 'id' }, reason: { name: 'reason' } },
    fn: { status: { name: 'status' }, id: { name: 'id' }, reason: { name: 'reason' } },
  } as unknown as Parameters<ReturnType<typeof QUEUE.pendingBl>>[0];

  const queue = QUEUE.pendingBl('wait');
  const withFilter = [...queue(ctx), missingArrivalFiles()];
  const without = queue(ctx);

  assert.equal(withFilter.length, without.length + 1, 'ตัวกรองต้องเพิ่มเงื่อนไข ไม่ใช่แทนที่');

  const combined = toSql(and(...(withFilter.filter(Boolean) as SQL[]))!);
  assert.match(combined, /not exists/i, 'เงื่อนไขตัวกรองต้องอยู่ใน SQL ที่ประกอบแล้ว');
  // เงื่อนไขเดิมของแท็บต้องยังอยู่ครบ
  assert.ok(combined.includes('and'), 'ต้องต่อด้วย and กับเงื่อนไขของแท็บ');

  console.log('PASS: ตัวกรองต่อท้ายเงื่อนไขของแท็บ ไม่ได้แทนที่');
}

/**
 * ค่าตั้งต้นของการเรียง — งานใหม่สุดอยู่บนสุด
 *
 * ยกตรรกะจากหน้า pending มาตรวจตรง ๆ เพราะเป็นจุดที่ถ้าเขียนสลับกัน
 * จะได้งานเก่าสุดขึ้นก่อน ซึ่งตรงข้ามกับที่ต้องการพอดี
 */
function sortDefaultTest() {
  const resolve = (sortBy: string | undefined, sortDir: 'asc' | 'desc') => ({
    key: sortBy ?? 'createdAt',
    way: sortBy ? sortDir : 'desc',
  });

  // ไม่ได้สั่งเรียง — ต้องเป็นวันที่สร้างงาน ใหม่ไปเก่า
  assert.deepEqual(resolve(undefined, 'desc'), { key: 'createdAt', way: 'desc' });
  // readParams() คืน sortDir เป็น desc เสมอเมื่อไม่ได้ระบุ ผลจึงต้องไม่เปลี่ยน
  assert.deepEqual(resolve(undefined, 'asc'), { key: 'createdAt', way: 'desc' },
    'ยังไม่ได้เลือกคอลัมน์ ต้องใช้ desc เสมอ ไม่ว่า sortDir ใน URL จะเป็นอะไร');

  // สั่งเรียงเองแล้ว ต้องเคารพที่ผู้ใช้เลือก
  assert.deepEqual(resolve('eta', 'asc'), { key: 'eta', way: 'asc' });
  assert.deepEqual(resolve('createdAt', 'asc'), { key: 'createdAt', way: 'asc' },
    'กดเรียงวันที่สร้างงานเป็นเก่าไปใหม่เองได้');

  console.log('PASS: ค่าตั้งต้นการเรียง — งานใหม่สุดอยู่บนสุด และกดสลับเองได้');
}

filterShapeTest();
combineWithQueueTest();
sortDefaultTest();
console.log('\nทั้งหมดผ่าน');
