import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { doPaySelectionIds } from '../src/lib/do-pay-selection';
import * as claimBatch from '../src/lib/do-claim-batch';
import { allClaimText, claimAmountInput, readBatchClaims } from '../src/lib/do-claim-batch';
import { claimReportXlsx } from '../src/lib/do-claim-report';
import ExcelJS from 'exceljs';
import { claimSummary, claimText, extraClaimText } from '../src/lib/do-charges';
import * as doAttachments from '../src/lib/do-attachments';

function compile(path: string, dependencies: Record<string, unknown>) {
  const output = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function('require', 'exports', output)((name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`);
    return dependencies[name];
  }, exports);
  return exports;
}

async function main() {
  assert.deepEqual(doPaySelectionIds([' B ', 'A', 'B', '']), ['B', 'A']);
  assert.deepEqual(doPaySelectionIds(undefined), []);
  assert.deepEqual(doPaySelectionIds(Array.from({ length: 101 }, (_, n) => String(n))), []);
  let calls = 0;
  let jobs = [
    { id: 'A', jobNo: 'JOB-A', blNo: 'BL-A', doPayAmount: '10.00' },
    { id: 'B', jobNo: 'JOB-B', blNo: 'BL-B', doPayAmount: '20.00' },
  ];
  const { loadDoPayBatch } = compile('src/lib/queries/do-files.ts', {
    'drizzle-orm': { and: (...v: unknown[]) => v, eq: (...v: unknown[]) => v, inArray: (...v: unknown[]) => v },
    '@/db/schema': { jobs: {}, files: {} },
    '@/lib/do-letter': {},
    '@/lib/do-letter-evergreen': {},
    '@/lib/do-slip-match': {},
    '@/lib/queries/jobs': { sentToPartner: () => null },
    '@/lib/do-attachments': doAttachments,
    '@/db': { db: { select: () => ({ from: () => ({ where: async () => {
      calls++;
      return calls % 2 ? jobs : [{ id: 'FILE-A', jobId: 'A', fileName: 'a.pdf', mimeType: 'application/pdf' }];
    } }) }) } },
  });
  const entries = await loadDoPayBatch(['B', 'A']);
  assert.equal(calls, 2, 'Batch should use two queries, not one query per job');
  assert.deepEqual(entries.map((entry: any) => entry.job.id), ['B', 'A']);
  assert.equal(entries[0].invoiceDo, undefined, 'Missing PDF must retain the job and amount field');
  assert.equal(entries[1].invoiceDo.id, 'FILE-A');
  const { DoPayBatchPanel } = compile('src/components/DoPayBatchPanel.tsx', {
    'react/jsx-runtime': jsx,
    './DoPayBatchForms': { DoPayBatchForms: 'BatchForms' },
    './InvoicePdfPages': { InvoicePdfPages: 'PdfPages' },
  });
  const tree = DoPayBatchPanel({ entries });
  const nodes: any[] = [];
  function visit(node: any) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    nodes.push(node);
    visit(node.props?.children);
  }
  visit(tree);
  const { DoPayBatchForms } = compile('src/components/DoPayBatchForms.tsx', {
    'react/jsx-runtime': jsx,
    react: {
      useState: (value: unknown) => [value, () => {}], useRef: () => ({ current: null }),
      useActionState: (_action: unknown, initial: unknown) => [initial, () => {}, false],
    },
    './DoPayPanel': { DoPayPanel: 'AmountForm' },
    './Interactions': { ConfirmSubmit: 'ConfirmSubmit' },
    '@/lib/do-claim-batch': claimBatch,
    '@/lib/actions/do-claim-batch': { markDoClaimedBatch: () => {} },
  });
  visit(DoPayBatchForms({ entries: nodes.find(node => node.type === 'BatchForms').props.entries }));
  const forms = nodes.filter(node => node.type === 'AmountForm');
  assert.deepEqual(forms.map(node => [node.props.jobId, node.props.blNo, node.props.amount]), [
    ['B', 'BL-B', '20.00'], ['A', 'BL-A', '10.00'],
  ]);
  assert.ok(forms.every(node => node.props.formOnly && node.props.nextId === null));
  assert.equal(nodes.filter(node => node.type === 'PdfPages')[0].props.fileId, 'FILE-A');
  calls = 0;
  jobs = jobs.slice(0, 1);
  assert.equal(await loadDoPayBatch(['A', 'B']), null, 'Do not silently omit unavailable jobs');
  assert.equal(allClaimText([
    { blNo: 'BL-B', eta: '2026-09-13', shipline: 'WANHAI', amount: '18,400', charges: [] },
    { blNo: 'BL-A', eta: '2026-09-14', shipline: 'ONE', amount: '2200.50', charges: [] },
  ]), 'BL-B=18,400\nETA 13/9/2026 ของ WANHAI\n\nBL-A=2,200.50\nETA 14/9/2026 ของ ONE');
  // หัวข้อค่าใช้จ่ายต่อท้ายด้วย + แยกยอดพร้อมชื่อหัวข้อ ไม่บวกรวม
  const dep = { amount: '20000.00', topicName: 'ค่ามัดจำตู้', note: null };
  const dem = { amount: '1500.00', topicName: 'ค่า Demurrage', note: null };
  const other = { amount: '50.00', topicName: 'ค่าอื่นๆ', note: 'ค่าล้างตู้' };
  assert.equal(allClaimText([
    { blNo: 'BL-B', eta: '2026-09-13', shipline: 'WANHAI', amount: '18,400', charges: [dep, dem] },
    { blNo: 'BL-A', eta: '2026-09-14', shipline: 'ONE', amount: '2200.50', charges: [] },
  ]), 'BL-B=18,400+20,000 (ค่ามัดจำตู้)+1,500 (ค่า Demurrage)\nETA 13/9/2026 ของ WANHAI\n\nBL-A=2,200.50\nETA 14/9/2026 ของ ONE');
  assert.equal(claimText({ blNo: 'X', eta: null, shipline: 'ONE', amount: '100.00', charges: [] }), 'X=100\nETA  ของ ONE');
  assert.equal(claimSummary('18400.00', [dep]), '18,400+20,000 (ค่ามัดจำตู้)');
  assert.equal(claimSummary('18400.00', []), '18,400');
  assert.equal(claimSummary('100', [other]), '100+50 (ค่าอื่นๆ: ค่าล้างตู้)');
  // ค่าใช้จ่ายที่เพิ่มหลังตั้งเบิก — เฉพาะส่วนเพิ่ม ไม่มีค่า DO
  assert.equal(extraClaimText({ blNo: 'X', eta: '2026-09-13', shipline: 'ONE', charges: [dem, other] }),
    'X (เพิ่มเติม)=1,500 (ค่า Demurrage)+50 (ค่าอื่นๆ: ค่าล้างตู้)\nETA 13/9/2026 ของ ONE');
  for (const bad of ['', '-1', 'abc', '1,2', '1.234', 'Infinity', '10000000000000000']) assert.equal(claimAmountInput(bad), null);
  assert.equal(claimAmountInput('0'), '0.00');
  const form = new FormData();
  form.append('jobId', 'B'); form.set('amount:B', '18,400');
  form.append('jobId', 'A'); form.set('amount:A', '2200.50');
  form.set('amount:UNSELECTED', '999');
  assert.deepEqual(readBatchClaims(form), [
    { id: 'B', amount: '18400.00' },
    { id: 'A', amount: '2200.50' },
  ]);
  // ช่องมัดจำ/ค่าอื่นๆ แบบเดิมไม่ถูกอ่านแล้ว (หัวข้อค่าใช้จ่ายบันทึกแยกที่ do_charges)
  form.set('deposit:A', 'bad');
  assert.deepEqual(readBatchClaims(form)[1], { id: 'A', amount: '2200.50' });
  form.delete('deposit:A');

  // รายงาน Excel — ยอดเป็นตัวเลขจริง วันที่เป็นวันที่จริง และมีแถวรวม
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await claimReportXlsx([
    { claimedOn: '2026-10-01', arrivedAt: '2026-09-30 17:45', blNo: 'BL-1', doPayAmount: '18400.00', charges: [{ topic: 'ค่ามัดจำตู้', amount: '20000.00', note: null }] },
    { claimedOn: '2026-10-02', arrivedAt: null, blNo: 'BL-2', doPayAmount: '2200.50', charges: [{ topic: 'ค่าอื่นๆ', amount: '1500.00', note: 'ค่าล้างตู้' }] },
    { claimedOn: '2026-10-05', arrivedAt: null, blNo: 'BL-1', doPayAmount: null, charges: [
      { topic: 'ค่า Demurrage', amount: '1000.00', note: null }, { topic: 'ค่า Demurrage', amount: '500.00', note: null }] },
  ]) as any);
  const sheet = wb.worksheets[0];
  assert.deepEqual((sheet.getRow(1).values as unknown[]).slice(1),
    ['วันที่ตั้งเบิก', 'วันที่ส่งรายการมา', 'เลข BL', 'ยอดค่า DO', 'ค่ามัดจำตู้', 'ค่าอื่นๆ', 'ค่า Demurrage', 'หมายเหตุ', 'รวม']);
  assert.equal((sheet.getCell('A2').value as Date).toISOString().slice(0, 10), '2026-10-01');
  assert.equal((sheet.getCell('B2').value as Date).toISOString().slice(0, 16), '2026-09-30T17:45');
  assert.equal(sheet.getCell('B3').value, null);
  assert.equal(sheet.getCell('D3').value, 2200.5);
  assert.equal(sheet.getCell('E3').value, null);
  assert.equal(sheet.getCell('F3').value, 1500);
  assert.equal(sheet.getCell('H3').value, 'ค่าอื่นๆ: ค่าล้างตู้');
  assert.equal(sheet.getCell('D4').value, null, 'Extra claim row has no DO amount');
  assert.equal(sheet.getCell('G4').value, 1500, 'Same topic twice on one day is summed');
  assert.equal(sheet.getCell('H4').value, 'ตั้งเบิกเพิ่มเติม');
  assert.deepEqual(sheet.getCell('I2').value, { formula: 'SUM(D2:G2)' });
  assert.deepEqual(sheet.getCell('D5').value, { formula: 'SUM(D2:D4)' });
  assert.deepEqual(sheet.getCell('I5').value, { formula: 'SUM(I2:I4)' });
  const jobsTable = {};
  const chargesTable = {};
  let authorized = true;
  let mutations: any[] = [];
  let records: any[] = [{ id: 'A', jobNo: 'JOB-A' }, { id: 'B', jobNo: 'JOB-B' }];
  const { markDoClaimedBatch } = compile('src/lib/actions/do-claim-batch.ts', {
    'next/cache': { revalidatePath: () => {} },
    'drizzle-orm': { eq: (...args: unknown[]) => args, inArray: (...args: unknown[]) => args, and: (...args: unknown[]) => args, isNull: (...args: unknown[]) => args },
    '@/db/schema': { jobs: jobsTable, activityLog: {}, doCharges: chargesTable },
    '@/lib/auth': { requireActiveSession: async (roles: string[]) => {
      assert.deepEqual(roles, ['MAY']); if (!authorized) throw new Error('FORBIDDEN'); return { id: 'MAY-1' };
    } },
    '@/lib/do-claim-batch': { readBatchClaims }, './common': { newId: () => 'LOG' },
    '@/db': { db: { transaction: async (work: any) => {
      const staged: any[] = [];
      await work({
        select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ for: async () => records }) }) }) }),
        update: (table: unknown) => ({ set: (value: any) => ({ where: async (condition: any) => {
          if (table === jobsTable) staged.push({ value, id: condition[1] });
          else if (table === chargesTable) staged.push({ charges: true, value, id: condition[0][1] });
        } }) }),
        insert: () => ({ values: async () => {} }),
      });
      mutations.push(...staged);
    } } },
  });
  const initial = { error: '', completed: [], message: '' };
  authorized = false;
  assert.equal((await markDoClaimedBatch(initial, form)).error, 'FORBIDDEN');
  assert.equal(mutations.length, 0);
  authorized = true;
  records[0].doClaimedAt = new Date();
  assert.match((await markDoClaimedBatch(initial, form)).error, /ตั้งเบิกไปแล้ว/);
  assert.equal(mutations.length, 0, 'No partial claim when one job is already claimed');
  delete records[0].doClaimedAt;
  const result = await markDoClaimedBatch(initial, form);
  assert.equal(result.error, '');
  assert.deepEqual(result.completed, ['B', 'A']);
  assert.deepEqual(mutations.filter(item => !item.charges).map(item => [item.id, item.value.doPayAmount]),
    [['B', '18400.00'], ['A', '2200.50']]);
  // หัวข้อค่าใช้จ่ายของแต่ละงานตั้งเบิกไปพร้อมค่า DO
  assert.deepEqual(mutations.filter(item => item.charges).map(item => item.id), ['B', 'A']);
  assert.ok(mutations.filter(item => item.charges).every(item => item.value.claimedBy === 'MAY-1'));
  assert.ok(mutations.filter(item => !item.charges).every(item => item.value.doClaimedBy === 'MAY-1'));
  /*
   * ANN ส่งแลกไปก่อนแล้ว MAY ยังต้องตั้งเบิกได้
   * ของจริงเกิดบ่อย — ANN ส่งแลกไม่กี่นาทีหลัง MAY กรอกยอด
   * เดิมปฏิเสธทั้งชุด งานเลยหลุดจากแท็บรอตั้งเบิกและไม่เคยไปถึงแท็บตั้งเบิกแล้ว
   */
  mutations = [];
  records = [{ id: 'A', jobNo: 'JOB-A', doExchangedAt: new Date() }, { id: 'B', jobNo: 'JOB-B', doExchangedAt: new Date() }];
  const afterExchange = await markDoClaimedBatch(initial, form);
  assert.equal(afterExchange.error, '', 'Jobs ANN already exchanged must still be claimable');
  assert.equal(mutations.filter(item => !item.charges).length, 2);
  assert.ok(mutations.filter(item => !item.charges).every(item => item.value.doClaimedAt instanceof Date));
  mutations = [];
  form.set('amount:A', 'bad');
  assert.ok((await markDoClaimedBatch(initial, form)).error);
  assert.equal(mutations.length, 0);
  console.log('PASS: selection validation, batch order, missing PDFs, and independent Job/BL/amount pairing');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
