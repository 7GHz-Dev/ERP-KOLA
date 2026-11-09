import Link from 'next/link';
import { and, eq, sql } from 'drizzle-orm';
import { jobs } from '@/db/schema';
import { requireUserReady } from '@/lib/auth';
import { col, draftBadge, readParams } from '@/lib/columns';
import { JobTable, Tabs, type Column } from '@/components/JobTable';
import { listJobs, type JoinContext } from '@/lib/queries/jobs';
import { isMissingTable, priceStatus } from '@/lib/sale/price-store';
import { baht } from '@/lib/sale/pricing';

export const dynamic = 'force-dynamic';

/*
 * งานที่ต้องมีราคา = เข้าตารางหลักแล้ว (AN ผ่าน) — ต้องกำหนดก่อนยิงใบขน
 *   wait  ยังไม่ยืนยันราคา และยังไม่ได้เลขใบขน
 *   done  ยืนยันราคาแล้ว
 *   all   ทุกงานที่เข้าตารางหลักแล้ว
 */
const TABS = [
  { key: 'wait', label: 'รอกำหนดราคา' },
  { key: 'done', label: 'ยืนยันราคาแล้ว' },
  { key: 'all', label: 'ทั้งหมด' },
];
const SEARCH_KEYS = ['jobNo', 'blNo', 'person', 'shipper', 'consignee', 'vessel'];

const confirmed = sql`exists (select 1 from job_price_sets ps where ps.job_id = ${jobs.id} and ps.confirmed_at is not null)`;
const whereFor = (tab: string) => ({ an }: JoinContext) => [
  eq(an.status, 'APPROVED'),
  tab === 'wait' ? and(sql`not ${confirmed}`, sql`${jobs.customsStatus} <> 'FILED'`) : undefined,
  tab === 'done' ? confirmed : undefined,
];

export default async function SalePricingPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUserReady(['SALE', 'SALE_SUPERVISOR']);
  const { one, search, sortBy, sortDir, carry } = readParams(await searchParams, SEARCH_KEYS);
  const tab = TABS.some((t) => t.key === one('tab')) ? one('tab') : 'wait';
  carry.tab = tab;

  let data: Awaited<ReturnType<typeof listJobs>>;
  try {
    data = await listJobs({ where: whereFor(tab), search, sortBy: sortBy ?? 'eta', sortDir: sortBy ? sortDir : 'asc' });
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    return (
      <>
        <div className="page-head"><h1>กำหนดราคา</h1></div>
        <p className="notice">ยังไม่ได้สร้างตารางของงาน Sale — ผู้ดูแลระบบต้องรัน <code>npm run migrate:sale</code> ก่อน</p>
      </>
    );
  }
  const { rows, total } = data;
  const prices = (await priceStatus(rows.map((r) => r.id))) ?? new Map();

  const columns: Column[] = [
    col.eta(), col.jobNo(), col.blNo(), col.clientInCharge(), col.shipper(), col.consignee(), col.jobType(),
    { label: 'ตู้', align: 'center', render: (r) => r.containerCount || '-' },
    {
      label: 'ขั้นงาน', kind: 'wrap',
      render: (r) => {
        if (r.customsStatus === 'FILED') return <span className="badge approved">ได้เลขใบขนแล้ว</span>;
        // ถึงขั้น Draft แล้ว = ทีมรอราคาอยู่ ยิงใบขนไม่ได้จนกว่าจะยืนยัน
        if (r.fnStatus === 'APPROVED') return <span className="chip-row">{draftBadge(r)}{prices.get(r.id)?.confirmed ? null : <span className="badge rejected">🔒 รอราคาเพื่อยิงใบขน</span>}</span>;
        return <span className="badge neutral">FN {r.fnStatus === 'PENDING' ? 'รออนุมัติ' : 'ยังไม่ส่ง'}</span>;
      },
    },
    {
      label: 'ราคาเก็บลูกค้า', align: 'right',
      render: (r) => {
        const p = prices.get(r.id);
        if (!p) return <span className="muted">-</span>;
        return <span>{baht(p.total)} {p.confirmed ? <span className="badge approved">ยืนยัน</span> : <span className="badge pending">ร่าง</span>}</span>;
      },
    },
    {
      label: 'จัดการ', kind: 'actions',
      render: (r) => <Link className="button tiny primary" href={`/sale/pricing/${r.id}`}>{prices.get(r.id) ? 'แก้ราคา' : 'กำหนดราคา'}</Link>,
    },
  ];

  return (
    <>
      <div className="page-head">
        <h1>กำหนดราคา</h1>
        <p>ราคาเก็บลูกค้าของงานที่เข้าตารางหลักแล้ว · ต้องยืนยันก่อนทีมยิงใบขน (งานที่ถึงขั้น Draft แล้วมีป้าย 🔒) · เรียงตาม ETA เก่าสุดก่อน</p>
      </div>
      <Tabs basePath="/sale/pricing" items={TABS} active={tab} />
      <JobTable
        basePath="/sale/pricing"
        columns={columns}
        rows={rows} total={total} carry={carry} sortBy={sortBy ?? 'eta'} sortDir={sortBy ? sortDir : 'asc'}
        empty={tab === 'wait' ? 'ไม่มีงานที่รอกำหนดราคา' : 'ไม่มีรายการ'}
      />
    </>
  );
}
