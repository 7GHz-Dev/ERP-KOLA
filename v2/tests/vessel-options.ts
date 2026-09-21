import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import { db } from '../src/db';
import { fahDoVessels } from '../src/lib/queries/jobs';

/**
 * ตรวจรายการเรือ/เที่ยวที่ใช้เป็นตัวเลือกในช่องกรองหน้า Upload InvDO
 *
 * ดักที่ db.execute แล้วอ่าน SQL ที่ประกอบออกมา ไม่ต้องต่อฐานข้อมูลจริง
 *
 * จุดที่พลาดง่ายคือเงื่อนไขไม่ตรงกับที่ตารางใช้ แล้วรายการมีเที่ยวที่เลือกแล้ว
 * ตารางว่าง หรือขาดเที่ยวที่ยังมีงานค้างอยู่ ซึ่งดูจากหน้าจอไม่ออกว่าผิด
 * เพราะทั้งสองกรณีหน้าตาเหมือนใช้งานได้ปกติ
 */

const dialect = new PgDialect();

async function capture(rows: unknown[]) {
  const original = db.execute;
  let text = '';
  (db as unknown as { execute: unknown }).execute = (async (q: Parameters<typeof db.execute>[0]) => {
    text = dialect.sqlToQuery(q as ReturnType<typeof import('drizzle-orm').sql>).sql;
    return rows;
  }) as typeof db.execute;
  try {
    const result = await fahDoVessels();
    return { sql: text, result };
  } finally {
    db.execute = original;
  }
}

async function sqlTest() {
  const { sql } = await capture([]);

  // เงื่อนไขต้องตรงกับ QUEUE.fahDo('wait') — AN อนุมัติแล้ว และยังไม่ส่ง Partner
  assert.match(sql, /approval_type = 'AN'/, 'ต้องดูเฉพาะการอนุมัติ AN');
  assert.match(sql, /status = 'APPROVED'/, 'ต้องเป็นงานที่อนุมัติแล้ว');
  assert.match(sql, /not exists[\s\S]*do_handoffs/i, 'ต้องเอาเฉพาะที่ยังไม่ส่ง Partner');
  assert.match(sql, /is_archived = false/, 'งานที่เก็บเข้ากรุแล้วต้องไม่นับ');

  /*
   * ต้องดูการอนุมัติ "ล่าสุด" ไม่ใช่มีแถว APPROVED อยู่ที่ไหนก็ได้
   * งานที่เคยอนุมัติแล้วถูกตีกลับทีหลังต้องไม่โผล่ในรายการ
   */
  assert.match(sql, /max\(a2\.requested_at\)/, 'ต้องยึดการอนุมัติล่าสุด');

  // ชื่อเรือว่างต้องไม่กลายเป็นตัวเลือกเปล่า ๆ
  assert.match(sql, /vessel is not null/, 'ต้องตัดงานที่ไม่มีชื่อเรือ');
  assert.match(sql, /group by j\.vessel, j\.voyage/, 'นับแยกตามเรือและเที่ยว');

  /*
   * ไม่มี alias ซ้อนกันสองชั้น ซึ่งเคยพังตอนเอา latestApproval() มาแทรกใน join
   * Postgres ไม่ยอมรับรูปแบบนั้น แต่ typecheck จับไม่ได้
   */
  assert.doesNotMatch(sql, /\)\s*"latest_an"\s*\)/, 'ต้องไม่มี alias ซ้อนกัน');

  console.log('PASS: เงื่อนไขรายการเรือตรงกับคิวของตาราง และ SQL ถูกรูปแบบ');
}

async function shapeTest() {
  const { result } = await capture([
    { vessel: 'BANGKOK BRIDGE', voyage: '0518W', count: 8 },
    { vessel: 'SHUN LONG', voyage: null, count: 2 },
  ]);

  assert.equal(result.length, 2);

  /*
   * ป้ายที่แสดงใช้ " / " ให้ตรงกับคอลัมน์ในตาราง คนจะได้เทียบได้ว่าเลือกตรงกับแถวไหน
   * ส่วนค่าที่ส่งเข้าช่องค้นหาใช้เว้นวรรคเฉย ๆ ตัวคั่นไม่สำคัญเพราะฝั่ง SQL
   * ตัดอักขระที่ไม่ใช่ตัวอักษรหรือตัวเลขทิ้งก่อนเทียบอยู่แล้ว
   */
  assert.equal(result[0].label, 'BANGKOK BRIDGE / 0518W');
  assert.equal(result[0].value, 'BANGKOK BRIDGE 0518W');
  assert.equal(result[0].count, 8);

  // งานที่ไม่มีเที่ยวเรือต้องยังเป็นตัวเลือกได้ ไม่ใช่ได้ป้ายที่มีตัวคั่นห้อยอยู่
  assert.equal(result[1].label, 'SHUN LONG', 'ไม่มีเที่ยว ต้องไม่มีตัวคั่นห้อยท้าย');
  assert.equal(result[1].value, 'SHUN LONG');

  console.log('PASS: ป้ายกับค่าที่ส่งเข้าช่องค้นหาถูกต้อง รวมงานที่ไม่มีเที่ยวเรือ');
}

async function roundTripTest() {
  /*
   * ค่าที่ dropdown ส่งออกไป ต้องกรองเจองานของเที่ยวนั้นจริง
   *
   * สองฝั่งนี้เขียนคนละที่ (รายการตัวเลือกกับเงื่อนไขค้นหา) ถ้าใครแก้ฝั่งเดียว
   * จะได้ตัวเลือกที่กดแล้วตารางว่าง ซึ่งเป็นอาการที่หาต้นเหตุยาก
   */
  const { result } = await capture([
    { vessel: 'BANGKOK BRIDGE', voyage: '0518W', count: 8 },
  ]);
  const { searchCondition } = await import('../src/lib/queries/jobs');
  const condition = searchCondition('vessel', result[0].value);
  assert.ok(condition, 'ค่าจาก dropdown ต้องสร้างเงื่อนไขค้นหาได้');

  const q = dialect.sqlToQuery(condition!);
  // ค่าที่ไปถึง SQL ต้องเป็นชื่อเรือต่อเที่ยวที่ตัดตัวคั่นแล้ว
  assert.deepEqual(q.params, ['%BANGKOKBRIDGE0518W%'],
    'ค่าจาก dropdown ต้องกรองเจองานของเที่ยวนั้น');

  console.log('PASS: ค่าจาก dropdown ใช้กับเงื่อนไขค้นหาได้ตรงกัน');
}

async function main() {
  await sqlTest();
  await shapeTest();
  await roundTripTest();
  console.log('\nทั้งหมดผ่าน');
}

main().catch((e) => { console.error('ล้มเหลว:', e); process.exit(1); });
