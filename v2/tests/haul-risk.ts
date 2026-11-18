/**
 * ข้อมูลประกอบการสั่งลากตู้ (Transport Request)
 *   npm run test:haul
 */
import assert from 'node:assert/strict';
import { demLeft, demUntil, detUntil, doStage, haulWarnings, todayBangkok, weekdayName, type HaulRisk } from '../src/lib/haul-risk';

const base: HaulRisk = {
  bl: 'BL1', shipline: 'CNC', terminal: 'A0', eta: '2026-11-15', etaOfficial: true, demDays: 4, detDays: 10, doStage: 'DONE',
};

// D/O: ส่งชุดแลก → ได้ Invoice/ยอด D/O = ได้แล้ว
assert.equal(doStage({}), 'NONE');
assert.equal(doStage({ doExchangedAt: new Date() }), 'SENT');
assert.equal(doStage({ doExchangedAt: new Date(), doPayAmount: '3500.00' }), 'DONE');
assert.equal(doStage({ doClaimedAt: '2026-11-17' }), 'DONE');

// นับ ETA เป็นวันที่ 1: Last Date = ETA + วัน − 1 · DET นับจาก ETA เหมือน DEM
assert.equal(demUntil(base), '2026-11-18');
assert.equal(detUntil(base), '2026-11-24');
assert.equal(demUntil({ eta: '2026-11-15', demDays: 0 }), null);
assert.equal(demLeft(base, '2026-11-18'), 0);
assert.equal(weekdayName('2026-11-20'), 'ศุกร์');

// วันปกติ ข้อมูลครบ = ไม่มีคำเตือน (พุธ 18 พ.ย. = วันสุดท้าย DEM · DET ถึงอังคาร 24)
assert.deepEqual(haulWarnings([base], '2026-11-18'), []);
assert.deepEqual(haulWarnings([base], ''), []);

// ศุกร์ 20 + DET 7 วัน (Last Date เสาร์ 21) → เหลือ 2 วัน · วันสุดท้ายตรงเสาร์ · เกิน DEM · ยังไม่ได้ D/O
const w = haulWarnings([{ ...base, detDays: 7, doStage: 'NONE' }], '2026-11-20');
assert.ok(w.includes('ลากวันศุกร์ — เสี่ยงคืนตู้ช้า'), w.join('|'));
assert.ok(w.some((t) => t.startsWith('ลากแล้วเหลือ DET 2 วัน ต้องรีบคืนตู้ (Last DET date 21/11/2026): BL1')), w.join('|'));
assert.ok(w.some((t) => t.startsWith('วันสุดท้ายคืนตู้ (21/11/2026) ตรงวันเสาร์')));
assert.ok(w.some((t) => t.startsWith('เกิน free time DEM (Last DEM date 18/11/2026)')));
assert.ok(w.some((t) => t.startsWith('ยังไม่ได้ส่งแลก D/O: BL1')));
// ลากหลัง Last Date of DET
assert.ok(haulWarnings([{ ...base, detDays: 3 }], '2026-11-18').some((t) => t.startsWith('เกิน free time DET (Last DET date 17/11/2026)')));

// ETA ยังไม่ยืนยัน · ลากก่อน ETA · รวม BL ที่โดนข้อความเดียวกัน
const e = haulWarnings([
  { ...base, bl: 'A', etaOfficial: false }, { ...base, bl: 'B', etaOfficial: false }, { ...base, bl: 'C', eta: '2026-11-25' },
], '2026-11-18');
assert.ok(e.includes('ETA ยังไม่ยืนยันจากระบบกรม (เรืออาจเลื่อน ตู้อาจยังไม่ลง): A, B'), e.join('|'));
assert.ok(e.includes('วันลากก่อน ETA: C'));

// Storage: ETA 15 + 3 − 1 = Last Date 17 · ลากวันที่ 18 = เกิน (มีค่าฝากตู้)
assert.ok(haulWarnings([{ ...base, storageLast: '2026-11-17' }], '2026-11-18').some((t) => t.startsWith('เกิน Storage free time (Last STORAGE date 17/11/2026)')));
assert.deepEqual(haulWarnings([{ ...base, storageLast: '2026-11-18' }], '2026-11-18'), []);

assert.equal(todayBangkok(new Date('2026-11-17T18:30:00Z')), '2026-11-18');
console.log('haul-risk ok');
