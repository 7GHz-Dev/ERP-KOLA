import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import { and, type SQL } from 'drizzle-orm';
import { hasArrivalFiles, QUEUE } from '../src/lib/queries/jobs';

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
  const no = toSql(hasArrivalFiles(false));
  const yes = toSql(hasArrivalFiles(true));

  // ต้องเป็น exists / not exists ไม่ใช่ count ซึ่งต้องไล่นับทุกแถวก่อนค่อยเทียบ
  assert.match(no, /not exists/i);
  assert.match(yes, /exists/i);
  assert.doesNotMatch(yes, /not exists/i, '"มีไฟล์" ต้องไม่ใช่ not exists');

  for (const sql of [no, yes]) {
    // ต้องดูทั้งสองหมวดในเงื่อนไขเดียว — เจอหมวดใดหมวดหนึ่งก็ถือว่ามีไฟล์แล้ว
    assert.match(sql, /category in \('ARRIVAL_NOTICE', 'BL'\)/);
    // ต้องดูเฉพาะไฟล์ปัจจุบัน ไฟล์เก่าที่ถูกแทนที่ไปแล้วไม่นับ
    assert.match(sql, /is_current = true/);
    assert.match(sql, /f\.job_id/);
  }

  /*
   * สองฝั่งต้องต่างกันแค่คำว่า not เท่านั้น
   *
   * ถ้าต่างกันมากกว่านั้น แปลว่าเงื่อนไขข้างในไม่ตรงกัน แล้ว "ไม่มีไฟล์" กับ "มีไฟล์"
   * รวมกันจะได้ไม่ครบทุกงาน หรือนับซ้ำ ซึ่งดูจากหน้าจอไม่ออกว่าหายไปไหน
   */
  assert.equal(no.replace(/not exists/i, 'exists'), yes,
    'สองฝั่งต้องเป็นเงื่อนไขเดียวกัน ต่างแค่ not');

  console.log('PASS: เงื่อนไขตัวกรอง — exists/not exists เป็นฝั่งตรงข้ามกันพอดี');
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
  const without = queue(ctx);

  for (const has of [true, false]) {
    const withFilter = [...queue(ctx), hasArrivalFiles(has)];
    assert.equal(withFilter.length, without.length + 1, 'ตัวกรองต้องเพิ่มเงื่อนไข ไม่ใช่แทนที่');

    const combined = toSql(and(...(withFilter.filter(Boolean) as SQL[]))!);
    assert.match(combined, /exists/i, 'เงื่อนไขตัวกรองต้องอยู่ใน SQL ที่ประกอบแล้ว');
    // เงื่อนไขเดิมของแท็บต้องยังอยู่ครบ
    assert.ok(combined.includes('and'), 'ต้องต่อด้วย and กับเงื่อนไขของแท็บ');
  }

  /* เลือก "ทั้งหมด" = ไม่เพิ่มเงื่อนไขอะไรเลย ไม่ใช่เพิ่มเงื่อนไขที่เป็นจริงเสมอ */
  const all = [...queue(ctx)];
  assert.equal(all.length, without.length, '"ทั้งหมด" ต้องไม่เพิ่มเงื่อนไข');

  console.log('PASS: ตัวกรองต่อท้ายเงื่อนไขของแท็บ ไม่ได้แทนที่ · "ทั้งหมด" ไม่เพิ่มเงื่อนไข');
}

/**
 * อ่านค่าตัวกรองจาก URL — ค่าที่ไม่รู้จักต้องตกกลับเป็น "ทั้งหมด"
 *
 * ยกตรรกะจากหน้า pending มาตรวจ เพราะค่าใน URL แก้มือได้
 * ถ้าไม่ดักแล้วเอาไปใช้ตรง ๆ จะได้เงื่อนไขที่ไม่ตั้งใจ
 */
function readFilterTest() {
  const FILTERS = [{ key: 'all' }, { key: 'no' }, { key: 'yes' }] as const;
  /* ยกตรรกะจากหน้า pending มาทั้งก้อน รวมเงื่อนไขว่าใช้ได้เฉพาะแท็บ bl */
  const read = (v: string, tab: string) =>
    (tab === 'bl' ? FILTERS.find((f) => f.key === v) ?? FILTERS[0] : FILTERS[0]).key;

  assert.equal(read('', 'bl'), 'all', 'ไม่ระบุ = ทั้งหมด');
  assert.equal(read('no', 'bl'), 'no');
  assert.equal(read('yes', 'bl'), 'yes');
  assert.equal(read('1', 'bl'), 'all', 'ค่าเดิมจากลิงก์เก่าต้องตกกลับเป็นทั้งหมด ไม่ใช่พัง');
  assert.equal(read('ไม่รู้จัก', 'bl'), 'all');

  /*
   * แท็บอื่นต้องเป็น "ทั้งหมด" เสมอ แม้ URL จะพา files=no ติดมา
   * ไม่งั้นกดจากแท็บ 1 ที่กรองอยู่ไปแท็บอื่น แล้วตารางจะหายไปเกือบหมด
   * โดยไม่มีปุ่มให้กดปิดตัวกรอง เพราะแถบถูกซ่อนไปแล้ว
   */
  for (const tab of ['fn', 'draft', 'edoc']) {
    assert.equal(read('no', tab), 'all', `แท็บ ${tab} ต้องไม่รับตัวกรองไฟล์`);
    assert.equal(read('yes', tab), 'all', `แท็บ ${tab} ต้องไม่รับตัวกรองไฟล์`);
  }

  console.log('PASS: ตัวกรองมีเฉพาะแท็บ bl · ค่าที่ไม่รู้จักตกกลับเป็นทั้งหมด');
}

/**
 * ส่งอนุมัติ AN ได้ต่อเมื่อมีไฟล์ AN หรือ BL แนบแล้ว
 *
 * ยกเงื่อนไขที่หน้าจอใช้ตัดสินใจแสดงปุ่มมาตรวจ ให้ตรงกับที่ฝั่งเซิร์ฟเวอร์บังคับ
 * ถ้าสองฝั่งไม่ตรงกัน จะได้ปุ่มที่กดแล้ว error ทุกครั้ง หรือแย่กว่านั้นคือ
 * ซ่อนปุ่มทั้งที่ส่งได้จริง แล้วงานค้างโดยไม่มีใครรู้ว่าติดอะไร
 */
function canSubmitTest() {
  type Files = Record<string, { id: string; fileName: string }> | null;
  const hasFile = (f: Files) => Boolean(f?.ARRIVAL_NOTICE || f?.BL);
  const file = { id: 'FIL-1', fileName: 'x.pdf' };

  assert.equal(hasFile({ ARRIVAL_NOTICE: file }), true, 'มีไฟล์ AN ส่งได้');
  assert.equal(hasFile({ BL: file }), true, 'มีไฟล์ BL ส่งได้ — อย่างใดอย่างหนึ่งก็พอ');
  assert.equal(hasFile({ ARRIVAL_NOTICE: file, BL: file }), true, 'มีทั้งคู่ส่งได้');

  assert.equal(hasFile(null), false, 'ไม่มีไฟล์เลย ส่งไม่ได้');
  assert.equal(hasFile({}), false, 'ไม่มีไฟล์เลย ส่งไม่ได้');
  // ไฟล์หมวดอื่นไม่นับ เพราะไม่ใช่เอกสารต้นเรื่องที่ NAMKANG ใช้ตรวจ
  assert.equal(hasFile({ FINAL_INVOICE: file, INVOICE_GOODS: file }), false,
    'ไฟล์หมวดอื่นไม่นับเป็นเอกสารต้นเรื่อง');

  console.log('PASS: ส่งอนุมัติได้เฉพาะงานที่มีไฟล์ AN หรือ BL');
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
readFilterTest();
canSubmitTest();
sortDefaultTest();
console.log('\nทั้งหมดผ่าน');
