import { requireUser } from '@/lib/auth';
import { col, draftBadge, readParams } from '@/lib/columns';
import { JobTable, Tabs, FileChip, type Column } from '@/components/JobTable';
import { RejectDraftButton, SubmitCustomsTask } from '@/components/ActionForms';
import { listJobs, QUEUE } from '@/lib/queries/jobs';

export const dynamic = 'force-dynamic';

const TABS = [
  { key: 'review', label: 'ตรวจ Draft' },
  { key: 'waiting', label: 'รอไฟล์และเลขใบขน' },
  { key: 'done', label: 'ใบขนเสร็จสิ้น' },
];
const SEARCH_KEYS = ['shipper', 'blNo', 'refNo', 'consignee', 'entryNo'];

export default async function FahDraftPage({
  searchParams,
}: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser(['FAH']);
  const params = await searchParams;
  const { one, search, sortBy, sortDir, carry } = readParams(params, SEARCH_KEYS);
  const tab = TABS.some((t) => t.key === one('tab')) ? one('tab') : 'review';

  const where =
    tab === 'waiting' ? QUEUE.fahDraftWaiting()
    : tab === 'done' ? QUEUE.fahDraftDone()
    : QUEUE.fahDraftReview();

  const { rows, total } = await listJobs({ where, search, sortBy, sortDir });

  const columns: Column[] =
    tab === 'done'
      ? [col.shipper(), col.blNo(), col.refNo(), col.consignee(), col.declarationNo(),
         { label: 'ไฟล์ใบขนสินค้า', render: (r) => <FileChip file={r.currentFiles?.CUSTOMS_ENTRY_DOC} /> }]
      : tab === 'waiting'
      ? [col.shipper(), col.blNo(), col.refNo(), col.consignee(),
         { label: 'สถานะ', render: () => <span className="badge pending">รอไฟล์และเลขใบขนสินค้า</span> }]
      : [col.shipper(), col.blNo(), col.refNo(), col.consignee(),
         { label: 'สถานะ Draft', render: draftBadge },
         {
           label: 'จัดการ',
           render: (r) => (
             <div className="row-actions">
               <SubmitCustomsTask jobId={r.id} />
               <RejectDraftButton jobId={r.id} />
             </div>
           ),
         }];

  return (
    <>
      <div className="page-head">
        <h1>ตรวจ Draft / ทำใบขนสินค้า</h1>
        <p>ตรวจ Draft → สร้างใบขน → รอไฟล์และเลขใบขน</p>
      </div>
      <Tabs basePath="/fah/draft" items={TABS} active={tab} carry={carry} />
      <JobTable
        basePath="/fah/draft"
        columns={columns}
        rows={rows} total={total} carry={{ ...carry, tab }} sortBy={sortBy} sortDir={sortDir}
        empty={tab === 'done' ? 'ยังไม่มีใบขนที่เสร็จ' : tab === 'waiting' ? 'ไม่มีงานรอผล' : 'ยังไม่มี Draft ส่งมาตรวจ'}
        hint="งานที่ได้เลขใบขนแล้วจะไปแสดงที่ งานคงค้าง → 4. เตรียมเอกสารเดิน E"
      />
    </>
  );
}
