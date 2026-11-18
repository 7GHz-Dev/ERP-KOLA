/**
 * วันฟรี DEM / DET (N/A) / Storage
 *   npm run test:free-time
 */
import assert from 'node:assert/strict';
import { daysText, freeLastDate, freeUrgency, readDays, storageLastDate } from '../src/lib/free-time';

// สูตรจากทีม: Last Date = (ETA + จำนวนวัน) − 1 → ETA 20/11/2026 Storage 3 วัน = 22/11/2026 (23/11 เริ่มมีค่าใช้จ่าย)
assert.equal(storageLastDate('2026-11-20', 3), '2026-11-22');
assert.equal(storageLastDate('2026-11-20', null), '2026-11-22', 'ไม่ระบุ = 3 วัน');
assert.equal(freeLastDate('2026-11-20', 7), '2026-11-26', 'DEM / DET 7 วัน');
assert.equal(freeLastDate('2026-11-20', 0), null, '0 วัน = ไม่มีวันฟรี');
assert.equal(storageLastDate(null, 3), null);
assert.equal(freeLastDate('2026-11-20', null), null, 'N/A ไม่มีวันสุดท้าย');
assert.equal(daysText(null), 'N/A');
assert.equal(daysText(0), '0');

// Last Date 22/11: 20 เหลือ 3 วัน · 21 Urgent (หมดพรุ่งนี้) · 22 Urgent (วันสุดท้าย) · 24 เกิน 2 วัน
assert.deepEqual(freeUrgency('2026-11-22', '2026-11-20'), { level: 'ok', left: 2, text: 'เหลือ 3 วัน' });
assert.equal(freeUrgency('2026-11-22', '2026-11-21')?.level, 'urgent');
assert.equal(freeUrgency('2026-11-22', '2026-11-22')?.text, 'Urgent · วันสุดท้ายของ free time');
assert.deepEqual(freeUrgency('2026-11-22', '2026-11-24'), { level: 'over', left: -2, text: 'เกิน free time 2 วัน' });

const fd = new FormData();
fd.set('demDays', ''); fd.set('detDays', '7'); fd.set('bad', '-1'); fd.set('na', 'N/A');
assert.equal(readDays(fd, 'demDays', 5, 'DEM'), null, 'ว่าง = N/A');
assert.equal(readDays(fd, 'detDays', null, 'DET'), 7);
assert.equal(readDays(fd, 'na', 3, 'X'), null);
assert.equal(readDays(fd, 'missing', 4, 'X'), 4, 'ไม่ได้ส่งมา = คงค่าเดิม');
assert.throws(() => readDays(fd, 'bad', null, 'DEM'), /0 ขึ้นไป/);
console.log('free-time ok');
