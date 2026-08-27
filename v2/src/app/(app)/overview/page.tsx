import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { col, readParams } from '@/lib/columns';
import { JobTable } from '@/components/JobTable';
import { listJobs } from '@/lib/queries/jobs';
import { dashboardSummary } from '@/lib/queries/dashboard';

export const dynamic = 'force-dynamic';
const SEARCH_KEYS = ['jobNo', 'blNo', 'shipper', 'consignee', 'vessel'];

const CARDS: Array<{ key: keyof Awaited<ReturnType<typeof dashboardSummary>>; label: string; href?: string; tone?: string }> = [
  { key: 'total', label: 'งานทั้งหมด' },
  { key: 'invoiceAlerts', label: 'Invoice เปลี่ยนใหม่', tone: 'rejected' },
  { key: 'waitingAn', label: 'รออนุมัติ AN', href: '/nam/approve', tone: 'pending' },
  { key: 'waitingFn', label: 'รออนุมัติ FN', href: '/fah/fn', tone: 'pending' },
  { key: 'customsDraft', label: 'Draft ใบขน', tone: 'neutral' },
  { key: 'customsFiled', label: 'ได้เลขใบขนแล้ว', tone: 'approved' },
  { key: 'released', label: 'ปล่อยสินค้าแล้ว', tone: 'approved' },
  { key: 'surrenderIssue', label: 'Surrender มีปัญหา', tone: 'rejected' },
];

export default async function OverviewPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const { search, sortBy, sortDir, carry } = readParams(await searchParams, SEARCH_KEYS);
  const [summary, { rows, total }] = await Promise.all([
    dashboardSummary(),
    listJobs({ search, sortBy, sortDir, pageSize: 50 }),
  ]);

  return (
    <>
      <div className="page-head">
        <h1>ภาพรวม</h1>
        <p>สรุปสถานะงานทั้งระบบ</p>
      </div>

      <div className="cards">
        {CARDS.map((c) => {
          const body = (
            <>
              <b>{summary[c.key]}</b>
              <span>{c.label}</span>
            </>
          );
          return c.href ? (
            <Link key={c.key} className={`card ${c.tone ?? ''}`} href={c.href} prefetch>{body}</Link>
          ) : (
            <div key={c.key} className={`card ${c.tone ?? ''}`}>{body}</div>
          );
        })}
      </div>

      <JobTable
        basePath="/overview"
        columns={[col.jobNo(), col.blNo(), col.shipper(), col.consignee(), col.vessel(),
          col.eta(), col.anStatus(), col.fnStatus()]}
        rows={rows} total={total} carry={carry} sortBy={sortBy} sortDir={sortDir}
      />
    </>
  );
}
