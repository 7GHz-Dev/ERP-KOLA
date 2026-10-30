/**
 * worker สร้าง Draft ใบขน กับ ERP จำลอง (ในหน่วยความจำ) + NETBAY จำลอง (tests/draft-mock-netbay.ts)
 * ไม่ต่อฐานข้อมูล ไม่ออกเน็ต
 *
 *   1. รับงาน -> ตรวจ -> ออกเลข -> สร้างใบขน + Import CSV -> ส่ง Ref No. + Excel + CSV กลับ (ไม่ Save ไม่ Send to Customs)
 *   2. ส่งผลกลับไม่ถึง ERP แล้วงานถูกหยิบใหม่ -> ส่งผลเดิมซ้ำ ไม่สร้างใบขนใบที่สอง
 *   3. Import แล้วไม่ขึ้น success -> ไม่สำเร็จ พร้อมข้อความบนหน้าจอ NETBAY และเลขใบขนที่ค้างไว้
 *   4. invoice ผิด / BL ไม่ตรงงาน / ไม่ใช่ Excel -> ส่งเหตุผลกลับ โดยไม่แตะ NETBAY และไม่ออกเลข
 *   5. ลิงก์ Ref No.: login -> ค้นหา Reference No. -> เปิดใบขน
 *
 * ต้องมี Google Chrome (หรือ Chromium ของ Playwright) ในเครื่อง
 *   npm run test:draft
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { loadDraftData } from '../src/lib/draft/csv';
import { processTask, type Api, type Deps, type Task } from '../scripts/draft-task';
import { closeNetbayChrome, netbayProfileDir, netbaySettings, openDeclaration, setImportTimeout } from '../scripts/netbay-kola';
import { parseRef } from '../scripts/netbay-open';
import { REF_NO, startMockNetbay } from './draft-mock-netbay';

const FIX = join(__dirname, 'fixtures', 'draft');

type Call = { fn: string; args: Record<string, any> };

/** ERP จำลอง: งาน 1 ชิ้นต่อ task id  เก็บทุกคำสั่งที่ worker เรียก */
function fakeErp(files: Record<string, { name: string; body: Buffer }>, opts: { failComplete?: number } = {}) {
  const calls: Call[] = [];
  let failComplete = opts.failComplete ?? 0;
  let next = 1_000_000;
  const api: Api = async (fn, args = {}) => {
    calls.push({ fn, args });
    if (fn === 'downloadInputFile') {
      const f = files[args.taskId as string];
      return { fileName: f.name, base64: f.body.toString('base64') } as never;
    }
    if (fn === 'engineLookup') return { rows: [] } as never;
    if (fn === 'engineIssue') {
      return { issued: (args.issue as { head: string }[]).map((c) => ({ number: String(next), full: `${c.head}-${next++}` })) } as never;
    }
    if (fn === 'completeTask' && failComplete > 0) { failComplete -= 1; throw new Error('completeTask: เน็ตหลุด (จำลอง)'); }
    return { ok: true } as never;
  };
  return { api, calls, of: (fn: string) => calls.filter((c) => c.fn === fn) };
}

const task = (id: string, blNo = 'TESTBL0001'): Task => ({
  id, jobId: 'JOB-1', inputFileName: null, hasInputFile: true, data: { jobNo: 'KOLA-2026-0001', blNo },
});

async function main() {
  const mock = await startMockNetbay();
  const data = await loadDraftData();
  const netbay = { ...netbaySettings({ NETBAY_URL: mock.url, NETBAY_USER: 'u1', NETBAY_PASSWORD: 'p1' }), headless: true };
  const lines: string[] = [];
  const deps = (api: Api): Deps => ({
    api, data, netbay, workDir: mkdtempSync(join(tmpdir(), 'draft-worker-')), log: (m) => lines.push(m), retryWaits: [0, 0],
  });
  const msfz = { name: 'FN Invoice.xlsx', body: readFileSync(join(FIX, 'msfz.xlsx')) };

  try {
    /* ---- 1. สร้าง Draft สำเร็จ ---- */
    const erp = fakeErp({ T1: msfz });
    await processTask(task('T1'), deps(erp.api));
    assert.deepEqual(erp.of('failTask'), [], lines.join('\n'));
    const [done] = erp.of('completeTask');
    assert.equal(done.args.refNo, REF_NO);
    assert.equal(done.args.file.name, 'TESTBL0001.xlsx');
    assert.equal(done.args.csv.name, 'TESTBL0001.csv');
    assert.ok(Buffer.from(done.args.csv.base64, 'base64').equals(mock.state.upload!), 'CSV ที่ส่งกลับ = CSV ที่นำเข้า NETBAY');
    const [issue] = erp.of('engineIssue');
    assert.deepEqual(issue.args.issue.map((c: { head: string }) => c.head), ['HR15', '2GR', 'M271']);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(done.args.file.base64, 'base64') as unknown as ArrayBuffer);
    assert.deepEqual([20, 21, 22].map((r) => wb.worksheets[0].getCell(`J${r}`).value), ['HR15-1000000', '2GR-1000001', 'M271-1000002']);
    assert.ok(mock.state.upload!.toString('latin1').includes('HR15-1000000'));
    const today = new Date();
    const dd = `${String(today.getDate()).padStart(2, '0')}-${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`;
    assert.equal(mock.state.decl!.bl, 'TESTBL0001');
    assert.equal(mock.state.decl!.arrival, dd, 'ช่องวันที่ต้องกรอกจากต้นช่อง (input mask)');
    assert.equal(mock.state.decl!.importer_name, 'บริษัท เเม่สอด ฟรีโซน จำกัด');
    assert.equal(mock.state.created, 1);
    assert.equal(mock.state.saved, 0, 'ไม่กด Save');
    assert.equal(mock.state.sentToCustoms, false, 'ไม่กด Send to Customs');
    assert.ok(lines.some((l) => l.includes('Success!! Please check your invoice')));
    assert.ok(lines.some((l) => l.includes('พิกัดยังไม่ครบ 1 คัน')));         // คันที่ 3 ไม่มีพิกัด -> XXXX
    console.log('✓ สร้าง Draft + Import CSV แล้วส่ง Ref No. กลับ');

    /* ---- 2. ส่งผลกลับไม่ถึง -> หยิบใหม่ -> ส่งซ้ำ ไม่สร้างใบขนใหม่ ---- */
    const erp2 = fakeErp({ T2: msfz }, { failComplete: 2 });
    const d2 = deps(erp2.api);
    await processTask(task('T2'), d2);
    assert.equal(erp2.of('completeTask').length, 2);
    assert.equal(mock.state.created, 2);
    await processTask(task('T2'), d2);
    assert.equal(erp2.of('completeTask').length, 3);
    assert.equal(erp2.of('completeTask')[2].args.refNo, REF_NO);
    assert.equal(mock.state.created, 2, 'ห้ามสร้างใบขนซ้ำ');
    console.log('✓ ส่งผลซ้ำได้โดยไม่สร้างใบขนใบที่สอง');

    /* ---- 3. Import ไม่ขึ้น success ---- */
    mock.state.importOk = false;
    setImportTimeout(3_000);
    const erp3 = fakeErp({ T3: msfz });
    await processTask(task('T3'), deps(erp3.api));
    const [fail] = erp3.of('failTask');
    assert.match(fail.args.error, /success please check your invoice/);
    assert.match(fail.args.error, /Error: invalid file format/);
    assert.match(fail.args.error, new RegExp(`${REF_NO} ถูกสร้างค้างไว้`));
    assert.deepEqual(erp3.of('completeTask'), []);
    mock.state.importOk = true;
    console.log('✓ Import ไม่สำเร็จ แจ้งข้อความ NETBAY + ใบขนที่ค้าง');

    /* ---- 4. ปัญหาที่ PAINT ต้องแก้ ---- */
    const created = mock.state.created;
    const erp4 = fakeErp({
      B: { name: 'blank.xlsx', body: readFileSync(join(FIX, 'blank.xlsx')) },
      O: msfz,
      P: { name: 'FN.pdf', body: Buffer.from('%PDF-1.4') },
    });
    await processTask(task('B'), deps(erp4.api));
    await processTask(task('O', 'OTHERBL999'), deps(erp4.api));
    await processTask(task('P'), deps(erp4.api));
    const errors = erp4.of('failTask').map((c) => c.args.error as string);
    assert.match(errors[0], /ไม่รู้จักชนิดไฟล์/);
    assert.match(errors[1], /ไม่ตรงกับงาน \(OTHERBL999\)/);
    assert.match(errors[2], /ต้องเป็นไฟล์ Excel/);
    assert.deepEqual(erp4.of('engineIssue'), [], 'ไม่ออกเลข');
    assert.equal(mock.state.created, created, 'ไม่แตะ NETBAY');
    console.log('✓ invoice ผิด / BL ไม่ตรง / ไม่ใช่ Excel ส่งเหตุผลกลับ');

    /* ---- 5. ลิงก์ Ref No. ---- */
    assert.equal(parseRef('kola-netbay://open?ref=qenx000000020'), 'QENX000000020');
    assert.equal(parseRef(' QELS100015902 '), 'QELS100015902');
    for (const bad of ['', 'kola-netbay://open', "QENX'; alert(1)//", 'A'.repeat(60)]) assert.throws(() => parseRef(bad));
    /*
     * กดครั้งแรก login แล้วจำ session ไว้ · ครั้งต่อไปใช้ Chrome/session เดิม ไม่ login ซ้ำ
     * (login ซ้ำด้วยบัญชีเดิม = หน้าต่างที่เปิดอยู่ก่อนหลุด) · session หลุดเพราะ login จากที่อื่น → login ใหม่เอง
     * หน้าต่างค้างไว้ (keepOpen) แบบที่ใช้จริง แล้วปิด Chrome เองตอนจบเทสต์
     */
    mock.state.requireSession = true;
    const profilesDir = mkdtempSync(join(tmpdir(), 'netbay-open-'));
    const keep = { keepOpen: true, profilesDir };
    const base = mock.state.logins;               // เทสต์สร้าง Draft ด้านบน login ไปแล้ว
    const searchedBefore = mock.state.searched.length;
    try {
      assert.equal(await openDeclaration('QENX000000042', netbay, keep), '16300');
      assert.equal(mock.state.logins - base, 1, 'กดครั้งแรก login');
      assert.equal(await openDeclaration('QENX000000777', netbay, keep), null);
      assert.equal(await openDeclaration('QENX000000099', netbay, keep), '16399');
      assert.equal(mock.state.logins - base, 1, 'กดครั้งต่อไปใช้ session เดิม ไม่ login ซ้ำ');
      mock.state.epoch += 1;                        // บัญชีนี้ถูก login จากที่อื่น
      assert.equal(await openDeclaration('QENX000000042', netbay, keep), '16300');
      assert.equal(mock.state.logins - base, 2, 'session หลุด → login ใหม่เอง');
      assert.deepEqual(mock.state.searched.slice(searchedBefore), ['QENX000000042', 'QENX000000777', 'QENX000000099', 'QENX000000042']);
    } finally {
      await closeNetbayChrome(netbayProfileDir(profilesDir, netbay.username));
    }
    console.log('✓ เปิดใบขนจาก Reference No. — จำ session ข้ามครั้ง · หลุดแล้ว login ใหม่เอง');

    console.log('ผ่านทั้งหมด');
  } finally {
    await mock.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
