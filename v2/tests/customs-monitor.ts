/**
 * ตัว monitor ใบขน กับ ERP จำลอง (ในหน่วยความจำ) + NETBAY จำลอง (tests/draft-mock-netbay.ts)
 * ไม่ต่อฐานข้อมูล ไม่ออกเน็ต
 *
 *   1. อ่านรหัสจากรูปป้ายสถานะ — ยาวก่อนสั้น (CANCEL_REJECT ไม่กลายเป็น REJECT, IMPREJECT ไม่กลายเป็น REJECT)
 *   2. แตก zip จาก Save PDF แล้วได้ <เลขใบขน>.pdf
 *   3. เช็ก 1 รอบ: ACCEPT -> ติ๊กแถวเดียว + ชื่อไฟล์ = เลขที่ใบขน + Save PDF -> completeTask (เลข + PDF)
 *      ยังไม่ ACCEPT / ไม่พบ / REJECT -> ส่งสถานะอย่างเดียว · อ่านป้ายไม่ออกแต่มีเลขใบขน -> ถามช่อง Status
 *      ACCEPT แต่ยังไม่มีเลขใบขน -> บอกข้อผิดพลาด ไม่ปิดงาน
 *   4. เข้า NETBAY ไม่ได้ -> ทุกแถวได้ข้อความบอกเหตุผล
 *
 * ต้องมี Google Chrome (หรือ Chromium ของ Playwright) ในเครื่อง
 *   npm run test:customs
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import { NOT_FOUND, parseStatusImage } from '../src/lib/customs-status';
import { checkRound, type Api, type MonitorTask } from '../scripts/customs-check';
import { netbaySettings, pdfFromDownload } from '../scripts/netbay-kola';
import { mockPdf, startMockNetbay } from './draft-mock-netbay';

type Call = { fn: string; args: Record<string, any> };

function fakeErp() {
  const calls: Call[] = [];
  const api: Api = async (fn, args = {}) => {
    calls.push({ fn, args });
    return { ok: true } as never;
  };
  return {
    api, calls,
    statusOf: (taskId: string) => calls.filter((c) => c.fn === 'customsStatus' && c.args.taskId === taskId).map((c) => c.args),
    completed: () => calls.filter((c) => c.fn === 'completeTask').map((c) => c.args),
  };
}

const task = (id: string, refNo: string): MonitorTask => ({ id, jobNo: `JOB-${id}`, blNo: null, refNo, checkedAt: null });

async function testStatusImage() {
  assert.equal(parseStatusImage({ src: '/kola/images/status/ACCEPT.gif' }), 'ACCEPT');
  assert.equal(parseStatusImage({ src: 'st_accept.png?v=2' }), 'ACCEPT');
  assert.equal(parseStatusImage({ src: '/img/cancel_reject.gif' }), 'CANCEL_REJECT');
  assert.equal(parseStatusImage({ src: '/img/IMPREJECT.gif' }), 'IMPREJECT');
  assert.equal(parseStatusImage({ src: '/img/reject.gif' }), 'REJECT');
  assert.equal(parseStatusImage({ src: '/img/send_cancel.gif' }), 'SEND_CANCEL');
  assert.equal(parseStatusImage({ src: '/img/send.gif' }), 'SEND');
  assert.equal(parseStatusImage({ src: '/img/1.gif', title: 'Customs Accept' }), 'ACCEPT');
  assert.equal(parseStatusImage({ src: '/img/2.gif', alt: 'เอกสารพร้อมส่ง' }), 'VALIDATED');
  assert.equal(parseStatusImage({ src: '/img/1.gif' }), null);
  console.log('✓ อ่านรหัสจากรูปป้ายสถานะ');
}

async function testZip() {
  const direct = await pdfFromDownload(mockPdf('x'), 'A0300691008769');
  assert.equal(direct.name, 'A0300691008769.pdf');

  const zip = new JSZip();
  zip.folder('_runtime_temp_20261030034633')!.file('A0300691008769.pdf', mockPdf('mine'));
  zip.file('A0290691012214.pdf', mockPdf('other'));
  const picked = await pdfFromDownload(await zip.generateAsync({ type: 'nodebuffer' }), 'A0300691008769');
  assert.ok(picked.body.equals(mockPdf('mine')), 'เลือกไฟล์ที่ชื่อตรงเลขใบขน ไม่ใช่ไฟล์แรก');

  await assert.rejects(pdfFromDownload(await zip.generateAsync({ type: 'nodebuffer' }), 'A9999999999999'), /ใน zip ไม่มี/);
  await assert.rejects(pdfFromDownload(Buffer.from('<html>error</html>'), 'A0300691008769'), /ไม่ใช่ zip/);
  console.log('✓ แตก zip จาก Save PDF');
}

async function testRound() {
  const mock = await startMockNetbay();
  const netbay = { ...netbaySettings({ NETBAY_URL: mock.url, NETBAY_USER: 'monitorerpkola', NETBAY_PASSWORD: 'x' }), headless: true };
  const lines: string[] = [];
  const workDir = mkdtempSync(join(tmpdir(), 'customs-monitor-'));

  mock.state.declarations = {
    101: 'QELS100015966', 102: 'QELS100015965', 104: 'QELS100015960',
    105: 'QELS100015956', 106: 'QELS100015971',
  };
  mock.state.statuses = {
    QELS100015966: { code: 'ACCEPT', image: '/images/status/ACCEPT.gif', declarationNo: 'A0300691008769' },
    QELS100015965: { code: 'VALIDATED', image: '/images/status/VALIDATED.gif' },
    QELS100015960: { code: 'REJECT', image: '/images/status/REJECT.gif' },
    // รูปป้ายชื่อไม่บอกสถานะ แต่ช่อง Status ของ NETBAY กรองได้ว่า Accept แล้ว
    QELS100015956: { code: 'ACCEPT', image: '/images/7.gif', declarationNo: 'A0290691009900' },
    QELS100015971: { code: 'ACCEPT', image: '/images/status/ACCEPT.gif' },
  };

  try {
    const erp = fakeErp();
    const result = await checkRound([
      task('T1', 'QELS100015966'), task('T2', 'QELS100015965'), task('T3', 'QELS100099999'),
      task('T4', 'QELS100015960'), task('T5', 'QELS100015956'), task('T6', 'QELS100015971'),
    ], { api: erp.api, netbay, workDir, log: (m) => lines.push(m) });
    const why = lines.join('\n');

    assert.deepEqual(result, { accepted: 2, waiting: 4, failed: 0 }, why);
    assert.deepEqual(erp.statusOf('T1'), [{ taskId: 'T1', status: 'ACCEPT' }], why);
    assert.deepEqual(erp.statusOf('T2'), [{ taskId: 'T2', status: 'VALIDATED' }], why);
    assert.deepEqual(erp.statusOf('T3'), [{ taskId: 'T3', status: NOT_FOUND }], why);
    assert.deepEqual(erp.statusOf('T4'), [{ taskId: 'T4', status: 'REJECT' }], why);
    assert.equal(erp.statusOf('T6')[0].status, 'ACCEPT');
    assert.match(erp.statusOf('T6')[0].error, /DECLARATION NO ยังว่าง/);

    const done = erp.completed();
    assert.deepEqual(done.map((d) => [d.taskId, d.entryNo, d.file.name]), [
      ['T1', 'A0300691008769', 'A0300691008769.pdf'],
      ['T5', 'A0290691009900', 'A0290691009900.pdf'],
    ], why);
    assert.ok(Buffer.from(done[0].file.base64, 'base64').equals(mockPdf('ใบขน A0300691008769')), 'PDF ที่ส่งเข้า ERP = ไฟล์ใน zip');
    assert.equal(done[0].file.mimeType, 'application/pdf');

    // ติ๊กแถวเดียวต่อครั้ง และเลือกชื่อไฟล์เป็นเลขที่ใบขน (ไม่ใช่ default)
    assert.deepEqual(mock.state.pdfRequests, [
      { refs: ['QELS100015966'], fileName: 'เลขที่ใบขน' },
      { refs: ['QELS100015956'], fileName: 'เลขที่ใบขน' },
    ]);
    assert.deepEqual(mock.state.login, ['monitorerpkola', 'x']);
    console.log('✓ เช็ก 1 รอบ: ACCEPT ดึงเลข + PDF · ที่ยังไม่ ACCEPT ส่งสถานะ');

    /* ---- เข้า NETBAY ไม่ได้ ---- */
    const down = fakeErp();
    const closed = { ...netbay, url: 'http://127.0.0.1:9' };
    await assert.rejects(checkRound([task('T7', 'QELS1'), task('T8', 'QELS2')], { api: down.api, netbay: closed, workDir, log: () => {} }));
    assert.match(down.statusOf('T7')[0].error, /เข้า NETBAY ไม่ได้/);
    assert.match(down.statusOf('T8')[0].error, /เข้า NETBAY ไม่ได้/);
    assert.deepEqual(down.completed(), []);
    console.log('✓ เข้า NETBAY ไม่ได้ — ทุกแถวบอกเหตุผล ไม่ปิดงาน');
  } finally {
    await mock.close();
  }
}

async function main() {
  await testStatusImage();
  await testZip();
  await testRound();
  console.log('\nผ่านทั้งหมด');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
