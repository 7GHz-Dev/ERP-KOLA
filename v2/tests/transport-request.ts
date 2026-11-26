import assert from 'node:assert/strict';
import {
  blCandidates, classifyDocFile, keyOf, mergeWithJob, parsePastedSheet, sanitizeAiRows, toIsoDate,
  type JobLite, type TrRow,
} from '../src/lib/transport-request/parse';

/**
 * Transport Request → SHIPME (เมนูชั่วคราวของ MAY)
 *
 * สิ่งที่ต้องรับประกันคือ "ไม่ส่งข้อมูลผิดไปให้ชิปปิ้ง" — AI อ่านรูปพลาดได้ แถวที่จับคู่งาน KOLA ได้จึงใช้ค่าจาก KOLA
 * และวันที่ของงาน = คอลัมน์ TRANSPORT เสมอ ไม่เอา ETA มาแทน
 */

// ---- key / BL ----
assert.equal(keyOf(' amp-0572751a '), 'AMP0572751A');
assert.deepEqual(blCandidates('KG1042026-74915(AMP0574862)'), ['KG104202674915AMP0574862', 'KG104202674915', 'AMP0574862']);
assert.deepEqual(blCandidates('AMP0572751A'), ['AMP0572751A']);

// ---- วันที่ ----
assert.equal(toIsoDate('27/11/2026'), '2026-11-27');
assert.equal(toIsoDate('27/11/2569'), '2026-11-27');
assert.equal(toIsoDate('27/11/26'), '2026-11-27');
assert.equal(toIsoDate('2026-11-27'), '2026-11-27');
assert.equal(toIsoDate('31/02/2026'), '');
assert.equal(toIsoDate(''), '');

// ---- วางข้อความจากชีต ----
const head = 'ETA\tประเภท\tINV.\tSUR\tTRANSPORT\tSHIPPER\tCON\tBILL OF LADING\tCONTAINER NO.\tSHIPLINE\tVESSEL\tPORT';
const line = '25/11/2026\tMSFZ\tY\tSWB\t27/11/2026\tAHMED ULLAH OLD SPARE PART\t2\tAMP0572751A\tSEKU6323323,TLLU7829812\tCNC\tCNC SULAWESI V.JTV0E0S89\tKERRY';
const pasted = parsePastedSheet(`${head}\n${line}\n`);
assert.equal(pasted.length, 1);
assert.equal(pasted[0].transportDate, '2026-11-27');
assert.equal(pasted[0].eta, '2026-11-25');
assert.equal(pasted[0].quantity, 2);
assert.deepEqual(pasted[0].containers, ['SEKU6323323', 'TLLU7829812']);
assert.equal(pasted[0].vessel, 'CNC');
assert.equal(pasted[0].vesselName, 'CNC SULAWESI V.JTV0E0S89');
assert.equal(pasted[0].port, 'KERRY');
assert.equal(pasted[0].customer, 'AHMED ULLAH OLD SPARE PART');
assert.equal(pasted[0].kind, 'MSFZ');
// ไม่มีคอลัมน์ TRANSPORT → วันที่ว่าง (ไม่ใช้ ETA แทน)
const noTransport = parsePastedSheet('ETA\tSHIPPER\tCON\tBILL OF LADING\n25/11/2026\tX\t1\tBL1\n');
assert.equal(noTransport[0].transportDate, '');

// ---- ผล AI ----
assert.deepEqual(sanitizeAiRows('nope'), []);
const ai = sanitizeAiRows([
  { transport: '27/11/2026', bl: '', containers: ['ABCU1234567'] },
  { eta: '25/11/2026', transport: '27/11/2026', shipper: 'FUJI STAR', con: 'x', bl: 'AMP0573687', containers: ['CMAU6397688', 'bad'], shipline: 'CNC', vessel: 'CNC SULAWESI', port: 'KERRY' },
]);
assert.equal(ai.length, 1);
assert.equal(ai[0].quantity, 0);
assert.deepEqual(ai[0].containers, ['CMAU6397688', 'BAD']);
assert.equal(ai[0].transportDate, '2026-11-27');
assert.equal(ai[0].line, 1);

// ---- รวมกับงาน KOLA ----
const row = (over: Partial<TrRow> = {}): TrRow => ({
  line: 1, eta: '2026-11-25', kind: 'MSFZ', transportDate: '2026-11-27', customer: 'AHMED', quantity: 2,
  bl: 'AMP0572751A', containers: ['SEKU632332', 'TLLU7829812'], vessel: 'CNC', vesselName: 'CNC SULAWESI', port: 'KERRY', ...over,
});
const job: JobLite = {
  id: 'J1', jobNo: 'KL-001', blNo: 'AMP0572751A', containers: ['SEKU6323323', 'TLLU7829812'],
  shipline: 'CNC', vessel: 'CNC SULAWESI', eta: '2026-11-25', doExchangedAt: null,
};
const merged = mergeWithJob(row(), job);
assert.deepEqual(merged.containers, ['SEKU6323323', 'TLLU7829812']);
assert.ok(merged.warnings.includes('เลขตู้ในรูปไม่ตรง KOLA: SEKU632332'));
assert.equal(merged.jobId, 'J1');
assert.equal(merged.doExchanged, false);
assert.equal(merged.error, '');

const lonely = mergeWithJob(row(), null);
assert.ok(lonely.warnings.includes('ไม่พบใน KOLA'));
assert.equal(lonely.jobId, null);
assert.equal(lonely.doExchanged, null);
assert.deepEqual(lonely.containers, ['SEKU632332', 'TLLU7829812']);

assert.ok(mergeWithJob(row({ quantity: 3 }), job).warnings.includes('CON 3 แต่มีเลขตู้ 2 ตู้'));
assert.equal(mergeWithJob(row({ transportDate: '' }), job).error, 'ไม่มีวันที่ TRANSPORT');
assert.equal(mergeWithJob(row(), { ...job, doExchangedAt: '2026-11-20T03:00:00Z' }).doExchanged, true);

// ---- แยกไฟล์ใบขน / E-Office ----
assert.deepEqual(classifyDocFile('A0310691002615.pdf'), { kind: 'DECL', declarationNo: 'A0310691002615', blHint: '', by: 'filename' });
assert.deepEqual(classifyDocFile('AMP0572751A E-744810.pdf'), { kind: 'EOFFICE', declarationNo: '', blHint: 'AMP0572751A', by: 'filename' });
assert.deepEqual(
  classifyDocFile('scan001.pdf', 'ใบตราส่งเลขที่ (EGLV060600257813) ... เลขที่ใบขนฯ A031-0-6910-02615'),
  { kind: 'DECL', declarationNo: 'A0310691002615', blHint: 'EGLV060600257813', by: 'text' },
);
assert.deepEqual(
  classifyDocFile('scan002.pdf', 'คำร้องขอนำของที่นำเข้ามาในราชอาณาจักรเข้าไปในเขตปลอดอากร'),
  { kind: 'EOFFICE', declarationNo: '', blHint: '', by: 'text' },
);
assert.deepEqual(classifyDocFile('x.pdf'), { kind: null, declarationNo: '', blHint: '', by: '' });

console.log('transport-request: PASS');
