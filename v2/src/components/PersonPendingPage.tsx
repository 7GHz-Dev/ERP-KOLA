import Link from 'next/link';
import type { SQL } from 'drizzle-orm';
import { col, readParams } from '@/lib/columns';
import { JobTable, Tabs, type Column } from '@/components/JobTable';
import { listJobs, type JoinContext } from '@/lib/queries/jobs';
import { queueCounts } from '@/lib/queries/dashboard';

/**
 * หน้า Pending Jobs ของ Senior Officer / Head Officer — แท็บละคิวของคนนั้น
 *
 * เป็นหน้ารวมให้เห็นว่าตัวเองค้างอะไรอยู่บ้างในที่เดียว ตัวงานจริงยังทำที่หน้าของคิวนั้น
 * (ปุ่ม "ไปทำที่หน้า …" บนแต่ละแท็บ) ไม่ทำปุ่มซ้ำที่นี่ จะได้มีที่ทำงานที่เดียวต่อหนึ่งขั้น
 */
export type PendingTab = {
  key: string;
  label: string;
  /** อธิบายสั้น ๆ ว่าแท็บนี้คืองานอะไร */
  hint: string;
  where: (ctx: JoinContext) => (SQL | undefined)[];
  /** หน้าที่ใช้ทำงานของคิวนี้ */
  href: string;
  hrefLabel: string;
  extra?: Column[];
};

const SEARCH_KEYS = ['jobNo', 'blNo', 'person', 'shipper', 'consignee', 'vessel'];

export async function PersonPendingPage({
  title, subtitle, basePath, tabs, searchParams,
}: {
  title: string; subtitle: string; basePath: string; tabs: PendingTab[];
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { one, search, sortBy, sortDir, carry } = readParams(searchParams, SEARCH_KEYS);
  const tab = tabs.find((t) => t.key === one('tab')) ?? tabs[0];
  carry.tab = tab.key;

  const [counts, { rows, total }] = await Promise.all([
    queueCounts(Object.fromEntries(tabs.map((t) => [t.key, t.where]))),
    listJobs({ where: tab.where, search, sortBy: sortBy ?? 'eta', sortDir: sortBy ? sortDir : 'asc' }),
  ]);

  const columns: Column[] = [
    col.jobNo(), col.blNo(), col.clientInCharge(), col.shipper(), col.consignee(), col.vessel(), col.eta(),
    { label: 'ตู้', align: 'center', render: (r) => r.containerCount || '-' },
    ...(tab.extra ?? []),
  ];

  return (
    <>
      <div className="page-head">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>

      <Tabs
        basePath={basePath}
        items={tabs.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] || undefined }))}
        active={tab.key}
      />

      <div className="filter-bar">
        <span className="filter-note">{tab.hint}</span>
        <Link className="button tiny primary" href={tab.href}>ไปทำที่หน้า {tab.hrefLabel} →</Link>
      </div>

      <JobTable
        basePath={basePath}
        columns={columns}
        rows={rows} total={total} carry={carry} sortBy={sortBy ?? 'eta'} sortDir={sortBy ? sortDir : 'asc'}
        empty={`ไม่มีงานค้างในแท็บ "${tab.label}"`}
        hint="เรียงตาม ETA เก่าสุดก่อน"
      />
    </>
  );
}
