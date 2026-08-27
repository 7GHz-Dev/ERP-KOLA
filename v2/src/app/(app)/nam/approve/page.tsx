import { requireUser } from '@/lib/auth';
import { col, readParams } from '@/lib/columns';
import { JobTable } from '@/components/JobTable';
import { ApproveReject } from '@/components/ActionForms';
import { listJobs, QUEUE } from '@/lib/queries/jobs';

export const dynamic = 'force-dynamic';
const SEARCH_KEYS = ['shipper', 'blNo', 'consignee', 'vessel'];

export default async function NamApprovePage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser(['NAMKANG']);
  const { search, sortBy, sortDir, carry } = readParams(await searchParams, SEARCH_KEYS);
  const { rows, total } = await listJobs({ where: QUEUE.namApprove(), search, sortBy, sortDir });

  return (
    <>
      <div className="page-head">
        <h1>อนุมัติข้อมูล BL เข้าตารางหลัก</h1>
        <p>ตรวจข้อมูล BL ที่ PAINT ส่งมา</p>
      </div>
      <JobTable
        basePath="/nam/approve"
        columns={[
          col.shipper(), col.blNo(), col.vessel(), col.eta(), col.consignee(),
          { label: 'DEM', align: 'right', sortKey: 'demDays', render: (r) => r.demDays },
          { label: 'DET', align: 'right', sortKey: 'detDays', render: (r) => r.detDays },
          { label: 'จัดการ', kind: 'actions', render: (r) => (r.anId ? <ApproveReject approvalId={r.anId} /> : '-') },
        ]}
        rows={rows} total={total} carry={carry} sortBy={sortBy} sortDir={sortDir}
        empty="ไม่มีรายการรออนุมัติ"
      />
    </>
  );
}
