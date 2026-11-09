/**
 * แถบ ETA "12 เดือนล่าสุด" ของ Bookings table
 *   npm run test:eta-recent
 */
import assert from 'node:assert/strict';
import { currentMonth, monthLabel, readEtaView, recentBar, recentFrom, recentStart } from '../src/lib/eta-period';

// 9 พ.ย. 2026 เวลาไทย (ตี 1 = ยังเป็นวันที่ 8 ใน UTC)
const now = new Date('2026-11-08T18:30:00Z');
assert.deepEqual(currentMonth(now), { year: 2026, month: 11 });
assert.deepEqual(recentStart(now), { year: 2025, month: 12 }, 'นับเดือนนี้เป็นเดือนที่ 12');
assert.equal(recentFrom(now), '2025-12-01');
assert.equal(monthLabel({ year: 2026, month: 11 }), 'พ.ย. 69');

// ข้ามปี: มกราคม → ช่วงเริ่ม ก.พ. ปีก่อน
assert.deepEqual(recentStart(new Date('2027-01-15T05:00:00Z')), { year: 2026, month: 2 });

assert.deepEqual(readEtaView('', '', ''), { kind: 'recent' });
assert.deepEqual(readEtaView('all', '2026', '5'), { kind: 'all' });
assert.deepEqual(readEtaView('', '2025', '3'), { kind: 'period', period: { year: 2025, month: 3 } });

const bar = recentBar([
  { year: 2026, month: 12, count: 2 },   // ETA เดือนหน้า (เรือยังไม่เข้า)
  { year: 2026, month: 11, count: 5 },
  { year: 2026, month: 1, count: 3 },
  { year: 2025, month: 12, count: 1 },   // เดือนแรกของช่วง
  { year: 2025, month: 11, count: 4 },   // นอกช่วง → ปีก่อนหน้า
  { year: 2024, month: 6, count: 7 },
], now);
assert.equal(bar.months.length, 13, 'ธ.ค. 69 (เดือนหน้า) + 12 เดือนย้อนหลัง');
assert.deepEqual(bar.months[0], { year: 2026, month: 12, count: 2 });
assert.deepEqual(bar.months[bar.months.length - 1], { year: 2025, month: 12, count: 1 });
assert.equal(bar.months.find((m) => m.year === 2026 && m.month === 6)?.count, 0, 'เดือนที่ไม่มีงานยังมีปุ่ม (นับ 0)');
assert.equal(bar.recentTotal, 11);
assert.equal(bar.allTotal, 22);
assert.deepEqual(bar.olderYears, [{ year: 2025, count: 4 }, { year: 2024, count: 7 }]);

console.log('✓ ETA 12 เดือนล่าสุด: เดือนไทย · ข้ามปี · ปุ่มเดือน · ยอดรวม · ปีก่อนหน้า');
