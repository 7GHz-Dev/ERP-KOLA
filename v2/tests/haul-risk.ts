/**
 * ข้อมูลประกอบการสั่งลากตู้ (Transport Request)
 *   npm run test:haul
 */
import assert from 'node:assert/strict';
import { demLeft, demUntil, doStage, haulWarnings, returnDue, todayBangkok, weekdayName, type HaulRisk } from '../src/lib/haul-risk';

const base: HaulRisk = {
  bl: 'BL1', shipline: 'CNC', terminal: 'A0', eta: '2026-11-15', etaOfficial: true, demDays: 4, detDays: 7, doStage: 'DONE',
};

// D/O: ส่งชุดแลก → ได้ Invoice/ยอด D/O = ได้แล้ว
assert.equal(doStage({}), 'NONE');
assert.equal(doStage({ doExchangedAt: new Date() }), 'SENT');
assert.equal(doStage({ doExchangedAt: new Date(), doPayAmount: '3500.00' }), 'DONE');
assert.equal(doStage({ doClaimedAt: '2026-11-17' }), 'DONE');

// DEM นับจาก ETA แบบเดียวกับคอลัมน์ DEM DATE ของทะเบียนงาน
assert.equal(demUntil(base), '2026-11-19');
assert.equal(demUntil({ eta: '2026-11-15', demDays: 0 }), null);
assert.equal(demLeft(base, '2026-11-18'), 1);
assert.equal(returnDue('2026-11-20', 2), '2026-11-22');
assert.equal(weekdayName('2026-11-20'), 'ศุกร์');

// วันปกติ ข้อมูลครบ = ไม่มีคำเตือน (พุธ 18 พ.ย. · คืนตู้พุธ 25)
assert.deepEqual(haulWarnings([base], '2026-11-18'), []);
assert.deepEqual(haulWarnings([base], ''), []);

// ศุกร์ + DET 2 วัน (CNC) → คืนตู้ตรงอาทิตย์ · เกิน DEM · ยังไม่ได้ D/O
const w = haulWarnings([{ ...base, detDays: 2, doStage: 'NONE' }], '2026-11-20');
assert.ok(w.includes('ลากวันศุกร์ — เสี่ยงคืนตู้ช้า'), w.join('|'));
assert.ok(w.some((t) => t.startsWith('DET 2 วัน ต้องรีบคืนตู้: BL1')));
assert.ok(w.some((t) => t.startsWith('วันคืนตู้ (22/11/2026) ตรงวันอาทิตย์')));
assert.ok(w.some((t) => t.startsWith('เกิน free time DEM (ฟรีถึง 19/11/2026)')));
assert.ok(w.some((t) => t.startsWith('ยังไม่ได้ส่งแลก D/O: BL1')));

// ETA ยังไม่ยืนยัน · ลากก่อน ETA · รวม BL ที่โดนข้อความเดียวกัน
const e = haulWarnings([
  { ...base, bl: 'A', etaOfficial: false }, { ...base, bl: 'B', etaOfficial: false }, { ...base, bl: 'C', eta: '2026-11-25' },
], '2026-11-18');
assert.ok(e.includes('ETA ยังไม่ยืนยันจากระบบกรม (เรืออาจเลื่อน ตู้อาจยังไม่ลง): A, B'), e.join('|'));
assert.ok(e.includes('วันลากก่อน ETA: C'));

assert.equal(todayBangkok(new Date('2026-11-17T18:30:00Z')), '2026-11-18');
console.log('haul-risk ok');
