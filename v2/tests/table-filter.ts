/**
 * ตัวกรองตารางในหน้าเว็บ — ตรรกะล้วน (src/lib/table-filter.ts)
 *   npm run test:table-filter
 */
import assert from 'node:assert/strict';
import {
  BLANK, cellDay, cellValue, describe, distinctValues, isActive, isDateColumn, parseSaved, rowPasses,
} from '../src/lib/table-filter';

assert.equal(cellValue('  MSFZ   CO  '), 'MSFZ CO');
assert.equal(cellValue('-'), BLANK);
assert.equal(cellValue(''), BLANK);

assert.equal(cellDay('03/11/2026'), '2026-11-03');
assert.equal(cellDay('30/10/2026, 16:53'), '2026-10-30');
assert.equal(cellDay('31/02/2026'), null, 'วันที่ไม่มีจริง');
assert.equal(cellDay('A0300691008769'), null);
assert.equal(cellDay('-'), null);

assert.equal(isDateColumn(['03/11/2026', '-', '04/11/2026']), true, 'มีช่องว่างปนได้');
assert.equal(isDateColumn(['MSFZ', 'JTC', '03/11/2026']), false);
assert.equal(isDateColumn(['-', '']), false);

const rows = [
  { Shipper: 'MSFZ', ETA: '03/11/2026' },
  { Shipper: 'JTC', ETA: '10/11/2026' },
  { Shipper: 'MSFZ', ETA: '-' },
  { Shipper: '-', ETA: '05/11/2026' },
];
const pass = (f: Parameters<typeof rowPasses>[1], except?: string) => rows.filter((r) => rowPasses(r, f, except)).length;
assert.equal(pass({}), 4);
assert.equal(pass({ Shipper: { kind: 'values', values: ['MSFZ'] } }), 2);
assert.equal(pass({ Shipper: { kind: 'values', values: ['MSFZ', BLANK] } }), 3, 'กรองหาแถวที่ว่างได้');
assert.equal(pass({ ETA: { kind: 'date', from: '2026-11-01', to: '2026-11-05' } }), 2, 'ช่วงวันที่รวมวันปลาย');
assert.equal(pass({ ETA: { kind: 'date', from: '2026-11-06' } }), 1, 'ใส่ข้างเดียวได้ · ไม่มีวันที่ = ไม่ผ่าน');
assert.equal(pass({ Shipper: { kind: 'values', values: ['MSFZ'] }, ETA: { kind: 'date', to: '2026-11-04' } }), 1);
assert.equal(pass({ Shipper: { kind: 'values', values: ['MSFZ'] } }, 'Shipper'), 4, 'ไม่นับคอลัมน์ตัวเอง');
assert.equal(pass({ Missing: { kind: 'values', values: ['x'] } }), 4, 'คอลัมน์ที่ไม่มีในตารางนี้ (ถูกซ่อน/เปลี่ยนชื่อ) ไม่กรอง');

assert.deepEqual(distinctValues(['MSFZ', 'JTC', 'MSFZ', '-', 'AICHI']), [
  { value: 'AICHI', count: 1 }, { value: 'JTC', count: 1 }, { value: 'MSFZ', count: 2 }, { value: BLANK, count: 1 },
]);

assert.equal(isActive({ kind: 'date' }), false);
assert.equal(isActive({ kind: 'date', to: '2026-11-01' }), true);
assert.equal(describe({ kind: 'values', values: ['A', 'B', 'C', 'D'] }), 'A, B +2');
assert.equal(describe({ kind: 'date', from: '2026-11-01', to: '2026-11-07' }), '01/11/2026 – 07/11/2026');

assert.deepEqual(parseSaved('{bad'), { filters: {}, hidden: [] });
assert.deepEqual(parseSaved(JSON.stringify({ filters: { A: { kind: 'values', values: [1] }, B: { kind: 'x' } }, hidden: ['C'] })),
  { filters: { A: { kind: 'values', values: ['1'] } }, hidden: ['C'] });

console.log('✓ ตัวกรองตาราง: ค่าในช่อง · วันที่ · กรองหลายคอลัมน์ · นับค่า · ค่าที่จำไว้');
