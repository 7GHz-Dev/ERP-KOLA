import Link from 'next/link';
import { requireUserReady } from '@/lib/auth';
import { col, readParams } from '@/lib/columns';
import { listJobs } from '@/lib/queries/jobs';
import { masterCounts } from '@/lib/queries/master';
import { MasterMenu, JOBS_MENU_KEY } from '@/components/MasterMenu';
import { JobTable, Tabs, type Column } from '@/components/JobTable';
import { ConfirmSubmit } from '@/components/Interactions';
import { setJobActive } from '@/lib/actions/job-activation';

export const dynamic = 'force-dynamic';
const BASE = '/master/jobs';
const SEARCH_KEYS = ['jobNo', 'person', 'shipper', 'blNo', 'consignee', 'refNo'];
const TABS = [{ key: 'active', label: 'เปิดใช้งาน' }, { key: 'inactive', label: 'ปิดการใช้งาน' }];

export default async function MasterJobsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUserReady(['ADMIN']);
  const { one, search, sortBy, sortDir, carry } = readParams(await searchParams, SEARCH_KEYS);
  const tab = one('tab') === 'inactive' ? 'inactive' : 'active';
  const page = Math.max(1, Math.floor(Number(one('page')) || 1));
  const [{ rows, total, pageSize }, counts] = await Promise.all([
    listJobs({ archived: tab === 'inactive', search, sortBy: sortBy ?? 'createdAt', sortDir, page, pageSize: 100 }),
    masterCounts(),
  ]);
  const columns: Column[] = [
    { label: 'วันที่สร้าง JOB', sortKey: 'createdAt', render: r => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok' }).format(r.createdAt) },
    col.jobNo(), col.source(), col.clientInCharge(), col.shipper(), col.blNo(),
    col.consignee(), col.eta(), col.refNo(), col.anStatus(), col.fnStatus(),
    { label: 'สถานะการใช้งาน', render: r => <span className={`badge ${r.isArchived ? 'rejected' : 'approved'}`}>{r.isArchived ? 'ปิดการใช้งาน' : 'เปิดใช้งาน'}</span> },
    {
      label: 'จัดการ', kind: 'actions', render: r => (
        <form action={setJobActive} className="inline-form">
          <input type="hidden" name="jobId" value={r.id} />
          <input type="hidden" name="active" value={r.isArchived ? '1' : '0'} />
          <ConfirmSubmit
            label={r.isArchived ? 'เปิดใช้งานกลับ' : 'ปิดการใช้งาน'}
            tone={r.isArchived ? 'ok' : 'danger'}
            confirm={`${r.isArchived ? 'เปิด' : 'ปิด'}การใช้งาน ${r.jobNo} ใช่ไหม`}
            detail={r.isArchived ? 'งานจะกลับไปแสดงในทะเบียนงานและคิวตามสถานะเดิม' : 'งานจะถูกนำออกจากทะเบียนงาน คิวงาน และ Export โดยเก็บข้อมูลและไฟล์แนบไว้ เปิดใช้งานกลับได้จากหน้านี้'}
          />
        </form>
      ),
    },
  ];
  const pageHref = (next: number) => `${BASE}?${new URLSearchParams({ ...carry, tab, page: String(next) })}`;
  return (
    <>
      <div className="page-head"><h1>ปิดการใช้งาน JOB</h1><p>จัดการการใช้งาน JOB สำหรับ ADMIN · เก็บข้อมูลและไฟล์แนบเดิมไว้</p></div>
      <div className="master-layout">
        <MasterMenu current={JOBS_MENU_KEY} counts={counts} />
        <div style={{ minWidth: 0 }}>
          <Tabs basePath={BASE} items={TABS} active={tab} carry={carry} />
          <JobTable basePath={BASE} columns={columns} rows={rows} total={total} carry={{ ...carry, tab }}
            sortBy={sortBy ?? 'createdAt'} sortDir={sortDir} empty="ไม่พบ JOB ที่ตรงกับเงื่อนไข" />
          <div className="chip-row">
            {page > 1 ? <Link className="button tiny" href={pageHref(page - 1)}>หน้าก่อนหน้า</Link> : null}
            <span className="meta">หน้า {page}</span>
            {page * pageSize < total ? <Link className="button tiny" href={pageHref(page + 1)}>หน้าถัดไป</Link> : null}
          </div>
        </div>
      </div>
    </>
  );
}
