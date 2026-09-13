import assert from 'node:assert/strict';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { db } from '../src/db';
import { templateCsv, templateRows, TEMPLATE_COLUMNS } from '../src/lib/job-template';
import { jobCreatedConditions, validJobDate } from '../src/lib/job-created-date';

async function main() {
  assert.equal(validJobDate('2026-02-29'), '');
  assert.equal(validJobDate('2024-02-29'), '2024-02-29');
  assert.equal(validJobDate('invalid'), '');
  assert.deepEqual(jobCreatedConditions(sql`created_at`), []);
  const dialect = new PgDialect();
  const conditions = jobCreatedConditions(sql`created_at`, '2026-09-12', '2026-09-12');
  const bounds = conditions.map(c => dialect.sqlToQuery(c));
  assert.deepEqual(bounds.map(q => q.params), [['2026-09-12T00:00:00+07:00'], ['2026-09-12T00:00:00+07:00']]);
  assert.match(bounds[0].sql, />=/);
  assert.match(bounds[1].sql, /< .*interval '24 hours'/);

  const original = db.execute;
  let queryText = '';
  db.execute = (async (query: Parameters<typeof db.execute>[0]) => {
    queryText = dialect.sqlToQuery(query as ReturnType<typeof sql>).sql;
    return [
      { job_type_name: 'MSFZ - USED CAR', container_nos: 'AAA,BBB', container_count: 2, surrender_status: 'CLEARED' },
      { job_type_name: 'OTHER', container_nos: 'CCC', container_count: 1, surrender_status: 'ISSUE' },
    ];
  }) as typeof db.execute;
  try {
    const rows = await templateRows({ createdFrom: '2026-09-12' });
    assert.match(queryText, /string_agg\(c.container_no, ',' order by c.container_no\)/);
    assert.match(queryText, /j.created_at >=/);
    assert.equal(rows[0]['ประเภท'], 'MSFZ - รถยนต์เก่า');
    assert.equal(rows[1]['ประเภท'], 'OTHER');
    assert.equal(rows[0]['CONTAINER NO.'], 'AAA,BBB');
    assert.equal(rows[1]['CONTAINER NO.'], 'CCC');
    assert.ok(rows.every(row => row.SUR === ''));
    const csv = templateCsv(rows);
    assert.ok(csv.startsWith('\uFEFF' + TEMPLATE_COLUMNS.join(',')));
    assert.ok(csv.includes(',"AAA,BBB",'));
    assert.equal(TEMPLATE_COLUMNS.length, 27);
    console.log('PASS: template mapping, CSV quoting, date validation and inclusive Thai date bounds');
  } finally {
    db.execute = original;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
