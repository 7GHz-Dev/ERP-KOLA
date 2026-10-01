import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { doPaySelectionIds } from '../src/lib/do-pay-selection';
import { allClaimText, claimAmountInput, depositInput, readBatchClaims } from '../src/lib/do-claim-batch';
import { claimAmounts, claimText } from '../src/lib/do-claim';
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
    '@/lib/do-claim-batch': { allClaimText, claimAmountInput, depositInput },
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
    { blNo: 'BL-B', eta: '2026-09-13', shipline: 'WANHAI', amount: '18,400' },
    { blNo: 'BL-A', eta: '2026-09-14', shipline: 'ONE', amount: '2200.50' },
  ]), 'BL-B=18,400\nETA 13/9/2026 ของ WANHAI\n\nBL-A=2,200.50\nETA 14/9/2026 ของ ONE');
  // ค่ามัดจำตู้ต่อท้ายด้วย + แยกยอด ไม่บวกรวม · ไม่มีหรือเป็นศูนย์ก็ไม่ต้องมี +
  assert.equal(allClaimText([
    { blNo: 'BL-B', eta: '2026-09-13', shipline: 'WANHAI', amount: '18,400', deposit: '20000' },
    { blNo: 'BL-A', eta: '2026-09-14', shipline: 'ONE', amount: '2200.50', deposit: '' },
  ]), 'BL-B=18,400+20,000\nETA 13/9/2026 ของ WANHAI\n\nBL-A=2,200.50\nETA 14/9/2026 ของ ONE');
  assert.equal(claimText({ blNo: 'X', eta: null, shipline: 'ONE', amount: '100.00', deposit: '0.00' }), 'X=100\nETA  ของ ONE');
  assert.equal(claimAmounts('18400.00', '5000.50'), '18,400+5,000.50');
  assert.equal(claimAmounts('18400.00', null), '18,400');
  assert.equal(depositInput(''), null);
  assert.equal(depositInput(' 20,000 '), '20000.00');
  assert.equal(depositInput('abc'), undefined);
  for (const bad of ['', '-1', 'abc', '1,2', '1.234', 'Infinity', '10000000000000000']) assert.equal(claimAmountInput(bad), null);
  assert.equal(claimAmountInput('0'), '0.00');
  const form = new FormData();
  form.append('jobId', 'B'); form.set('amount:B', '18,400');
  form.append('jobId', 'A'); form.set('amount:A', '2200.50');
  form.set('amount:UNSELECTED', '999');
  assert.deepEqual(readBatchClaims(form), [
    { id: 'B', amount: '18400.00', deposit: null }, { id: 'A', amount: '2200.50', deposit: null },
  ]);
  form.set('deposit:A', 'bad');
  assert.throws(() => readBatchClaims(form), /มัดจำ/);
  form.delete('deposit:A');
  form.set('deposit:B', '20,000');
  assert.deepEqual(readBatchClaims(form)[0], { id: 'B', amount: '18400.00', deposit: '20000.00' });
  let authorized = true;
  let mutations: any[] = [];
  let records: any[] = [{ id: 'A', jobNo: 'JOB-A' }, { id: 'B', jobNo: 'JOB-B' }];
  const { markDoClaimedBatch } = compile('src/lib/actions/do-claim-batch.ts', {
    'next/cache': { revalidatePath: () => {} },
    'drizzle-orm': { eq: (...args: unknown[]) => args, inArray: (...args: unknown[]) => args },
    '@/db/schema': { jobs: {}, activityLog: {} },
    '@/lib/auth': { requireActiveSession: async (roles: string[]) => {
      assert.deepEqual(roles, ['MAY']); if (!authorized) throw new Error('FORBIDDEN'); return { id: 'MAY-1' };
    } },
    '@/lib/do-claim-batch': { readBatchClaims }, './common': { newId: () => 'LOG' },
    '@/db': { db: { transaction: async (work: any) => {
      const staged: any[] = [];
      await work({
        select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ for: async () => records }) }) }) }),
        update: () => ({ set: (value: any) => ({ where: async (condition: any) => { staged.push({ value, id: condition[1] }); } }) }),
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
  assert.deepEqual(mutations.map(item => [item.id, item.value.doPayAmount, item.value.doDepositAmount]),
    [['B', '18400.00', '20000.00'], ['A', '2200.50', null]]);
  assert.ok(mutations.every(item => item.value.doClaimedBy === 'MAY-1'));
  /*
   * ANN ส่งแลกไปก่อนแล้ว MAY ยังต้องตั้งเบิกได้
   * ของจริงเกิดบ่อย — ANN ส่งแลกไม่กี่นาทีหลัง MAY กรอกยอด
   * เดิมปฏิเสธทั้งชุด งานเลยหลุดจากแท็บรอตั้งเบิกและไม่เคยไปถึงแท็บตั้งเบิกแล้ว
   */
  mutations = [];
  records = [{ id: 'A', jobNo: 'JOB-A', doExchangedAt: new Date() }, { id: 'B', jobNo: 'JOB-B', doExchangedAt: new Date() }];
  const afterExchange = await markDoClaimedBatch(initial, form);
  assert.equal(afterExchange.error, '', 'Jobs ANN already exchanged must still be claimable');
  assert.equal(mutations.length, 2);
  assert.ok(mutations.every(item => item.value.doClaimedAt instanceof Date));
  mutations = [];
  form.set('amount:A', 'bad');
  assert.ok((await markDoClaimedBatch(initial, form)).error);
  assert.equal(mutations.length, 0);
  console.log('PASS: selection validation, batch order, missing PDFs, and independent Job/BL/amount pairing');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
