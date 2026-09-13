import { sql, type SQL } from 'drizzle-orm';

export function validJobDate(value: string | null | undefined): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : '';
}

/** Inclusive calendar dates in Thailand; the upper bound is the next midnight. */
export function jobCreatedConditions(column: SQL, from?: string, to?: string): SQL[] {
  const start = validJobDate(from);
  const end = validJobDate(to);
  return [
    ...(start ? [sql`${column} >= ${`${start}T00:00:00+07:00`}::timestamptz`] : []),
    ...(end ? [sql`${column} < (${`${end}T00:00:00+07:00`}::timestamptz + interval '24 hours')`] : []),
  ];
}
