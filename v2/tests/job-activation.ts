import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Exercise the server action without changing any live jobs.
let allowed = true;
let transactions = 0;
let changed = true;
let exists = true;
let lastUpdate: Record<string, unknown> = {};
const logs: Record<string, unknown>[] = [];
const invalidations: unknown[][] = [];
const tx = {
  update: () => ({ set: (value: Record<string, unknown>) => {
    lastUpdate = value;
    return { where: () => ({ returning: async () => changed ? [{ jobNo: 'TEST-001' }] : [] }) };
  } }),
  select: () => ({ from: () => ({ where: () => ({ limit: async () => exists ? [{ id: 'JOB-TEST' }] : [] }) }) }),
  insert: () => ({ values: async (value: Record<string, unknown>) => { logs.push(value); } }),
};
const mocks: Record<string, unknown> = {
  'next/cache': { revalidatePath: (...args: unknown[]) => invalidations.push(args) },
  'drizzle-orm': { and: (...args: unknown[]) => args, eq: (...args: unknown[]) => args },
  '@/db': { db: { transaction: async (work: (value: typeof tx) => Promise<void>) => { transactions++; await work(tx); } } },
  '@/db/schema': { jobs: { id: 'id', isArchived: 'isArchived', jobNo: 'jobNo' }, activityLog: {} },
  '@/lib/auth': { requireActiveSession: async (roles: string[]) => {
    assert.deepEqual(roles, ['ADMIN']);
    if (!allowed) throw new Error('FORBIDDEN');
    return { id: 'ADMIN-TEST', mustChangePassword: false };
  } },
  './common': {
    runAction: (work: () => Promise<void>) => work(), newId: () => 'LOG-TEST',
    required: (value: unknown) => { if (!value) throw new Error('required'); return value; },
  },
};
const compiled = ts.transpileModule(readFileSync('src/lib/actions/job-activation.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports: { setJobActive?: (form: FormData) => Promise<void> } = {};
new Function('require', 'exports', compiled)((name: string) => {
  if (!(name in mocks)) throw new Error(`Unexpected dependency: ${name}`);
  return mocks[name];
}, exports);
const form = (active: string) => { const data = new FormData(); data.set('jobId', 'JOB-TEST'); data.set('active', active); return data; };
async function main() {
  const action = exports.setJobActive!;
  allowed = false;
  await assert.rejects(action(form('0')), /FORBIDDEN/);
  assert.equal(transactions, 0);
  allowed = true;
  await assert.rejects(action(form('invalid')), /สถานะ/);
  assert.equal(transactions, 0);
  await action(form('0'));
  assert.equal(lastUpdate.isArchived, true);
  assert.equal(lastUpdate.updatedBy, 'ADMIN-TEST');
  assert.equal(logs[0].action, 'DISABLE_JOB');
  await action(form('1'));
  assert.equal(lastUpdate.isArchived, false);
  assert.equal(logs[1].action, 'ENABLE_JOB');
  changed = false;
  await action(form('1'));
  assert.equal(logs.length, 2, 'Duplicate submission must not create another audit entry');
  exists = false;
  await assert.rejects(action(form('0')), /ไม่พบ JOB/);
  assert.ok(invalidations.every(args => args[0] === '/' && args[1] === 'layout'));
  console.log('PASS: admin authorization, input validation, disable/restore, audit and duplicate submissions');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
