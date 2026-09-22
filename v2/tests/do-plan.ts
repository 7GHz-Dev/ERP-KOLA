import assert from 'node:assert/strict';
import {
  missingSummary, planNo, planProgress, planReadiness, readyForPlan, type PlanCandidate,
} from '../src/lib/do-plan';

/**
 * กติกาของ Plan แลก DO
 *
 * สองอย่างที่พลาดแล้วเจ็บและดูจากหน้าจอไม่ออก
 *   1. ความพร้อม — ถ้าหน้าจอกับเซิร์ฟเวอร์ตัดสินไม่ตรงกัน ปุ่มจะกดได้แล้วโดนปฏิเสธ
 *      หรือแย่กว่านั้นคือติ๊กไม่ได้ทั้งที่กรอกครบแล้ว แล้วไม่มีอะไรบอกว่าทำไม
 *   2. ความครบของชุด — ถ้านับผิด ชุดที่ยังเหลือใบจะขึ้นว่าเสร็จแล้ว
 *      แล้ววันนัดไปถึงโดยที่ไม่มีใครรู้ว่าขาด ซึ่งเป็นปัญหาที่ Plan มีไว้แก้พอดี
 */

const base: PlanCandidate = {
  id: 'JOB-1', label: 'BL-001',
  hasInvoiceDo: true, eta: '2026-10-01',
  portId: 'PORT-1', terminalId: 'TERM-1', partnerName: 'SHIPME',
  alreadySent: false,
};

function readinessTest() {
  assert.deepEqual(planReadiness(base), { ready: true, missing: [] },
    'กรอกครบต้องใส่ Plan ได้');

  // ขาดหลายช่องพร้อมกันต้องบอกครบในรอบเดียว ไม่ใช่บอกทีละช่องให้กลับมากดใหม่
  const empty = planReadiness({
    ...base, hasInvoiceDo: false, eta: null, portId: null, terminalId: null, partnerName: null,
  });
  assert.equal(empty.ready, false);
  assert.deepEqual(empty.missing, ['Invoice DO', 'ETA official', 'Port', 'Terminal', 'Partner'],
    'ต้องบอกทุกช่องที่ขาดในครั้งเดียว');

  // Partner ที่เป็นช่องว่างล้วนต้องนับว่าขาด ไม่ใช่ผ่านเพราะสตริงไม่ว่าง
  assert.equal(planReadiness({ ...base, partnerName: '   ' }).ready, false,
    'Partner ที่เป็นช่องว่างต้องถือว่ายังไม่ได้กรอก');

  /*
   * ใบที่ส่ง Partner ไปแล้วต้องใส่ Plan ซ้ำไม่ได้
   * ถ้าปล่อยผ่าน ใบเดียวจะอยู่สองชุด แล้วยอดรวมของทั้งสองชุดไม่มีวันตรงกับของจริง
   */
  const sent = planReadiness({ ...base, alreadySent: true });
  assert.equal(sent.ready, false, 'ใบที่ส่งไปแล้วต้องใส่ Plan ซ้ำไม่ได้');
  assert.deepEqual(sent.missing, ['ส่ง Partner ไปแล้ว']);

  console.log('PASS: ความพร้อมของใบที่จะใส่ Plan');
}

function summaryTest() {
  const jobs: PlanCandidate[] = [
    base,
    { ...base, id: 'JOB-2', label: 'BL-002', hasInvoiceDo: false },
    { ...base, id: 'JOB-3', label: 'BL-003', terminalId: null },
  ];
  assert.deepEqual(readyForPlan(jobs), ['JOB-1'], 'ต้องเหลือเฉพาะใบที่กรอกครบ');

  const summary = missingSummary(jobs);
  assert.match(summary, /BL-002 ขาด Invoice DO/);
  assert.match(summary, /BL-003 ขาด Terminal/);
  assert.doesNotMatch(summary, /BL-001/, 'ใบที่ครบแล้วต้องไม่ถูกรายงานว่าขาด');
  assert.equal(missingSummary([base]), '', 'ครบทุกใบต้องไม่มีข้อความเตือน');

  /*
   * เลือกทีละหลายสิบใบได้ ข้อความจึงต้องตัด ไม่งั้นยาวจนอ่านไม่ออกและดันเนื้อหาตกจอ
   * ตัดที่สามใบแรกแล้วบอกจำนวนที่เหลือ
   */
  const many = Array.from({ length: 6 }, (_, i) => ({
    ...base, id: `JOB-${i}`, label: `BL-${i}`, hasInvoiceDo: false,
  }));
  assert.match(missingSummary(many), /และอีก 3 รายการ$/, 'ต้องตัดข้อความที่ยาวเกินสามใบ');

  console.log('PASS: ข้อความบอกว่าใบไหนยังขาดอะไร');
}

function planNoTest() {
  // เลขที่อ้างวันที่นัดแลก ไม่ใช่วันที่กดสร้าง — ทุกฝ่ายคุยกันด้วยวันที่ไปแลก
  assert.equal(planNo('2026-09-22', 0), 'PLAN-20260922-01');
  assert.equal(planNo('2026-09-22', 1), 'PLAN-20260922-02');
  assert.equal(planNo('2026-09-22', 11), 'PLAN-20260922-12');
  console.log('PASS: เลขที่ Plan');
}

function progressTest() {
  assert.deepEqual(planProgress([{ doneAt: '2026-09-22' }, { doneAt: null }]),
    { done: 1, total: 2, complete: false });
  assert.deepEqual(planProgress([{ doneAt: '2026-09-22' }, { doneAt: '2026-09-23' }]),
    { done: 2, total: 2, complete: true });

  /*
   * ชุดว่างต้องไม่ถือว่าครบ
   *
   * เกิดได้จริงตอนงานในชุดถูกเก็บเข้ากรุจนหมด ถ้านับว่าครบ ชุดนั้นจะหายไปจากแท็บ
   * "ยังทำไม่ครบ" เงียบ ๆ ทั้งที่ควรเห็นว่ามีชุดที่ไม่เหลืออะไรให้ทำแล้ว
   */
  assert.deepEqual(planProgress([]), { done: 0, total: 0, complete: false },
    'ชุดว่างต้องไม่นับว่าครบ');

  console.log('PASS: ความคืบหน้าของชุด');
}

readinessTest();
summaryTest();
planNoTest();
progressTest();
console.log('\nทั้งหมดผ่าน');
