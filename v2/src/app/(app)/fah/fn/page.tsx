import { requireUser } from '@/lib/auth';
import { col, readParams } from '@/lib/columns';
import { JobTable, FileChip } from '@/components/JobTable';
import { ApproveReject } from '@/components/ActionForms';
import { listJobs, QUEUE } from '@/lib/queries/jobs';

export const dynamic = 'force-dynamic';
const SEARCH_KEYS = ['shipper', 'blNo', 'consignee'];

export default async function FahFnPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser(['FAH']);
  const { search, sortBy, sortDir, carry } = readParams(await searchParams, SEARCH_KEYS);
  const { rows, total } = await listJobs({ where: QUEUE.fahFn(), search, sortBy, sortDir });

  return (
    <>
      <div className="page-head">
        <h1>อนุมัติ Final Invoice</h1>
        <p>ตรวจไฟล์ที่ PAINT ส่งมา แล้วอนุมัติหรือตีกลับพร้อมเหตุผล</p>
      </div>
      <JobTable
        basePath="/fah/fn"
        columns={[
          col.shipper(), col.blNo(), col.consignee(), col.eta(),
          { label: 'Final Invoice', render: (r) => <FileChip file={r.currentFiles?.FINAL_INVOICE} /> },
          { label: 'จัดการ', kind: 'actions', render: (r) => (r.fnId ? <ApproveReject approvalId={r.fnId} /> : '-') },
        ]}
        rows={rows} total={total} carry={carry} sortBy={sortBy} sortDir={sortDir}
        empty="ไม่มีรายการรออนุมัติ"
      />
    </>
  );
}
