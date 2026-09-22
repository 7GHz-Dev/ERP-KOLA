import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import { db } from '../src/db';
import { doQueueArrivalDates, searchCondition } from '../src/lib/queries/jobs';

/**
 * ตัวกรอง "วันที่ส่งรายการมา" ของหน้า ANN และ MAY
 *
 * ดักที่ db.execute แล้วอ่าน SQL ที่ประกอบออกมา ไม่ต้องต่อฐานข้อมูลจริง
 *
 * จุดที่พลาดแล้วดูไม่ออกคือการตัดวันด้วยเขตเวลา ของที่ส่งตอนเย็นเวลาไทย
 * ใน UTC เป็นวันถัดไปแล้ว ถ้าตัดด้วย UTC ตัวเลือกกับคอลัมน์ในตารางจะคนละวันกัน
 * ซึ่งหน้าจอยังดูปกติทุกอย่าง แค่กรองแล้วได้ของผิดวัน
 */

const dialect = new PgDialect();

async function capture(scope: 'wait' | 'sent', rows: unknown[]) {
  const original = db.execute;
  let text = '';
  (db as unknown as { execute: unknown }).execute = (async (q: Parameters<typeof db.execute>[0]) => {
    text = dialect.sqlToQuery(q as ReturnType<typeof import('drizzle-orm').sql>).sql;
    return rows;
  }) as typeof db.execute;
  try {
    // ต้อง await ให้เสร็จก่อนค่อยอ่าน text ไม่งั้นได้ค่าว่างเพราะยังไม่ถูกเขียน
    const result = await doQueueArrivalDates(scope);
    return { sql: text, result };
  } finally {
    db.execute = original;
  }
}

async function sqlTest() {
  const { sql } = await capture('wait', []);

  // ต้องตัดวันด้วยเขตเวลาไทย ให้ตรงกับที่ formatDateTime() แสดงบนหน้าจอ
  assert.match(sql, /at time zone 'Asia\/Bangkok'/, 'ต้องตัดวันด้วยเขตเวลาไทย');
  // เวลาที่รายการเข้าคิวมาได้สองทาง ต้องเอาเวลาแรกสุด
  assert.match(sql, /least\(/, 'ต้องใช้เวลาแรกสุดจากสองทาง');
  assert.match(sql, /eoffice_sent_at/, 'ต้องนับทางที่ PAINT ส่ง');
  assert.match(sql, /do_handoffs/, 'ต้องนับทางที่ FAH ส่ง');
  assert.match(sql, /is_archived = false/, 'งานที่เก็บเข้ากรุแล้วต้องไม่นับ');

  console.log('PASS: SQL ตัดวันด้วยเขตเวลาไทยและนับครบทั้งสองทาง');
}

async function scopeTest() {
  /*
   * สองแท็บต้องคนละเงื่อนไขกัน
   * ถ้าเหมือนกัน แท็บบันทึกย้อนหลังจะได้ช่องเลือกว่างเปล่าทั้งที่ตารางมีรายการเต็ม
   */
  const wait = (await capture('wait', [])).sql;
  const sentSql = (await capture('sent', [])).sql;

  assert.match(wait, /do_exchanged_at is null/, 'ฝั่งรอทำต้องเอางานที่ยังไม่ส่งแลก');
  assert.match(sentSql, /do_exchanged_at is not null/, 'ฝั่งส่งแล้วต้องเอางานที่ส่งแลกแล้ว');
  assert.notEqual(wait, sentSql, 'สองแท็บต้องไม่ใช้เงื่อนไขเดียวกัน');

  console.log('PASS: ตัวเลือกแยกตามแท็บที่เปิดอยู่');
}

async function shapeTest() {
  const { result } = await capture('wait', [
    { day: '2026-09-22', count: 7 },
    { day: new Date('2026-09-21T00:00:00Z'), count: 3 },
  ]);

  assert.equal(result.length, 2);
  // ค่าที่ส่งเข้าช่องค้นหาเป็น YYYY-MM-DD ส่วนป้ายเป็นรูปแบบที่คนอ่าน
  assert.equal(result[0].value, '2026-09-22');
  assert.equal(result[0].label, '22/09/2026');
  assert.equal(result[0].count, 7);

  /*
   * driver คืนค่า date มาเป็น Date หรือข้อความก็ได้ แล้วแต่ทาง
   * ทั้งสองแบบต้องได้ค่าเดียวกัน ไม่งั้นตัวเลือกบางตัวจะกดแล้วตารางว่าง
   */
  assert.equal(result[1].value, '2026-09-21', 'ค่าที่เป็น Date ต้องแปลงได้เหมือนข้อความ');
  assert.equal(result[1].label, '21/09/2026');

  console.log('PASS: ป้ายกับค่าที่ส่งเข้าช่องค้นหาถูกต้อง รับทั้ง Date และข้อความ');
}

async function roundTripTest() {
  /*
   * ค่าจาก dropdown ต้องกรองเจอจริง — เป็นจุดที่ขาดกันบ่อยเวลาแก้ฝั่งใดฝั่งหนึ่ง
   * แล้วได้ตัวเลือกที่กดแล้วตารางว่าง ซึ่งเป็นอาการที่หาต้นเหตุยาก
   */
  const { result } = await capture('wait', [{ day: '2026-09-22', count: 7 }]);
  const condition = searchCondition('arrivedOn', result[0].value);
  assert.ok(condition, 'ค่าจาก dropdown ต้องสร้างเงื่อนไขค้นหาได้');

  const q = dialect.sqlToQuery(condition!);
  assert.deepEqual(q.params, ['2026-09-22'], 'ค่าที่ไปถึง SQL ต้องเป็นวันที่เลือก');
  assert.match(q.sql, /at time zone 'Asia\/Bangkok'/,
    'เงื่อนไขค้นหาต้องตัดวันแบบเดียวกับตอนสร้างตัวเลือก');

  // ค่าว่างต้องไม่กลายเป็นเงื่อนไขที่ match ทุกแถว
  assert.equal(searchCondition('arrivedOn', ''), undefined, 'ค่าว่างต้องไม่สร้างเงื่อนไข');

  console.log('PASS: ค่าจาก dropdown ใช้กับเงื่อนไขค้นหาได้ตรงกัน');
}

async function main() {
  await sqlTest();
  await scopeTest();
  await shapeTest();
  await roundTripTest();
  console.log('\nทั้งหมดผ่าน');
}

main().catch((e) => { console.error('ล้มเหลว:', e); process.exit(1); });
