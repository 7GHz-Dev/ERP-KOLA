import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

async function main() {
  let allowed = true;
  let writes: any[] = [];
  let transactions = 0;
  const jobsTable = { id: 'id' };
  const filesTable = {};
  let records: any[] = [{ id: 'A', jobNo: 'JOB-A', status: 'READY' }, { id: 'B', jobNo: 'JOB-B', status: 'READY' }];
  let bundled = [{ jobId: 'A' }, { jobId: 'B' }];
  const mocks: Record<string, unknown> = {
    'next/cache': { revalidatePath: () => {} },
    'drizzle-orm': { and: (...args: unknown[]) => args, eq: (...args: unknown[]) => args, inArray: (...args: unknown[]) => args },
    '@/db/schema': { jobs: jobsTable, files: filesTable, activityLog: 'log', statusHistory: 'history' },
    '@/lib/auth': { requireActiveSession: async (roles: string[]) => {
      assert.deepEqual(roles, ['ANN']); if (!allowed) throw new Error('FORBIDDEN'); return { id: 'ANN-1' };
    } },
    './common': { newId: () => 'TEST-ID' },
    '@/db': { db: { transaction: async (work: any) => {
      transactions++;
      const pending: any[] = [];
      await work({
        select: () => ({ from: (table: unknown) => ({ where: () => table === jobsTable
          ? { orderBy: () => ({ for: async () => records }) } : Promise.resolve(bundled) }) }),
        update: () => ({ set: (value: any) => ({ where: async (condition: any) => pending.push({ type: 'update', id: condition[1], value }) }) }),
        insert: (type: string) => ({ values: async (value: any) => pending.push({ type, value }) }),
      });
      writes.push(...pending);
    } } },
  };
  const code = ts.transpileModule(readFileSync('src/lib/actions/do-exchange-batch.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: any = {};
  new Function('require', 'exports', code)((name: string) => {
    if (!(name in mocks)) throw new Error(`Unexpected dependency ${name}`);
    return mocks[name];
  }, exports);
  const action = exports.markDoExchangedBatch;
  const initial = { error: '', message: '' };
  const data = new FormData(); data.append('jobId', 'A'); data.append('jobId', 'B');
  allowed = false;
  assert.equal((await action(initial, data)).error, 'FORBIDDEN');
  assert.equal(transactions, 0);
  allowed = true;
  assert.ok((await action(initial, new FormData())).error);
  bundled = [{ jobId: 'A' }];
  assert.match((await action(initial, data)).error, /JOB-B.*ยังไม่ได้รวมชุด/);
  assert.equal(writes.length, 0);
  bundled.push({ jobId: 'B' });
  records[1].doExchangedAt = new Date();
  assert.match((await action(initial, data)).error, /ส่งแลก DO ไปแล้ว/);
  assert.equal(writes.length, 0);
  delete records[1].doExchangedAt;
  records[1].isArchived = true;
  assert.match((await action(initial, data)).error, /ปิดการใช้งาน/);
  assert.equal(writes.length, 0);
  records[1].isArchived = false;
  const result = await action(initial, data);
  assert.equal(result.error, '');
  assert.deepEqual(writes.filter(row => row.type === 'update').map(row => [row.id, row.value.doExchangedBy]), [['A', 'ANN-1'], ['B', 'ANN-1']]);
  assert.equal(writes.filter(row => row.type === 'history').length, 2);
  assert.equal(writes.filter(row => row.type === 'log').length, 2);
  writes = [];
  data.append('jobId', 'A');
  assert.ok((await action(initial, data)).error);
  assert.equal(writes.length, 0);
  console.log('PASS: ANN authorization, selected jobs only, required bundles, duplicate/archive guards and per-job audit');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
