import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as pdfLib from '@cantoo/pdf-lib';
import { doBundleFileName, isDoBundleKind } from '../src/lib/do-bundle-options';
import { readMergeProgress } from '../src/lib/merge-progress';
import * as doAttachments from '../src/lib/do-attachments';
import { checkPageOrder, keepPages } from '../src/lib/pdf-pages';

function compile(path: string, mocks: Record<string, unknown>) {
  const output = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, any> = {};
  new Function('require', 'exports', output)((name: string) => {
    if (!(name in mocks)) throw new Error(`Unexpected import: ${name}`);
    return mocks[name];
  }, exports);
  return exports;
}

async function main() {
  assert.equal(doBundleFileName('TESTBL001', 'do'), 'TESTBL001 stamp.pdf');
  assert.equal(doBundleFileName('TESTBL001', 'doPlain'), 'TESTBL001 no stamp.pdf');
  assert.equal(doBundleFileName('TESTBL001', 'doUploaded'), 'TESTBL001 uploaded.pdf');
  assert.throws(() => doBundleFileName('', 'do'));
  assert.ok(isDoBundleKind('doUploaded'));
  assert.ok(!isDoBundleKind('bad'));
  const makePdf = async (widths: number[]) => {
    const pdf = await pdfLib.PDFDocument.create();
    widths.forEach(width => pdf.addPage([width, 500]));
    return Buffer.from(await pdf.save());
  };
  const stored = new Map<string, Buffer>();
  stored.set('signed', await makePdf([301, 302]));
  stored.set('plain', await makePdf([303, 304]));
  stored.set('uploaded', await makePdf([305]));
  stored.set('invoice', await makePdf([401, 402]));
  let current: any[] = [];
  const inserts: any[] = [];
  const generated: boolean[] = [];
  const job = { id: 'JOB-1', jobNo: 'KOLA-1', blNo: 'TESTBL001', isArchived: false };
  const tables = { jobs: { name: 'jobs' }, files: { name: 'files' } };
  const mocks: Record<string, unknown> = {
    'drizzle-orm': { and: (...args: unknown[]) => args, eq: (...args: unknown[]) => args },
    '@/db/schema': tables,
    '@/db': { db: {
      select: () => ({ from: (table: unknown) => ({ where: () => {
        const rows = table === tables.jobs ? [job] : current;
        return { limit: async () => rows.slice(0, 1), then: (resolve: any) => Promise.resolve(rows).then(resolve) };
      } }) }),
      update: () => ({ set: () => ({ where: async () => {} }) }),
      insert: () => ({ values: async (row: unknown) => { inserts.push(row); } }),
    } },
    '@/lib/storage': {
      buildKey: (_job: string, _category: string, id: string) => id,
      downloadFile: async (key: string) => ({ body: stored.get(key)! }), ensureBucket: async () => {},
      uploadFile: async (key: string, bytes: Buffer) => { stored.set(key, bytes); },
    },
    '@/lib/actions/common': { logActivity: async () => {}, newId: () => `FILE-${inserts.length}` },
    '@/lib/eoffice-pdf': {}, '@/lib/xlsx-pdf': {},
    '@/lib/do-bundle-options': { doBundleFileName },
    '@/lib/do-attachments': doAttachments,
    '@cantoo/pdf-lib': pdfLib,
    '@/lib/do-letter-store': { storeDoLetterPdf: async (_job: string, _user: string, stamp: boolean) => {
      generated.push(stamp);
      current.push({ category: stamp ? 'DO_LETTER_SIGNED' : 'DO_LETTER', storageKey: stamp ? 'signed' : 'plain', fileName: 'letter.pdf', note: 'ระบบออกให้อัตโนมัติ' });
    } },
  };
  const { buildBundle } = compile('src/lib/eoffice-bundle.ts', mocks);
  for (const [kind, expected] of [['do', [301, 302, 401, 402]], ['doPlain', [303, 304, 401, 402]], ['doUploaded', [305, 401, 402]]] as const) {
    current = [
      { category: 'DO_LETTER_UPLOADED', storageKey: 'uploaded', fileName: 'custom.pdf' },
      { category: 'INVOICE_DO', storageKey: 'invoice', fileName: 'invoice.pdf' },
    ];
    const steps: any[] = [];
    const result = await buildBundle(job.id, 'ANN-1', (step: any) => { steps.push(step); }, kind);
    const saved = inserts.at(-1);
    assert.equal(saved.fileName, doBundleFileName(job.blNo, kind));
    const merged = await pdfLib.PDFDocument.load(stored.get(result.fileId)!);
    assert.deepEqual(merged.getPages().map(page => page.getWidth()), [...expected]);
    assert.equal(steps.at(-1).fileId, result.fileId);
    assert.ok(saved.note.includes('ยังขาด:'), 'Preserve missing-document notes in the saved preview');
  }
  assert.deepEqual(generated, [true, false], 'Uploaded mode must never generate a letter');

  /*
   * Slip กับเอกสารหลายใบต่องาน — ต้องเข้าชุดครบทุกใบ เรียงตามหัวข้อก่อน แล้วตามเวลาที่อัป
   * ใส่ข้อมูลสลับลำดับไว้โดยตั้งใจ ถ้าระบบเรียงตามลำดับที่ฐานข้อมูลคืนมา ผลจะผิด
   */
  stored.set('slip-do-late', await makePdf([502]));
  stored.set('slip-do-early', await makePdf([501]));
  stored.set('slip-dem', await makePdf([503]));
  stored.set('inv-dem', await makePdf([601, 602]));
  stored.set('other', await makePdf([701]));
  current = [
    { category: 'DO_OTHER', storageKey: 'other', fileName: 'other.pdf', uploadedAt: '2026-10-01T01:00:00Z' },
    { category: 'DO_INV_DEM', storageKey: 'inv-dem', fileName: 'inv-dem.pdf', uploadedAt: '2026-10-01T01:00:00Z' },
    { category: 'DO_SLIP_DEM', storageKey: 'slip-dem', fileName: 'slip-dem.png', uploadedAt: '2026-10-01T00:00:00Z' },
    { category: 'DO_SLIP', storageKey: 'slip-do-late', fileName: 'b.pdf', uploadedAt: '2026-10-01T09:00:00Z' },
    { category: 'DO_SLIP', storageKey: 'slip-do-early', fileName: 'a.pdf', uploadedAt: '2026-10-01T08:00:00Z' },
    { category: 'INVOICE_DO', storageKey: 'invoice', fileName: 'invoice.pdf' },
    { category: 'DO_LETTER_UPLOADED', storageKey: 'uploaded', fileName: 'custom.pdf' },
  ];
  const multi = await buildBundle(job.id, 'ANN-1', undefined, 'doUploaded');
  const multiPages = (await pdfLib.PDFDocument.load(stored.get(multi.fileId)!)).getPages().map(page => page.getWidth());
  assert.deepEqual(multiPages, [305, 401, 402, 501, 502, 503, 601, 602, 701],
    'letter → Invoice DO → Slip ค่า DO (by upload time) → Slip DEM → Invoice DEM → other');
  const multiNote = inserts.at(-1).note;
  assert.ok(multiNote.includes('Slip ค่า DO (2 ใบ'), 'Two slips under one heading are reported as one part with a count');
  assert.ok(!/ค่ามัดจำตู้|ค่า DET|Invoice DET|ล่าช้า/.test(multiNote), 'Optional headings that are absent must not be reported as missing');

  // ไม่มีสลิปค่า DO เลย ยังต้องเตือนเหมือนเดิม — เป็นใบหลักของทุกชุด
  current = [
    { category: 'DO_LETTER_UPLOADED', storageKey: 'uploaded', fileName: 'custom.pdf' },
    { category: 'INVOICE_DO', storageKey: 'invoice', fileName: 'invoice.pdf' },
  ];
  await buildBundle(job.id, 'ANN-1', undefined, 'doUploaded');
  assert.ok(inserts.at(-1).note.includes('Slip ค่า DO (ยังไม่มีไฟล์)'), 'Missing DO slip is still flagged');

  // ลำดับหน้าใหม่ต้องครบทุกหน้า หน้าละครั้ง — กันหน้าหายหรือซ้ำโดยไม่ตั้งใจ
  assert.deepEqual(checkPageOrder([2, 0, 1], 3), [2, 0, 1]);
  assert.throws(() => checkPageOrder([0, 1], 3), /ครบ 3 หน้า/);
  assert.throws(() => checkPageOrder([0, 0, 1], 3), /ซ้ำ/);
  assert.throws(() => checkPageOrder([0, 1, 3], 3), /ไม่มีหน้า/);
  assert.throws(() => checkPageOrder([0, 1.5, 2], 3), /ไม่มีหน้า/);
  assert.throws(() => checkPageOrder([0, 1, 2], 3), /เหมือนเดิม/);
  assert.throws(() => checkPageOrder('0,1,2', 3), /ครบ/);
  const reordered = await keepPages(await makePdf([11, 22, 33]), checkPageOrder([2, 0, 1], 3));
  assert.deepEqual((await pdfLib.PDFDocument.load(reordered)).getPages().map(page => page.getWidth()), [33, 11, 22]);
  current = [{ category: 'DO_LETTER', note: 'ระบบออกให้อัตโนมัติ', storageKey: 'plain' }];
  const before = inserts.length;
  await assert.rejects(buildBundle(job.id, 'ANN-1', undefined, 'doUploaded'), /อัปโหลดเอง/);
  assert.equal(inserts.length, before, 'Missing uploaded letter must not save an incomplete bundle');
  const { concatenateDoPdfs } = compile('src/lib/do-bundle-combine.ts', {
    ...mocks, './do-bundle-options': { doBundleFileName },
  });
  const joined = await concatenateDoPdfs([stored.get('signed'), stored.get('uploaded'), stored.get('invoice')]);
  assert.deepEqual((await pdfLib.PDFDocument.load(joined)).getPages().map(page => page.getWidth()), [301, 302, 305, 401, 402]);
  const data = new TextEncoder().encode(JSON.stringify({ status: 'done', fileId: 'FILE-OK', detail: 'เสร็จแล้ว' }));
  const response = new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < data.length; i += 2) controller.enqueue(data.slice(i, i + 2));
    controller.close();
  } }));
  assert.equal((await readMergeProgress(response, () => {})).fileId, 'FILE-OK');
  await assert.rejects(readMergeProgress(new Response('{"status":"error","detail":"ไม่มีสิทธิ์"}', { status: 401 }), () => {}), /ไม่มีสิทธิ์/);
  await assert.rejects(readMergeProgress(new Response('{"status":"reading"}\n'), () => {}), /ยังไม่เสร็จ/);
  console.log('PASS: automatic letter modes, filenames, uploaded-only guard, multi-slip heading order, page reorder and streaming responses');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
