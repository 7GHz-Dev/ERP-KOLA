/**
 * Waiting BL — อ่านวันที่แบบที่คนพิมพ์ และแปลงข้อความที่วางจาก Excel
 *   npm run test:waiting-bl
 */
import assert from 'node:assert/strict';
import { blKey, parseLooseDate, parsePaste, splitContainers } from '../src/lib/waiting-bl';

assert.equal(parseLooseDate('2026-10-30'), '2026-10-30');
assert.equal(parseLooseDate('30/10/2026'), '2026-10-30');
assert.equal(parseLooseDate('30/10/2569'), '2026-10-30', 'ปี พ.ศ. 4 หลัก');
assert.equal(parseLooseDate('30/10/69'), '2026-10-30', 'ปี พ.ศ. 2 หลัก');
assert.equal(parseLooseDate('30-10-26'), '2026-10-30', 'ปี ค.ศ. 2 หลัก');
assert.equal(parseLooseDate('1.2.69'), '2026-02-01');
assert.equal(parseLooseDate('31/02/2026'), null, 'วันที่ไม่มีจริง');
assert.equal(parseLooseDate('next week'), null);
assert.equal(parseLooseDate(''), null);

assert.deepEqual(splitContainers('tcnu 3365522, UETU8895265\nTCNU3365522'), ['TCNU3365522', 'UETU8895265']);
assert.equal(blKey(' amp 0561328b '), 'AMP0561328B');

const { rows, errors } = parsePaste([
  'BL No.\tลูกค้า\tShipper\tเรือ\tVoyage\tETA\tเลขตู้',
  'AMP0561328B\tASHRAF ALI\tKTK\tHUA XIANG 936\tJTX040S\t30/10/69\tTCNU3365522 UETU8895265\tUSED CAR\tโทรมาแจ้ง',
  '',
  'EGLV1 | SALIM | | | | 99/99/99',
  '\tไม่มีเลข BL',
].join('\n'));
assert.equal(rows.length, 2, 'ข้ามหัวตาราง บรรทัดว่าง และบรรทัดไม่มี BL');
assert.equal(rows[0].eta, '2026-10-30');
assert.equal(rows[0].containerNos, 'TCNU3365522 UETU8895265');
assert.equal(rows[0].note, 'โทรมาแจ้ง');
assert.equal(rows[1].blNo, 'EGLV1');
assert.equal(rows[1].customer, 'SALIM');
assert.equal(rows[1].eta, null);
assert.equal(errors.length, 2, 'เตือนวันที่อ่านไม่ได้ และบรรทัดไม่มี BL');

console.log('✓ Waiting BL: วันที่ พ.ศ./ค.ศ. · เลขตู้ · วางจาก Excel');
