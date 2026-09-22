import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import { db } from '../src/db';
import { listDoPlans } from '../src/lib/queries/do-plans';

/**
 * SQL ของหน้า Plan แลก DO
 *
 * ดักที่ตัวส่ง query แล้วอ่าน SQL ที่ประกอบออกมา ไม่ต้องต่อฐานข้อมูลจริง
 *
 * จุดที่พลาดแล้วดูไม่ออกคือช่องที่ใช้นับว่า "ทำแล้ว" สลับกันระหว่างสองหน้า
 * ANN ต้องนับ do_exchanged_at ส่วน MAY ต้องนับ do_claimed_at ถ้าสลับกัน
 * ทั้งสองหน้ายังขึ้นตัวเลขสวย ๆ ตามปกติ แค่เป็นตัวเลขของอีกคน
 */

const dialect = new PgDialect();

type Row = Record<string, unknown>;

type Session = { prepareQuery: (...args: unknown[]) => unknown };

/**
 * ดักทุก query ที่ listDoPlans ยิงออกไป แล้วคืน SQL ตามลำดับพร้อมผลที่ป้อนกลับไป
 *
 * ดักที่ session.prepareQuery ไม่ใช่ที่ db.execute เพราะ query พวกนี้ประกอบด้วย
 * db.select() ซึ่งเป็น thenable ที่ไม่ผ่าน db.execute เลย
 */
async function capture(
  responses: Row[][],
  options: Parameters<typeof listDoPlans>[0],
) {
  const session = (db as unknown as { session: Session }).session;
  const originalPrepare = session.prepareQuery.bind(session);
  const statements: string[] = [];
  let call = 0;

  session.prepareQuery = ((query: { sql: string }, ...rest: unknown[]) => {
    statements.push(query.sql);
    const index = call++;
    const prepared = originalPrepare(query, ...rest) as { execute: () => Promise<unknown> };
    prepared.execute = async () => responses[index] ?? [];
    return prepared;
  }) as Session['prepareQuery'];

  try {
    return { statements, result: await listDoPlans(options) };
  } finally {
    session.prepareQuery = originalPrepare as Session['prepareQuery'];
  }
}

async function trackTest() {
  const { statements } = await capture([[]], { track: 'exchange', openOnly: true });
  const head = statements[0];

  assert.match(head, /do_plans/, 'ต้องดึงจากตาราง Plan');
  assert.match(head, /do_plan_id/, 'ต้องผูกงานเข้ากับ Plan ด้วย do_plan_id');
  assert.match(head, /do_exchanged_at/, 'ฝั่ง ANN ต้องนับ do_exchanged_at');
  assert.doesNotMatch(head, /do_claimed_at/, 'ฝั่ง ANN ต้องไม่ไปนับช่องของ MAY');
  // งานที่เก็บเข้ากรุแล้วต้องไม่ถูกนับเป็นงานค้างในชุด ไม่งั้นชุดจะไม่มีวันครบ
  assert.match(head, /is_archived/, 'ต้องตัดงานที่เก็บเข้ากรุออก');

  console.log('PASS: SQL ของฝั่ง ANN นับช่องที่ถูกต้อง');
}

async function claimTrackTest() {
  const { statements } = await capture([[]], { track: 'claim', openOnly: true });
  const head = statements[0];

  assert.match(head, /do_claimed_at/, 'ฝั่ง MAY ต้องนับ do_claimed_at');
  assert.doesNotMatch(head, /do_exchanged_at/, 'ฝั่ง MAY ต้องไม่ไปนับช่องของ ANN');
  console.log('PASS: SQL ของฝั่ง MAY นับช่องที่ถูกต้อง');
}

async function shapeTest() {
  /*
   * ไม่มี Plan ไหนเข้าเกณฑ์ ต้องไม่ยิง query รอบสองเพื่อดึงงาน
   * เพราะ `in ()` ที่ไม่มีค่าเลยเป็น SQL ที่พังได้ และเป็นกรณีที่เกิดทุกวันตอนยังไม่มี Plan
   */
  const { statements, result } = await capture([[]], { track: 'exchange', openOnly: true });
  assert.equal(statements.length, 1, 'ไม่มี Plan ต้องไม่ยิง query ดึงงานต่อ');
  assert.deepEqual(result, [], 'ต้องคืนรายการว่าง');
  console.log('PASS: ไม่มี Plan แล้วไม่ยิง query เปล่า');
}

async function main() {
  await trackTest();
  await claimTrackTest();
  await shapeTest();
  console.log('\nทั้งหมดผ่าน');
}

main().catch((e) => { console.error('ล้มเหลว:', e); process.exit(1); });
