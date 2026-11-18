/**
 * วันฟรี DEM / DET (N/A) / Storage
 *   npm run test:free-time
 */
import assert from 'node:assert/strict';
import { daysText, freeLastDate, freeUrgency, readDays, storageLastDate } from '../src/lib/free-time';

// ตัวอย่างจากทีม: ETA 20/11/2026 ฟรี 3 วัน (ETA = วันที่ 1) → หมด free time / เริ่มมีค่าใช้จ่าย 23/11/2026
assert.equal(storageLastDate('2026-11-20', 3), '2026-11-23');
assert.equal(storageLastDate('2026-11-20', null), '2026-11-23', 'ไม่ระบุ = 3 วัน');
assert.equal(storageLastDate(null, 3), null);
assert.equal(freeLastDate('2026-11-20', null), null, 'N/A ไม่มีวันสุดท้าย');
assert.equal(daysText(null), 'N/A');
assert.equal(daysText(0), '0');

assert.equal(freeUrgency('2026-11-23', '2026-11-21')?.level, 'ok');
assert.equal(freeUrgency('2026-11-23', '2026-11-22')?.level, 'urgent');
assert.equal(freeUrgency('2026-11-23', '2026-11-23')?.level, 'urgent');
assert.deepEqual(freeUrgency('2026-11-23', '2026-11-25'), { level: 'over', left: -2, text: 'เกิน free time 2 วัน' });

const fd = new FormData();
fd.set('demDays', ''); fd.set('detDays', '7'); fd.set('bad', '-1'); fd.set('na', 'N/A');
assert.equal(readDays(fd, 'demDays', 5, 'DEM'), null, 'ว่าง = N/A');
assert.equal(readDays(fd, 'detDays', null, 'DET'), 7);
assert.equal(readDays(fd, 'na', 3, 'X'), null);
assert.equal(readDays(fd, 'missing', 4, 'X'), 4, 'ไม่ได้ส่งมา = คงค่าเดิม');
assert.throws(() => readDays(fd, 'bad', null, 'DEM'), /0 ขึ้นไป/);
console.log('free-time ok');
